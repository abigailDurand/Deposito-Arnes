'use strict';

const express = require('express');
const nock = require('nock');
const request = require('supertest');

const { crearApp } = require('../../../src/app');
const billetera = require('../../helpers/billetera');

const { pool: poolApp } = require('../../../src/core/db');
const { logger } = require('../../../src/core/logger');
const auditoriaRepository = require('../../../src/core/repositories/auditoriaRepository');
const correlationId = require('../../../src/core/middlewares/correlationId');
const auditoria = require('../../../src/core/middlewares/auditoria');
const { autenticar } = require('../../../src/core/middlewares/auth');
const manejadorErrores = require('../../../src/core/middlewares/manejadorErrores');
const { limpiar, cerrar, pool } = require('../../helpers/db');
const { token } = require('../../helpers/tokens');

const CUENTA = '0011-0123-456789';
const ID_DEPOSITO = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

// App mínima con el orden de PIP-R11 (SPEC-06 aún no existe):
// correlationId → auditoria → /health → autenticar → express.json → rutas → manejadorErrores.
// Las rutas son falsas (SPEC-07/08 pending) pero con los mismos método y path que las auditadas:
// la auditoría solo depende del método, la ruta, el status y req.usuario / res.locals.
function crearAppPrueba() {
  const app = express();
  app.use(correlationId);
  app.use(auditoria);
  app.get('/health', (req, res) => res.json({ estado: 'ok' }));
  app.use(autenticar);
  app.use(express.json());
  app.post('/api/v1/depositos', (req, res) => res.status(201).json({ falso: true }));
  app.get('/api/v1/depositos/:id', (req, res) => res.json({ id: req.params.id }));
  app.get('/api/v1/cuentas/:numero/depositos', (req, res) => res.json({ datos: [] }));
  app.get('/api/v1/otra', (req, res) => res.json({ ok: true }));
  app.use(manejadorErrores);
  return app;
}

const app = crearAppPrueba();

function bearer(t) {
  return { Authorization: `Bearer ${t}` };
}

// SPEC-04 §6: la fila se escribe después de responder → reintentos cortos hasta 1 s.
async function filasAuditoria(minimo = 1, limiteMs = 1000) {
  const inicio = Date.now();
  for (;;) {
    const { rows } = await pool.query(
      `SELECT deposito_id, usuario_id, accion, ip, canal, monto::text AS monto, resultado,
              correlation_id, creado_en
         FROM auditoria_depositos ORDER BY id`,
    );
    if (rows.length >= minimo || Date.now() - inicio >= limiteMs) return rows;
    await new Promise((r) => setTimeout(r, 20));
  }
}

beforeEach(limpiar);

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await poolApp.end();
  await cerrar();
});

// SPEC-07 ya existe: AUD-T01, AUD-T02 y AUD-T04 usan la ruta real (crearApp), PostgreSQL real y
// billetera con nock. Extensiones inactivas; cada prueba arma su app (el pipeline es un singleton).
const MANIFEST_REAL = {
  version: 1,
  servicio: 'deposito-service',
  features: [
    { id: 'registrar-deposito', estado: 'activo', tipo: 'endpoint' },
    { id: 'limites-por-canal', estado: 'inactivo', tipo: 'validador', orden: 10 },
    { id: 'conversion-moneda', estado: 'inactivo', tipo: 'transformador', orden: 10 },
    { id: 'alerta-uif', estado: 'inactivo', tipo: 'post-proceso', orden: 10 },
  ],
};
const BODY_REAL = { cuentaDestino: CUENTA, monto: '150.00', moneda: 'PEN', canal: 'AGENTE' };

function postReal(appReal, { body = BODY_REAL, clave = 'aud-clave-0001', correlation } = {}) {
  let r = request(appReal)
    .post('/api/v1/depositos')
    .set(bearer(token('usr-agente-1')))
    .set('Idempotency-Key', clave);
  if (correlation) r = r.set('X-Correlation-Id', correlation);
  return r.send(body);
}

