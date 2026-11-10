'use strict';

const nock = require('nock');
const request = require('supertest');

const { crearApp } = require('../../../src/app');
const { pool: poolApp } = require('../../../src/core/db');
const { logger } = require('../../../src/core/logger');
const repository = require('../../../src/modules/alerta-uif/repository');
const billetera = require('../../helpers/billetera');
const { limpiar, cerrar, pool } = require('../../helpers/db');
const { token } = require('../../helpers/tokens');

const RUTA = '/api/v1/depositos';
const CUENTA = '0011-0123-456789';
const USUARIO = 'usr-cajero-1';
const BODY = { cuentaDestino: CUENTA, monto: '1000.00', moneda: 'PEN', canal: 'VENTANILLA' };
// SPEC-02 §4 v2.0: billetera USD de usr-cliente-2 (Billetera USD); límite VENTANILLA USD 15000.00.
const WALLET_USD = '22222222-2222-4222-8222-222222222222';
const BODY_USD = { cuentaDestino: WALLET_USD, monto: '300.00', moneda: 'USD', canal: 'VENTANILLA' };

// SPEC-12 §6: VENTANILLA (límite alto), conversion-moneda inactiva; alerta-uif según el caso.
function manifest({ uif = 'activo' } = {}) {
  return {
    version: 1,
    servicio: 'deposito-service',
    features: [
      { id: 'registrar-deposito', estado: 'activo', tipo: 'endpoint' },
      { id: 'consultar-deposito', estado: 'activo', tipo: 'endpoint' },
      { id: 'limites-por-canal', estado: 'activo', tipo: 'validador', orden: 10 },
      { id: 'conversion-moneda', estado: 'inactivo', tipo: 'transformador', orden: 10 },
      { id: 'alerta-uif', estado: uif, tipo: 'post-proceso', orden: 10 },
    ],
  };
}

function post(app, {
  monto = '1000.00', clave = 'uif-clave-0001', correlation, body = BODY,
} = {}) {
  let r = request(app)
    .post(RUTA)
    .set('Authorization', `Bearer ${token(USUARIO)}`)
    .set('Idempotency-Key', clave);
  if (correlation) r = r.set('X-Correlation-Id', correlation);
  return r.send({ ...body, monto });
}

function get(app, id) {
  return request(app).get(`${RUTA}/${id}`).set('Authorization', `Bearer ${token(USUARIO)}`);
}

async function alertas() {
  const { rows } = await pool.query(
    `SELECT id, deposito_id, monto::text AS monto, moneda, umbral::text AS umbral,
            estado_reporte FROM alertas_uif`,
  );
  return rows;
}

async function depositos() {
  const { rows } = await pool.query('SELECT id, monto::text AS monto, estado FROM depositos');
  return rows;
}

