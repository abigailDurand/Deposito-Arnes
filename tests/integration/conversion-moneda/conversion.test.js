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
// SPEC-02 §4 v2.0: la cuenta en dólares es la billetera USD de usr-cliente-1 (Billetera USD).
const WALLET_USD = '11111111-1111-4111-8111-111111111111';
const BODY = { cuentaDestino: CUENTA, monto: '100.00', moneda: 'USD', canal: 'APP' };
const TIPO_1 = '00000000-0000-0000-0000-000000000001';
const TIPO_2 = '00000000-0000-0000-0000-000000000002';
const TIPO_3 = '00000000-0000-0000-0000-000000000003';
const EXTENSION_375 = { monedaCuenta: 'PEN', tipoCambio: '3.7500', montoAcreditado: '375.00' };

// SPEC-11 §6: limites-por-canal inactiva; conversion-moneda según el caso.
function manifest({ conversion = 'activo' } = {}) {
  return {
    version: 1,
    servicio: 'deposito-service',
    features: [
      { id: 'registrar-deposito', estado: 'activo', tipo: 'endpoint' },
      { id: 'consultar-deposito', estado: 'activo', tipo: 'endpoint' },
      { id: 'limites-por-canal', estado: 'inactivo', tipo: 'validador', orden: 10 },
      { id: 'conversion-moneda', estado: conversion, tipo: 'transformador', orden: 10 },
      { id: 'alerta-uif', estado: 'inactivo', tipo: 'post-proceso', orden: 10 },
    ],
  };
}

function post(app, { body = BODY, usuario = 'usr-cliente-1', correlation } = {}) {
  let r = request(app)
    .post(RUTA)
    .set('Authorization', `Bearer ${token(usuario)}`)
    .set('Idempotency-Key', 'cm-clave-0001');
  if (correlation) r = r.set('X-Correlation-Id', correlation);
  return r.send(body);
}

// Cada prueba carga sus tipos (§6). `desplazamiento` es un interval relativo a now().
async function cargarTipo({ id, origen = 'USD', destino = 'PEN', valor, desplazamiento }) {
  await pool.query(
    `INSERT INTO tipos_cambio (id, moneda_origen, moneda_destino, valor, vigente_desde)
     VALUES ($1, $2, $3, $4, now() + $5::interval)`,
    [id, origen, destino, valor, desplazamiento],
  );
}

async function depositos() {
  const { rows } = await pool.query(
    `SELECT id, monto::text AS monto, moneda, monto_acreditar::text AS monto_acreditar,
            moneda_acreditar, estado FROM depositos`,
  );
  return rows;
}

async function conversiones() {
  const { rows } = await pool.query(
    `SELECT deposito_id, tipo_cambio_id, moneda_cuenta, tipo_cambio::text AS tipo_cambio,
            monto_final::text AS monto_final FROM conversiones_deposito`,
  );
  return rows;
}

