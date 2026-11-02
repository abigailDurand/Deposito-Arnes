'use strict';

const { createHash } = require('node:crypto');
const express = require('express');
const nock = require('nock');
const request = require('supertest');

const config = require('../../../src/config');
const { crearApp } = require('../../../src/app');
const { pool: poolApp } = require('../../../src/core/db');
const { ErrorApp, manejar } = require('../../../src/core/errores');
const { logger } = require('../../../src/core/logger');
const idempotenciaRepository = require('../../../src/core/repositories/idempotenciaRepository');
const correlationId = require('../../../src/core/middlewares/correlationId');
const { autenticar } = require('../../../src/core/middlewares/auth');
const idempotencia = require('../../../src/core/middlewares/idempotencia');
const manejadorErrores = require('../../../src/core/middlewares/manejadorErrores');
const limpiarClaves = require('../../../src/core/tareas/limpiarClaves');
const billetera = require('../../helpers/billetera');
const { limpiar, cerrar, pool } = require('../../helpers/db');
const { token } = require('../../helpers/tokens');

const CUENTA = '0011-0123-456789';
const ID_DEPOSITO = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const ID_INEXISTENTE = '7f1c2e9a-0b1d-4c5e-9f00-123456789abc';
const RUTA = '/api/v1/depositos';
const CLAVE = 'clave-ide-0001';
const BODY = { cuentaDestino: CUENTA, monto: '150.00', moneda: 'PEN', canal: 'AGENTE' };

// La ruta real (SPEC-07) aún no existe. El controller falso lo decide cada prueba con
// `controlador`; el orden es el de SPEC-05 §6: después de autenticar y antes del controller.
let controlador;
let llamadas;
let observados;

function crearAppPrueba({ conCorrelationId = true } = {}) {
  const app = express();
  if (conCorrelationId) app.use(correlationId);
  app.use(autenticar);
  app.use(express.json());
  app.use((req, res, next) => {
    res.on('finish', () => {
      observados.push({ depositoId: res.locals.depositoId, idempotencia: req.idempotencia });
    });
    next();
  });
  app.post(RUTA, idempotencia, manejar(async (req, res) => {
    llamadas += 1;
    await controlador(req, res);
  }));
  app.use(manejadorErrores);
  return app;
}

const app = crearAppPrueba();

function post(usuario = 'usr-agente-1', { clave = CLAVE, body = BODY, correlation, appUsada = app } = {}) {
  let r = request(appUsada).post(RUTA).set('Authorization', `Bearer ${token(usuario)}`);
  if (clave !== null) r = r.set('Idempotency-Key', clave);
  if (correlation) r = r.set('X-Correlation-Id', correlation);
  return r.send(body);
}

async function claves() {
  const { rows } = await pool.query(
    `SELECT usuario_id, clave, hash_solicitud, estado, status_http, respuesta, deposito_id
       FROM claves_idempotencia ORDER BY usuario_id, clave`,
  );
  return rows;
}

async function crearDeposito(id = ID_DEPOSITO) {
  await pool.query(
    `INSERT INTO depositos (id, cuenta_destino, monto, moneda, monto_acreditar, moneda_acreditar,
                            canal, estado, usuario_id)
     VALUES ($1, $2, 150.00, 'PEN', 150.00, 'PEN', 'AGENTE', 'PENDIENTE', 'usr-agente-1')`,
    [id, CUENTA],
  );
}

function diferido() {
  let liberar;
  const promesa = new Promise((r) => { liberar = r; });
  return { promesa, liberar };
}

function esperar(ms) {
  return new Promise((r) => { setTimeout(r, ms); });
}

function hashEsperado(texto) {
  return createHash('sha256').update(texto).digest('hex');
}

beforeEach(async () => {
  await limpiar();
  llamadas = 0;
  observados = [];
  controlador = async (req, res) => {
    res.locals.depositoId = ID_DEPOSITO;
    res.status(201).json({ id: ID_DEPOSITO, estado: 'COMPLETADO' });
  };
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await poolApp.end();
  await cerrar();
});