describe('SPEC-04 auditoría con la ruta real (SPEC-07)', () => {
  beforeAll(() => {
    nock.disableNetConnect();
    nock.enableNetConnect(/127\.0\.0\.1|localhost/);
  });

  beforeEach(() => {
    nock.cleanAll();
  });

  afterEach(() => {
    nock.abortPendingRequests();
    nock.cleanAll();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  test('AUD-T01 depósito válido → 1 fila CREAR_DEPOSITO, EXITO, deposito_id lleno, correlation_id igual al de la respuesta', async () => {
    const appReal = crearApp({ manifest: MANIFEST_REAL });
    billetera.cuentaActiva(CUENTA);
    billetera.acreditaOk(CUENTA);

    const res = await postReal(appReal);

    expect(res.status).toBe(201);
    const filas = await filasAuditoria(1);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      accion: 'CREAR_DEPOSITO',
      resultado: 'EXITO',
      deposito_id: res.body.id,
      usuario_id: 'usr-agente-1',
      canal: 'AGENTE',
      monto: '150.00',
      correlation_id: res.headers['x-correlation-id'],
    });
    expect(filas[0].correlation_id).toEqual(expect.any(String));
  });

  test('AUD-T02 monto "-5" → 1 fila ERROR_422, deposito_id nulo, monto -5.00', async () => {
    const appReal = crearApp({ manifest: MANIFEST_REAL });
    const consulta = billetera.cuentaActiva(CUENTA);

    const res = await postReal(appReal, { body: { ...BODY_REAL, monto: '-5' }, correlation: 'aud-t02' });

    expect(res.status).toBe(422);
    expect(res.body.codigo).toBe('MONTO_INVALIDO');
    expect(consulta.peticiones).toHaveLength(0);
    const filas = await filasAuditoria(1);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      accion: 'CREAR_DEPOSITO',
      resultado: 'ERROR_422',
      deposito_id: null,
      usuario_id: 'usr-agente-1',
      monto: '-5.00',
      correlation_id: 'aud-t02',
    });
  });

  test('AUD-T04 3 POST iguales con la misma clave → 3 filas CREAR_DEPOSITO con el mismo deposito_id; 1 solo depósito', async () => {
    const appReal = crearApp({ manifest: MANIFEST_REAL });
    billetera.cuentaActiva(CUENTA);
    const credito = billetera.acreditaOk(CUENTA);

    const respuestas = [];
    for (let i = 0; i < 3; i += 1) respuestas.push(await postReal(appReal));

    expect(respuestas.map((r) => r.status)).toEqual([201, 201, 201]);
    const id = respuestas[0].body.id;
    expect(respuestas.map((r) => r.headers['idempotency-replayed'])).toEqual([undefined, 'true', 'true']);
    expect(credito.peticiones).toHaveLength(1);
    const filas = await filasAuditoria(3);
    expect(filas).toHaveLength(3);
    for (const fila of filas) {
      expect(fila).toMatchObject({ accion: 'CREAR_DEPOSITO', resultado: 'EXITO', deposito_id: id });
    }
    const { rows } = await pool.query('SELECT id FROM depositos');
    expect(rows).toEqual([{ id }]);
  });
});

