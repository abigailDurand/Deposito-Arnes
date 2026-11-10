'use strict';

const nock = require('nock');
const request = require('supertest');

const { crearApp } = require('../../../src/app');
const config = require('../../../src/config');
const billeteraClient = require('../../../src/core/clients/billeteraClient');
const { pool: poolApp } = require('../../../src/core/db');
const { logger } = require('../../../src/core/logger');
const pipeline = require('../../../src/core/pipeline');
const reconciliacion = require('../../../src/modules/registrar-deposito/reconciliacion');
const repository = require('../../../src/modules/registrar-deposito/repository');
const service = require('../../../src/modules/registrar-deposito/service');
const billetera = require('../../helpers/billetera');
const { limpiar, cerrar, pool } = require('../../helpers/db');
const { token } = require('../../helpers/tokens');

const RUTA = '/api/v1/depositos';
const CUENTA = '0011-0123-456789';
// SPEC-02 v2.0 §4: 0011-0123-000002 es PEN de usr-cliente-2 (ajena para usr-cliente-1).
const CUENTA_AJENA = '0011-0123-000002';
const CUENTA_BLOQUEADA = '0011-0123-000003';
const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PATRON_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const BODY = { cuentaDestino: CUENTA, monto: '150.00', moneda: 'PEN', canal: 'AGENTE' };
const AGENTE_1 = { id: 'usr-agente-1', roles: ['AGENTE'] };

