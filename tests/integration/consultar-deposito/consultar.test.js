'use strict';

const nock = require('nock');
const request = require('supertest');

const { crearApp } = require('../../../src/app');
const { pool: poolApp } = require('../../../src/core/db');
const pipeline = require('../../../src/core/pipeline');
const repository = require('../../../src/modules/consultar-deposito/repository');
const modulo = require('../../../src/modules/consultar-deposito');
const billetera = require('../../helpers/billetera');
const { limpiar, cerrar, pool } = require('../../helpers/db');
const { token } = require('../../helpers/tokens');
const { registrarFixtures, activa, inactiva } = require('../../core/fixtures/modulos');
const registro = require('../../core/fixtures/registro');

registrarFixtures(jest);

const CUENTA = '0011-0123-456789';
const CUENTA_USD = '0011-0123-000002';
const ID = '7f1c2e9a-0b1d-4c5e-9f00-123456789abc';
const ID_INEXISTENTE = '00000000-0000-4000-8000-000000000000';
const CREADO = '2026-10-13T19:20:00.000Z';
const ACTUALIZADO = '2026-10-13T19:20:01.000Z';

// SPEC-08: endpoint activo; extensiones de SPEC-10..12 inactivas salvo conversion-moneda en
// CD-T07.
function manifest({ consultar = 'activo', conversion = 'inactivo', extra = [] } = {}) {
  return {
    version: 1,
    servicio: 'deposito-service',
    features: [
      { id: 'registrar-deposito', estado: 'activo', tipo: 'endpoint' },
      { id: 'consultar-deposito', estado: consultar, tipo: 'endpoint' },
      { id: 'limites-por-canal', estado: 'inactivo', tipo: 'validador', orden: 10 },
      { id: 'conversion-moneda', estado: conversion, tipo: 'transformador', orden: 10 },
      { id: 'alerta-uif', estado: 'inactivo', tipo: 'post-proceso', orden: 10 },
      ...extra,
    ],
  };
}

async function insertarDeposito({
  id = ID,
  cuenta = CUENTA,
  moneda = 'PEN',
  usuario = 'usr-agente-1',
  canal = 'AGENTE',
  estado = 'COMPLETADO',
  referencia = null,
} = {}) {
  await pool.query(
    `INSERT INTO depositos (id, cuenta_destino, monto, moneda, monto_acreditar, moneda_acreditar,
                            canal, referencia, estado, usuario_id, creado_en, actualizado_en)
     VALUES ($1, $2, '100.00', $3, '100.00', $3, $4, $5, $6, $7, $8, $9)`,
    [id, cuenta, moneda, canal, referencia, estado, usuario, CREADO, ACTUALIZADO],
  );
}

// SPEC-11 §4: depósito USD a la cuenta PEN, convertido con 3.7500 (fila en conversiones_deposito).
const TIPO_CAMBIO = '00000000-0000-0000-0000-000000000001';
const EXTENSION_CONVERSION = {
  monedaCuenta: 'PEN', tipoCambio: '3.7500', montoAcreditado: '375.00',
};

async function insertarDepositoConvertido() {
  await pool.query(
    `INSERT INTO tipos_cambio (id, moneda_origen, moneda_destino, valor, vigente_desde)
     VALUES ($1, 'USD', 'PEN', 3.7500, '2026-01-01T00:00:00Z')`,
    [TIPO_CAMBIO],
  );
  await pool.query(
    `INSERT INTO depositos (id, cuenta_destino, monto, moneda, monto_acreditar, moneda_acreditar,
                            canal, referencia, estado, usuario_id, creado_en, actualizado_en)
     VALUES ($1, $2, '100.00', 'USD', '375.00', 'PEN', 'APP', NULL, 'COMPLETADO',
             'usr-cliente-1', $3, $4)`,
    [ID, CUENTA, CREADO, ACTUALIZADO],
  );
  await pool.query(
    `INSERT INTO conversiones_deposito (deposito_id, tipo_cambio_id, moneda_cuenta, tipo_cambio,
                                        monto_final)
     VALUES ($1, $2, 'PEN', 3.7500, 375.00)`,
    [ID, TIPO_CAMBIO],
  );
}