describe('SPEC-05 idempotencia: casos', () => {
  test('IDE-T01 POST con clave nueva → pasa al controller; fila TERMINADO con el status de la respuesta', async () => {
    await crearDeposito();

    const res = await post();

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: ID_DEPOSITO, estado: 'COMPLETADO' });
    expect(res.headers['idempotency-replayed']).toBeUndefined();
    expect(llamadas).toBe(1);

    const filas = await claves();
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      usuario_id: 'usr-agente-1',
      clave: CLAVE,
      estado: 'TERMINADO',
      status_http: 201,
      respuesta: { id: ID_DEPOSITO, estado: 'COMPLETADO' },
      deposito_id: ID_DEPOSITO,
    });
  });

  test('IDE-T01 status no 201 (422) → fila TERMINADO con 422 y deposito_id nulo', async () => {
    controlador = async (req, res) => {
      res.status(422).json({ codigo: 'MONTO_INVALIDO' });
    };

    const res = await post();

    expect(res.status).toBe(422);
    const filas = await claves();
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      estado: 'TERMINADO', status_http: 422, respuesta: { codigo: 'MONTO_INVALIDO' }, deposito_id: null,
    });
  });

  test('IDE-T09 sin header Idempotency-Key → 400 IDEMPOTENCY_KEY_REQUERIDA; el controller no corre', async () => {
    const res = await post('usr-agente-1', { clave: null, correlation: 'ide-t09' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      codigo: 'IDEMPOTENCY_KEY_REQUERIDA',
      mensaje: 'Falta o es inválido el header Idempotency-Key.',
      correlationId: 'ide-t09',
    });
    expect(llamadas).toBe(0);
    expect(await claves()).toHaveLength(0);
  });

  test('IDE-T09 clave de 7 caracteres → 400 IDEMPOTENCY_KEY_REQUERIDA; el controller no corre', async () => {
    const res = await post('usr-agente-1', { clave: '1234567' });

    expect(res.status).toBe(400);
    expect(res.body.codigo).toBe('IDEMPOTENCY_KEY_REQUERIDA');
    expect(llamadas).toBe(0);
    expect(await claves()).toHaveLength(0);
  });

});

