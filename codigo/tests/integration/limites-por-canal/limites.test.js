'use strict';

const nock = require('nock');
const request = require('supertest');

const { crearApp } = require('../../../src/app');
const { pool: poolApp } = require('../../../src/core/db');
const billetera = require('../../helpers/billetera');
const { limpiar, cerrar, pool } = require('../../helpers/db');
const { token } = require('../../helpers/tokens');

const RUTA = '/api/v1/depositos';
const CUENTA = '0011-0123-456789';
const BODY = { cuentaDestino: CUENTA, monto: '2500.00', moneda: 'PEN', canal: 'AGENTE' };
const MENSAJE = 'El monto supera el máximo permitido para el canal.';

// SPEC-10: registrar-deposito activo; limites-por-canal según el caso; el resto inactivas.
function manifest({ limites = 'activo' } = {}) {
  return {
    version: 1,
    servicio: 'deposito-service',
    features: [
      { id: 'registrar-deposito', estado: 'activo', tipo: 'endpoint' },
      { id: 'limites-por-canal', estado: limites, tipo: 'validador', orden: 10 },
      { id: 'conversion-moneda', estado: 'inactivo', tipo: 'transformador', orden: 10 },
      { id: 'alerta-uif', estado: 'inactivo', tipo: 'post-proceso', orden: 10 },
    ],
  };
}

function post(app, { body = BODY, clave = 'lc-clave-0001', correlation } = {}) {
  let r = request(app)
    .post(RUTA)
    .set('Authorization', `Bearer ${token('usr-agente-1')}`)
    .set('Idempotency-Key', clave);
  if (correlation) r = r.set('X-Correlation-Id', correlation);
  return r.send(body);
}

async function depositos() {
  const { rows } = await pool.query(
    'SELECT id, monto::text AS monto, moneda, canal, estado, usuario_id FROM depositos',
  );
  return rows;
}

// La auditoría escribe después de responder: si su INSERT coincide con el TRUNCATE de
// limpiar() de la prueba siguiente, PostgreSQL detecta un deadlock. Se espera a que el
// conteo se estabilice.
async function esperarAuditoria() {
  let previo = -1;
  for (let i = 0; i < 20; i += 1) {
    await new Promise((r) => { setTimeout(r, 50); });
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM auditoria_depositos');
    if (rows[0].n === previo) return;
    previo = rows[0].n;
  }
}

beforeAll(() => {
  nock.disableNetConnect();
  nock.enableNetConnect(/127\.0\.0\.1|localhost/);
});

beforeEach(async () => {
  await limpiar();
  nock.cleanAll();
});

afterEach(async () => {
  await esperarAuditoria();
  jest.restoreAllMocks();
  nock.abortPendingRequests();
  nock.cleanAll();
});

afterAll(async () => {
  nock.enableNetConnect();
  await new Promise((r) => { setTimeout(r, 200); });
  await poolApp.end();
  await cerrar();
});

describe('SPEC-10 limites-por-canal: casos', () => {
  test('LC-T05 feature activa, POST 2500.00 PEN AGENTE → 422 LIMITE_CANAL_EXCEDIDO; 0 filas '
    + 'en depositos; billetera no llamada (sin acreditación)', async () => {
    const app = crearApp({ manifest: manifest() });
    const consulta = billetera.cuentaActiva(CUENTA);
    const credito = billetera.acreditaOk(CUENTA);

    const res = await post(app, { correlation: 'lc-t05' });

    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      codigo: 'LIMITE_CANAL_EXCEDIDO',
      mensaje: MENSAJE,
      correlationId: 'lc-t05',
    });
    expect(await depositos()).toHaveLength(0);
    expect(credito.peticiones).toHaveLength(0);
    // SPEC-07 RD-R04: la cuenta se consulta antes de los validadores; solo esa llamada.
    expect(consulta.peticiones).toHaveLength(1);
  });

  test('LC-T06 feature inactiva en el manifest, POST 2500.00 PEN AGENTE → 201', async () => {
    const app = crearApp({ manifest: manifest({ limites: 'inactivo' }) });
    billetera.cuentaActiva(CUENTA);
    const credito = billetera.acreditaOk(CUENTA);

    const res = await post(app);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ monto: '2500.00', moneda: 'PEN', estado: 'COMPLETADO' });
    expect(await depositos()).toEqual([
      expect.objectContaining({ id: res.body.id, monto: '2500.00', estado: 'COMPLETADO' }),
    ]);
    expect(credito.peticiones).toHaveLength(1);
    expect(credito.peticiones[0].body.monto).toBe('2500.00');
  });
});

describe('SPEC-10 limites-por-canal: reglas con la BD real', () => {
  test('LC-R02 feature activa, AGENTE 2000.00 PEN (igual al límite) → 201', async () => {
    const app = crearApp({ manifest: manifest() });
    billetera.cuentaActiva(CUENTA);
    const credito = billetera.acreditaOk(CUENTA);

    const res = await post(app, { body: { ...BODY, monto: '2000.00' } });

    expect(res.status).toBe(201);
    expect(res.body.estado).toBe('COMPLETADO');
    expect(await depositos()).toHaveLength(1);
    expect(credito.peticiones).toHaveLength(1);
  });

  test('limites_canal tiene los datos de ejemplo de §4 y limpiar() no la vacía', async () => {
    const { rows } = await pool.query(
      'SELECT canal, moneda, monto_maximo::text AS maximo FROM limites_canal'
        + ' ORDER BY canal, moneda',
    );
    expect(rows).toEqual([
      { canal: 'AGENTE', moneda: 'PEN', maximo: '2000.00' },
      { canal: 'AGENTE', moneda: 'USD', maximo: '500.00' },
      { canal: 'APP', moneda: 'PEN', maximo: '5000.00' },
      { canal: 'APP', moneda: 'USD', maximo: '1500.00' },
      { canal: 'VENTANILLA', moneda: 'PEN', maximo: '50000.00' },
      { canal: 'VENTANILLA', moneda: 'USD', maximo: '15000.00' },
    ]);
  });

  test('LC-R04 cambiar el límite en la tabla cambia el resultado sin tocar código', async () => {
    const app = crearApp({ manifest: manifest() });
    billetera.cuentaActiva(CUENTA);
    billetera.acreditaOk(CUENTA);
    await pool.query(
      "UPDATE limites_canal SET monto_maximo = 3000.00 WHERE canal = 'AGENTE' AND moneda = 'PEN'",
    );
    try {
      const res = await post(app);

      expect(res.status).toBe(201);
      expect(await depositos()).toHaveLength(1);
    } finally {
      await pool.query(
        "UPDATE limites_canal SET monto_maximo = 2000.00"
          + " WHERE canal = 'AGENTE' AND moneda = 'PEN'",
      );
    }
  });
});