function get(app, id, { usuario = 'usr-cliente-1', correlation } = {}) {
  let r = request(app).get(`/api/v1/depositos/${id}`).set('Authorization', `Bearer ${token(usuario)}`);
  if (correlation) r = r.set('X-Correlation-Id', correlation);
  return r;
}

function esError(res, status, codigo) {
  expect(res.status).toBe(status);
  expect(res.body).toEqual({
    codigo,
    mensaje: expect.any(String),
    correlationId: res.headers['x-correlation-id'],
  });
}

function cuerpoEsperado(extra = {}) {
  return {
    id: ID,
    cuentaDestino: CUENTA,
    monto: '100.00',
    moneda: 'PEN',
    canal: 'AGENTE',
    referencia: null,
    estado: 'COMPLETADO',
    creadoEn: CREADO,
    actualizadoEn: ACTUALIZADO,
    extensiones: {},
    ...extra,
  };
}

// La auditoría escribe después de responder: se reintenta hasta 1 s.
async function filasAuditoria(esperadas) {
  let rows = [];
  for (let i = 0; i < 20; i += 1) {
    ({ rows } = await pool.query(
      'SELECT deposito_id, usuario_id, accion, resultado, correlation_id FROM auditoria_depositos',
    ));
    if (rows.length >= esperadas) return rows;
    await new Promise((r) => { setTimeout(r, 50); });
  }
  return rows;
}

beforeAll(() => {
  nock.disableNetConnect();
  nock.enableNetConnect(/127\.0\.0\.1|localhost/);
});

beforeEach(async () => {
  await limpiar();
  nock.cleanAll();
  registro.reiniciar();
});

// La auditoría escribe después de responder: si su INSERT coincide con el TRUNCATE de limpiar()
// de la prueba siguiente, PostgreSQL detecta un deadlock. Se espera a que el conteo se estabilice.
async function esperarAuditoria() {
  let previo = -1;
  for (let i = 0; i < 20; i += 1) {
    await new Promise((r) => { setTimeout(r, 50); });
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM auditoria_depositos');
    if (rows[0].n === previo) return;
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
  await new Promise((r) => { setTimeout(r, 200); });
  await poolApp.end();
  await cerrar();
});