// SPEC-07 ya existe: estos casos usan la ruta real con crearApp, PostgreSQL real y billetera con nock.
// Todas las extensiones inactivas; el pipeline es un singleton y cada prueba arma su app.
describe('SPEC-05 idempotencia: casos con la ruta real (SPEC-07)', () => {
  const MANIFEST = {
    version: 1,
    servicio: 'deposito-service',
    features: [
      { id: 'registrar-deposito', estado: 'activo', tipo: 'endpoint' },
      { id: 'limites-por-canal', estado: 'inactivo', tipo: 'validador', orden: 10 },
      { id: 'conversion-moneda', estado: 'inactivo', tipo: 'transformador', orden: 10 },
      { id: 'alerta-uif', estado: 'inactivo', tipo: 'post-proceso', orden: 10 },
    ],
  };

  async function depositos() {
    const { rows } = await pool.query('SELECT id, estado, usuario_id FROM depositos ORDER BY creado_en');
    return rows;
  }

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

  test('IDE-T02 repetir el mismo POST → mismo status y cuerpo, Idempotency-Replayed: true, billetera llamada 1 vez', async () => {
    const appReal = crearApp({ manifest: MANIFEST });
    const consulta = billetera.cuentaActiva(CUENTA);
    const credito = billetera.acreditaOk(CUENTA);

    const primera = await post('usr-agente-1', { appUsada: appReal, correlation: 'ide-t02-a' });
    const segunda = await post('usr-agente-1', { appUsada: appReal, correlation: 'ide-t02-b' });

    expect(primera.status).toBe(201);
    expect(primera.headers['idempotency-replayed']).toBeUndefined();
    expect(segunda.status).toBe(201);
    expect(segunda.body).toEqual(primera.body);
    expect(segunda.headers['idempotency-replayed']).toBe('true');
    expect(segunda.headers['x-correlation-id']).toBe('ide-t02-b');
    expect(consulta.peticiones).toHaveLength(1);
    expect(credito.peticiones).toHaveLength(1);
    expect(credito.peticiones[0].body.depositoId).toBe(primera.body.id);
    expect(await depositos()).toEqual([
      expect.objectContaining({ id: primera.body.id, estado: 'COMPLETADO' }),
    ]);
  });

  test('IDE-T03 misma clave, monto distinto → 409 IDEMPOTENCY_KEY_REUTILIZADA', async () => {
    const appReal = crearApp({ manifest: MANIFEST });
    billetera.cuentaActiva(CUENTA);
    const credito = billetera.acreditaOk(CUENTA);

    const primera = await post('usr-agente-1', { appUsada: appReal });
    const segunda = await post('usr-agente-1', {
      appUsada: appReal, body: { ...BODY, monto: '200.00' }, correlation: 'ide-t03',
    });

    expect(primera.status).toBe(201);
    expect(segunda.status).toBe(409);
    expect(segunda.body).toEqual({
      codigo: 'IDEMPOTENCY_KEY_REUTILIZADA',
      mensaje: 'Clave usada antes con otros datos.',
      correlationId: 'ide-t03',
    });
    expect(credito.peticiones).toHaveLength(1);
    expect(await depositos()).toHaveLength(1);
  });

  test('IDE-T04 billetera tarda 2 s; segundo POST a los 100 ms → 409 SOLICITUD_EN_PROCESO; el primero termina 201', async () => {
    const appReal = crearApp({ manifest: MANIFEST });
    billetera.cuentaActiva(CUENTA);
    const credito = billetera.acreditaLento(CUENTA, { demora: 2000 });

    const inicio = Date.now();
    const primera = post('usr-agente-1', { appUsada: appReal }).then((r) => r);
    await esperar(100);
    const segunda = await post('usr-agente-1', { appUsada: appReal, correlation: 'ide-t04' });

    expect(segunda.status).toBe(409);
    expect(segunda.body).toEqual({
      codigo: 'SOLICITUD_EN_PROCESO',
      mensaje: 'La solicitud original con esa clave aún se procesa.',
      correlationId: 'ide-t04',
    });
    const r1 = await primera;
    expect(Date.now() - inicio).toBeGreaterThanOrEqual(1900);
    expect(r1.status).toBe(201);
    expect(r1.body.estado).toBe('COMPLETADO');
    expect(credito.peticiones).toHaveLength(1);
    expect(await depositos()).toHaveLength(1);
  }, 10000);

  test('IDE-T05 5 POST simultáneos con la misma clave → 1 depósito, 1 acreditación', async () => {
    const appReal = crearApp({ manifest: MANIFEST });
    const consulta = billetera.cuentaActiva(CUENTA);
    const credito = billetera.acreditaOk(CUENTA);

    const respuestas = await Promise.all(
      Array.from({ length: 5 }, () => post('usr-agente-1', { appUsada: appReal })),
    );

    const originales = respuestas.filter((r) => r.status === 201 && !r.headers['idempotency-replayed']);
    expect(originales).toHaveLength(1);
    for (const r of respuestas) {
      if (r.status === 201) {
        expect(r.body).toEqual(originales[0].body);
      } else {
        expect(r.status).toBe(409);
        expect(r.body.codigo).toBe('SOLICITUD_EN_PROCESO');
      }
    }
    expect(consulta.peticiones).toHaveLength(1);
    expect(credito.peticiones).toHaveLength(1);
    expect(await depositos()).toHaveLength(1);
    expect(await claves()).toEqual([
      expect.objectContaining({ estado: 'TERMINADO', status_http: 201, deposito_id: originales[0].body.id }),
    ]);
  });

  test('IDE-T06 billetera 500 al acreditar, luego reintento y billetera OK → 502, luego 201 con el mismo id; billetera recibió el mismo depositoId', async () => {
    const appReal = crearApp({ manifest: MANIFEST });
    const consulta = billetera.cuentaActiva(CUENTA);
    const fallo = billetera.acreditaFalla(CUENTA, { status: 500 });

    const primera = await post('usr-agente-1', { appUsada: appReal });

    expect(primera.status).toBe(502);
    expect(primera.body.codigo).toBe('BILLETERA_NO_DISPONIBLE');
    const [fallido] = await depositos();
    expect(fallido.estado).toBe('FALLIDO');
    expect((await claves())[0]).toMatchObject({ estado: 'REINTENTABLE', deposito_id: fallido.id });

    const ok = billetera.acreditaOk(CUENTA);
    const segunda = await post('usr-agente-1', { appUsada: appReal });

    expect(segunda.status).toBe(201);
    expect(segunda.headers['idempotency-replayed']).toBeUndefined();
    expect(segunda.body).toMatchObject({ id: fallido.id, estado: 'COMPLETADO', extensiones: {} });
    expect(fallo.peticiones[0].body.depositoId).toBe(fallido.id);
    expect(ok.peticiones[0].body.depositoId).toBe(fallido.id);
    expect(consulta.peticiones).toHaveLength(1);
    expect(await depositos()).toEqual([expect.objectContaining({ id: fallido.id, estado: 'COMPLETADO' })]);
    expect((await claves())[0]).toMatchObject({ estado: 'TERMINADO', status_http: 201, deposito_id: fallido.id });
  });

  test('IDE-T07 billetera timeout, luego reintento y billetera 409 → 201 COMPLETADO', async () => {
    const appReal = crearApp({ manifest: MANIFEST });
    billetera.cuentaActiva(CUENTA);
    billetera.acreditaLento(CUENTA, { demora: 6000 });

    const primera = await post('usr-agente-1', { appUsada: appReal });

    expect(primera.status).toBe(502);
    expect(primera.body.codigo).toBe('BILLETERA_NO_DISPONIBLE');
    const [fallido] = await depositos();
    expect(fallido.estado).toBe('FALLIDO');

    const yaExiste = billetera.acreditaYaExiste(CUENTA);
    const segunda = await post('usr-agente-1', { appUsada: appReal });

    expect(segunda.status).toBe(201);
    expect(segunda.body).toMatchObject({ id: fallido.id, estado: 'COMPLETADO' });
    expect(yaExiste.peticiones[0].body.depositoId).toBe(fallido.id);
    expect(await depositos()).toEqual([expect.objectContaining({ id: fallido.id, estado: 'COMPLETADO' })]);
  }, 20000);

  test('IDE-T08 billetera 500 al consultar la cuenta, luego reintento → 502, luego se procesa como nuevo', async () => {
    const appReal = crearApp({ manifest: MANIFEST });
    billetera.consultaFalla(CUENTA, { status: 500 });

    const primera = await post('usr-agente-1', { appUsada: appReal });

    expect(primera.status).toBe(502);
    expect(primera.body.codigo).toBe('BILLETERA_NO_DISPONIBLE');
    expect(await depositos()).toHaveLength(0);
    expect(await claves()).toHaveLength(0);

    const consulta = billetera.cuentaActiva(CUENTA);
    const credito = billetera.acreditaOk(CUENTA);
    const segunda = await post('usr-agente-1', { appUsada: appReal });

    expect(segunda.status).toBe(201);
    expect(segunda.headers['idempotency-replayed']).toBeUndefined();
    expect(segunda.body.estado).toBe('COMPLETADO');
    expect(consulta.peticiones).toHaveLength(1);
    expect(credito.peticiones).toHaveLength(1);
    expect(await depositos()).toEqual([expect.objectContaining({ id: segunda.body.id, estado: 'COMPLETADO' })]);
  });

  test('IDE-T10 usr-agente-1 y usr-agente-2 con la misma clave → ambos se procesan', async () => {
    const appReal = crearApp({ manifest: MANIFEST });
    billetera.cuentaActiva(CUENTA);
    billetera.cuentaActiva(CUENTA);
    const credito1 = billetera.acreditaOk(CUENTA);
    const credito2 = billetera.acreditaOk(CUENTA);

    const r1 = await post('usr-agente-1', { appUsada: appReal });
    const r2 = await post('usr-agente-2', { appUsada: appReal });

    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(r2.headers['idempotency-replayed']).toBeUndefined();
    expect(r2.body.id).not.toBe(r1.body.id);
    expect(credito1.peticiones).toHaveLength(1);
    expect(credito2.peticiones).toHaveLength(1);
    const filas = await depositos();
    expect(filas.map((f) => f.usuario_id).sort()).toEqual(['usr-agente-1', 'usr-agente-2']);
    expect((await claves()).map((c) => [c.usuario_id, c.clave])).toEqual([
      ['usr-agente-1', CLAVE], ['usr-agente-2', CLAVE],
    ]);
  });
});