// Logger falso solo para el hijo del módulo alerta-uif (contexto.logger de SPEC-06 §4).
function espiarLoggerUif() {
  const falso = {
    error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(),
    trace: jest.fn(), fatal: jest.fn(),
  };
  falso.child = () => falso;
  const original = logger.child.bind(logger);
  jest.spyOn(logger, 'child').mockImplementation((bindings, ...resto) => (
    bindings && bindings.modulo === 'alerta-uif' ? falso : original(bindings, ...resto)
  ));
  return falso;
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

describe('SPEC-12 alerta-uif: casos', () => {
  test('UIF-T01 COMPLETADO con 1000.00 PEN → 1 fila PENDIENTE con umbral 1000.00', async () => {
    const app = crearApp({ manifest: manifest() });
    billetera.cuentaActiva(CUENTA);
    const credito = billetera.acreditaOk(CUENTA);

    const res = await post(app);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ monto: '1000.00', moneda: 'PEN', estado: 'COMPLETADO' });
    expect(credito.peticiones).toHaveLength(1);
    const filas = await alertas();
    expect(filas).toEqual([{
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      deposito_id: res.body.id,
      monto: '1000.00',
      moneda: 'PEN',
      umbral: '1000.00',
      estado_reporte: 'PENDIENTE',
    }]);
    expect(filas[0].id).not.toBe(res.body.id);
  });

  test('UIF-T02 COMPLETADO con 999.99 PEN → 0 filas', async () => {
    const app = crearApp({ manifest: manifest() });
    billetera.cuentaActiva(CUENTA);
    billetera.acreditaOk(CUENTA);

    const res = await post(app, { monto: '999.99' });

    expect(res.status).toBe(201);
    expect(res.body.estado).toBe('COMPLETADO');
    expect(await alertas()).toHaveLength(0);
  });

  test('UIF-T03 billetera 500, 5000.00 PEN (FALLIDO) → 0 filas', async () => {
    const app = crearApp({ manifest: manifest() });
    billetera.cuentaActiva(CUENTA);
    const credito = billetera.acreditaFalla(CUENTA, { status: 500 });

    const res = await post(app, { monto: '5000.00' });

    expect(res.status).toBe(502);
    expect(res.body.codigo).toBe('BILLETERA_NO_DISPONIBLE');
    expect(credito.peticiones).toHaveLength(1);
    expect(await depositos()).toEqual([expect.objectContaining({ estado: 'FALLIDO' })]);
    expect(await alertas()).toHaveLength(0);
  });

  test('UIF-T04 error forzado en el INSERT → 201 normal; logger.error con depositoId',
    async () => {
      const app = crearApp({ manifest: manifest() });
      billetera.cuentaActiva(CUENTA);
      billetera.acreditaOk(CUENTA);
      const log = espiarLoggerUif();
      const real = repository.insertar;
      // Error real de PostgreSQL: moneda de 4 caracteres viola CHAR(3).
      const insertar = jest.spyOn(repository, 'insertar')
        .mockImplementation((db, alerta) => real(db, { ...alerta, moneda: 'PENX' }));

      const res = await post(app, { monto: '5000.00', correlation: 'uif-t04' });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ monto: '5000.00', moneda: 'PEN', estado: 'COMPLETADO' });
      expect(insertar).toHaveBeenCalledTimes(1);
      expect(await depositos()).toEqual([
        { id: res.body.id, monto: '5000.00', estado: 'COMPLETADO' },
      ]);
      expect(await alertas()).toHaveLength(0);
      expect(log.error).toHaveBeenCalledTimes(1);
      expect(log.error.mock.calls[0][0]).toEqual(
        expect.objectContaining({ depositoId: res.body.id }),
      );
    });

  test('UIF-T05 GET /depositos/{id} de un depósito con alerta → sin datos de UIF', async () => {
    const app = crearApp({ manifest: manifest() });
    billetera.cuentaActiva(CUENTA);
    billetera.acreditaOk(CUENTA);
    const creado = await post(app, { monto: '5000.00' });
    expect(creado.status).toBe(201);
    expect(await alertas()).toHaveLength(1);

    const res = await get(app, creado.body.id);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual([
      'actualizadoEn', 'canal', 'creadoEn', 'cuentaDestino', 'estado', 'extensiones', 'id',
      'moneda', 'monto', 'referencia',
    ]);
    expect(res.body.extensiones).toEqual({});
    expect(JSON.stringify(res.body)).not.toMatch(/uif|umbral|PENDIENTE|estadoReporte/i);
    expect(JSON.stringify(creado.body)).not.toMatch(/uif|umbral|PENDIENTE|estadoReporte/i);
  });

  test('UIF-T06 feature inactivo, 5000.00 PEN → 201; 0 filas', async () => {
    const app = crearApp({ manifest: manifest({ uif: 'inactivo' }) });
    billetera.cuentaActiva(CUENTA);
    billetera.acreditaOk(CUENTA);

    const res = await post(app, { monto: '5000.00' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ monto: '5000.00', estado: 'COMPLETADO' });
    expect(await alertas()).toHaveLength(0);
  });
});