describe('SPEC-08 consultar-deposito: casos', () => {
  test('CD-T01 usr-cliente-1 consulta un depósito a 0011-0123-456789 → 200 con todos los campos', async () => {
    const app = crearApp({ manifest: manifest() });
    await insertarDeposito({ referencia: 'Pago alquiler' });
    const consulta = billetera.cuentaActiva(CUENTA);

    const res = await get(app, ID, { correlation: 'cd-t01' });

    expect(res.status).toBe(200);
    expect(res.headers['x-correlation-id']).toBe('cd-t01');
    expect(res.body).toEqual(cuerpoEsperado({ referencia: 'Pago alquiler' }));
    expect(consulta.isDone()).toBe(true);
    expect(consulta.peticiones).toHaveLength(1);
    expect(consulta.peticiones[0].headers['x-correlation-id']).toBe('cd-t01');
  });

  test('CD-T02 UUID inexistente → 404 DEPOSITO_NO_ENCONTRADO', async () => {
    const app = crearApp({ manifest: manifest() });
    await insertarDeposito();
    const consulta = billetera.cuentaActiva(CUENTA);

    const res = await get(app, ID_INEXISTENTE);

    esError(res, 404, 'DEPOSITO_NO_ENCONTRADO');
    expect(res.body.mensaje).toBe('No existe un depósito con ese id.');
    expect(consulta.isDone()).toBe(false);
  });

  test('CD-T03 id "abc" → 400 FORMATO_INVALIDO; la BD no se consulta', async () => {
    const app = crearApp({ manifest: manifest() });
    const buscar = jest.spyOn(repository, 'buscarPorId');
    const consulta = billetera.cuentaActiva(CUENTA);

    const res = await get(app, 'abc');

    esError(res, 400, 'FORMATO_INVALIDO');
    expect(buscar).not.toHaveBeenCalled();
    expect(consulta.isDone()).toBe(false);
  });

  test('CD-T04 usr-cliente-2 consulta un depósito a 0011-0123-456789 → 404 (no 403)', async () => {
    const app = crearApp({ manifest: manifest() });
    await insertarDeposito();
    const consulta = billetera.cuentaActiva(CUENTA);

    const res = await get(app, ID, { usuario: 'usr-cliente-2' });

    esError(res, 404, 'DEPOSITO_NO_ENCONTRADO');
    expect(res.body.mensaje).toBe('No existe un depósito con ese id.');
    expect(consulta.peticiones).toHaveLength(1);
  });

  test('CD-T05 usr-agente-2 consulta un depósito registrado por usr-agente-1 → 404; billetera no llamada', async () => {
    const app = crearApp({ manifest: manifest() });
    await insertarDeposito({ usuario: 'usr-agente-1' });
    const consulta = billetera.cuentaActiva(CUENTA);

    const res = await get(app, ID, { usuario: 'usr-agente-2' });

    esError(res, 404, 'DEPOSITO_NO_ENCONTRADO');
    expect(consulta.isDone()).toBe(false);
    expect(consulta.peticiones).toHaveLength(0);
  });

  test('CD-T06 usr-agente-1 consulta su propio depósito → 200; billetera no llamada', async () => {
    const app = crearApp({ manifest: manifest() });
    await insertarDeposito({ usuario: 'usr-agente-1' });
    const consulta = billetera.cuentaActiva(CUENTA);

    const res = await get(app, ID, { usuario: 'usr-agente-1' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(cuerpoEsperado());
    expect(consulta.isDone()).toBe(false);
    expect(consulta.peticiones).toHaveLength(0);
  });

  test('CD-T07 depósito con fila en conversiones_deposito, conversion-moneda activa → '
    + 'extensiones.conversion-moneda presente', async () => {
    const app = crearApp({ manifest: manifest({ conversion: 'activo' }) });
    await insertarDepositoConvertido();
    billetera.cuentaActiva(CUENTA);

    const res = await get(app, ID);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(cuerpoEsperado({
      moneda: 'USD',
      canal: 'APP',
      extensiones: { 'conversion-moneda': EXTENSION_CONVERSION },
    }));
  });

  test('CD-T08 el mismo depósito con conversion-moneda inactiva → extensiones sin esa clave',
    async () => {
      const app = crearApp({ manifest: manifest({ conversion: 'inactivo' }) });
      await insertarDepositoConvertido();
      billetera.cuentaActiva(CUENTA);

      const res = await get(app, ID);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(cuerpoEsperado({ moneda: 'USD', canal: 'APP', extensiones: {} }));
      const { rows } = await pool.query('SELECT count(*)::int AS n FROM conversiones_deposito');
      expect(rows[0].n).toBe(1);
    });

  test('CD-T09 usr-cliente-1 y billetera 500 → 502 BILLETERA_NO_DISPONIBLE', async () => {
    const app = crearApp({ manifest: manifest() });
    await insertarDeposito();
    const consulta = billetera.consultaFalla(CUENTA, { status: 500 });

    const res = await get(app, ID);

    esError(res, 502, 'BILLETERA_NO_DISPONIBLE');
    expect(consulta.peticiones).toHaveLength(1);
  });
});

describe('SPEC-08 consultar-deposito: reglas', () => {
  test('feature consultar-deposito inactiva en el manifest → 404 RUTA_NO_ENCONTRADA; ni BD ni billetera', async () => {
    const app = crearApp({ manifest: manifest({ consultar: 'inactivo' }) });
    await insertarDeposito();
    const buscar = jest.spyOn(repository, 'buscarPorId');
    const consulta = billetera.cuentaActiva(CUENTA);

    const res = await get(app, ID);

    esError(res, 404, 'RUTA_NO_ENCONTRADA');
    expect(buscar).not.toHaveBeenCalled();
    expect(consulta.isDone()).toBe(false);
  });

  test('CD-R01 ids no UUID ("123", UUID con un carácter de más, con caracteres no hex) → 400 FORMATO_INVALIDO', async () => {
    const app = crearApp({ manifest: manifest() });
    for (const id of ['123', `${ID}0`, '7f1c2e9a-0b1d-4c5e-9f00-12345678zzzz']) {
      const res = await get(app, id);
      esError(res, 400, 'FORMATO_INVALIDO');
    }
  });

  test('CD-R02 usr-cliente-1 ve un depósito a su cuenta aunque lo haya registrado otro usuario (usr-cajero-1)', async () => {
    const app = crearApp({ manifest: manifest() });
    await insertarDeposito({ usuario: 'usr-cajero-1', canal: 'VENTANILLA' });
    billetera.cuentaActiva(CUENTA);

    const res = await get(app, ID);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(cuerpoEsperado({ canal: 'VENTANILLA' }));
  });

  test('CD-R02 usr-cajero-1 consulta el depósito que registró → 200 sin billetera; usr-agente-1 no lo ve → 404', async () => {
    const app = crearApp({ manifest: manifest() });
    await insertarDeposito({ usuario: 'usr-cajero-1', canal: 'VENTANILLA' });
    const consulta = billetera.cuentaActiva(CUENTA);

    const propio = await get(app, ID, { usuario: 'usr-cajero-1' });
    const ajeno = await get(app, ID, { usuario: 'usr-agente-1' });

    expect(propio.status).toBe(200);
    expect(propio.body).toEqual(cuerpoEsperado({ canal: 'VENTANILLA' }));
    esError(ajeno, 404, 'DEPOSITO_NO_ENCONTRADO');
    expect(consulta.peticiones).toHaveLength(0);
  });

  test('CD-R02 usr-cliente-2 ve un depósito a su cuenta USD 0011-0123-000002', async () => {
    const app = crearApp({ manifest: manifest() });
    await insertarDeposito({ cuenta: CUENTA_USD, moneda: 'USD', usuario: 'usr-cajero-1', canal: 'VENTANILLA' });
    billetera.cuentaActiva(CUENTA_USD);

    const res = await get(app, ID, { usuario: 'usr-cliente-2' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(cuerpoEsperado({ cuentaDestino: CUENTA_USD, moneda: 'USD', canal: 'VENTANILLA' }));
  });

  test('CD-R04 billetera 404 para la cuenta del depósito (null) → 404 DEPOSITO_NO_ENCONTRADO', async () => {
    const app = crearApp({ manifest: manifest() });
    await insertarDeposito();
    const consulta = billetera.cuentaNoExiste(CUENTA);

    const res = await get(app, ID);

    esError(res, 404, 'DEPOSITO_NO_ENCONTRADO');
    expect(consulta.peticiones).toHaveLength(1);
  });

  test('CD-R05 la respuesta de "sin permiso" es idéntica a la de "no existe" (status, código y mensaje)', async () => {
    const app = crearApp({ manifest: manifest() });
    await insertarDeposito();
    billetera.cuentaActiva(CUENTA);

    const sinPermiso = await get(app, ID, { usuario: 'usr-cliente-2', correlation: 'cd-r05' });
    const noExiste = await get(app, ID_INEXISTENTE, { usuario: 'usr-cliente-2', correlation: 'cd-r05' });

    expect(sinPermiso.status).toBe(404);
    expect(sinPermiso.body).toEqual(noExiste.body);
    expect(sinPermiso.body.codigo).not.toBe('SIN_PERMISO');
  });

  test('CD-R06 billetera no responde a tiempo al verificar → 502 BILLETERA_NO_DISPONIBLE', async () => {
    const app = crearApp({ manifest: manifest() });
    await insertarDeposito();
    billetera.consultaFalla(CUENTA, { demora: 6000 });

    const res = await get(app, ID);

    esError(res, 502, 'BILLETERA_NO_DISPONIBLE');
  });

  test('CD-R07 estados PENDIENTE, PROCESANDO y FALLIDO se devuelven tal cual con su estado actual', async () => {
    const app = crearApp({ manifest: manifest() });
    const ids = {
      PENDIENTE: '7f1c2e9a-0b1d-4c5e-9f00-000000000001',
      PROCESANDO: '7f1c2e9a-0b1d-4c5e-9f00-000000000002',
      FALLIDO: '7f1c2e9a-0b1d-4c5e-9f00-000000000003',
    };
    for (const [estado, id] of Object.entries(ids)) {
      await insertarDeposito({ id, estado });
      const res = await get(app, id, { usuario: 'usr-agente-1' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual(cuerpoEsperado({ id, estado }));
    }
  });

  test('CD-R07 extensión activa con datos → aparece en extensiones; inactiva → no aparece (sin tocar el módulo)', async () => {
    registro.extensiones['fx-transformador-a'] = { marca: 'datos-a' };
    await insertarDeposito();

    const appActiva = crearApp({
      manifest: manifest({ extra: [activa('fx-transformador-a', 'transformador', 20)] }),
    });
    const resActiva = await get(appActiva, ID, { usuario: 'usr-agente-1' });

    expect(resActiva.status).toBe(200);
    expect(resActiva.body.extensiones).toEqual({ 'fx-transformador-a': { marca: 'datos-a' } });
    const lectura = registro.llamadas.find((l) => l.fase === 'leerExtension');
    expect(lectura.depositoId).toBe(ID);

    const appInactiva = crearApp({
      manifest: manifest({ extra: [inactiva('fx-transformador-a', 'transformador', 20)] }),
    });
    const resInactiva = await get(appInactiva, ID, { usuario: 'usr-agente-1' });

    expect(resInactiva.status).toBe(200);
    expect(resInactiva.body).toEqual(cuerpoEsperado());
  });

  test('CD-R07 extensión activa sin datos para este depósito (null) → extensiones sin su clave', async () => {
    await insertarDeposito();
    const app = crearApp({
      manifest: manifest({ extra: [activa('fx-transformador-a', 'transformador', 20)] }),
    });

    const res = await get(app, ID, { usuario: 'usr-agente-1' });

    expect(res.status).toBe(200);
    expect(res.body.extensiones).toEqual({});
  });

  test('CD-R07 sin permiso → 404 sin leer extensiones', async () => {
    const app = crearApp({ manifest: manifest() });
    await insertarDeposito();
    const leer = jest.spyOn(pipeline, 'leerExtensiones');

    const res = await get(app, ID, { usuario: 'usr-agente-2' });

    esError(res, 404, 'DEPOSITO_NO_ENCONTRADO');
    expect(leer).not.toHaveBeenCalled();
  });

  test('repository.buscarPorId: fila existente con todas sus columnas; id inexistente → null', async () => {
    await insertarDeposito();

    const fila = await repository.buscarPorId(pool, ID);
    const nada = await repository.buscarPorId(pool, ID_INEXISTENTE);

    expect(fila).toMatchObject({
      id: ID,
      cuenta_destino: CUENTA,
      monto: '100.00',
      moneda: 'PEN',
      canal: 'AGENTE',
      estado: 'COMPLETADO',
      usuario_id: 'usr-agente-1',
    });
    expect(nada).toBeNull();
  });

  test('index.js cumple el contrato de endpoint de SPEC-06 §4', () => {
    expect(modulo.id).toBe('consultar-deposito');
    expect(modulo.tipo).toBe('endpoint');
    expect(typeof modulo.router).toBe('function');
  });

  test('§2 repository solo SELECT: consultar no modifica la fila del depósito', async () => {
    const app = crearApp({ manifest: manifest() });
    await insertarDeposito();
    const antes = (await pool.query('SELECT * FROM depositos')).rows;

    await get(app, ID, { usuario: 'usr-agente-1' });

    const despues = (await pool.query('SELECT * FROM depositos')).rows;
    expect(despues).toEqual(antes);
  });
});

describe('SPEC-08 decisiones de impl_08', () => {
  test('decisión 1: contexto.cuenta = null cuando lo consulta el operador que lo registró (no se llama a billetera)', async () => {
    const app = crearApp({ manifest: manifest() });
    await insertarDeposito();
    const leer = jest.spyOn(pipeline, 'leerExtensiones');

    const res = await get(app, ID, { usuario: 'usr-agente-1', correlation: 'cd-dec1' });

    expect(res.status).toBe(200);
    expect(leer).toHaveBeenCalledTimes(1);
    const [depositoId, contexto] = leer.mock.calls[0];
    expect(depositoId).toBe(ID);
    expect(contexto.cuenta).toBeNull();
    expect(contexto.usuario).toEqual({ id: 'usr-agente-1', roles: ['AGENTE'] });
    expect(contexto.correlationId).toBe('cd-dec1');
    expect(contexto.db).toBe(poolApp);
    expect(typeof contexto.logger.info).toBe('function');
  });

  test('decisión 1: contexto.cuenta = la cuenta de billetera cuando consulta el CLIENTE titular', async () => {
    const app = crearApp({ manifest: manifest() });
    await insertarDeposito();
    billetera.cuentaActiva(CUENTA);
    const leer = jest.spyOn(pipeline, 'leerExtensiones');

    const res = await get(app, ID, { correlation: 'cd-dec1b' });

    expect(res.status).toBe(200);
    const [, contexto] = leer.mock.calls[0];
    expect(contexto.cuenta).toEqual({
      numero: CUENTA,
      estado: 'ACTIVA',
      moneda: 'PEN',
      titularId: 'usr-cliente-1',
    });
    expect(contexto.usuario).toEqual({ id: 'usr-cliente-1', roles: ['CLIENTE'] });
  });
});

describe('SPEC-08 auditoría de la consulta (AUD-R06)', () => {
  test('200 → fila CONSULTAR_DEPOSITO EXITO con deposito_id; 404 sin permiso → ERROR_404 sin deposito_id', async () => {
    const app = crearApp({ manifest: manifest() });
    await insertarDeposito();

    await get(app, ID, { usuario: 'usr-agente-1', correlation: 'cd-aud-ok' });
    await get(app, ID, { usuario: 'usr-agente-2', correlation: 'cd-aud-404' });

    const filas = await filasAuditoria(2);
    expect(filas).toHaveLength(2);
    const ok = filas.find((f) => f.correlation_id === 'cd-aud-ok');
    const no = filas.find((f) => f.correlation_id === 'cd-aud-404');
    expect(ok).toEqual({
      deposito_id: ID,
      usuario_id: 'usr-agente-1',
      accion: 'CONSULTAR_DEPOSITO',
      resultado: 'EXITO',
      correlation_id: 'cd-aud-ok',
    });
    expect(no).toEqual({
      deposito_id: null,
      usuario_id: 'usr-agente-2',
      accion: 'CONSULTAR_DEPOSITO',
      resultado: 'ERROR_404',
      correlation_id: 'cd-aud-404',
    });
  });
});