describe('SPEC-05 idempotencia: reglas con controller falso (sin SPEC-07)', () => {
  test('IDE-R01: claveValida acepta 8 y 100 caracteres; rechaza 7, 101, vacío y no string', async () => {
    expect(idempotencia.claveValida('12345678')).toBe(true);
    expect(idempotencia.claveValida('x'.repeat(100))).toBe(true);
    expect(idempotencia.claveValida('1234567')).toBe(false);
    expect(idempotencia.claveValida('x'.repeat(101))).toBe(false);
    expect(idempotencia.claveValida('')).toBe(false);
    expect(idempotencia.claveValida(undefined)).toBe(false);
    expect(idempotencia.claveValida(12345678)).toBe(false);

    expect((await post('usr-agente-1', { clave: 'x'.repeat(101) })).status).toBe(400);
    expect((await post('usr-agente-1', { clave: '12345678' })).status).toBe(201);
    expect((await post('usr-agente-1', { clave: 'y'.repeat(100) })).status).toBe(201);
    expect(llamadas).toBe(2);
  });

  test('IDE-R03: hash = SHA-256 hex de "método originalUrl body" con llaves ordenadas (recursivo; arrays conservan orden)', async () => {
    const req = {
      method: 'POST',
      originalUrl: '/api/v1/depositos?x=1',
      body: { z: 1, a: { d: [{ b: 2, a: 1 }, 3], c: null } },
    };
    expect(idempotencia.calcularHash(req)).toBe(
      hashEsperado('POST /api/v1/depositos?x=1 {"a":{"c":null,"d":[{"a":1,"b":2},3]},"z":1}'),
    );
    expect(idempotencia.calcularHash({ method: 'POST', originalUrl: RUTA, body: undefined }))
      .toBe(hashEsperado(`POST ${RUTA} `));

    await post();
    const [fila] = await claves();
    expect(fila.hash_solicitud).toBe(hashEsperado(
      `POST ${RUTA} {"canal":"AGENTE","cuentaDestino":"${CUENTA}","moneda":"PEN","monto":"150.00"}`,
    ));
  });

  test('IDE-R07: repetir TERMINADO → mismo status y cuerpo, Idempotency-Replayed, X-Correlation-Id actual, res.locals.depositoId; controller 1 vez', async () => {
    await crearDeposito();
    const primera = await post('usr-agente-1', { correlation: 'ide-r07-a' });
    expect(primera.status).toBe(201);

    const reordenado = { canal: 'AGENTE', moneda: 'PEN', monto: '150.00', cuentaDestino: CUENTA };
    const segunda = await post('usr-agente-1', { body: reordenado, correlation: 'ide-r07-b' });

    expect(segunda.status).toBe(201);
    expect(segunda.body).toEqual(primera.body);
    expect(segunda.headers['idempotency-replayed']).toBe('true');
    expect(segunda.headers['x-correlation-id']).toBe('ide-r07-b');
    expect(llamadas).toBe(1);
    expect(observados[1].depositoId).toBe(ID_DEPOSITO);

    const filas = await claves();
    expect(filas).toHaveLength(1);
    expect(filas[0].estado).toBe('TERMINADO');
  });

  test('IDE-R07: repetir una respuesta guardada sin deposito_id → no asigna res.locals.depositoId', async () => {
    controlador = async (req, res) => {
      res.status(422).json({ codigo: 'MONTO_INVALIDO' });
    };
    await post();
    const segunda = await post();

    expect(segunda.status).toBe(422);
    expect(segunda.body).toEqual({ codigo: 'MONTO_INVALIDO' });
    expect(segunda.headers['idempotency-replayed']).toBe('true');
    expect(observados[1].depositoId).toBeUndefined();
    expect(llamadas).toBe(1);
  });

  test('IDE-R07: sin correlationId en la petición → repite sin X-Correlation-Id', async () => {
    const appSinCorrelation = crearAppPrueba({ conCorrelationId: false });
    await crearDeposito();
    await post('usr-agente-1', { appUsada: appSinCorrelation });
    const segunda = await post('usr-agente-1', { appUsada: appSinCorrelation });

    expect(segunda.status).toBe(201);
    expect(segunda.headers['idempotency-replayed']).toBe('true');
    expect(segunda.headers['x-correlation-id']).toBeUndefined();
  });

  test('IDE-R05: misma clave con monto distinto → 409 IDEMPOTENCY_KEY_REUTILIZADA', async () => {
    await crearDeposito();
    await post();
    const res = await post('usr-agente-1', { body: { ...BODY, monto: '151.00' }, correlation: 'ide-r05' });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      codigo: 'IDEMPOTENCY_KEY_REUTILIZADA',
      mensaje: 'Clave usada antes con otros datos.',
      correlationId: 'ide-r05',
    });
    expect(res.headers['idempotency-replayed']).toBeUndefined();
    expect(llamadas).toBe(1);
  });

  test('IDE-R05: clave EN_PROCESO → 409 SOLICITUD_EN_PROCESO; con hash distinto gana REUTILIZADA (se compara primero)', async () => {
    await crearDeposito();
    const lento = diferido();
    controlador = async (req, res) => {
      await lento.promesa;
      res.locals.depositoId = ID_DEPOSITO;
      res.status(201).json({ id: ID_DEPOSITO });
    };

    const primera = post().then((r) => r);
    await esperar(100);

    const misma = await post('usr-agente-1', { correlation: 'ide-r05-b' });
    expect(misma.status).toBe(409);
    expect(misma.body).toEqual({
      codigo: 'SOLICITUD_EN_PROCESO',
      mensaje: 'La solicitud original con esa clave aún se procesa.',
      correlationId: 'ide-r05-b',
    });

    const distinta = await post('usr-agente-1', { body: { ...BODY, monto: '1.00' } });
    expect(distinta.status).toBe(409);
    expect(distinta.body.codigo).toBe('IDEMPOTENCY_KEY_REUTILIZADA');

    lento.liberar();
    expect((await primera).status).toBe(201);
    expect(llamadas).toBe(1);
    expect((await claves())[0].estado).toBe('TERMINADO');
  });

  test('IDE-R04: 5 POST simultáneos con la misma clave → controller 1 vez; 1×201 y 4×409 SOLICITUD_EN_PROCESO', async () => {
    await crearDeposito();
    const lento = diferido();
    controlador = async (req, res) => {
      await lento.promesa;
      res.locals.depositoId = ID_DEPOSITO;
      res.status(201).json({ id: ID_DEPOSITO });
    };

    const pendientes = Array.from({ length: 5 }, () => post().then((r) => r));
    await esperar(300);
    lento.liberar();
    const respuestas = await Promise.all(pendientes);

    const status = respuestas.map((r) => r.status).sort();
    expect(status).toEqual([201, 409, 409, 409, 409]);
    respuestas.filter((r) => r.status === 409)
      .forEach((r) => expect(r.body.codigo).toBe('SOLICITUD_EN_PROCESO'));
    expect(llamadas).toBe(1);
    expect(await claves()).toHaveLength(1);
  });

  test('IDE-R02: usr-agente-1 y usr-agente-2 con la misma clave → ambos se procesan; 2 filas', async () => {
    controlador = async (req, res) => {
      res.status(201).json({ usuario: req.usuario.id });
    };

    const a = await post('usr-agente-1');
    const b = await post('usr-agente-2');

    expect(a.status).toBe(201);
    expect(a.body).toEqual({ usuario: 'usr-agente-1' });
    expect(b.status).toBe(201);
    expect(b.body).toEqual({ usuario: 'usr-agente-2' });
    expect(b.headers['idempotency-replayed']).toBeUndefined();
    expect(llamadas).toBe(2);

    const filas = await claves();
    expect(filas.map((f) => [f.usuario_id, f.clave, f.estado])).toEqual([
      ['usr-agente-1', CLAVE, 'TERMINADO'],
      ['usr-agente-2', CLAVE, 'TERMINADO'],
    ]);
  });

  test('IDE-R08: 5xx sin depósito (500) → se borra la clave; el reintento se procesa como nuevo', async () => {
    controlador = async () => {
      throw new Error('fallo forzado');
    };
    const primera = await post();
    expect(primera.status).toBe(500);
    expect(primera.body.codigo).toBe('ERROR_INTERNO');
    expect(await claves()).toHaveLength(0);

    controlador = async (req, res) => {
      res.status(201).json({ ok: true });
    };
    const segunda = await post();
    expect(segunda.status).toBe(201);
    expect(segunda.headers['idempotency-replayed']).toBeUndefined();
    expect(llamadas).toBe(2);
    expect(observados[1].idempotencia).toBeUndefined();
    expect((await claves())[0]).toMatchObject({ estado: 'TERMINADO', status_http: 201 });
  });

  test('IDE-R08: 502 sin res.locals.depositoId (falló la consulta) → se borra la clave', async () => {
    controlador = async () => {
      throw new ErrorApp('BILLETERA_NO_DISPONIBLE');
    };
    const res = await post();

    expect(res.status).toBe(502);
    expect(res.body.codigo).toBe('BILLETERA_NO_DISPONIBLE');
    expect(await claves()).toHaveLength(0);
  });

  test('IDE-R08 + IDE-R06: 502 con depositoId → REINTENTABLE; el reintento recibe depositoIdPrevio y termina con el mismo deposito_id', async () => {
    await crearDeposito();
    controlador = async () => {
      throw new ErrorApp('BILLETERA_NO_DISPONIBLE', { depositoId: ID_DEPOSITO });
    };
    const primera = await post();
    expect(primera.status).toBe(502);
    expect((await claves())[0]).toMatchObject({
      estado: 'REINTENTABLE', deposito_id: ID_DEPOSITO, status_http: null, respuesta: null,
    });

    controlador = async (req, res) => {
      res.locals.depositoId = req.idempotencia.depositoIdPrevio;
      res.status(201).json({ id: req.idempotencia.depositoIdPrevio, estado: 'COMPLETADO' });
    };
    const segunda = await post();
    expect(segunda.status).toBe(201);
    expect(segunda.body).toEqual({ id: ID_DEPOSITO, estado: 'COMPLETADO' });
    expect(segunda.headers['idempotency-replayed']).toBeUndefined();
    expect(observados[1].idempotencia).toEqual({ depositoIdPrevio: ID_DEPOSITO });
    expect((await claves())[0]).toMatchObject({
      estado: 'TERMINADO', status_http: 201, deposito_id: ID_DEPOSITO,
    });

    const tercera = await post();
    expect(tercera.headers['idempotency-replayed']).toBe('true');
    expect(llamadas).toBe(2);
  });

  test('IDE-R06: REINTENTABLE con el reintento ya en curso → 409 SOLICITUD_EN_PROCESO', async () => {
    await crearDeposito();
    controlador = async () => {
      throw new ErrorApp('BILLETERA_NO_DISPONIBLE', { depositoId: ID_DEPOSITO });
    };
    await post();

    const lento = diferido();
    controlador = async (req, res) => {
      await lento.promesa;
      res.locals.depositoId = ID_DEPOSITO;
      res.status(201).json({ id: ID_DEPOSITO });
    };
    const reintento = post().then((r) => r);
    await esperar(100);
    const otro = await post();
    expect(otro.status).toBe(409);
    expect(otro.body.codigo).toBe('SOLICITUD_EN_PROCESO');

    lento.liberar();
    expect((await reintento).status).toBe(201);
    expect(llamadas).toBe(2);
  });

  test('IDE-R06: otra petición gana el UPDATE REINTENTABLE → EN_PROCESO (0 filas) → 409 SOLICITUD_EN_PROCESO', async () => {
    await crearDeposito();
    await pool.query(
      `INSERT INTO claves_idempotencia (usuario_id, clave, hash_solicitud, estado, deposito_id)
       VALUES ('usr-agente-1', $1, $2, 'REINTENTABLE', $3)`,
      [CLAVE, hashEsperado(
        `POST ${RUTA} {"canal":"AGENTE","cuentaDestino":"${CUENTA}","moneda":"PEN","monto":"150.00"}`,
      ), ID_DEPOSITO],
    );
    // Carrera real en PostgreSQL: entre el SELECT y el UPDATE otra petición toma el reintento.
    const buscarReal = idempotenciaRepository.buscar;
    jest.spyOn(idempotenciaRepository, 'buscar').mockImplementation(async (...args) => {
      const fila = await buscarReal(...args);
      await pool.query("UPDATE claves_idempotencia SET estado = 'EN_PROCESO' WHERE clave = $1", [CLAVE]);
      return fila;
    });

    const res = await post();

    expect((await claves())[0].estado).toBe('EN_PROCESO');
    expect(res.status).toBe(409);
    expect(res.body.codigo).toBe('SOLICITUD_EN_PROCESO');
    expect(llamadas).toBe(0);
  });

  test('IDE-R05: la fila desaparece entre el INSERT en conflicto y el SELECT → 409 SOLICITUD_EN_PROCESO', async () => {
    await pool.query(
      `INSERT INTO claves_idempotencia (usuario_id, clave, hash_solicitud, estado)
       VALUES ('usr-agente-1', $1, $2, 'EN_PROCESO')`,
      [CLAVE, 'x'.repeat(64)],
    );
    const buscarReal = idempotenciaRepository.buscar;
    jest.spyOn(idempotenciaRepository, 'buscar').mockImplementation(async (...args) => {
      await pool.query('DELETE FROM claves_idempotencia WHERE clave = $1', [CLAVE]);
      return buscarReal(...args);
    });

    const res = await post();

    expect(res.status).toBe(409);
    expect(res.body.codigo).toBe('SOLICITUD_EN_PROCESO');
    expect(llamadas).toBe(0);
  });

  test('IDE-R08: el guardado falla (FK con depositoId inexistente) → logger.error sin cuerpo ni clave; la respuesta sale igual', async () => {
    const espia = jest.spyOn(logger, 'error').mockImplementation(() => {});
    controlador = async (req, res) => {
      res.locals.depositoId = ID_INEXISTENTE;
      res.status(201).json({ id: ID_INEXISTENTE, cuentaDestino: CUENTA });
    };

    const res = await post('usr-agente-1', { correlation: 'ide-r08' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: ID_INEXISTENTE, cuentaDestino: CUENTA });
    expect(espia).toHaveBeenCalledTimes(1);
    const [datos, mensaje] = espia.mock.calls[0];
    expect(datos).toEqual({ correlationId: 'ide-r08', status: 201, codigoError: '23503' });
    expect(mensaje).toMatch(/idempotencia/);
    const texto = JSON.stringify(espia.mock.calls[0]);
    expect(texto).not.toContain(CUENTA);
    expect(texto).not.toContain(CLAVE);
    expect((await claves())[0].estado).toBe('EN_PROCESO');
  });

  test('IDE-R08: guardado falla sin correlationId ni err.code → logger.error con nulls; la respuesta sale igual', async () => {
    const appSinCorrelation = crearAppPrueba({ conCorrelationId: false });
    const espia = jest.spyOn(logger, 'error').mockImplementation(() => {});
    jest.spyOn(idempotenciaRepository, 'terminar').mockRejectedValue(new Error('sin código'));

    const res = await post('usr-agente-1', { appUsada: appSinCorrelation });

    expect(res.status).toBe(201);
    expect(espia).toHaveBeenCalledWith(
      { correlationId: null, status: 201, codigoError: null },
      expect.any(String),
    );
  });
});