describe('SPEC-12 alerta-uif: reglas con la BD real', () => {
  test('UIF-R01 reintento exitoso tras FALLIDO con la misma clave → 1 alerta', async () => {
    const app = crearApp({ manifest: manifest() });
    billetera.cuentaActiva(CUENTA);
    billetera.acreditaFalla(CUENTA, { status: 500 });
    const fallo = await post(app, { monto: '5000.00' });
    expect(fallo.status).toBe(502);
    expect(await alertas()).toHaveLength(0);

    billetera.acreditaOk(CUENTA);
    const res = await post(app, { monto: '5000.00' });

    expect(res.status).toBe(201);
    expect(res.body.estado).toBe('COMPLETADO');
    expect(await alertas()).toEqual([
      expect.objectContaining({ deposito_id: res.body.id, estado_reporte: 'PENDIENTE' }),
    ]);
  });

  test('UIF-R07 la alerta no se escribe en la auditoría', async () => {
    const app = crearApp({ manifest: manifest() });
    billetera.cuentaActiva(CUENTA);
    billetera.acreditaOk(CUENTA);

    const res = await post(app, { monto: '5000.00' });
    expect(res.status).toBe(201);
    await esperarAuditoria();

    const { rows } = await pool.query(
      'SELECT row_to_json(a)::text AS t FROM auditoria_depositos a',
    );
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach(({ t }) => expect(t).not.toMatch(/uif|umbral|estado_reporte/i));
  });
});

describe('SPEC-12 alerta-uif: umbral USD con Billetera USD', () => {
  test('UIF-R03 300.00 USD (igual al umbral) a la billetera USD → 1 alerta umbral 300.00',
    async () => {
      const app = crearApp({ manifest: manifest() });
      const consulta = billetera.billeteraUsdExiste(WALLET_USD);
      const credito = billetera.acreditaUsdOk();
      const creditoPen = billetera.acreditaOk(CUENTA);

      const res = await post(app, { monto: '300.00', body: BODY_USD });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        cuentaDestino: WALLET_USD, monto: '300.00', moneda: 'USD', estado: 'COMPLETADO',
      });
      expect(consulta.peticiones).toHaveLength(1);
      expect(credito.peticiones).toHaveLength(1);
      expect(creditoPen.peticiones).toHaveLength(0);
      expect(await alertas()).toEqual([{
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        deposito_id: res.body.id,
        monto: '300.00',
        moneda: 'USD',
        umbral: '300.00',
        estado_reporte: 'PENDIENTE',
      }]);
    });

  test('UIF-R03 299.99 USD a la billetera USD → COMPLETADO; 0 alertas', async () => {
    const app = crearApp({ manifest: manifest() });
    billetera.billeteraUsdExiste(WALLET_USD);
    const credito = billetera.acreditaUsdOk();

    const res = await post(app, { monto: '299.99', body: BODY_USD });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ moneda: 'USD', estado: 'COMPLETADO' });
    expect(credito.peticiones).toHaveLength(1);
    expect(await alertas()).toHaveLength(0);
  });

  test('UIF-T03 (USD) Billetera USD 500, 5000.00 USD (FALLIDO) → 0 alertas', async () => {
    const app = crearApp({ manifest: manifest() });
    billetera.billeteraUsdExiste(WALLET_USD);
    const credito = billetera.acreditaUsdFalla({ status: 500 });

    const res = await post(app, { monto: '5000.00', body: BODY_USD });

    expect(res.status).toBe(502);
    expect(res.body.codigo).toBe('BILLETERA_NO_DISPONIBLE');
    expect(credito.peticiones).toHaveLength(1);
    expect(await depositos()).toEqual([expect.objectContaining({ estado: 'FALLIDO' })]);
    expect(await alertas()).toHaveLength(0);
  });
});

