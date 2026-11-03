'use strict';

const nock = require('nock');
const request = require('supertest');

const { crearApp } = require('../../../src/app');
const billeteraClient = require('../../../src/core/clients/billeteraClient');
const { pool: poolApp } = require('../../../src/core/db');
const pipeline = require('../../../src/core/pipeline');
const repository = require('../../../src/modules/registrar-deposito/repository');
const service = require('../../../src/modules/registrar-deposito/service');
const billetera = require('../../helpers/billetera');
const { limpiar, cerrar, pool } = require('../../helpers/db');
const { token } = require('../../helpers/tokens');

const RUTA = '/api/v1/depositos';
const CUENTA = '0011-0123-456789';
const CUENTA_USD = '0011-0123-000002';
const CUENTA_BLOQUEADA = '0011-0123-000003';
const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PATRON_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const BODY = { cuentaDestino: CUENTA, monto: '150.00', moneda: 'PEN', canal: 'AGENTE' };
const AGENTE_1 = { id: 'usr-agente-1', roles: ['AGENTE'] };

// SPEC-07 §6: todas las extensiones inactivas salvo que el caso diga otra cosa.
function manifest({ registrar = 'activo' } = {}) {
  return {
    version: 1,
    servicio: 'deposito-service',
    features: [
      { id: 'registrar-deposito', estado: registrar, tipo: 'endpoint' },
      { id: 'limites-por-canal', estado: 'inactivo', tipo: 'validador', orden: 10 },
      { id: 'conversion-moneda', estado: 'inactivo', tipo: 'transformador', orden: 10 },
      { id: 'alerta-uif', estado: 'inactivo', tipo: 'post-proceso', orden: 10 },
    ],
  };
}

function post(app, { usuario = 'usr-agente-1', body = BODY, clave = 'rd-clave-0001', correlation } = {}) {
  let r = request(app).post(RUTA).set('Authorization', `Bearer ${token(usuario)}`);
  if (clave !== null) r = r.set('Idempotency-Key', clave);
  if (correlation) r = r.set('X-Correlation-Id', correlation);
  return r.send(body);
}

async function depositos() {
  const { rows } = await pool.query(
    `SELECT id, cuenta_destino, monto::text AS monto, moneda, monto_acreditar::text AS monto_acreditar,
            moneda_acreditar, canal, referencia, estado, usuario_id, creado_en, actualizado_en
       FROM depositos ORDER BY creado_en`,
  );
  return rows;
}

async function claves() {
  const { rows } = await pool.query(
    'SELECT usuario_id, clave, estado, status_http, deposito_id FROM claves_idempotencia',
  );
  return rows;
}

async function insertarDeposito(id, estado, { monto = '150.00', montoAcreditar = '150.00' } = {}) {
  await pool.query(
    `INSERT INTO depositos (id, cuenta_destino, monto, moneda, monto_acreditar, moneda_acreditar,
                            canal, estado, usuario_id)
     VALUES ($1, $2, $3, 'PEN', $4, 'PEN', 'AGENTE', $5, 'usr-agente-1')`,
    [id, CUENTA, monto, montoAcreditar, estado],
  );
}

function esError(res, status, codigo) {
  expect(res.status).toBe(status);
  expect(res.body).toEqual({
    codigo,
    mensaje: expect.any(String),
    correlationId: res.headers['x-correlation-id'],
  });
}

beforeAll(() => {
  nock.disableNetConnect();
  nock.enableNetConnect(/127\.0\.0\.1|localhost/);
});

beforeEach(async () => {
  await limpiar();
  nock.cleanAll();
});

afterEach(() => {
  jest.restoreAllMocks();
  nock.abortPendingRequests();
  nock.cleanAll();
});

afterAll(async () => {
  nock.enableNetConnect();
  // La auditoría escribe después de responder: se le da un margen antes de cerrar el pool.
  await new Promise((r) => { setTimeout(r, 200); });
  await poolApp.end();
  await cerrar();
});