// SPEC-07 §6: todas las extensiones inactivas salvo que el caso diga otra cosa.
function manifest({ registrar = 'activo', conversion = 'inactivo' } = {}) {
  return {
    version: 1,
    servicio: 'deposito-service',
    features: [
      { id: 'registrar-deposito', estado: registrar, tipo: 'endpoint' },
      { id: 'limites-por-canal', estado: 'inactivo', tipo: 'validador', orden: 10 },
      { id: 'conversion-moneda', estado: conversion, tipo: 'transformador', orden: 10 },
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
            moneda_acreditar, canal, referencia, estado, usuario_id, titular_id, creado_en, actualizado_en
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

// Depósito a una billetera USD insertado directamente (RD-R13). `hace` (interval de PostgreSQL)
// lleva actualizado_en al pasado, más allá de RECONCILIACION_ANTIGUEDAD_MS; sin `hace`, now().
async function insertarUsd(id, estado, { cuenta, titular, hace = null }) {
  await pool.query(
    `INSERT INTO depositos (id, cuenta_destino, monto, moneda, monto_acreditar, moneda_acreditar,
                            canal, estado, usuario_id, titular_id, creado_en, actualizado_en)
     VALUES ($1, $2, '150.00', 'USD', '150.00', 'USD', 'AGENTE', $3, 'usr-agente-1', $4,
             now() - COALESCE($5::interval, '0'::interval), now() - COALESCE($5::interval, '0'::interval))`,
    [id, cuenta, estado, titular, hace],
  );
}

async function envejecer(id, hace) {
  await pool.query(
    'UPDATE depositos SET actualizado_en = now() - $2::interval WHERE id = $1',
    [id, hace],
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

// AUD-R03: la auditoría se escribe en res.on('finish'), después de que supertest recibe la
// respuesta. Si el TRUNCATE de limpiar() (siguiente beforeEach) coincide con ese INSERT, PostgreSQL
// detecta un deadlock. Se espera a que el pool de la app quede sin consultas en curso y a que el
// conteo de auditoria_depositos sea estable (mismo patrón que conversion.test.js).
async function esperarAuditoria() {
  const pausa = (ms) => new Promise((r) => { setTimeout(r, ms); });
  const ocioso = () => poolApp.waitingCount === 0 && poolApp.totalCount === poolApp.idleCount;
  let previo = -1;
  let estables = 0;
  for (let i = 0; i < 100 && estables < 2; i += 1) {
    await pausa(25);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM auditoria_depositos');
    estables = ocioso() && rows[0].n === previo ? estables + 1 : 0;
    previo = rows[0].n;
  }
}

afterEach(async () => {
  await esperarAuditoria();
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

  test('verificarTitular: usr-cliente-1 por APP a su cuenta → 201; usr-cajero-1 por VENTANILLA a 0011-0123-000002 (ajena) → 201', async () => {
    const app = crearApp({ manifest: manifest() });
    billetera.cuentaActiva(CUENTA);
    billetera.acreditaOk(CUENTA);
    billetera.cuentaActiva(CUENTA_AJENA);
    const creditoAjena = billetera.acreditaOk(CUENTA_AJENA);

    const cliente = await post(app, { usuario: 'usr-cliente-1', body: { ...BODY, canal: 'APP' } });
    const cajero = await post(app, {
      usuario: 'usr-cajero-1',
      body: { cuentaDestino: CUENTA_AJENA, monto: '100.00', moneda: 'PEN', canal: 'VENTANILLA' },
    });

    expect(cliente.status).toBe(201);
    expect(cliente.body.canal).toBe('APP');
    expect(cajero.status).toBe(201);
    expect(cajero.body).toMatchObject({ moneda: 'PEN', canal: 'VENTANILLA', estado: 'COMPLETADO' });
    expect(creditoAjena.peticiones[0].body).toMatchObject({ monto: '100.00', moneda: 'PEN' });
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

describe('SPEC-07 registrar-deposito: Billetera USD (RD-T13..RD-T18)', () => {
  // SPEC-02 §4: 11111111-… (usr-cliente-1), cccccccc-… (usr-falla-una-vez: 503 y luego OK).
  const WALLET = '11111111-1111-4111-8111-111111111111';
  const WALLET_FALLA_UNA_VEZ = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const BODY_USD = { cuentaDestino: WALLET, monto: '150.00', moneda: 'USD', canal: 'AGENTE' };

  test('RD-T13 usr-agente-1 "150.00" USD AGENTE a 11111111-… → 201 COMPLETADO; Billetera USD recibió Idempotency-Key = id, cliente_id usr-cliente-1, canal, metodo_origen EFECTIVO, monto "150.00" y sin cuenta_destino_id; la fila guarda titular_id y usuario_id', async () => {
    const app = crearApp({ manifest: manifest() });
    const consulta = billetera.billeteraUsdExiste(WALLET);
    const credito = billetera.acreditaUsdOk();
    const creditoPen = billetera.acreditaOk(CUENTA);

    const res = await post(app, { body: BODY_USD, clave: 'rd-t13-clave', correlation: 'rd-t13' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.stringMatching(PATRON_UUID),
      cuentaDestino: WALLET,
      monto: '150.00',
      moneda: 'USD',
      canal: 'AGENTE',
      referencia: null,
      estado: 'COMPLETADO',
      creadoEn: expect.stringMatching(PATRON_ISO),
      actualizadoEn: expect.stringMatching(PATRON_ISO),
      extensiones: {},
    });
    const filas = await depositos();
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      id: res.body.id, cuenta_destino: WALLET, monto: '150.00', moneda: 'USD',
      monto_acreditar: '150.00', moneda_acreditar: 'USD', canal: 'AGENTE',
      estado: 'COMPLETADO', usuario_id: 'usr-agente-1', titular_id: 'usr-cliente-1',
    });

    expect(consulta.peticiones).toHaveLength(1);
    expect(credito.peticiones).toHaveLength(1);
    expect(credito.peticiones[0].headers['idempotency-key']).toBe(res.body.id);
    expect(credito.peticiones[0].headers['x-correlation-id']).toBe('rd-t13');
    // SPEC-02 v2.1 INT-R07: cliente_id = titular de la billetera, con canal y sin cuenta_destino_id.
    expect(credito.peticiones[0].body).toEqual({
      cliente_id: 'usr-cliente-1',
      monto: '150.00',
      moneda: 'USD',
      canal: 'AGENTE',
      metodo_origen: 'EFECTIVO',
      referencia_externa: res.body.id,
    });
    expect(credito.peticiones[0].body).not.toHaveProperty('cuenta_destino_id');
    expect(creditoPen.peticiones).toHaveLength(0);
  });

  test('RD-T14 "100.00" PEN a 11111111-… (USD) con conversion-moneda INACTIVA → 422 MONEDA_NO_SOPORTADA; 0 filas; sin acreditación', async () => {
    const app = crearApp({ manifest: manifest() });
    const consulta = billetera.billeteraUsdExiste(WALLET);
    const credito = billetera.acreditaUsdOk();

    const res = await post(app, { body: { ...BODY_USD, monto: '100.00', moneda: 'PEN' } });

    esError(res, 422, 'MONEDA_NO_SOPORTADA');
    expect(consulta.peticiones).toHaveLength(1);
    expect(credito.peticiones).toHaveLength(0);
    expect(await depositos()).toHaveLength(0);
  });

  test('RD-T14 "100.00" PEN a 11111111-… (USD) con conversion-moneda ACTIVA y sin tipo PEN→USD → 422 MONEDA_NO_SOPORTADA; 0 filas; sin acreditación', async () => {
    const app = crearApp({ manifest: manifest({ conversion: 'activo' }) });
    const consulta = billetera.billeteraUsdExiste(WALLET);
    const credito = billetera.acreditaUsdOk();

    const res = await post(app, { body: { ...BODY_USD, monto: '100.00', moneda: 'PEN' } });

    esError(res, 422, 'MONEDA_NO_SOPORTADA');
    expect(consulta.peticiones).toHaveLength(1);
    expect(credito.peticiones).toHaveLength(0);
    expect(await depositos()).toHaveLength(0);
  });

  test('RD-T14 "100.00" PEN a 11111111-… (USD) con conversion-moneda ACTIVA y tipo PEN→USD cargado → 422 MONEDA_NO_SOPORTADA (D1); 0 filas; sin acreditación', async () => {
    const app = crearApp({ manifest: manifest({ conversion: 'activo' }) });
    await pool.query(
      `INSERT INTO tipos_cambio (id, moneda_origen, moneda_destino, valor, vigente_desde)
       VALUES ('00000000-0000-0000-0000-000000000002', 'PEN', 'USD', 0.2600, now() - interval '1 day')`,
    );
    const consulta = billetera.billeteraUsdExiste(WALLET);
    const credito = billetera.acreditaUsdOk();

    const res = await post(app, { body: { ...BODY_USD, monto: '100.00', moneda: 'PEN' } });

    esError(res, 422, 'MONEDA_NO_SOPORTADA');
    expect(consulta.peticiones).toHaveLength(1);
    expect(credito.peticiones).toHaveLength(0);
    expect(await depositos()).toHaveLength(0);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM conversiones_deposito');
    expect(rows[0].n).toBe(0);
  });

  test('RD-T15 cuentaDestino UUID incompleto o en mayúsculas → 400 FORMATO_INVALIDO; billetera no llamada', async () => {
    const app = crearApp({ manifest: manifest() });
    const consulta = billetera.billeteraUsdExiste(WALLET);
    const credito = billetera.acreditaUsdOk();

    const cuentas = [
      '11111111-1111-4111-8111-11111111111',
      '11111111-1111-4111-8111',
      '11111111111141118111111111111111',
      '11111111-1111-4111-8111-11111111111A',
      'ABCDEF01-1111-4111-8111-111111111111',
    ];
    for (const [i, cuentaDestino] of cuentas.entries()) {
      const res = await post(app, { body: { ...BODY_USD, cuentaDestino }, clave: `rd-t15-clave-${i}` });
      esError(res, 400, 'FORMATO_INVALIDO');
    }

    expect(consulta.peticiones).toHaveLength(0);
    expect(credito.peticiones).toHaveLength(0);
    expect(await depositos()).toHaveLength(0);
  });

  test('RD-T16 Billetera USD 404 al consultar → 422 CUENTA_NO_ENCONTRADA; 0 filas; sin acreditación', async () => {
    const app = crearApp({ manifest: manifest() });
    const consulta = billetera.billeteraUsdNoExiste(WALLET);
    const credito = billetera.acreditaUsdOk();

    const res = await post(app, { body: BODY_USD });

    esError(res, 422, 'CUENTA_NO_ENCONTRADA');
    expect(consulta.peticiones).toHaveLength(1);
    expect(credito.peticiones).toHaveLength(0);
    expect(await depositos()).toHaveLength(0);
  });

  test('RD-T17 Billetera USD 409 al acreditar → 502 BILLETERA_NO_DISPONIBLE; depósito FALLIDO; clave REINTENTABLE', async () => {
    const app = crearApp({ manifest: manifest() });
    billetera.billeteraUsdExiste(WALLET);
    const credito = billetera.acreditaUsdConflicto();

    const res = await post(app, { body: BODY_USD });

    esError(res, 502, 'BILLETERA_NO_DISPONIBLE');
    const filas = await depositos();
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ estado: 'FALLIDO', cuenta_destino: WALLET, moneda: 'USD' });
    expect(credito.peticiones).toHaveLength(1);
    expect(credito.peticiones[0].headers['idempotency-key']).toBe(filas[0].id);
    expect(await claves()).toEqual([
      expect.objectContaining({ estado: 'REINTENTABLE', deposito_id: filas[0].id }),
    ]);
  });

  // SPEC-07 v2.2: cccccccc-… / usr-falla-una-vez (SPEC-02 §4): 503 la primera vez y luego OK.
  test('RD-T18 Billetera USD 503 al acreditar (cccccccc-…) → 502 FALLIDO; reintento con la misma Idempotency-Key → mismo id, COMPLETADO; la 2.ª petición lleva la misma clave, el mismo cliente_id y un body idéntico', async () => {
    const app = crearApp({ manifest: manifest() });
    const consulta = billetera.billeteraUsdExiste(WALLET_FALLA_UNA_VEZ);
    const fallo = billetera.acreditaUsdFalla({ status: 503 });
    const body = { ...BODY_USD, cuentaDestino: WALLET_FALLA_UNA_VEZ };

    const primero = await post(app, { body, clave: 'rd-t18-clave', correlation: 'rd-t18-a' });

    esError(primero, 502, 'BILLETERA_NO_DISPONIBLE');
    const [fallido] = await depositos();
    expect(fallido).toMatchObject({
      estado: 'FALLIDO', cuenta_destino: WALLET_FALLA_UNA_VEZ, titular_id: 'usr-falla-una-vez',
    });
    expect(await claves()).toEqual([
      expect.objectContaining({ estado: 'REINTENTABLE', deposito_id: fallido.id }),
    ]);
    await esperarAuditoria();

    const credito = billetera.acreditaUsdOk();
    const segundo = await post(app, { body, clave: 'rd-t18-clave', correlation: 'rd-t18-b' });

    expect(segundo.status).toBe(201);
    expect(segundo.body).toMatchObject({
      id: fallido.id, cuentaDestino: WALLET_FALLA_UNA_VEZ, monto: '150.00', moneda: 'USD', estado: 'COMPLETADO',
    });
    const filas = await depositos();
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ id: fallido.id, estado: 'COMPLETADO' });
    expect(await claves()).toEqual([
      expect.objectContaining({ estado: 'TERMINADO', status_http: 201, deposito_id: fallido.id }),
    ]);

    // RD-R08 / INT-R06: sin nueva consulta; misma Idempotency-Key, mismo cliente_id y body idéntico.
    expect(consulta.peticiones).toHaveLength(1);
    expect(fallo.peticiones).toHaveLength(1);
    expect(credito.peticiones).toHaveLength(1);
    const [original] = fallo.peticiones;
    const [reintento] = credito.peticiones;
    expect(original.headers['idempotency-key']).toBe(fallido.id);
    expect(reintento.headers['idempotency-key']).toBe(original.headers['idempotency-key']);
    expect(original.body).toEqual({
      cliente_id: 'usr-falla-una-vez',
      monto: '150.00',
      moneda: 'USD',
      canal: 'AGENTE',
      metodo_origen: 'EFECTIVO',
      referencia_externa: fallido.id,
    });
    expect(reintento.body.cliente_id).toBe(original.body.cliente_id);
    expect(reintento.body).toEqual(original.body);
  });
});

describe('SPEC-07 v2.2 registrar-deposito: Billetera USD (RD-T19..RD-T21, RD-R08, RD-R11)', () => {
  const WALLET = '11111111-1111-4111-8111-111111111111';
  const BODY_USD = { cuentaDestino: WALLET, monto: '150.00', moneda: 'USD', canal: 'AGENTE' };
  // SPEC-02 §4: rechazos de negocio del mock por cliente_id (INT-R05 → CUENTA_INACTIVA).
  const RECHAZOS = [
    ['55555555-5555-4555-8555-555555555555', 'usr-carrera', 'WALLET_BLOCKED'],
    ['66666666-6666-4666-8666-666666666666', 'usr-cliente-bloqueado', 'CUSTOMER_BLOCKED'],
    ['77777777-7777-4777-8777-777777777777', 'usr-sin-usd', 'USD_ACCOUNT_NOT_ENABLED'],
  ];

  test('RD-T19 33333333-… (BLOCKED) y 44444444-… (CLOSED) → 422 CUENTA_INACTIVA; 0 filas; sin acreditación', async () => {
    const app = crearApp({ manifest: manifest() });
    const bloqueada = billetera.billeteraUsdBloqueada();
    const cerrada = billetera.billeteraUsdCerrada();
    const credito = billetera.acreditaUsdOk();

    const r1 = await post(app, {
      body: { ...BODY_USD, cuentaDestino: '33333333-3333-4333-8333-333333333333' }, clave: 'rd-t19-a',
    });
    const r2 = await post(app, {
      body: { ...BODY_USD, cuentaDestino: '44444444-4444-4444-8444-444444444444' }, clave: 'rd-t19-b',
    });

    esError(r1, 422, 'CUENTA_INACTIVA');
    esError(r2, 422, 'CUENTA_INACTIVA');
    expect(bloqueada.peticiones).toHaveLength(1);
    expect(cerrada.peticiones).toHaveLength(1);
    expect(credito.peticiones).toHaveLength(0);
    expect(await depositos()).toHaveLength(0);
  });

  test('RD-T20 Billetera USD 422 al acreditar (55555555-…, 66666666-…, 77777777-…) → 422 CUENTA_INACTIVA; depósito FALLIDO', async () => {
    const app = crearApp({ manifest: manifest() });

    for (const [i, [cuentaDestino, titular, codigo]] of RECHAZOS.entries()) {
      billetera.billeteraUsdExiste(cuentaDestino);
      const rechazo = billetera.acreditaUsdRechazo(codigo);

      const res = await post(app, { body: { ...BODY_USD, cuentaDestino }, clave: `rd-t20-${i}` });

      esError(res, 422, 'CUENTA_INACTIVA');
      const fila = (await depositos()).find((f) => f.cuenta_destino === cuentaDestino);
      expect(fila).toMatchObject({ estado: 'FALLIDO', moneda: 'USD', titular_id: titular });
      expect(rechazo.peticiones).toHaveLength(1);
      expect(rechazo.peticiones[0].headers['idempotency-key']).toBe(fila.id);
      expect(rechazo.peticiones[0].body.cliente_id).toBe(titular);
      await esperarAuditoria();
    }
    expect((await depositos()).map((f) => f.estado)).toEqual(['FALLIDO', 'FALLIDO', 'FALLIDO']);
  });

  test('RD-R11 acreditar → CUENTA_INACTIVA: la clave queda TERMINADO (422, con depositoId) y repetirla devuelve el mismo 422 sin llamar a billetera', async () => {
    const app = crearApp({ manifest: manifest() });
    const [cuentaDestino, , codigo] = RECHAZOS[1];
    const consulta = billetera.billeteraUsdExiste(cuentaDestino);
    const rechazo = billetera.acreditaUsdRechazo(codigo);
    const body = { ...BODY_USD, cuentaDestino };

    const primero = await post(app, { body, clave: 'rd-r11-clave' });
    esError(primero, 422, 'CUENTA_INACTIVA');
    const [fallido] = await depositos();
    expect(await claves()).toEqual([
      expect.objectContaining({ estado: 'TERMINADO', status_http: 422, deposito_id: fallido.id }),
    ]);
    await esperarAuditoria();

    const otraVez = billetera.acreditaUsdOk();
    const segundo = await post(app, { body, clave: 'rd-r11-clave' });

    expect(segundo.status).toBe(422);
    expect(segundo.headers['idempotency-replayed']).toBe('true');
    expect(segundo.body).toEqual(primero.body);
    expect(consulta.peticiones).toHaveLength(1);
    expect(rechazo.peticiones).toHaveLength(1);
    expect(otraVez.peticiones).toHaveLength(0);
    expect(await depositos()).toEqual([expect.objectContaining({ id: fallido.id, estado: 'FALLIDO' })]);
  });

  test('RD-T21 Billetera USD 202 → 202 PROCESANDO; sin post-procesos; repetir la clave → el mismo 202', async () => {
    const app = crearApp({ manifest: manifest() });
    const consulta = billetera.billeteraUsdExiste(WALLET);
    const pendiente = billetera.acreditaUsdPendiente();
    const otraVez = billetera.acreditaUsdOk();
    const postProcesos = jest.spyOn(pipeline, 'ejecutarPostProcesos');

    const primero = await post(app, { body: BODY_USD, clave: 'rd-t21-clave', correlation: 'rd-t21' });

    expect(primero.status).toBe(202);
    expect(primero.headers['idempotency-replayed']).toBeUndefined();
    expect(primero.body).toEqual({
      id: expect.stringMatching(PATRON_UUID),
      cuentaDestino: WALLET,
      monto: '150.00',
      moneda: 'USD',
      canal: 'AGENTE',
      referencia: null,
      estado: 'PROCESANDO',
      creadoEn: expect.stringMatching(PATRON_ISO),
      actualizadoEn: expect.stringMatching(PATRON_ISO),
      extensiones: {},
    });
    const filas = await depositos();
    expect(filas).toEqual([expect.objectContaining({
      id: primero.body.id, estado: 'PROCESANDO', titular_id: 'usr-cliente-1',
    })]);
    expect(postProcesos).not.toHaveBeenCalled();
    expect(pendiente.peticiones).toHaveLength(1);
    expect(await claves()).toEqual([
      expect.objectContaining({ estado: 'TERMINADO', status_http: 202, deposito_id: primero.body.id }),
    ]);
    await esperarAuditoria();

    const segundo = await post(app, { body: BODY_USD, clave: 'rd-t21-clave' });

    expect(segundo.status).toBe(202);
    expect(segundo.headers['idempotency-replayed']).toBe('true');
    expect(segundo.body).toEqual(primero.body);
    expect(consulta.peticiones).toHaveLength(1);
    expect(otraVez.peticiones).toHaveLength(0);
    expect(postProcesos).not.toHaveBeenCalled();
    expect(await depositos()).toEqual([expect.objectContaining({ estado: 'PROCESANDO' })]);
  });

  test('RD-R08 reintentar un depósito USD FALLIDO y el replay responde FALLIDO (RECHAZADO) → FALLIDO y 502 BILLETERA_NO_DISPONIBLE con depositoId', async () => {
    crearApp({ manifest: manifest() });
    const id = '7f1c2e9a-0b1d-4c5e-9f00-123456789abc';
    await insertarUsd(id, 'FALLIDO', { cuenta: WALLET, titular: 'usr-cliente-1' });
    const replay = billetera.acreditaUsdReplay({ estado: 'FALLIDO' });
    const postProcesos = jest.spyOn(pipeline, 'ejecutarPostProcesos');

    await expect(service.reintentar(id, AGENTE_1, 'rd-r08-rechazado'))
      .rejects.toMatchObject({ codigo: 'BILLETERA_NO_DISPONIBLE', status: 502, depositoId: id });

    expect(replay.peticiones).toHaveLength(1);
    expect(replay.peticiones[0].headers['idempotency-key']).toBe(id);
    expect(replay.peticiones[0].body).toEqual({
      cliente_id: 'usr-cliente-1', monto: '150.00', moneda: 'USD', canal: 'AGENTE',
      metodo_origen: 'EFECTIVO', referencia_externa: id,
    });
    expect((await depositos())[0]).toMatchObject({ id, estado: 'FALLIDO' });
    expect(postProcesos).not.toHaveBeenCalled();
  });
});

describe('SPEC-07 v2.2 reconciliación con la BD real (RD-T22..RD-T24, RD-R13)', () => {
  const WALLET = '11111111-1111-4111-8111-111111111111';
  // SPEC-02 §4: aaaaaaaa-… / usr-pendiente (202 y luego COMPLETADO), bbbbbbbb-… / usr-pendiente-falla
  // (202 y luego FALLIDO).
  const WALLET_PENDIENTE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const WALLET_PENDIENTE_FALLA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const ID_1 = '7f1c2e9a-0b1d-4c5e-9f00-123456789abc';
  const ID_2 = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
  const ID_3 = '5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d';

  // POST que Billetera USD deja pendiente (202 VALIDADO) y luego envejece la fila más allá de
  // RECONCILIACION_ANTIGUEDAD_MS. Devuelve el depósito y la petición original a Billetera USD.
  async function depositoPendiente(app, cuentaDestino, clave) {
    billetera.billeteraUsdExiste(cuentaDestino);
    const pendiente = billetera.acreditaUsdPendiente();
    const res = await post(app, {
      body: { cuentaDestino, monto: '150.00', moneda: 'USD', canal: 'AGENTE' }, clave,
    });
    expect(res.status).toBe(202);
    expect(pendiente.peticiones).toHaveLength(1);
    // La auditoría (FK a depositos) debe terminar antes: su bloqueo haría que SKIP LOCKED salte la fila.
    await esperarAuditoria();
    await envejecer(res.body.id, '1 minute');
    return { id: res.body.id, original: pendiente.peticiones[0] };
  }

  function mismoBody(reenvio, original, id) {
    expect(reenvio.headers['idempotency-key']).toBe(id);
    expect(reenvio.headers['idempotency-key']).toBe(original.headers['idempotency-key']);
    expect(reenvio.body).toEqual(original.body);
  }

  test('RD-T22 replay COMPLETADO → COMPLETADO y post-procesos una sola vez (contexto.cuenta = null); body idéntico al original', async () => {
    const app = crearApp({ manifest: manifest() });
    const postProcesos = jest.spyOn(pipeline, 'ejecutarPostProcesos');
    const { id, original } = await depositoPendiente(app, WALLET_PENDIENTE, 'rd-t22-completado');
    expect(postProcesos).not.toHaveBeenCalled();
    const replay = billetera.acreditaUsdReplay({ estado: 'COMPLETADO' });

    const resumen = await reconciliacion.reconciliar();

    expect(resumen).toEqual({ completados: 1, fallidos: 0, pendientes: 0 });
    expect((await depositos())[0]).toMatchObject({ id, estado: 'COMPLETADO' });
    expect(replay.peticiones).toHaveLength(1);
    mismoBody(replay.peticiones[0], original, id);
    expect(original.body.cliente_id).toBe('usr-pendiente');
    expect(postProcesos).toHaveBeenCalledTimes(1);
    const [deposito, contexto] = postProcesos.mock.calls[0];
    expect(deposito).toMatchObject({ id, estado: 'COMPLETADO', moneda: 'USD' });
    expect(contexto).toMatchObject({ cuenta: null, usuario: { id: 'usr-agente-1', roles: [] } });

    // Un segundo ciclo ya no lo toma: sin otra acreditación ni otro post-proceso.
    const otraVez = billetera.acreditaUsdReplay({ estado: 'COMPLETADO' });
    await expect(reconciliacion.reconciliar())
      .resolves.toEqual({ completados: 0, fallidos: 0, pendientes: 0 });
    expect(otraVez.peticiones).toHaveLength(0);
    expect(postProcesos).toHaveBeenCalledTimes(1);
  });

  test('RD-T22 replay FALLIDO → FALLIDO; sin post-procesos; body idéntico al original', async () => {
    const app = crearApp({ manifest: manifest() });
    const postProcesos = jest.spyOn(pipeline, 'ejecutarPostProcesos');
    const { id, original } = await depositoPendiente(app, WALLET_PENDIENTE_FALLA, 'rd-t22-fallido');
    const replay = billetera.acreditaUsdReplay({ estado: 'FALLIDO' });

    const resumen = await reconciliacion.reconciliar();

    expect(resumen).toEqual({ completados: 0, fallidos: 1, pendientes: 0 });
    expect((await depositos())[0]).toMatchObject({ id, estado: 'FALLIDO' });
    expect(replay.peticiones).toHaveLength(1);
    mismoBody(replay.peticiones[0], original, id);
    expect(original.body.cliente_id).toBe('usr-pendiente-falla');
    expect(postProcesos).not.toHaveBeenCalled();
  });

  test('RD-T22 replay VALIDADO → sigue en PROCESANDO (actualizado_en intacto); body idéntico al original; se reintenta en el siguiente ciclo', async () => {
    const app = crearApp({ manifest: manifest() });
    const postProcesos = jest.spyOn(pipeline, 'ejecutarPostProcesos');
    const { id, original } = await depositoPendiente(app, WALLET_PENDIENTE, 'rd-t22-validado');
    const [antes] = await depositos();
    const replay = billetera.acreditaUsdReplay({ estado: 'VALIDADO' });

    const resumen = await reconciliacion.reconciliar();

    expect(resumen).toEqual({ completados: 0, fallidos: 0, pendientes: 1 });
    const [despues] = await depositos();
    expect(despues).toMatchObject({ id, estado: 'PROCESANDO' });
    expect(despues.actualizado_en.getTime()).toBe(antes.actualizado_en.getTime());
    expect(replay.peticiones).toHaveLength(1);
    mismoBody(replay.peticiones[0], original, id);
    expect(postProcesos).not.toHaveBeenCalled();

    const siguiente = billetera.acreditaUsdReplay({ estado: 'COMPLETADO' });
    await expect(reconciliacion.reconciliar())
      .resolves.toEqual({ completados: 1, fallidos: 0, pendientes: 0 });
    mismoBody(siguiente.peticiones[0], original, id);
    expect(postProcesos).toHaveBeenCalledTimes(1);
  });

  test('RD-T23 dos reconciliaciones simultáneas sobre el mismo depósito → 1 sola lo procesa (una acreditación, un post-proceso)', async () => {
    crearApp({ manifest: manifest() });
    await insertarUsd(ID_1, 'PROCESANDO', { cuenta: WALLET, titular: 'usr-cliente-1', hace: '1 minute' });
    const replay = billetera.acreditaUsdReplay({ estado: 'COMPLETADO' });
    const sobrante = billetera.acreditaUsdReplay({ estado: 'COMPLETADO' });
    const postProcesos = jest.spyOn(pipeline, 'ejecutarPostProcesos');

    // La primera reconciliación retiene la fila bloqueada (no llama a billetera) hasta que la
    // segunda haya hecho su SELECT ... FOR UPDATE SKIP LOCKED: así se solapan siempre.
    const tomados = [];
    let avisarSegunda;
    const segundaTomo = new Promise((r) => { avisarSegunda = r; });
    const tomarReal = repository.tomarParaReconciliar;
    jest.spyOn(repository, 'tomarParaReconciliar').mockImplementation(async (...args) => {
      const filas = await tomarReal(...args);
      tomados.push(filas.map((f) => f.id));
      if (tomados.length === 2) avisarSegunda();
      return filas;
    });
    const acreditarReal = billeteraClient.acreditar;
    let tope;
    jest.spyOn(billeteraClient, 'acreditar').mockImplementation(async (...args) => {
      // Tope de 3 s por si la segunda quedara bloqueada esperando la fila (sin SKIP LOCKED).
      await Promise.race([segundaTomo, new Promise((r) => { tope = setTimeout(r, 3000); })]);
      clearTimeout(tope);
      return acreditarReal(...args);
    });

    const resumenes = await Promise.all([reconciliacion.reconciliar(), reconciliacion.reconciliar()]);

    expect(tomados).toHaveLength(2);
    expect(tomados.map((t) => t.length).sort()).toEqual([0, 1]);
    expect(resumenes.map((r) => r.completados).sort()).toEqual([0, 1]);
    expect(resumenes.every((r) => r.fallidos === 0 && r.pendientes === 0)).toBe(true);
    expect(replay.peticiones).toHaveLength(1);
    expect(sobrante.peticiones).toHaveLength(0);
    expect(postProcesos).toHaveBeenCalledTimes(1);
    expect((await depositos())[0]).toMatchObject({ id: ID_1, estado: 'COMPLETADO' });
  });

  test('RD-T24 depósito PEN en PROCESANDO (antiguo) → la reconciliación no lo toma; tampoco un USD reciente', async () => {
    crearApp({ manifest: manifest() });
    await insertarDeposito(ID_1, 'PROCESANDO');
    await envejecer(ID_1, '2 hours');
    await insertarUsd(ID_2, 'PROCESANDO', { cuenta: WALLET, titular: 'usr-cliente-1' });
    await insertarUsd(ID_3, 'PROCESANDO', { cuenta: WALLET, titular: 'usr-cliente-1', hace: '1 minute' });
    const antes = await depositos();
    const creditoPen = billetera.acreditaOk(CUENTA);
    const replay = billetera.acreditaUsdReplay({ estado: 'COMPLETADO' });
    const sobrante = billetera.acreditaUsdReplay({ estado: 'COMPLETADO' });

    const resumen = await reconciliacion.reconciliar();

    // Solo el USD antiguo (ID_3); el PEN (RD-R14) y el USD reciente quedan como estaban.
    expect(resumen).toEqual({ completados: 1, fallidos: 0, pendientes: 0 });
    expect(creditoPen.peticiones).toHaveLength(0);
    expect(replay.peticiones).toHaveLength(1);
    expect(replay.peticiones[0].headers['idempotency-key']).toBe(ID_3);
    expect(sobrante.peticiones).toHaveLength(0);
    const porId = Object.fromEntries((await depositos()).map((f) => [f.id, f]));
    expect(porId[ID_1].estado).toBe('PROCESANDO');
    expect(porId[ID_2].estado).toBe('PROCESANDO');
    expect(porId[ID_3].estado).toBe('COMPLETADO');
    const previo = Object.fromEntries(antes.map((f) => [f.id, f]));
    expect(porId[ID_1].actualizado_en.getTime()).toBe(previo[ID_1].actualizado_en.getTime());
    expect(porId[ID_2].actualizado_en.getTime()).toBe(previo[ID_2].actualizado_en.getTime());
  });

  test('RD-R13 Billetera USD 422 (CUENTA_INACTIVA) → FALLIDO; 503 (BILLETERA_NO_DISPONIBLE) → sigue en PROCESANDO', async () => {
    crearApp({ manifest: manifest() });
    // ORDER BY actualizado_en: ID_1 (más antiguo) se reenvía primero.
    await insertarUsd(ID_1, 'PROCESANDO', { cuenta: WALLET, titular: 'usr-cliente-1', hace: '3 minutes' });
    await insertarUsd(ID_2, 'PROCESANDO', { cuenta: WALLET, titular: 'usr-cliente-1', hace: '2 minutes' });
    const rechazo = billetera.acreditaUsdRechazo('WALLET_BLOCKED');
    const falla = billetera.acreditaUsdFalla({ status: 503 });

    const resumen = await reconciliacion.reconciliar();

    expect(resumen).toEqual({ completados: 0, fallidos: 1, pendientes: 1 });
    expect(rechazo.peticiones[0].headers['idempotency-key']).toBe(ID_1);
    expect(falla.peticiones[0].headers['idempotency-key']).toBe(ID_2);
    const porId = Object.fromEntries((await depositos()).map((f) => [f.id, f]));
    expect(porId[ID_1].estado).toBe('FALLIDO');
    expect(porId[ID_2].estado).toBe('PROCESANDO');
  });

  test('RD-R13 sigue en PROCESANDO más de RECONCILIACION_ALERTA_MS → logger.error con depositoId; uno reciente no alerta', async () => {
    crearApp({ manifest: manifest() });
    await insertarUsd(ID_1, 'PROCESANDO', { cuenta: WALLET, titular: 'usr-cliente-1', hace: '2 hours' });
    await insertarUsd(ID_2, 'PROCESANDO', { cuenta: WALLET, titular: 'usr-cliente-1', hace: '1 minute' });
    billetera.acreditaUsdReplay({ estado: 'VALIDADO' });
    billetera.acreditaUsdReplay({ estado: 'VALIDADO' });
    const errores = [];
    const original = logger.child.bind(logger);
    jest.spyOn(logger, 'child').mockImplementation((...args) => {
      const hijo = original(...args);
      const error = hijo.error.bind(hijo);
      hijo.error = (obj, ...resto) => { errores.push(obj); return error(obj, ...resto); };
      return hijo;
    });

    const resumen = await reconciliacion.reconciliar();

    expect(resumen).toEqual({ completados: 0, fallidos: 0, pendientes: 2 });
    const alertas = errores.filter((e) => e && e.enProcesandoMs !== undefined);
    expect(alertas).toEqual([expect.objectContaining({ depositoId: ID_1 })]);
    expect(alertas[0].enProcesandoMs).toBeGreaterThan(config.reconciliacion.alertaMs);
    expect((await depositos()).map((f) => f.estado)).toEqual(['PROCESANDO', 'PROCESANDO']);
  });
});