describe('SPEC-04 auditoría', () => {

  test('AUD-T03 POST /api/v1/depositos sin token → 1 fila CREAR_DEPOSITO ERROR_401 con usuario_id nulo', async () => {
    const res = await request(app)
      .post('/api/v1/depositos')
      .set('X-Correlation-Id', 'aud-t03')
      .send({ cuentaDestino: CUENTA, monto: '150.00', moneda: 'PEN', canal: 'AGENTE' });

    expect(res.status).toBe(401);
    expect(res.body.codigo).toBe('TOKEN_REQUERIDO');

    const filas = await filasAuditoria(1);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      accion: 'CREAR_DEPOSITO',
      resultado: 'ERROR_401',
      usuario_id: null,
      deposito_id: null,
      correlation_id: 'aud-t03',
    });
    expect(typeof filas[0].ip).toBe('string');
    expect(filas[0].creado_en).toBeInstanceOf(Date);
  });

  test('AUD-T05 UPDATE y DELETE directos en SQL → ambos lanzan excepción; TRUNCATE sí limpia', async () => {
    await pool.query(
      `INSERT INTO auditoria_depositos (usuario_id, accion, resultado, correlation_id)
       VALUES ('usr-agente-1', 'CREAR_DEPOSITO', 'EXITO', 'aud-t05')`,
    );

    await expect(pool.query("UPDATE auditoria_depositos SET resultado = 'ERROR_500'"))
      .rejects.toThrow('auditoria_depositos es solo de inserción');
    await expect(pool.query('DELETE FROM auditoria_depositos'))
      .rejects.toThrow('auditoria_depositos es solo de inserción');

    const { rows } = await pool.query('SELECT resultado FROM auditoria_depositos');
    expect(rows).toEqual([{ resultado: 'EXITO' }]);

    await limpiar();
    const { rows: tras } = await pool.query('SELECT count(*)::int AS n FROM auditoria_depositos');
    expect(tras[0].n).toBe(0);
  });

  test('AUD-T06 INSERT de auditoría forzado a fallar → la respuesta 201 llega normal; logger.error sin la cuenta', async () => {
    const errorSql = Object.assign(
      new Error(`Failing row contains (${CUENTA}, 150.00)`),
      { code: 'XX000', detail: `cuenta ${CUENTA}` },
    );
    const insertar = jest.spyOn(auditoriaRepository, 'insertar').mockRejectedValue(errorSql);
    const logError = jest.spyOn(logger, 'error').mockImplementation(() => {});

    const res = await request(app)
      .post('/api/v1/depositos')
      .set({ ...bearer(token('usr-agente-1')), 'X-Correlation-Id': 'aud-t06' })
      .send({ cuentaDestino: CUENTA, monto: '150.00', moneda: 'PEN', canal: 'AGENTE' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ falso: true });
    expect(res.headers['x-correlation-id']).toBe('aud-t06');

    const inicio = Date.now();
    while (logError.mock.calls.length === 0 && Date.now() - inicio < 1000) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(insertar).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledTimes(1);
    const [contexto] = logError.mock.calls[0];
    expect(contexto).toMatchObject({ correlationId: 'aud-t06', accion: 'CREAR_DEPOSITO' });

    const todo = JSON.stringify(logError.mock.calls);
    expect(todo).not.toContain(CUENTA);
    expect(todo).not.toContain('0011-0123');

    expect(await filasAuditoria(1, 200)).toHaveLength(0);
  });

  test('AUD-T07 GET /api/v1/depositos/{id} → 1 fila CONSULTAR_DEPOSITO', async () => {
    const res = await request(app)
      .get(`/api/v1/depositos/${ID_DEPOSITO}`)
      .set({ ...bearer(token('usr-agente-1')), 'X-Correlation-Id': 'aud-t07' });

    expect(res.status).toBe(200);

    const filas = await filasAuditoria(1);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      accion: 'CONSULTAR_DEPOSITO',
      resultado: 'EXITO',
      usuario_id: 'usr-agente-1',
      correlation_id: 'aud-t07',
      canal: null,
      monto: null,
    });
  });

  test('AUD-T08 GET /health → 0 filas', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(await filasAuditoria(1)).toHaveLength(0);
  });

  describe('reglas sin caso numerado (AUD-R02, AUD-R07, AUD-R08)', () => {
    test('AUD-R07/R08: canal y monto válidos se guardan; con token → usuario_id y EXITO', async () => {
      await request(app)
        .post('/api/v1/depositos')
        .set({ ...bearer(token('usr-agente-1')), 'X-Correlation-Id': 'aud-r07a' })
        .send({ cuentaDestino: CUENTA, monto: '0.01', moneda: 'PEN', canal: 'VENTANILLA' })
        .expect(201);

      const filas = await filasAuditoria(1);
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({
        accion: 'CREAR_DEPOSITO', usuario_id: 'usr-agente-1', canal: 'VENTANILLA', monto: '0.01', resultado: 'EXITO',
      });
    });

    test('AUD-R07: canal fuera de la lista, monto numérico o con 3 decimales → null', async () => {
      const t = token('usr-agente-1');
      await request(app).post('/api/v1/depositos').set(bearer(t))
        .send({ cuentaDestino: CUENTA, monto: 10, moneda: 'PEN', canal: 'XX' }).expect(201);
      await request(app).post('/api/v1/depositos').set(bearer(t))
        .send({ cuentaDestino: CUENTA, monto: '10.001', moneda: 'PEN', canal: 'agente' }).expect(201);
      await request(app).post('/api/v1/depositos').set(bearer(t))
        .send([{ monto: '10.00', canal: 'APP' }]).expect(201);

      const filas = await filasAuditoria(3);
      expect(filas).toHaveLength(3);
      for (const f of filas) {
        expect(f).toMatchObject({ canal: null, monto: null, resultado: 'EXITO' });
      }
    });

    test('AUD-R08: JSON mal formado → ERROR_400 (también se audita)', async () => {
      await request(app).post('/api/v1/depositos')
        .set({ ...bearer(token('usr-agente-1')), 'Content-Type': 'application/json' })
        .send('{"monto": ')
        .expect(400);

      const filas = await filasAuditoria(1);
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({ accion: 'CREAR_DEPOSITO', resultado: 'ERROR_400' });
    });

    test('AUD-R02: GET /api/v1/cuentas/{numero}/depositos?pagina=1 → LISTAR_DEPOSITOS', async () => {
      await request(app).get(`/api/v1/cuentas/${CUENTA}/depositos?pagina=1`)
        .set(bearer(token('usr-cliente-1'))).expect(200);

      const filas = await filasAuditoria(1);
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({ accion: 'LISTAR_DEPOSITOS', usuario_id: 'usr-cliente-1' });
    });

    test('AUD-R02: rutas no listadas y métodos no auditados → 0 filas', async () => {
      const t = token('usr-agente-1');
      await request(app).get('/api/v1/otra').set(bearer(t)).expect(200);
      await request(app).get('/api/v1/nada').set(bearer(t)).expect(404);
      await request(app).delete(`/api/v1/depositos/${ID_DEPOSITO}`).set(bearer(t)).expect(404);
      await request(app).get('/api/v1/depositos').set(bearer(t)).expect(404);
      expect(await filasAuditoria(1)).toHaveLength(0);
    });

    test('AUD-R02: deducirAccion con mayúsculas y barra final, como enruta Express', () => {
      const { deducirAccion } = auditoria;
      expect(deducirAccion({ method: 'POST', originalUrl: '/API/v1/Depositos/' })).toBe('CREAR_DEPOSITO');
      expect(deducirAccion({ method: 'GET', originalUrl: `/api/v1/depositos/${ID_DEPOSITO}?x=1` })).toBe('CONSULTAR_DEPOSITO');
      expect(deducirAccion({ method: 'GET', url: '/health' })).toBeNull();
      expect(deducirAccion({ method: 'GET' })).toBeNull();
    });

    test('AUD-R07: extraerDelBody con body ausente o null → canal y monto null', () => {
      const { extraerDelBody } = auditoria;
      expect(extraerDelBody(undefined)).toEqual({ canal: null, monto: null });
      expect(extraerDelBody(null)).toEqual({ canal: null, monto: null });
      expect(extraerDelBody({ canal: 'APP', monto: '-5' })).toEqual({ canal: 'APP', monto: '-5' });
    });
  });
});