describe('IDE-R09 limpieza de claves', () => {
  async function sembrar() {
    await crearDeposito();
    const filas = [
      ['clave-vieja-01', 'EN_PROCESO', '8 days'],
      ['clave-vieja-02', 'TERMINADO', '30 days'],
      ['clave-vieja-03', 'REINTENTABLE', '7 days 1 hour'],
      ['clave-nueva-01', 'TERMINADO', '6 days'],
      ['clave-nueva-02', 'EN_PROCESO', '0 days'],
    ];
    for (const [clave, estado, edad] of filas) {
      await pool.query(
        `INSERT INTO claves_idempotencia (usuario_id, clave, hash_solicitud, estado, deposito_id, creado_en)
         VALUES ('usr-agente-1', $1, $2, $3, $4, now() - $5::interval)`,
        [clave, 'x'.repeat(64), estado, estado === 'REINTENTABLE' ? ID_DEPOSITO : null, edad],
      );
    }
  }

  test('IDE-R09: borrarAntiguas(IDEMPOTENCIA_DIAS) borra las de más de N días en cualquier estado y devuelve cuántas', async () => {
    await sembrar();

    const borradas = await idempotenciaRepository.borrarAntiguas(pool, config.idempotenciaDias);

    expect(config.idempotenciaDias).toBe(7);
    expect(borradas).toBe(3);
    expect((await claves()).map((f) => f.clave)).toEqual(['clave-nueva-01', 'clave-nueva-02']);
  });

  test('IDE-R09: iniciar() programa la limpieza cada hora con unref; al dispararse borra las antiguas y lo loguea', async () => {
    await sembrar();
    const unref = jest.fn();
    const espiaIntervalo = jest.spyOn(global, 'setInterval').mockImplementation(() => ({ unref }));
    const espiaInfo = jest.spyOn(logger, 'info').mockImplementation(() => {});

    const temporizador = limpiarClaves.iniciar();

    expect(espiaIntervalo).toHaveBeenCalledTimes(1);
    const [tarea, ms] = espiaIntervalo.mock.calls[0];
    expect(ms).toBe(60 * 60 * 1000);
    expect(unref).toHaveBeenCalledTimes(1);
    expect(temporizador).toEqual({ unref });

    await tarea();

    expect((await claves()).map((f) => f.clave)).toEqual(['clave-nueva-01', 'clave-nueva-02']);
    expect(espiaInfo).toHaveBeenCalledWith({ borradas: 3 }, expect.any(String));
  });

  test('IDE-R09: si la limpieza falla → logger.error con el código y el proceso sigue', async () => {
    const espiaIntervalo = jest.spyOn(global, 'setInterval').mockImplementation(() => ({ unref() {} }));
    const espiaError = jest.spyOn(logger, 'error').mockImplementation(() => {});
    jest.spyOn(idempotenciaRepository, 'borrarAntiguas')
      .mockRejectedValueOnce(Object.assign(new Error('caída'), { code: '57P01' }))
      .mockRejectedValueOnce(new Error('sin código'));

    limpiarClaves.iniciar();
    const [tarea] = espiaIntervalo.mock.calls[0];

    await expect(tarea()).resolves.toBeUndefined();
    await expect(tarea()).resolves.toBeUndefined();
    expect(espiaError).toHaveBeenNthCalledWith(1, { codigoError: '57P01' }, expect.any(String));
    expect(espiaError).toHaveBeenNthCalledWith(2, { codigoError: null }, expect.any(String));
  });
});