// SPEC-12 v1.3, UIF-R01: la reconciliación (RD-R13) ejecuta los post-procesos una sola vez por
// depósito. SPEC-02 §4: aaaaaaaa-… / usr-pendiente (202 y luego COMPLETADO) y bbbbbbbb-… /
// usr-pendiente-falla (202 y luego FALLIDO). Monto sobre UIF_UMBRAL_USD (300.00), dentro del
// límite VENTANILLA USD (15000.00).
describe('SPEC-12 v1.3 alerta-uif: reconciliación (UIF-R01, RD-R13)', () => {
  const reconciliacion = require('../../../src/modules/registrar-deposito/reconciliacion');
  const WALLET_PENDIENTE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const WALLET_PENDIENTE_FALLA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  // POST que Billetera USD deja en 202 VALIDADO; luego se envejece la fila más allá de
  // RECONCILIACION_ANTIGUEDAD_MS para que la reconciliación la tome.
  async function depositoPendiente(app, cuentaDestino, clave) {
    billetera.billeteraUsdExiste(cuentaDestino);
    const pendiente = billetera.acreditaUsdPendiente();
    const res = await post(app, {
      monto: '5000.00', clave, body: { ...BODY_USD, cuentaDestino },
    });
    expect(res.status).toBe(202);
    expect(pendiente.peticiones).toHaveLength(1);
    expect(await depositos()).toEqual([
      { id: res.body.id, monto: '5000.00', estado: 'PROCESANDO' },
    ]);
    expect(await alertas()).toHaveLength(0);
    await esperarAuditoria();
    await pool.query(
      "UPDATE depositos SET actualizado_en = now() - interval '1 minute' WHERE id = $1",
      [res.body.id],
    );
    return res.body.id;
  }

  test('UIF-R01 PROCESANDO → reconciliación COMPLETADO → 1 alerta; 2.ª reconciliación y replay no generan otra',
    async () => {
      const app = crearApp({ manifest: manifest() });
      const id = await depositoPendiente(app, WALLET_PENDIENTE, 'uif-r01-reconcilia-ok');
      const replay = billetera.acreditaUsdReplay({ estado: 'COMPLETADO' });

      await expect(reconciliacion.reconciliar())
        .resolves.toEqual({ completados: 1, fallidos: 0, pendientes: 0 });

      expect(replay.peticiones).toHaveLength(1);
      expect(replay.peticiones[0].body.cliente_id).toBe('usr-pendiente');
      expect(await depositos()).toEqual([{ id, monto: '5000.00', estado: 'COMPLETADO' }]);
      const filas = await alertas();
      expect(filas).toEqual([{
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        deposito_id: id,
        monto: '5000.00',
        moneda: 'USD',
        umbral: '300.00',
        estado_reporte: 'PENDIENTE',
      }]);

      // Segunda reconciliación: ya no toma el depósito, no acredita ni alerta otra vez.
      const otra = billetera.acreditaUsdReplay({ estado: 'COMPLETADO' });
      await expect(reconciliacion.reconciliar())
        .resolves.toEqual({ completados: 0, fallidos: 0, pendientes: 0 });
      expect(otra.peticiones).toHaveLength(0);
      expect(await alertas()).toEqual(filas);

      // Replay de la petición original (misma Idempotency-Key): no vuelve a ejecutar post-procesos.
      const credito = billetera.acreditaUsdReplay({ estado: 'COMPLETADO' });
      const repetido = await post(app, {
        monto: '5000.00', clave: 'uif-r01-reconcilia-ok',
        body: { ...BODY_USD, cuentaDestino: WALLET_PENDIENTE },
      });
      expect(repetido.body.id).toBe(id);
      expect(credito.peticiones).toHaveLength(0);
      expect(await depositos()).toEqual([{ id, monto: '5000.00', estado: 'COMPLETADO' }]);
      expect(await alertas()).toEqual(filas);
    });

  test('UIF-R01 PROCESANDO → reconciliación FALLIDO (RECHAZADO) → 0 alertas', async () => {
    const app = crearApp({ manifest: manifest() });
    const id = await depositoPendiente(app, WALLET_PENDIENTE_FALLA, 'uif-r01-reconcilia-falla');
    const replay = billetera.acreditaUsdReplay({ estado: 'FALLIDO' });

    await expect(reconciliacion.reconciliar())
      .resolves.toEqual({ completados: 0, fallidos: 1, pendientes: 0 });

    expect(replay.peticiones).toHaveLength(1);
    expect(replay.peticiones[0].body.cliente_id).toBe('usr-pendiente-falla');
    expect(await depositos()).toEqual([{ id, monto: '5000.00', estado: 'FALLIDO' }]);
    expect(await alertas()).toHaveLength(0);
  });
});