function esError(res, status, codigo) {
  expect(res.status).toBe(status);
  expect(res.body).toEqual({
    codigo,
    mensaje: expect.any(String),
    correlationId: res.headers['x-correlation-id'],
  });
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

describe('SPEC-11 conversion-moneda: casos', () => {
  test('CM-T01 100.00 USD, tipo 3.7500 → billetera recibe "375.00" PEN; fila con monto_final '
    + '375.00; respuesta con la extensión', async () => {
    const app = crearApp({ manifest: manifest() });
    await cargarTipo({ id: TIPO_1, valor: '3.7500', desplazamiento: '-1 day' });
    billetera.cuentaActiva(CUENTA);
    const credito = billetera.acreditaOk(CUENTA);

    const res = await post(app, { correlation: 'cm-t01' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      cuentaDestino: CUENTA,
      monto: '100.00',
      moneda: 'USD',
      canal: 'APP',
      estado: 'COMPLETADO',
      extensiones: { 'conversion-moneda': EXTENSION_375 },
    });
    expect(credito.peticiones).toHaveLength(1);
    expect(credito.peticiones[0].body).toMatchObject({
      depositoId: res.body.id, monto: '375.00', moneda: 'PEN',
    });
    expect(await depositos()).toEqual([{
      id: res.body.id,
      monto: '100.00',
      moneda: 'USD',
      monto_acreditar: '375.00',
      moneda_acreditar: 'PEN',
      estado: 'COMPLETADO',
    }]);
    expect(await conversiones()).toEqual([{
      deposito_id: res.body.id,
      tipo_cambio_id: TIPO_1,
      moneda_cuenta: 'PEN',
      tipo_cambio: '3.7500',
      monto_final: '375.00',
    }]);
  });

  test('CM-T02 150.00 PEN → sin fila de conversión; sin clave en extensiones', async () => {
    const app = crearApp({ manifest: manifest() });
    await cargarTipo({ id: TIPO_1, valor: '3.7500', desplazamiento: '-1 day' });
    await cargarTipo({
      id: TIPO_2, origen: 'PEN', destino: 'USD', valor: '0.2600', desplazamiento: '-1 day',
    });
    billetera.cuentaActiva(CUENTA);
    const credito = billetera.acreditaOk(CUENTA);

    const res = await post(app, { body: { ...BODY, monto: '150.00', moneda: 'PEN' } });

    expect(res.status).toBe(201);
    expect(res.body.estado).toBe('COMPLETADO');
    expect(res.body.extensiones).toEqual({});
    expect(credito.peticiones[0].body).toMatchObject({ monto: '150.00', moneda: 'PEN' });
    expect(await conversiones()).toEqual([]);
    expect(await depositos()).toEqual([expect.objectContaining({
      monto: '150.00', monto_acreditar: '150.00', moneda_acreditar: 'PEN',
    })]);
  });

  test('CM-T03 USD sin tipo cargado → 422 MONEDA_NO_SOPORTADA', async () => {
    const app = crearApp({ manifest: manifest() });
    billetera.cuentaActiva(CUENTA);
    const credito = billetera.acreditaOk(CUENTA);

    const res = await post(app);

    esError(res, 422, 'MONEDA_NO_SOPORTADA');
    expect(credito.peticiones).toHaveLength(0);
    expect(await depositos()).toEqual([]);
    expect(await conversiones()).toEqual([]);
  });

  test('CM-T04 tipos de ayer (3.70) y de hoy (3.75) → usa 3.75', async () => {
    const app = crearApp({ manifest: manifest() });
    await cargarTipo({ id: TIPO_1, valor: '3.7000', desplazamiento: '-1 day' });
    await cargarTipo({ id: TIPO_3, valor: '3.7500', desplazamiento: '-1 minute' });
    billetera.cuentaActiva(CUENTA);
    const credito = billetera.acreditaOk(CUENTA);

    const res = await post(app);

    expect(res.status).toBe(201);
    expect(res.body.extensiones).toEqual({ 'conversion-moneda': EXTENSION_375 });
    expect(credito.peticiones[0].body).toMatchObject({ monto: '375.00', moneda: 'PEN' });
    expect(await conversiones()).toEqual([
      expect.objectContaining({ tipo_cambio_id: TIPO_3, tipo_cambio: '3.7500' }),
    ]);
  });

  test('CM-T05 solo un tipo con vigente_desde mañana → 422 MONEDA_NO_SOPORTADA', async () => {
    const app = crearApp({ manifest: manifest() });
    await cargarTipo({ id: TIPO_1, valor: '3.7500', desplazamiento: '1 day' });
    billetera.cuentaActiva(CUENTA);
    const credito = billetera.acreditaOk(CUENTA);

    const res = await post(app);

    esError(res, 422, 'MONEDA_NO_SOPORTADA');
    expect(credito.peticiones).toHaveLength(0);
    expect(await depositos()).toEqual([]);
    expect(await conversiones()).toEqual([]);
  });

  test('CM-T07 feature inactivo, USD (con tipo cargado) → 422 MONEDA_NO_SOPORTADA', async () => {
    const app = crearApp({ manifest: manifest({ conversion: 'inactivo' }) });
    await cargarTipo({ id: TIPO_1, valor: '3.7500', desplazamiento: '-1 day' });
    billetera.cuentaActiva(CUENTA);
    const credito = billetera.acreditaOk(CUENTA);

    const res = await post(app);

    esError(res, 422, 'MONEDA_NO_SOPORTADA');
    expect(credito.peticiones).toHaveLength(0);
    expect(await depositos()).toEqual([]);
    expect(await conversiones()).toEqual([]);
  });

  test('CM-T08 billetera 500 después de convertir → depósito FALLIDO; la fila de conversión '
    + 'se queda', async () => {
    const app = crearApp({ manifest: manifest() });
    await cargarTipo({ id: TIPO_1, valor: '3.7500', desplazamiento: '-1 day' });
    billetera.cuentaActiva(CUENTA);
    const credito = billetera.acreditaFalla(CUENTA, { status: 500 });

    const res = await post(app);

    esError(res, 502, 'BILLETERA_NO_DISPONIBLE');
    expect(credito.peticiones).toHaveLength(1);
    expect(credito.peticiones[0].body).toMatchObject({ monto: '375.00', moneda: 'PEN' });
    const filas = await depositos();
    expect(filas).toEqual([expect.objectContaining({
      estado: 'FALLIDO', monto_acreditar: '375.00', moneda_acreditar: 'PEN',
    })]);
    expect(await conversiones()).toEqual([{
      deposito_id: filas[0].id,
      tipo_cambio_id: TIPO_1,
      moneda_cuenta: 'PEN',
      tipo_cambio: '3.7500',
      monto_final: '375.00',
    }]);
  });
});

describe('SPEC-11 conversion-moneda: reglas con la BD real', () => {
  // SPEC-02 v2.0: la cuenta USD es la billetera 11111111-… (usr-cliente-1), atendida por
  // Billetera USD; el crédito va a POST /api/v1/depositos/usd.
  const BODY_PEN_A_USD = { cuentaDestino: WALLET_USD, monto: '150.00', moneda: 'PEN', canal: 'APP' };
  const EXTENSION_39 = { monedaCuenta: 'USD', tipoCambio: '0.2600', montoAcreditado: '39.00' };

  test('CM-R03 PEN → USD a la billetera 11111111-… usa la fila PEN→USD (0.26), no la inversa '
    + 'de USD→PEN; Billetera USD recibe "39.00" USD', async () => {
    const app = crearApp({ manifest: manifest() });
    await cargarTipo({ id: TIPO_1, valor: '3.7500', desplazamiento: '-1 day' });
    await cargarTipo({
      id: TIPO_2, origen: 'PEN', destino: 'USD', valor: '0.2600', desplazamiento: '-1 day',
    });
    const consulta = billetera.billeteraUsdExiste(WALLET_USD);
    const credito = billetera.acreditaUsdOk();
    const creditoPen = billetera.acreditaOk(CUENTA);

    const res = await post(app, { body: BODY_PEN_A_USD, correlation: 'cm-r03-pen-usd' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      cuentaDestino: WALLET_USD,
      monto: '150.00',
      moneda: 'PEN',
      canal: 'APP',
      estado: 'COMPLETADO',
      extensiones: { 'conversion-moneda': EXTENSION_39 },
    });
    expect(consulta.peticiones).toHaveLength(1);
    expect(credito.peticiones).toHaveLength(1);
    expect(credito.peticiones[0].headers['idempotency-key']).toBe(res.body.id);
    expect(credito.peticiones[0].body).toMatchObject({
      cliente_id: 'usr-cliente-1',
      cuenta_destino_id: WALLET_USD,
      monto: '39.00',
      moneda: 'USD',
      metodo_origen: 'TRANSFERENCIA',
      referencia_externa: res.body.id,
    });
    expect(creditoPen.peticiones).toHaveLength(0);
    expect(await depositos()).toEqual([{
      id: res.body.id,
      monto: '150.00',
      moneda: 'PEN',
      monto_acreditar: '39.00',
      moneda_acreditar: 'USD',
      estado: 'COMPLETADO',
    }]);
    expect(await conversiones()).toEqual([{
      deposito_id: res.body.id,
      tipo_cambio_id: TIPO_2,
      moneda_cuenta: 'USD',
      tipo_cambio: '0.2600',
      monto_final: '39.00',
    }]);
  });

  test('CM-R03 solo hay fila USD→PEN y el depósito es PEN a la billetera USD → 422 (no invierte)',
    async () => {
      const app = crearApp({ manifest: manifest() });
      await cargarTipo({ id: TIPO_1, valor: '3.7500', desplazamiento: '-1 day' });
      billetera.billeteraUsdExiste(WALLET_USD);
      const credito = billetera.acreditaUsdOk();

      const res = await post(app, { body: BODY_PEN_A_USD });

      esError(res, 422, 'MONEDA_NO_SOPORTADA');
      expect(credito.peticiones).toHaveLength(0);
      expect(await depositos()).toEqual([]);
      expect(await conversiones()).toEqual([]);
    });

  test('CM-R09 PEN → USD y Billetera USD responde 500 → FALLIDO; la fila de conversión se queda',
    async () => {
      const app = crearApp({ manifest: manifest() });
      await cargarTipo({
        id: TIPO_2, origen: 'PEN', destino: 'USD', valor: '0.2600', desplazamiento: '-1 day',
      });
      billetera.billeteraUsdExiste(WALLET_USD);
      const credito = billetera.acreditaUsdFalla({ status: 500 });

      const res = await post(app, { body: BODY_PEN_A_USD });

      esError(res, 502, 'BILLETERA_NO_DISPONIBLE');
      expect(credito.peticiones).toHaveLength(1);
      expect(credito.peticiones[0].body).toMatchObject({ monto: '39.00', moneda: 'USD' });
      const filas = await depositos();
      expect(filas).toEqual([expect.objectContaining({
        estado: 'FALLIDO', monto_acreditar: '39.00', moneda_acreditar: 'USD',
      })]);
      expect(await conversiones()).toEqual([expect.objectContaining({
        deposito_id: filas[0].id, tipo_cambio_id: TIPO_2, monto_final: '39.00',
      })]);
    });

  test('CM-T07 (PEN → USD) feature inactivo, PEN a la billetera USD con tipo cargado → 422 '
    + 'MONEDA_NO_SOPORTADA', async () => {
    const app = crearApp({ manifest: manifest({ conversion: 'inactivo' }) });
    await cargarTipo({
      id: TIPO_2, origen: 'PEN', destino: 'USD', valor: '0.2600', desplazamiento: '-1 day',
    });
    billetera.billeteraUsdExiste(WALLET_USD);
    const credito = billetera.acreditaUsdOk();

    const res = await post(app, { body: BODY_PEN_A_USD });

    esError(res, 422, 'MONEDA_NO_SOPORTADA');
    expect(credito.peticiones).toHaveLength(0);
    expect(await depositos()).toEqual([]);
    expect(await conversiones()).toEqual([]);
  });

  test('CM-R03 solo hay fila PEN→USD y el depósito es USD a cuenta PEN → 422 (no invierte)',
    async () => {
      const app = crearApp({ manifest: manifest() });
      await cargarTipo({
        id: TIPO_2, origen: 'PEN', destino: 'USD', valor: '0.2600', desplazamiento: '-1 day',
      });
      billetera.cuentaActiva(CUENTA);
      billetera.acreditaOk(CUENTA);

      const res = await post(app);

      esError(res, 422, 'MONEDA_NO_SOPORTADA');
      expect(await depositos()).toEqual([]);
    });

  test('CM-R08 la conversión se ve en el detalle: GET /depositos/{id} trae la extensión',
    async () => {
      const app = crearApp({ manifest: manifest() });
      await cargarTipo({ id: TIPO_1, valor: '3.7500', desplazamiento: '-1 day' });
      billetera.cuentaActiva(CUENTA);
      billetera.acreditaOk(CUENTA);
      const creado = await post(app);
      expect(creado.status).toBe(201);
      billetera.cuentaActiva(CUENTA);

      const res = await request(app)
        .get(`${RUTA}/${creado.body.id}`)
        .set('Authorization', `Bearer ${token('usr-cliente-1')}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: creado.body.id, monto: '100.00', moneda: 'USD' });
      expect(res.body.extensiones).toEqual({ 'conversion-moneda': EXTENSION_375 });
    });

  test('CM-R10 db/11-conversion-moneda.sql crea tipos_cambio con su índice de par', async () => {
    const { rows } = await pool.query(
      "SELECT indexname FROM pg_indexes WHERE tablename = 'tipos_cambio'"
        + " AND indexname = 'idx_tipos_cambio_par'",
    );
    expect(rows).toHaveLength(1);
  });
});