describe('SPEC-07 registrar-deposito: casos', () => {
  test('RD-T01 usr-agente-1 "150.00" PEN AGENTE a 0011-0123-456789 → 201 COMPLETADO; 1 fila; billetera recibió "150.00" y el depositoId', async () => {
    const app = crearApp({ manifest: manifest() });
    const consulta = billetera.cuentaActiva(CUENTA);
    const credito = billetera.acreditaOk(CUENTA);

    const res = await post(app, {
      body: { ...BODY, referencia: 'Pago alquiler' },
      correlation: 'rd-t01',
    });

    expect(res.status).toBe(201);
    expect(res.headers['idempotency-replayed']).toBeUndefined();
    expect(res.headers['x-correlation-id']).toBe('rd-t01');
    expect(res.body).toEqual({
      id: expect.stringMatching(PATRON_UUID),
      cuentaDestino: CUENTA,
      monto: '150.00',
      moneda: 'PEN',
      canal: 'AGENTE',
      referencia: 'Pago alquiler',
      estado: 'COMPLETADO',
      creadoEn: expect.stringMatching(PATRON_ISO),
      actualizadoEn: expect.stringMatching(PATRON_ISO),
      extensiones: {},
    });

    const filas = await depositos();
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      id: res.body.id,
      cuenta_destino: CUENTA,
      monto: '150.00',
      moneda: 'PEN',
      monto_acreditar: '150.00',
      moneda_acreditar: 'PEN',
      canal: 'AGENTE',
      referencia: 'Pago alquiler',
      estado: 'COMPLETADO',
      usuario_id: 'usr-agente-1',
    });
    expect(filas[0].creado_en.toISOString()).toBe(res.body.creadoEn);
    expect(filas[0].actualizado_en.toISOString()).toBe(res.body.actualizadoEn);

    expect(consulta.peticiones).toHaveLength(1);
    expect(consulta.peticiones[0].headers['x-correlation-id']).toBe('rd-t01');
    expect(credito.peticiones).toHaveLength(1);
    expect(credito.peticiones[0].body).toEqual({
      depositoId: res.body.id,
      monto: '150.00',
      moneda: 'PEN',
      concepto: 'DEPOSITO',
    });
    expect(credito.peticiones[0].headers['x-correlation-id']).toBe('rd-t01');

    expect(await claves()).toEqual([
      expect.objectContaining({ estado: 'TERMINADO', status_http: 201, deposito_id: res.body.id }),
    ]);
  });

  test('RD-T02 monto "0", "-1" y "10.001" → 422 MONTO_INVALIDO; 0 filas; billetera no llamada', async () => {
    const app = crearApp({ manifest: manifest() });
    const consulta = billetera.cuentaActiva(CUENTA);
    const credito = billetera.acreditaOk(CUENTA);

    for (const [i, monto] of ['0', '-1', '10.001'].entries()) {
      const res = await post(app, { body: { ...BODY, monto }, clave: `rd-t02-clave-${i}` });
      esError(res, 422, 'MONTO_INVALIDO');
    }

    expect(await depositos()).toHaveLength(0);
    expect(consulta.peticiones).toHaveLength(0);
    expect(credito.peticiones).toHaveLength(0);
  });

  test('RD-T03 monto "0.01" → 201 COMPLETADO; billetera recibe "0.01"', async () => {
    const app = crearApp({ manifest: manifest() });
    billetera.cuentaActiva(CUENTA);
    const credito = billetera.acreditaOk(CUENTA);

    const res = await post(app, { body: { ...BODY, monto: '0.01' } });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ monto: '0.01', estado: 'COMPLETADO', referencia: null });
    const filas = await depositos();
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ monto: '0.01', monto_acreditar: '0.01', estado: 'COMPLETADO' });
    expect(credito.peticiones[0].body.monto).toBe('0.01');
  });

  test('RD-T04 sin cuentaDestino, monto como número 150 y campo extra "x": 1 → 400 FORMATO_INVALIDO', async () => {
    const app = crearApp({ manifest: manifest() });
    const consulta = billetera.cuentaActiva(CUENTA);
    const credito = billetera.acreditaOk(CUENTA);
    const { cuentaDestino, ...sinCuenta } = BODY;
    expect(cuentaDestino).toBe(CUENTA);

    const cuerpos = [sinCuenta, { ...BODY, monto: 150 }, { ...BODY, x: 1 }];
    for (const [i, body] of cuerpos.entries()) {
      const res = await post(app, { body, clave: `rd-t04-clave-${i}` });
      esError(res, 400, 'FORMATO_INVALIDO');
    }

    expect(await depositos()).toHaveLength(0);
    expect(consulta.peticiones).toHaveLength(0);
    expect(credito.peticiones).toHaveLength(0);
  });

  test('RD-T05 billetera 404 al consultar → 422 CUENTA_NO_ENCONTRADA; 0 filas; sin acreditación', async () => {
    const app = crearApp({ manifest: manifest() });
    const consulta = billetera.cuentaNoExiste(CUENTA);
    const credito = billetera.acreditaOk(CUENTA);

    const res = await post(app);

    esError(res, 422, 'CUENTA_NO_ENCONTRADA');
    expect(consulta.peticiones).toHaveLength(1);
    expect(credito.peticiones).toHaveLength(0);
    expect(await depositos()).toHaveLength(0);
  });

  test('RD-T06 0011-0123-000003 (BLOQUEADA) → 422 CUENTA_INACTIVA; 0 filas; sin acreditación', async () => {
    const app = crearApp({ manifest: manifest() });
    const consulta = billetera.cuentaActiva(CUENTA_BLOQUEADA);
    const credito = billetera.acreditaOk(CUENTA_BLOQUEADA);

    const res = await post(app, { body: { ...BODY, cuentaDestino: CUENTA_BLOQUEADA } });

    esError(res, 422, 'CUENTA_INACTIVA');
    expect(consulta.peticiones).toHaveLength(1);
    expect(credito.peticiones).toHaveLength(0);
    expect(await depositos()).toHaveLength(0);
  });

  test('RD-T07 billetera 500 al acreditar → 502 BILLETERA_NO_DISPONIBLE; depósito FALLIDO; clave REINTENTABLE', async () => {
    const app = crearApp({ manifest: manifest() });
    billetera.cuentaActiva(CUENTA);
    const credito = billetera.acreditaFalla(CUENTA, { status: 500 });

    const res = await post(app, { correlation: 'rd-t07' });

    esError(res, 502, 'BILLETERA_NO_DISPONIBLE');
    const filas = await depositos();
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ estado: 'FALLIDO', monto: '150.00', usuario_id: 'usr-agente-1' });
    expect(credito.peticiones).toHaveLength(1);
    expect(credito.peticiones[0].body.depositoId).toBe(filas[0].id);
    expect(await claves()).toEqual([
      expect.objectContaining({ estado: 'REINTENTABLE', deposito_id: filas[0].id }),
    ]);
  });

  test('RD-T08 billetera tarda 6 s al acreditar → 502 BILLETERA_NO_DISPONIBLE; depósito FALLIDO', async () => {
    const app = crearApp({ manifest: manifest() });
    billetera.cuentaActiva(CUENTA);
    const credito = billetera.acreditaLento(CUENTA, { demora: 6000 });

    // nock adelanta el 'timeout' del socket cuando la demora (6 s) supera BILLETERA_TIMEOUT_MS (5 s).
    const res = await post(app);

    esError(res, 502, 'BILLETERA_NO_DISPONIBLE');
    expect(credito.peticiones.length).toBeLessThanOrEqual(1);
    const filas = await depositos();
    expect(filas).toHaveLength(1);
    expect(filas[0].estado).toBe('FALLIDO');
  }, 15000);

  test('RD-T09 billetera 500 al consultar → 502; 0 filas; sin acreditación; la clave se borra', async () => {
    const app = crearApp({ manifest: manifest() });
    const consulta = billetera.consultaFalla(CUENTA, { status: 500 });
    const credito = billetera.acreditaOk(CUENTA);

    const res = await post(app);

    esError(res, 502, 'BILLETERA_NO_DISPONIBLE');
    expect(consulta.peticiones).toHaveLength(1);
    expect(credito.peticiones).toHaveLength(0);
    expect(await depositos()).toHaveLength(0);
    expect(await claves()).toHaveLength(0);
  });

  test('RD-T10 "100.00" USD a 0011-0123-456789 (PEN) → 422 MONEDA_NO_SOPORTADA; 0 filas; sin acreditación', async () => {
    const app = crearApp({ manifest: manifest() });
    billetera.cuentaActiva(CUENTA);
    const credito = billetera.acreditaOk(CUENTA);

    const res = await post(app, { body: { ...BODY, monto: '100.00', moneda: 'USD' } });

    esError(res, 422, 'MONEDA_NO_SOPORTADA');
    expect(credito.peticiones).toHaveLength(0);
    expect(await depositos()).toHaveLength(0);
  });

  test('RD-T11 flujo exitoso con spy de cambiarEstado → PENDIENTE→PROCESANDO y PROCESANDO→COMPLETADO, en ese orden', async () => {
    const app = crearApp({ manifest: manifest() });
    billetera.cuentaActiva(CUENTA);
    billetera.acreditaOk(CUENTA);
    const spy = jest.spyOn(repository, 'cambiarEstado');

    const res = await post(app);

    expect(res.status).toBe(201);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0]).toEqual([poolApp, res.body.id, 'PENDIENTE', 'PROCESANDO']);
    expect(spy.mock.calls[1]).toEqual([poolApp, res.body.id, 'PROCESANDO', 'COMPLETADO']);
    expect((await depositos())[0].estado).toBe('COMPLETADO');
  });

  test('RD-T12 reintentar un depósito FALLIDO con billetera OK → mismo id, COMPLETADO, sin nueva consulta de cuenta', async () => {
    const app = crearApp({ manifest: manifest() });
    const consulta = billetera.cuentaActiva(CUENTA);
    billetera.acreditaFalla(CUENTA, { status: 500 });
    const fallo = await post(app);
    expect(fallo.status).toBe(502);
    const [fallido] = await depositos();
    expect(fallido.estado).toBe('FALLIDO');

    const spyConsulta = jest.spyOn(billeteraClient, 'consultarCuenta');
    const spyValidadores = jest.spyOn(pipeline, 'ejecutarValidadores');
    const spyTransformadores = jest.spyOn(pipeline, 'ejecutarTransformadores');
    const credito = billetera.acreditaOk(CUENTA);

    const resultado = await service.reintentar(fallido.id, AGENTE_1, 'rd-t12');

    expect(resultado).toMatchObject({
      id: fallido.id,
      cuentaDestino: CUENTA,
      monto: '150.00',
      estado: 'COMPLETADO',
      extensiones: {},
    });
    expect(spyConsulta).not.toHaveBeenCalled();
    expect(spyValidadores).not.toHaveBeenCalled();
    expect(spyTransformadores).not.toHaveBeenCalled();
    expect(consulta.peticiones).toHaveLength(1);
    expect(credito.peticiones).toHaveLength(1);
    expect(credito.peticiones[0].body).toEqual({
      depositoId: fallido.id, monto: '150.00', moneda: 'PEN', concepto: 'DEPOSITO',
    });
    const filas = await depositos();
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ id: fallido.id, estado: 'COMPLETADO' });
  });
});

describe('SPEC-07 registrar-deposito: reglas', () => {
  test('feature INACTIVA en el manifest → POST /api/v1/depositos 404 RUTA_NO_ENCONTRADA; billetera no llamada', async () => {
    const app = crearApp({ manifest: manifest({ registrar: 'inactivo' }) });
    const consulta = billetera.cuentaActiva(CUENTA);

    const res = await post(app);

    esError(res, 404, 'RUTA_NO_ENCONTRADA');
    expect(consulta.peticiones).toHaveLength(0);
    expect(await depositos()).toHaveLength(0);
  });

  test('RD-R01/R02 formato: cuenta mal formada, moneda EUR, canal WEB, referencia vacía o de 141, body no objeto → 400', async () => {
    const app = crearApp({ manifest: manifest() });
    const consulta = billetera.cuentaActiva(CUENTA);

    const cuerpos = [
      { ...BODY, cuentaDestino: '0011-0123-45678' },
      { ...BODY, monto: '150,00' },
      { ...BODY, monto: '12345678901234' },
      { ...BODY, moneda: 'EUR' },
      { ...BODY, canal: 'WEB' },
      { ...BODY, referencia: '' },
      { ...BODY, referencia: 'r'.repeat(141) },
      { ...BODY, referencia: 5 },
      [BODY],
    ];
    for (const [i, body] of cuerpos.entries()) {
      const res = await post(app, { body, clave: `rd-r02-clave-${i}` });
      esError(res, 400, 'FORMATO_INVALIDO');
    }
    expect(consulta.peticiones).toHaveLength(0);
    expect(await depositos()).toHaveLength(0);
  });

  test('RD-R02 referencia de 140 caracteres y 13 dígitos enteros → 201', async () => {
    const app = crearApp({ manifest: manifest() });
    billetera.cuentaActiva(CUENTA);
    billetera.acreditaOk(CUENTA);

    const res = await post(app, { body: { ...BODY, monto: '1234567890123.45', referencia: 'r'.repeat(140) } });

    expect(res.status).toBe(201);
    expect(res.body.monto).toBe('1234567890123.45');
    expect(res.body.referencia).toHaveLength(140);
  });

  test('requiereRol + verificarCanal: AGENTE con canal APP → 403 SIN_PERMISO; 0 filas; sin acreditación', async () => {
    const app = crearApp({ manifest: manifest() });
    billetera.cuentaActiva(CUENTA);
    const credito = billetera.acreditaOk(CUENTA);

    const res = await post(app, { body: { ...BODY, canal: 'APP' } });

    esError(res, 403, 'SIN_PERMISO');
    expect(credito.peticiones).toHaveLength(0);
    expect(await depositos()).toHaveLength(0);
  });

  test('verificarTitular: usr-cliente-1 por APP a su cuenta → 201; usr-cajero-1 por VENTANILLA a 0011-0123-000002 (USD) → 201', async () => {
    const app = crearApp({ manifest: manifest() });
    billetera.cuentaActiva(CUENTA);
    billetera.acreditaOk(CUENTA);
    billetera.cuentaActiva(CUENTA_USD);
    const creditoUsd = billetera.acreditaOk(CUENTA_USD);

    const cliente = await post(app, { usuario: 'usr-cliente-1', body: { ...BODY, canal: 'APP' } });
    const cajero = await post(app, {
      usuario: 'usr-cajero-1',
      body: { cuentaDestino: CUENTA_USD, monto: '100.00', moneda: 'USD', canal: 'VENTANILLA' },
    });

    expect(cliente.status).toBe(201);
    expect(cliente.body.canal).toBe('APP');
    expect(cajero.status).toBe(201);
    expect(cajero.body).toMatchObject({ moneda: 'USD', canal: 'VENTANILLA', estado: 'COMPLETADO' });
    expect(creditoUsd.peticiones[0].body).toMatchObject({ monto: '100.00', moneda: 'USD' });
    const filas = await depositos();
    expect(filas.map((f) => f.usuario_id).sort()).toEqual(['usr-cajero-1', 'usr-cliente-1']);
  });

  test('RD-R07 persistir de un transformador falla después del INSERT → rollback, 500, sin acreditación', async () => {
    const app = crearApp({ manifest: manifest() });
    billetera.cuentaActiva(CUENTA);
    const credito = billetera.acreditaOk(CUENTA);
    jest.spyOn(pipeline, 'persistirTransformadores').mockRejectedValue(new Error('falla en persistir'));
    const spyInsertar = jest.spyOn(repository, 'insertar');

    const res = await post(app);

    esError(res, 500, 'ERROR_INTERNO');
    expect(spyInsertar).toHaveBeenCalledTimes(1);
    expect(await depositos()).toHaveLength(0);
    expect(credito.peticiones).toHaveLength(0);
    expect(await claves()).toHaveLength(0);
  });

  test('RD-R06 cambiarEstado: si el depósito no está en `de` → lanza; transición fuera de SPEC-01 → lanza sin tocar la fila', async () => {
    const id = '7f1c2e9a-0b1d-4c5e-9f00-123456789abc';
    await insertarDeposito(id, 'PENDIENTE');

    await expect(repository.cambiarEstado(poolApp, id, 'PROCESANDO', 'COMPLETADO')).rejects.toThrow();
    await expect(repository.cambiarEstado(poolApp, id, 'PENDIENTE', 'COMPLETADO')).rejects.toThrow();
    await expect(repository.cambiarEstado(poolApp, id, 'COMPLETADO', 'PROCESANDO')).rejects.toThrow();
    expect((await depositos())[0].estado).toBe('PENDIENTE');

    const fila = await repository.cambiarEstado(poolApp, id, 'PENDIENTE', 'PROCESANDO');
    expect(fila).toMatchObject({ id, estado: 'PROCESANDO' });
    expect(fila.actualizado_en.getTime()).toBeGreaterThanOrEqual(fila.creado_en.getTime());
    expect(await repository.buscarPorId(poolApp, id)).toMatchObject({ estado: 'PROCESANDO' });
    expect(await repository.buscarPorId(poolApp, '00000000-0000-4000-8000-000000000000')).toBeNull();
  });

  test('RD-R08 reintentar un depósito COMPLETADO → lo devuelve sin llamar a billetera', async () => {
    crearApp({ manifest: manifest() });
    const id = '7f1c2e9a-0b1d-4c5e-9f00-123456789abc';
    await insertarDeposito(id, 'COMPLETADO');
    const spyAcreditar = jest.spyOn(billeteraClient, 'acreditar');
    const spyConsulta = jest.spyOn(billeteraClient, 'consultarCuenta');

    const resultado = await service.reintentar(id, AGENTE_1, 'rd-r08');

    expect(resultado).toMatchObject({ id, estado: 'COMPLETADO', monto: '150.00', extensiones: {} });
    expect(spyAcreditar).not.toHaveBeenCalled();
    expect(spyConsulta).not.toHaveBeenCalled();
  });

  test('RD-R08 reintentar un depósito PENDIENTE o PROCESANDO → 409 SOLICITUD_EN_PROCESO; estado intacto', async () => {
    crearApp({ manifest: manifest() });
    const pendiente = '7f1c2e9a-0b1d-4c5e-9f00-123456789abc';
    const procesando = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
    await insertarDeposito(pendiente, 'PENDIENTE');
    await insertarDeposito(procesando, 'PROCESANDO');
    const spyAcreditar = jest.spyOn(billeteraClient, 'acreditar');

    await expect(service.reintentar(pendiente, AGENTE_1, 'x'))
      .rejects.toMatchObject({ codigo: 'SOLICITUD_EN_PROCESO', status: 409, depositoId: pendiente });
    await expect(service.reintentar(procesando, AGENTE_1, 'x'))
      .rejects.toMatchObject({ codigo: 'SOLICITUD_EN_PROCESO', status: 409 });
    expect(spyAcreditar).not.toHaveBeenCalled();
    const estados = (await depositos()).map((f) => f.estado).sort();
    expect(estados).toEqual(['PENDIENTE', 'PROCESANDO']);
  });

  test('RD-R08 reintentar acredita monto_acreditar y moneda_acreditar guardados; si vuelve a fallar → FALLIDO y 502 con depositoId', async () => {
    crearApp({ manifest: manifest() });
    const id = '7f1c2e9a-0b1d-4c5e-9f00-123456789abc';
    await insertarDeposito(id, 'FALLIDO', { monto: '150.00', montoAcreditar: '149.50' });
    const credito = billetera.acreditaFalla(CUENTA, { status: 503 });

    await expect(service.reintentar(id, AGENTE_1, 'rd-r08'))
      .rejects.toMatchObject({ codigo: 'BILLETERA_NO_DISPONIBLE', status: 502, depositoId: id });

    expect(credito.peticiones[0].body).toMatchObject({ depositoId: id, monto: '149.50', moneda: 'PEN' });
    expect((await depositos())[0].estado).toBe('FALLIDO');
  });
});
