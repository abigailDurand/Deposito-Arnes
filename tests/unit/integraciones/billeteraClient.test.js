'use strict';

const nock = require('nock');
const Decimal = require('decimal.js');

const config = require('../../../src/config');
const { consultarCuenta, acreditar } = require('../../../src/core/clients/billeteraClient');
const { ErrorApp } = require('../../../src/core/errores');
const { logger } = require('../../../src/core/logger');
const billetera = require('../../helpers/billetera');

// SPEC-02 §4: datos de prueba compartidos.
const CUENTA = '0011-0123-456789';
const CUENTA_2 = '0011-0123-000002';
const CUENTA_BLOQUEADA = '0011-0123-000003';
const WALLET_USD = '11111111-1111-4111-8111-111111111111';
const WALLET_USD_2 = '22222222-2222-4222-8222-222222222222';
const DEPOSITO_ID = '7f1c2e9a-0b1d-4c5e-9f00-123456789abc';
const CORRELATION_ID = 'abc-123';
const TITULAR_ID = 'usr-cliente-1';
const TIMEOUT_CORTO_MS = 100;
const DEMORA_MS = 1000;

function datosCredito(extra = {}) {
  return { depositoId: DEPOSITO_ID, cuenta: CUENTA, monto: '150.00', moneda: 'PEN', ...extra };
}

function datosCreditoUsd(extra = {}) {
  return {
    depositoId: DEPOSITO_ID,
    cuenta: WALLET_USD,
    monto: '150.00',
    moneda: 'USD',
    titularId: TITULAR_ID,
    canal: 'AGENTE',
    ...extra,
  };
}

// Carga el cliente en un registro aislado con variables de entorno distintas (config.js lee el
// entorno al cargarse). No se toca ningún archivo; el entorno se restaura siempre. Devuelve también
// el logger de ese registro (el que usa el cliente aislado) para espiarlo. `null` borra la variable.
function cargarCon(variables) {
  const previos = {};
  for (const [nombre, valor] of Object.entries(variables)) {
    previos[nombre] = process.env[nombre];
    if (valor === null) delete process.env[nombre];
    else process.env[nombre] = valor;
  }
  let cargado;
  try {
    jest.isolateModules(() => {
      cargado = {
        cliente: require('../../../src/core/clients/billeteraClient'),
        logger: require('../../../src/core/logger').logger,
      };
    });
  } finally {
    for (const [nombre, valor] of Object.entries(previos)) {
      if (valor === undefined) delete process.env[nombre];
      else process.env[nombre] = valor;
    }
  }
  return cargado;
}

function clienteCon(variables) {
  return cargarCon(variables).cliente;
}

// INT-R13: Billetera USD con OAuth client credentials. Host de tokens propio de las pruebas (nock).
const TOKEN_URL = 'http://auth-usd.test/oauth2/token';
const CLIENT_ID = 'deposito-service';
const CLIENT_SECRET = 'secreto-de-prueba-no-loguear';
const OAUTH = {
  BILLETERA_USD_TOKEN_URL: TOKEN_URL,
  BILLETERA_USD_CLIENT_ID: CLIENT_ID,
  BILLETERA_USD_CLIENT_SECRET: CLIENT_SECRET,
};

// Cliente aislado con OAuth (caché de token nueva en cada carga). `extra` añade variables.
function clienteOAuth(extra = {}) {
  return cargarCon({ ...OAUTH, ...extra });
}

function espiarLogs(log) {
  return ['trace', 'debug', 'info', 'warn', 'error', 'fatal'].map((nivel) => jest.spyOn(log, nivel));
}

function textoLogs(espias) {
  return JSON.stringify(espias.flatMap((spy) => spy.mock.calls));
}

// INT-R03 sin esperar los 5 s reales.
function clienteConTimeoutCorto() {
  return clienteCon({ BILLETERA_TIMEOUT_MS: String(TIMEOUT_CORTO_MS) });
}

// El cliente aislado tiene su propia clase ErrorApp: se compara por nombre, código y status.
async function esperaNoDisponible(promesa) {
  await expect(promesa).rejects.toMatchObject({
    name: 'ErrorApp',
    codigo: 'BILLETERA_NO_DISPONIBLE',
    status: 502,
  });
}

// Interceptores comodín sobre una billetera: si el cliente la llama, isDone() pasa a true.
function cualquierLlamada(url) {
  return {
    get: nock(url).get(/.*/).reply(500),
    post: nock(url).post(/.*/).reply(500),
  };
}

beforeAll(() => {
  nock.disableNetConnect();
});

beforeEach(() => {
  nock.cleanAll();
});

afterEach(() => {
  nock.abortPendingRequests();
  nock.cleanAll();
  jest.restoreAllMocks();
});

afterAll(() => {
  nock.enableNetConnect();
});

// ── Billetera PEN (INT-R11, INT-R12) ──

describe('Billetera PEN · consultarCuenta', () => {
  test('INT-T01 consultar con 200 → devuelve la cuenta', async () => {
    const scope = billetera.cuentaActiva(CUENTA);

    const cuenta = await consultarCuenta(CUENTA, CORRELATION_ID);

    expect(cuenta).toEqual({
      numero: '0011-0123-456789',
      estado: 'ACTIVA',
      moneda: 'PEN',
      titularId: 'usr-cliente-1',
    });
    expect(scope.isDone()).toBe(true);
    expect(scope.peticiones).toHaveLength(1);
  });

  test('INT-T01 (cuentas 000002 y BLOQUEADA de §4) → devuelve su estado, moneda PEN y titular', async () => {
    const cuenta2 = billetera.cuentaActiva(CUENTA_2);
    const bloqueada = billetera.cuentaActiva(CUENTA_BLOQUEADA);

    await expect(consultarCuenta(CUENTA_2, CORRELATION_ID)).resolves.toEqual({
      numero: CUENTA_2, estado: 'ACTIVA', moneda: 'PEN', titularId: 'usr-cliente-2',
    });
    await expect(consultarCuenta(CUENTA_BLOQUEADA, CORRELATION_ID)).resolves.toEqual({
      numero: CUENTA_BLOQUEADA, estado: 'BLOQUEADA', moneda: 'PEN', titularId: 'usr-cliente-1',
    });
    expect(cuenta2.isDone()).toBe(true);
    expect(bloqueada.isDone()).toBe(true);
  });

  test('INT-T02 consultar con 404 → devuelve null', async () => {
    const scope = billetera.cuentaNoExiste(CUENTA);

    await expect(consultarCuenta(CUENTA, CORRELATION_ID)).resolves.toBeNull();
    expect(scope.isDone()).toBe(true);
  });

  test('INT-T03 consultar con 500 → BILLETERA_NO_DISPONIBLE', async () => {
    const scope = billetera.consultaFalla(CUENTA, { status: 500 });

    const promesa = consultarCuenta(CUENTA, CORRELATION_ID);

    await expect(promesa).rejects.toBeInstanceOf(ErrorApp);
    await esperaNoDisponible(promesa);
    expect(scope.isDone()).toBe(true);
  });

  test('INT-T03 consultar con timeout → BILLETERA_NO_DISPONIBLE', async () => {
    const cliente = clienteConTimeoutCorto();
    const scope = billetera.consultaFalla(CUENTA, { status: 200, demora: DEMORA_MS });

    const inicio = Date.now();
    await esperaNoDisponible(cliente.consultarCuenta(CUENTA, CORRELATION_ID));

    expect(Date.now() - inicio).toBeLessThan(DEMORA_MS);
    expect(scope.isDone()).toBe(true);
  });

  test('INT-R11 consultar con otro status (400) → BILLETERA_NO_DISPONIBLE', async () => {
    const scope = billetera.consultaFalla(CUENTA, { status: 400 });

    await esperaNoDisponible(consultarCuenta(CUENTA, CORRELATION_ID));
    expect(scope.isDone()).toBe(true);
  });

  test('INT-R11 consultar con 200 y cuerpo no objeto → BILLETERA_NO_DISPONIBLE', async () => {
    const scope = nock(config.billetera.url)
      .get(`/api/v1/cuentas/${CUENTA}`)
      .reply(200, 'texto');

    await esperaNoDisponible(consultarCuenta(CUENTA, CORRELATION_ID));
    expect(scope.isDone()).toBe(true);
  });

  test('INT-R11 error de red al consultar → BILLETERA_NO_DISPONIBLE', async () => {
    const scope = nock(config.billetera.url)
      .get(`/api/v1/cuentas/${CUENTA}`)
      .replyWithError({ code: 'ECONNREFUSED', message: 'conexión rechazada' });

    await esperaNoDisponible(consultarCuenta(CUENTA, CORRELATION_ID));
    expect(scope.isDone()).toBe(true);
  });
});

describe('Billetera PEN · acreditar', () => {
  test('INT-T04 acreditar con 201 → resuelve { estado: ACREDITADO }', async () => {
    const scope = billetera.acreditaOk(CUENTA);

    await expect(acreditar(datosCredito(), CORRELATION_ID)).resolves.toEqual({ estado: 'ACREDITADO' });
    expect(scope.isDone()).toBe(true);
    expect(scope.peticiones).toHaveLength(1);
  });

  test('INT-T04 acreditar con 409 (depositoId ya acreditado) → resuelve { estado: ACREDITADO }', async () => {
    const scope = billetera.acreditaYaExiste(CUENTA);

    await expect(acreditar(datosCredito(), CORRELATION_ID)).resolves.toEqual({ estado: 'ACREDITADO' });
    expect(scope.isDone()).toBe(true);
    expect(scope.peticiones).toHaveLength(1);
  });

  test('INT-R12 acreditar con 200 → resuelve { estado: ACREDITADO }', async () => {
    const scope = billetera.acreditaOk(CUENTA, { status: 200 });

    await expect(acreditar(datosCredito(), CORRELATION_ID)).resolves.toEqual({ estado: 'ACREDITADO' });
    expect(scope.isDone()).toBe(true);
  });

  test.each([400, 500])(
    'INT-T05 acreditar con %i → BILLETERA_NO_DISPONIBLE y nock recibió 1 sola llamada',
    async (status) => {
      const scope = billetera.acreditaFalla(CUENTA, { status });
      // Un segundo interceptor idéntico atraparía un reintento (INT-R06).
      const reintento = billetera.acreditaFalla(CUENTA, { status });

      const promesa = acreditar(datosCredito(), CORRELATION_ID);

      await expect(promesa).rejects.toBeInstanceOf(ErrorApp);
      await esperaNoDisponible(promesa);
      expect(scope.isDone()).toBe(true);
      expect(scope.peticiones).toHaveLength(1);
      expect(reintento.isDone()).toBe(false);
      expect(reintento.peticiones).toHaveLength(0);
    },
  );

  test('INT-T05 acreditar con timeout → BILLETERA_NO_DISPONIBLE y nock recibió 1 sola llamada', async () => {
    const cliente = clienteConTimeoutCorto();
    const scope = billetera.acreditaLento(CUENTA, { demora: DEMORA_MS });
    const reintento = billetera.acreditaLento(CUENTA, { demora: DEMORA_MS });
    let recibidas = 0;
    const contar = () => { recibidas += 1; };
    scope.on('request', contar);
    reintento.on('request', contar);

    const inicio = Date.now();
    await esperaNoDisponible(cliente.acreditar(datosCredito(), CORRELATION_ID));
    // Margen para que un reintento hipotético llegue a nock antes de comprobar.
    await new Promise((r) => { setTimeout(r, 2 * TIMEOUT_CORTO_MS); });

    expect(Date.now() - inicio).toBeLessThan(DEMORA_MS);
    expect(scope.isDone()).toBe(true);
    expect(reintento.isDone()).toBe(false);
    expect(recibidas).toBe(1);
  });
});

describe('Billetera PEN · cabeceras y body', () => {
  test('INT-T06 consultar y acreditar llevan Authorization y X-Correlation-Id', async () => {
    const consulta = billetera.cuentaActiva(CUENTA);
    const credito = billetera.acreditaOk(CUENTA);

    await consultarCuenta(CUENTA, 'corr-consulta');
    await acreditar(datosCredito(), 'corr-credito');

    expect(consulta.peticiones[0].headers).toMatchObject({
      authorization: 'Bearer token-de-prueba',
      'x-correlation-id': 'corr-consulta',
    });
    expect(credito.peticiones[0].headers).toMatchObject({
      authorization: 'Bearer token-de-prueba',
      'x-correlation-id': 'corr-credito',
    });
  });

  test('INT-T06 llamadas con 404 y 500 también llevan Authorization y X-Correlation-Id', async () => {
    const noExiste = billetera.cuentaNoExiste(CUENTA);
    const falla = billetera.acreditaFalla(CUENTA, { status: 500 });

    await consultarCuenta(CUENTA, CORRELATION_ID);
    await expect(acreditar(datosCredito(), CORRELATION_ID)).rejects.toBeInstanceOf(ErrorApp);

    for (const scope of [noExiste, falla]) {
      expect(scope.peticiones[0].headers.authorization).toBe('Bearer token-de-prueba');
      expect(scope.peticiones[0].headers['x-correlation-id']).toBe(CORRELATION_ID);
    }
  });

  test('INT-T07 monto Decimal(150) → el body lleva "150.00"', async () => {
    const scope = billetera.acreditaOk(CUENTA);

    await acreditar(datosCredito({ monto: new Decimal(150) }), CORRELATION_ID);

    expect(scope.peticiones[0].body).toEqual({
      depositoId: DEPOSITO_ID,
      monto: '150.00',
      moneda: 'PEN',
      concepto: 'DEPOSITO',
    });
  });

  test('INT-R12 montos límite "0.01" y Decimal("10.5") → "0.01" y "10.50"; concepto DEPOSITO', async () => {
    const uno = billetera.acreditaOk(CUENTA);
    const dos = billetera.acreditaOk(CUENTA_2);

    await acreditar(datosCredito({ monto: '0.01' }), CORRELATION_ID);
    await acreditar(datosCredito({ cuenta: CUENTA_2, monto: new Decimal('10.5') }), CORRELATION_ID);

    expect(uno.peticiones[0].body).toEqual({
      depositoId: DEPOSITO_ID, monto: '0.01', moneda: 'PEN', concepto: 'DEPOSITO',
    });
    expect(dos.peticiones[0].body).toEqual({
      depositoId: DEPOSITO_ID, monto: '10.50', moneda: 'PEN', concepto: 'DEPOSITO',
    });
  });
});

// ── Billetera USD (INT-R04, INT-R05, INT-R07, INT-R14) ──

const WALLET_BLOQUEADA = '33333333-3333-4333-8333-333333333333';
const WALLET_CERRADA = '44444444-4444-4444-8444-444444444444';

async function esperaCuentaInactiva(promesa) {
  await expect(promesa).rejects.toMatchObject({
    name: 'ErrorApp',
    codigo: 'CUENTA_INACTIVA',
    status: 422,
  });
}

describe('Billetera USD · consultarCuenta', () => {
  test('INT-T08 consultar con 200 ACTIVE → { numero: id, estado ACTIVA, moneda USD, titularId: user_id }, sin balance ni nombre', async () => {
    const uno = billetera.billeteraUsdExiste(WALLET_USD);
    const dos = billetera.billeteraUsdExiste(WALLET_USD_2);

    const cuenta = await consultarCuenta(WALLET_USD, CORRELATION_ID);
    const cuenta2 = await consultarCuenta(WALLET_USD_2, CORRELATION_ID);

    // toEqual exacto: ninguna clave extra (balance, nombre, id, user_id, estado de billetera).
    expect(cuenta).toEqual({
      numero: WALLET_USD, estado: 'ACTIVA', moneda: 'USD', titularId: 'usr-cliente-1',
    });
    expect(cuenta2).toEqual({
      numero: WALLET_USD_2, estado: 'ACTIVA', moneda: 'USD', titularId: 'usr-cliente-2',
    });
    expect(cuenta).not.toHaveProperty('balance');
    expect(cuenta).not.toHaveProperty('nombre');
    expect(uno.isDone()).toBe(true);
    expect(dos.isDone()).toBe(true);
    expect(uno.peticiones).toHaveLength(1);
  });

  test('INT-T08 consultar con 200 BLOCKED → estado BLOQUEADA (33333333-…, usr-bloqueada)', async () => {
    const scope = billetera.billeteraUsdBloqueada(WALLET_BLOQUEADA);

    await expect(consultarCuenta(WALLET_BLOQUEADA, CORRELATION_ID)).resolves.toEqual({
      numero: WALLET_BLOQUEADA, estado: 'BLOQUEADA', moneda: 'USD', titularId: 'usr-bloqueada',
    });
    expect(scope.isDone()).toBe(true);
  });

  test('INT-T08 consultar con 200 CLOSED → estado CERRADA (44444444-…, usr-cerrada)', async () => {
    const scope = billetera.billeteraUsdCerrada(WALLET_CERRADA);

    await expect(consultarCuenta(WALLET_CERRADA, CORRELATION_ID)).resolves.toEqual({
      numero: WALLET_CERRADA, estado: 'CERRADA', moneda: 'USD', titularId: 'usr-cerrada',
    });
    expect(scope.isDone()).toBe(true);
  });

  test('INT-T08 consultar con 200 y estado desconocido → BILLETERA_NO_DISPONIBLE', async () => {
    const otro = billetera.billeteraUsdExiste(WALLET_USD, { estado: 'SUSPENDED' });
    await esperaNoDisponible(consultarCuenta(WALLET_USD, CORRELATION_ID));
    expect(otro.isDone()).toBe(true);

    // Los valores de deposito-service no son estados de Wallet: tampoco se aceptan.
    const enEspanol = billetera.billeteraUsdExiste(WALLET_USD, { estado: 'ACTIVA' });
    await esperaNoDisponible(consultarCuenta(WALLET_USD, CORRELATION_ID));
    expect(enEspanol.isDone()).toBe(true);
  });

  test('INT-T08 consultar no loguea balance ni nombre (tampoco cuando el estado es desconocido)', async () => {
    billetera.billeteraUsdExiste(WALLET_USD);
    billetera.billeteraUsdExiste(WALLET_USD, { estado: 'SUSPENDED' });
    const espias = espiarLogs(logger);

    await consultarCuenta(WALLET_USD, CORRELATION_ID);
    await esperaNoDisponible(consultarCuenta(WALLET_USD, CORRELATION_ID));

    const logueado = textoLogs(espias);
    expect(logueado).not.toContain('350.75');
    expect(logueado).not.toContain('Cliente Uno');
  });

  test('INT-R04 consultar con 200 sin user_id (ausente o null) → BILLETERA_NO_DISPONIBLE', async () => {
    const ausente = billetera.billeteraUsdExiste(WALLET_USD, { user_id: undefined });
    await esperaNoDisponible(consultarCuenta(WALLET_USD, CORRELATION_ID));
    expect(ausente.isDone()).toBe(true);

    const nulo = billetera.billeteraUsdExiste(WALLET_USD, { user_id: null });
    await esperaNoDisponible(consultarCuenta(WALLET_USD, CORRELATION_ID));
    expect(nulo.isDone()).toBe(true);
  });

  test('INT-R04 transición (Q7, sin BILLETERA_USD_TOKEN_URL): estado ausente → ACTIVA', async () => {
    expect(config.billeteraUsd.tokenUrl).toBeNull();
    const scope = billetera.billeteraUsdExiste(WALLET_USD, { estado: undefined });

    await expect(consultarCuenta(WALLET_USD, CORRELATION_ID)).resolves.toEqual({
      numero: WALLET_USD, estado: 'ACTIVA', moneda: 'USD', titularId: 'usr-cliente-1',
    });
    expect(scope.isDone()).toBe(true);
  });

  test('INT-R04 con BILLETERA_USD_TOKEN_URL (fuera de la transición Q7): estado ausente → BILLETERA_NO_DISPONIBLE', async () => {
    const { cliente } = clienteOAuth();
    const token = billetera.tokenUsdOk({ url: TOKEN_URL });
    const scope = billetera.billeteraUsdExiste(WALLET_USD, { estado: undefined });

    await esperaNoDisponible(cliente.consultarCuenta(WALLET_USD, CORRELATION_ID));
    expect(token.peticiones).toHaveLength(1);
    expect(scope.isDone()).toBe(true);
    expect(scope.peticiones).toHaveLength(1);

    // Con el estado presente, el mismo cliente con OAuth sí la devuelve (el fallo se debe al estado ausente).
    billetera.billeteraUsdExiste(WALLET_USD);
    await expect(cliente.consultarCuenta(WALLET_USD, CORRELATION_ID)).resolves.toEqual({
      numero: WALLET_USD, estado: 'ACTIVA', moneda: 'USD', titularId: 'usr-cliente-1',
    });
  });

  test('INT-T09 consultar con 404 → null', async () => {
    const scope = billetera.billeteraUsdNoExiste(WALLET_USD);

    await expect(consultarCuenta(WALLET_USD, CORRELATION_ID)).resolves.toBeNull();
    expect(scope.isDone()).toBe(true);
  });

  test('INT-T09 consultar con 500 → BILLETERA_NO_DISPONIBLE', async () => {
    const scope = billetera.consultaUsdFalla(WALLET_USD, { status: 500 });

    const promesa = consultarCuenta(WALLET_USD, CORRELATION_ID);

    await expect(promesa).rejects.toBeInstanceOf(ErrorApp);
    await esperaNoDisponible(promesa);
    expect(scope.isDone()).toBe(true);
  });

  test('INT-T09 consultar con timeout → BILLETERA_NO_DISPONIBLE', async () => {
    const cliente = clienteConTimeoutCorto();
    const scope = billetera.consultaUsdFalla(WALLET_USD, { status: 200, demora: DEMORA_MS });

    const inicio = Date.now();
    await esperaNoDisponible(cliente.consultarCuenta(WALLET_USD, CORRELATION_ID));

    expect(Date.now() - inicio).toBeLessThan(DEMORA_MS);
    expect(scope.isDone()).toBe(true);
  });

  test('INT-R04 consultar con otro status (400) y con 200 sin cuerpo objeto → BILLETERA_NO_DISPONIBLE', async () => {
    const falla = billetera.consultaUsdFalla(WALLET_USD, { status: 400 });
    await esperaNoDisponible(consultarCuenta(WALLET_USD, CORRELATION_ID));
    expect(falla.isDone()).toBe(true);

    const texto = nock(config.billeteraUsd.url)
      .get(`/api/v1/billetera/wallets/${WALLET_USD}`)
      .reply(200, 'texto');
    await esperaNoDisponible(consultarCuenta(WALLET_USD, CORRELATION_ID));
    expect(texto.isDone()).toBe(true);
  });

  test('INT-R04 error de red al consultar → BILLETERA_NO_DISPONIBLE', async () => {
    const scope = nock(config.billeteraUsd.url)
      .get(`/api/v1/billetera/wallets/${WALLET_USD}`)
      .replyWithError({ code: 'ECONNREFUSED', message: 'conexión rechazada' });

    await esperaNoDisponible(consultarCuenta(WALLET_USD, CORRELATION_ID));
    expect(scope.isDone()).toBe(true);
  });
});

describe('Billetera USD · acreditar', () => {
  test('INT-T10 acreditar con 201 COMPLETADO (con movimiento_saldo_id) → ACREDITADO; Idempotency-Key = depositoId', async () => {
    const scope = billetera.acreditaUsdOk();

    await expect(acreditar(datosCreditoUsd(), CORRELATION_ID))
      .resolves.toEqual({ estado: 'ACREDITADO' });

    expect(scope.isDone()).toBe(true);
    expect(scope.peticiones).toHaveLength(1);
    expect(scope.peticiones[0].headers['idempotency-key']).toBe(DEPOSITO_ID);
  });

  test('INT-T10 acreditar con 200 (replay) COMPLETADO → ACREDITADO; misma Idempotency-Key y mismo body', async () => {
    const primera = billetera.acreditaUsdOk();
    const replay = billetera.acreditaUsdReplay();

    await expect(acreditar(datosCreditoUsd(), CORRELATION_ID))
      .resolves.toEqual({ estado: 'ACREDITADO' });
    await expect(acreditar(datosCreditoUsd(), CORRELATION_ID))
      .resolves.toEqual({ estado: 'ACREDITADO' });

    expect(primera.isDone()).toBe(true);
    expect(replay.isDone()).toBe(true);
    expect(replay.peticiones).toHaveLength(1);
    expect(replay.peticiones[0].headers['idempotency-key']).toBe(DEPOSITO_ID);
    // INT-R06: un reintento manual reenvía exactamente el mismo body.
    expect(replay.peticiones[0].body).toEqual(primera.peticiones[0].body);
  });

  test('INT-T10 COMPLETADO sin movimiento_saldo_id (201 null, 201 ausente, 200 null) → BILLETERA_NO_DISPONIBLE', async () => {
    const casos = [
      billetera.acreditaUsdOk({ cambios: { movimiento_saldo_id: null } }),
      billetera.acreditaUsdOk({ cambios: { movimiento_saldo_id: undefined } }),
      billetera.acreditaUsdReplay({ cambios: { movimiento_saldo_id: null } }),
    ];

    for (let i = 0; i < casos.length; i += 1) {
      await esperaNoDisponible(acreditar(datosCreditoUsd(), CORRELATION_ID));
    }
    for (const scope of casos) {
      expect(scope.isDone()).toBe(true);
      expect(scope.peticiones).toHaveLength(1);
    }
  });

  test('INT-T11 acreditar con 409 IDEMPOTENCY_CONFLICT → BILLETERA_NO_DISPONIBLE y log error', async () => {
    const error = jest.spyOn(logger, 'error');
    const scope = billetera.acreditaUsdConflicto();

    const promesa = acreditar(datosCreditoUsd(), CORRELATION_ID);

    await expect(promesa).rejects.toBeInstanceOf(ErrorApp);
    await esperaNoDisponible(promesa);
    expect(scope.isDone()).toBe(true);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toMatchObject({ correlationId: CORRELATION_ID, status: 409 });
  });

  test('INT-T11 acreditar con 202 VALIDADO → resuelve { estado: PENDIENTE }', async () => {
    const scope = billetera.acreditaUsdPendiente();

    await expect(acreditar(datosCreditoUsd(), CORRELATION_ID))
      .resolves.toEqual({ estado: 'PENDIENTE' });
    expect(scope.isDone()).toBe(true);
    expect(scope.peticiones).toHaveLength(1);
    expect(scope.peticiones[0].headers['idempotency-key']).toBe(DEPOSITO_ID);
  });

  test('INT-T11 acreditar con 200 (replay) VALIDADO y 200 PENDIENTE → resuelve { estado: PENDIENTE }', async () => {
    const validado = billetera.acreditaUsdReplay({ estado: 'VALIDADO' });
    const pendiente = billetera.acreditaUsdReplay({ estado: 'PENDIENTE' });

    await expect(acreditar(datosCreditoUsd(), CORRELATION_ID))
      .resolves.toEqual({ estado: 'PENDIENTE' });
    await expect(acreditar(datosCreditoUsd(), CORRELATION_ID))
      .resolves.toEqual({ estado: 'PENDIENTE' });
    expect(validado.isDone()).toBe(true);
    expect(pendiente.isDone()).toBe(true);
  });

  test('INT-T11 acreditar con 200 (replay) FALLIDO → resuelve { estado: RECHAZADO }; 1 sola petición', async () => {
    const scope = billetera.acreditaUsdReplay({ estado: 'FALLIDO' });
    // Un segundo interceptor atraparía un reintento (INT-R06).
    const reintento = billetera.acreditaUsdReplay({ estado: 'FALLIDO' });

    await expect(acreditar(datosCreditoUsd(), CORRELATION_ID))
      .resolves.toEqual({ estado: 'RECHAZADO' });
    expect(scope.isDone()).toBe(true);
    expect(scope.peticiones).toHaveLength(1);
    expect(scope.peticiones[0].headers['idempotency-key']).toBe(DEPOSITO_ID);
    expect(reintento.peticiones).toHaveLength(0);
  });

  test.each([400, 500])(
    'INT-T12 acreditar con %i → BILLETERA_NO_DISPONIBLE y nock recibió 1 sola llamada',
    async (status) => {
      const scope = billetera.acreditaUsdFalla({ status });
      // Un segundo interceptor idéntico atraparía un reintento (INT-R06).
      const reintento = billetera.acreditaUsdFalla({ status });

      const promesa = acreditar(datosCreditoUsd(), CORRELATION_ID);

      await expect(promesa).rejects.toBeInstanceOf(ErrorApp);
      await esperaNoDisponible(promesa);
      expect(scope.isDone()).toBe(true);
      expect(scope.peticiones).toHaveLength(1);
      expect(reintento.isDone()).toBe(false);
      expect(reintento.peticiones).toHaveLength(0);
    },
  );

  test('INT-T12 acreditar con timeout → BILLETERA_NO_DISPONIBLE y nock recibió 1 sola llamada', async () => {
    const cliente = clienteConTimeoutCorto();
    const scope = billetera.acreditaUsdLento({ demora: DEMORA_MS });
    const reintento = billetera.acreditaUsdLento({ demora: DEMORA_MS });
    let recibidas = 0;
    const contar = () => { recibidas += 1; };
    scope.on('request', contar);
    reintento.on('request', contar);

    const inicio = Date.now();
    await esperaNoDisponible(cliente.acreditar(datosCreditoUsd(), CORRELATION_ID));
    await new Promise((r) => { setTimeout(r, 2 * TIMEOUT_CORTO_MS); });

    expect(Date.now() - inicio).toBeLessThan(DEMORA_MS);
    expect(scope.isDone()).toBe(true);
    expect(reintento.isDone()).toBe(false);
    expect(recibidas).toBe(1);
  });

  test.each([
    ['429', { status: 429, code: 'RATE_LIMITED' }],
    ['503', { status: 503, code: 'SERVICE_UNAVAILABLE' }],
  ])('INT-R05 acreditar con %s → BILLETERA_NO_DISPONIBLE, sin reintento', async (_n, falla) => {
    const scope = billetera.acreditaUsdFalla(falla);
    const reintento = billetera.acreditaUsdFalla(falla);

    await esperaNoDisponible(acreditar(datosCreditoUsd(), CORRELATION_ID));
    expect(scope.peticiones).toHaveLength(1);
    expect(reintento.peticiones).toHaveLength(0);
  });

  test('INT-R05 otra respuesta (201 VALIDADO, 202 COMPLETADO, 422 con otro code) → BILLETERA_NO_DISPONIBLE', async () => {
    const validado201 = nock(config.billeteraUsd.url)
      .post('/api/v1/depositos/usd')
      .reply(201, { estado: 'VALIDADO', movimiento_saldo_id: null });
    const completado202 = nock(config.billeteraUsd.url)
      .post('/api/v1/depositos/usd')
      .reply(202, { estado: 'COMPLETADO', movimiento_saldo_id: 'mov_1' });
    const otro422 = billetera.acreditaUsdFalla({ status: 422, code: 'VALIDATION_ERROR' });

    await esperaNoDisponible(acreditar(datosCreditoUsd(), CORRELATION_ID));
    await esperaNoDisponible(acreditar(datosCreditoUsd(), CORRELATION_ID));
    await esperaNoDisponible(acreditar(datosCreditoUsd(), CORRELATION_ID));
    expect(validado201.isDone()).toBe(true);
    expect(completado202.isDone()).toBe(true);
    expect(otro422.isDone()).toBe(true);
  });

  test('INT-R05 error de red al acreditar → BILLETERA_NO_DISPONIBLE', async () => {
    const scope = nock(config.billeteraUsd.url)
      .post('/api/v1/depositos/usd')
      .replyWithError({ code: 'ECONNRESET', message: 'conexión cortada' });

    await esperaNoDisponible(acreditar(datosCreditoUsd(), CORRELATION_ID));
    expect(scope.isDone()).toBe(true);
  });

  test('INT-T13 body exacto: Decimal(150) → "150.00", USD, cliente_id = titularId, canal, referencia_externa; sin concepto ni cuenta_destino_id', async () => {
    const scope = billetera.acreditaUsdOk();

    await acreditar(datosCreditoUsd({ monto: new Decimal(150), canal: 'AGENTE' }), CORRELATION_ID);

    // Ejemplo de SPEC-02 §5 (cliente_id = usr-cliente-1, titular de 11111111-…).
    expect(scope.peticiones[0].body).toEqual({
      cliente_id: 'usr-cliente-1',
      monto: '150.00',
      moneda: 'USD',
      canal: 'AGENTE',
      metodo_origen: 'EFECTIVO',
      referencia_externa: DEPOSITO_ID,
    });
    expect(scope.peticiones[0].body).not.toHaveProperty('concepto');
    expect(scope.peticiones[0].body).not.toHaveProperty('cuenta_destino_id');
  });

  test.each([
    ['VENTANILLA', WALLET_USD, 'usr-cliente-1', 'EFECTIVO'],
    ['AGENTE', WALLET_USD_2, 'usr-cliente-2', 'EFECTIVO'],
    ['APP', WALLET_USD, 'usr-cliente-1', 'TRANSFERENCIA'],
  ])('INT-T13 canal %s (billetera %s, titular %s) → metodo_origen %s, canal y cliente_id = titularId', async (canal, cuenta, titularId, metodo) => {
    const scope = billetera.acreditaUsdOk();

    await acreditar(datosCreditoUsd({ canal, cuenta, titularId }), CORRELATION_ID);

    expect(scope.peticiones[0].body).toEqual({
      cliente_id: titularId,
      monto: '150.00',
      moneda: 'USD',
      canal,
      metodo_origen: metodo,
      referencia_externa: DEPOSITO_ID,
    });
  });

  test('INT-T13 monto Decimal("10.5") → "10.50"; quien registra (usuarioId) no llega al body', async () => {
    const scope = billetera.acreditaUsdOk();

    await acreditar(
      datosCreditoUsd({ monto: new Decimal('10.5'), usuarioId: 'usr-agente-1' }),
      CORRELATION_ID,
    );

    expect(scope.peticiones[0].body).toMatchObject({ monto: '10.50', cliente_id: 'usr-cliente-1' });
    expect(JSON.stringify(scope.peticiones[0].body)).not.toContain('usr-agente-1');
  });

  test('INT-T18 acreditar con 422 WALLET_BLOCKED, WALLET_CLOSED, CUSTOMER_BLOCKED y USD_ACCOUNT_NOT_ENABLED → CUENTA_INACTIVA', async () => {
    expect(billetera.RECHAZOS_USD).toEqual([
      'WALLET_BLOCKED', 'WALLET_CLOSED', 'CUSTOMER_BLOCKED', 'USD_ACCOUNT_NOT_ENABLED',
    ]);
    for (const codigo of billetera.RECHAZOS_USD) {
      const scope = billetera.acreditaUsdRechazo(codigo);
      const reintento = billetera.acreditaUsdRechazo(codigo);

      const promesa = acreditar(datosCreditoUsd(), CORRELATION_ID);

      await expect(promesa).rejects.toBeInstanceOf(ErrorApp);
      await esperaCuentaInactiva(promesa);
      expect(scope.peticiones).toHaveLength(1);
      expect(reintento.peticiones).toHaveLength(0);
      nock.cleanAll();
    }
  });

  test.each([401, 403])(
    'INT-T19 acreditar con %i → BILLETERA_NO_DISPONIBLE y log error',
    async (status) => {
      const error = jest.spyOn(logger, 'error');
      const code = status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN';
      const scope = billetera.acreditaUsdFalla({ status, code });

      const promesa = acreditar(datosCreditoUsd(), CORRELATION_ID);

      await expect(promesa).rejects.toBeInstanceOf(ErrorApp);
      await esperaNoDisponible(promesa);
      expect(scope.peticiones).toHaveLength(1);
      expect(error).toHaveBeenCalledTimes(1);
      expect(error.mock.calls[0][0]).toMatchObject({ correlationId: CORRELATION_ID, status });
    },
  );

  test('INT-R14 acreditar USD usa solo POST /api/v1/depositos/usd; nunca /wallets/{id}/depositos', async () => {
    const legada = nock(config.billeteraUsd.url)
      .post(/\/wallets\/[^/]+\/depositos/)
      .times(10)
      .reply(201, {});
    const ok = billetera.acreditaUsdOk();
    const replay = billetera.acreditaUsdReplay();
    const pendiente = billetera.acreditaUsdPendiente();

    await acreditar(datosCreditoUsd(), CORRELATION_ID);
    await acreditar(datosCreditoUsd(), CORRELATION_ID);
    await acreditar(datosCreditoUsd({ cuenta: WALLET_USD_2, titularId: 'usr-cliente-2' }), CORRELATION_ID);

    expect(ok.isDone()).toBe(true);
    expect(replay.isDone()).toBe(true);
    expect(pendiente.isDone()).toBe(true);
    expect(legada.isDone()).toBe(false);
  });
});

// ── Enrutamiento (INT-R10) y cabeceras USD (INT-R02, INT-R13) ──

describe('Enrutamiento y cabeceras', () => {
  test('INT-T14 cuenta 0011-0123-456789 → solo se llama a la billetera PEN', async () => {
    const consulta = billetera.cuentaActiva(CUENTA);
    const credito = billetera.acreditaOk(CUENTA);
    const usd = cualquierLlamada(config.billeteraUsd.url);

    await consultarCuenta(CUENTA, CORRELATION_ID);
    await acreditar(datosCredito(), CORRELATION_ID);

    expect(consulta.isDone()).toBe(true);
    expect(credito.isDone()).toBe(true);
    expect(usd.get.isDone()).toBe(false);
    expect(usd.post.isDone()).toBe(false);
  });

  test('INT-T14 cuenta UUID → solo se llama a Billetera USD', async () => {
    const consulta = billetera.billeteraUsdExiste(WALLET_USD);
    const credito = billetera.acreditaUsdOk();
    const pen = cualquierLlamada(config.billetera.url);

    await consultarCuenta(WALLET_USD, CORRELATION_ID);
    await acreditar(datosCreditoUsd(), CORRELATION_ID);

    expect(consulta.isDone()).toBe(true);
    expect(credito.isDone()).toBe(true);
    expect(pen.get.isDone()).toBe(false);
    expect(pen.post.isDone()).toBe(false);
  });

  test('INT-T15 Billetera USD sin BILLETERA_USD_TOKEN_URL → sin Authorization; X-Correlation-Id siempre', async () => {
    expect(config.billeteraUsd.tokenUrl).toBeNull();
    const consulta = billetera.billeteraUsdExiste(WALLET_USD);
    const credito = billetera.acreditaUsdOk();

    await consultarCuenta(WALLET_USD, 'corr-usd-consulta');
    await acreditar(datosCreditoUsd(), 'corr-usd-credito');

    expect(consulta.peticiones[0].headers).not.toHaveProperty('authorization');
    expect(credito.peticiones[0].headers).not.toHaveProperty('authorization');
    expect(consulta.peticiones[0].headers['x-correlation-id']).toBe('corr-usd-consulta');
    expect(credito.peticiones[0].headers['x-correlation-id']).toBe('corr-usd-credito');
  });

  test('INT-T15 Billetera USD con BILLETERA_USD_TOKEN_URL → Authorization Bearer <token OAuth> y X-Correlation-Id; el token se pide con client credentials', async () => {
    const { cliente } = clienteOAuth();
    const token = billetera.tokenUsdOk({ url: TOKEN_URL });
    const consulta = billetera.billeteraUsdExiste(WALLET_USD);
    const credito = billetera.acreditaUsdOk();

    await cliente.consultarCuenta(WALLET_USD, 'corr-usd-consulta');
    await expect(cliente.acreditar(datosCreditoUsd(), 'corr-usd-credito'))
      .resolves.toEqual({ estado: 'ACREDITADO' });

    expect(consulta.peticiones[0].headers.authorization).toBe(`Bearer ${token.accessToken}`);
    expect(credito.peticiones[0].headers.authorization).toBe(`Bearer ${token.accessToken}`);
    expect(consulta.peticiones[0].headers['x-correlation-id']).toBe('corr-usd-consulta');
    expect(credito.peticiones[0].headers['x-correlation-id']).toBe('corr-usd-credito');

    // INT-R13: client credentials con los dos scopes y las credenciales configuradas.
    expect(token.peticiones).toHaveLength(1);
    const [pedido] = token.peticiones;
    const form = new URLSearchParams(pedido.body);
    expect(form.get('grant_type')).toBe('client_credentials');
    expect(form.get('scope').split(' ').sort())
      .toEqual(['billetera/depositos.write', 'billetera/wallets.read']);
    const basic = `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`;
    const credencialesEnBody = form.get('client_id') === CLIENT_ID
      && form.get('client_secret') === CLIENT_SECRET;
    expect(pedido.headers.authorization === basic || credencialesEnBody).toBe(true);
  });

  test('INT-T15 llamadas USD con 404 y 500 también llevan X-Correlation-Id', async () => {
    const noExiste = billetera.billeteraUsdNoExiste(WALLET_USD);
    const falla = billetera.acreditaUsdFalla({ status: 500 });

    await consultarCuenta(WALLET_USD, CORRELATION_ID);
    await expect(acreditar(datosCreditoUsd(), CORRELATION_ID)).rejects.toBeInstanceOf(ErrorApp);

    expect(noExiste.peticiones[0].headers['x-correlation-id']).toBe(CORRELATION_ID);
    expect(falla.peticiones[0].headers['x-correlation-id']).toBe(CORRELATION_ID);
  });

  test('INT-T15 con OAuth, la billetera PEN sigue llevando Bearer BILLETERA_TOKEN y no el token OAuth', async () => {
    const { cliente } = clienteOAuth();
    const token = billetera.tokenUsdOk({ url: TOKEN_URL });
    const usd = billetera.billeteraUsdExiste(WALLET_USD);
    const pen = billetera.cuentaActiva(CUENTA);

    await cliente.consultarCuenta(WALLET_USD, CORRELATION_ID);
    await cliente.consultarCuenta(CUENTA, CORRELATION_ID);

    expect(usd.peticiones[0].headers.authorization).toBe(`Bearer ${token.accessToken}`);
    expect(pen.peticiones[0].headers.authorization).toBe('Bearer token-de-prueba');
  });
});

// ── OAuth de Billetera USD (INT-R13) ──

describe('Billetera USD · token OAuth (INT-R13)', () => {
  test('INT-T16 dos llamadas seguidas → 1 sola petición de token; las dos llevan el mismo Bearer', async () => {
    const { cliente } = clienteOAuth();
    const token = billetera.tokenUsdOk({ url: TOKEN_URL });
    const segundo = billetera.tokenUsdOk({ url: TOKEN_URL });
    const consulta = billetera.billeteraUsdExiste(WALLET_USD);
    const credito = billetera.acreditaUsdOk();

    await cliente.consultarCuenta(WALLET_USD, CORRELATION_ID);
    await cliente.acreditar(datosCreditoUsd(), CORRELATION_ID);

    expect(token.peticiones).toHaveLength(1);
    expect(segundo.peticiones).toHaveLength(0);
    expect(consulta.peticiones[0].headers.authorization).toBe(`Bearer ${token.accessToken}`);
    expect(credito.peticiones[0].headers.authorization).toBe(`Bearer ${token.accessToken}`);
  });

  test('INT-T16 llamadas simultáneas → comparten 1 sola petición de token', async () => {
    const { cliente } = clienteOAuth();
    const token = billetera.tokenUsdOk({ url: TOKEN_URL });
    const segundo = billetera.tokenUsdOk({ url: TOKEN_URL });
    const consultas = [
      billetera.billeteraUsdExiste(WALLET_USD),
      billetera.billeteraUsdExiste(WALLET_USD_2),
      billetera.billeteraUsdExiste(WALLET_USD),
    ];

    await Promise.all([
      cliente.consultarCuenta(WALLET_USD, 'c1'),
      cliente.consultarCuenta(WALLET_USD_2, 'c2'),
      cliente.consultarCuenta(WALLET_USD, 'c3'),
    ]);

    expect(token.peticiones).toHaveLength(1);
    expect(segundo.peticiones).toHaveLength(0);
    for (const scope of consultas) {
      expect(scope.peticiones[0].headers.authorization).toBe(`Bearer ${token.accessToken}`);
    }
  });

  test('INT-T16 a menos de 60 s de expirar → pide uno nuevo; a más de 60 s → reutiliza', async () => {
    const T0 = Date.parse('2026-11-09T12:00:00.000Z');
    let ahora = T0;
    jest.spyOn(Date, 'now').mockImplementation(() => ahora);
    const { cliente } = clienteOAuth();
    const primero = billetera.tokenUsdOk({ url: TOKEN_URL, expiresIn: 3600 });

    billetera.billeteraUsdExiste(WALLET_USD);
    await cliente.consultarCuenta(WALLET_USD, CORRELATION_ID);
    expect(primero.peticiones).toHaveLength(1);

    // Faltan 61 s para expirar: sigue vigente.
    const segundo = billetera.tokenUsdOk({ url: TOKEN_URL, expiresIn: 3600 });
    ahora = T0 + (3600 - 61) * 1000;
    const reutiliza = billetera.billeteraUsdExiste(WALLET_USD);
    await cliente.consultarCuenta(WALLET_USD, CORRELATION_ID);
    expect(segundo.peticiones).toHaveLength(0);
    expect(reutiliza.peticiones[0].headers.authorization).toBe(`Bearer ${primero.accessToken}`);

    // Faltan 59 s: se pide otro y se usa el nuevo.
    ahora = T0 + (3600 - 59) * 1000;
    const renueva = billetera.billeteraUsdExiste(WALLET_USD);
    await cliente.consultarCuenta(WALLET_USD, CORRELATION_ID);
    expect(segundo.peticiones).toHaveLength(1);
    expect(renueva.peticiones[0].headers.authorization).toBe(`Bearer ${segundo.accessToken}`);
    expect(segundo.accessToken).not.toBe(primero.accessToken);
  });

  test('INT-T17 fallo al obtener el token (401) → BILLETERA_NO_DISPONIBLE sin llamar a la billetera; ni secreto ni credenciales en logs', async () => {
    const { cliente, logger: log } = clienteOAuth();
    const espias = espiarLogs(log);
    const token = billetera.tokenUsdFalla({ url: TOKEN_URL, status: 401 });
    const usd = cualquierLlamada(config.billeteraUsd.url);

    await esperaNoDisponible(cliente.consultarCuenta(WALLET_USD, CORRELATION_ID));

    expect(token.peticiones).toHaveLength(1);
    expect(usd.get.isDone()).toBe(false);
    expect(usd.post.isDone()).toBe(false);
    expect(espias.some((spy) => spy.mock.calls.length > 0)).toBe(true);
    const logueado = textoLogs(espias);
    expect(logueado).not.toContain(CLIENT_SECRET);
    expect(logueado).not.toContain(Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'));
  });

  test('INT-T17 fallo al obtener el token al acreditar (500, timeout, error de red, 200 sin access_token) → BILLETERA_NO_DISPONIBLE; sin POST a la billetera', async () => {
    const casos = [
      () => billetera.tokenUsdFalla({ url: TOKEN_URL, status: 500 }),
      () => billetera.tokenUsdFalla({ url: TOKEN_URL, status: 200, demora: DEMORA_MS }),
      () => nock('http://auth-usd.test').post('/oauth2/token')
        .replyWithError({ code: 'ECONNREFUSED', message: 'conexión rechazada' }),
      () => nock('http://auth-usd.test').post('/oauth2/token')
        .reply(200, { token_type: 'Bearer', expires_in: 3600 }),
    ];
    for (const preparar of casos) {
      const { cliente, logger: log } = clienteOAuth({
        BILLETERA_TIMEOUT_MS: String(TIMEOUT_CORTO_MS),
      });
      const espias = espiarLogs(log);
      const token = preparar();
      const credito = billetera.acreditaUsdOk();

      await esperaNoDisponible(cliente.acreditar(datosCreditoUsd(), CORRELATION_ID));

      expect(token.isDone()).toBe(true);
      expect(credito.peticiones).toHaveLength(0);
      expect(textoLogs(espias)).not.toContain(CLIENT_SECRET);
      nock.abortPendingRequests();
      nock.cleanAll();
    }
  });

  test('INT-T17 el token y el secreto no aparecen en los logs (éxito, fallo de billetera 500 y 409)', async () => {
    const { cliente, logger: log } = clienteOAuth();
    const espias = espiarLogs(log);
    const token = billetera.tokenUsdOk({ url: TOKEN_URL });
    billetera.billeteraUsdExiste(WALLET_USD);
    billetera.consultaUsdFalla(WALLET_USD_2, { status: 500 });
    billetera.acreditaUsdConflicto();

    await cliente.consultarCuenta(WALLET_USD, CORRELATION_ID);
    await esperaNoDisponible(cliente.consultarCuenta(WALLET_USD_2, CORRELATION_ID));
    await esperaNoDisponible(cliente.acreditar(datosCreditoUsd(), CORRELATION_ID));

    // Hubo logs (warn del 500 y error del 409), pero sin credenciales.
    expect(espias.some((spy) => spy.mock.calls.length > 0)).toBe(true);
    const logueado = textoLogs(espias);
    expect(logueado).not.toContain(token.accessToken);
    expect(logueado).not.toContain(CLIENT_SECRET);
  });

  test('INT-T19 con OAuth, la billetera responde 403 al acreditar → BILLETERA_NO_DISPONIBLE y log error sin el token', async () => {
    const { cliente, logger: log } = clienteOAuth();
    const error = jest.spyOn(log, 'error');
    const token = billetera.tokenUsdOk({ url: TOKEN_URL });
    const scope = billetera.acreditaUsdFalla({ status: 403, code: 'FORBIDDEN' });

    await esperaNoDisponible(cliente.acreditar(datosCreditoUsd(), CORRELATION_ID));

    expect(scope.peticiones).toHaveLength(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toMatchObject({ correlationId: CORRELATION_ID, status: 403 });
    expect(JSON.stringify(error.mock.calls)).not.toContain(token.accessToken);
  });

  test('INT-T19 acreditar con 401 → BILLETERA_NO_DISPONIBLE sin reintento; la siguiente llamada pide un token nuevo', async () => {
    const { cliente, logger: log } = clienteOAuth();
    const espias = espiarLogs(log);
    const error = espias[4];
    const primero = billetera.tokenUsdOk({ url: TOKEN_URL });
    const segundo = billetera.tokenUsdOk({ url: TOKEN_URL });
    const rechazo = billetera.acreditaUsdFalla({ status: 401, code: 'UNAUTHORIZED' });
    const reintento = billetera.acreditaUsdOk();

    await esperaNoDisponible(cliente.acreditar(datosCreditoUsd(), CORRELATION_ID));

    // Esa llamada no reintenta (INT-R06) ni pide otro token todavía.
    expect(rechazo.peticiones).toHaveLength(1);
    expect(rechazo.peticiones[0].headers.authorization).toBe(`Bearer ${primero.accessToken}`);
    expect(reintento.peticiones).toHaveLength(0);
    expect(primero.peticiones).toHaveLength(1);
    expect(segundo.peticiones).toHaveLength(0);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toMatchObject({ correlationId: CORRELATION_ID, status: 401 });

    // La siguiente llamada pide un token nuevo y lo usa.
    await expect(cliente.acreditar(datosCreditoUsd(), CORRELATION_ID))
      .resolves.toEqual({ estado: 'ACREDITADO' });
    expect(segundo.peticiones).toHaveLength(1);
    expect(reintento.peticiones).toHaveLength(1);
    expect(reintento.peticiones[0].headers.authorization).toBe(`Bearer ${segundo.accessToken}`);
    expect(segundo.accessToken).not.toBe(primero.accessToken);

    const logueado = textoLogs(espias);
    expect(logueado).not.toContain(primero.accessToken);
    expect(logueado).not.toContain(segundo.accessToken);
    expect(logueado).not.toContain(CLIENT_SECRET);
  });

  test('INT-T19 acreditar con 403 → BILLETERA_NO_DISPONIBLE; la siguiente llamada reutiliza el token (no pide otro)', async () => {
    const { cliente, logger: log } = clienteOAuth();
    const espias = espiarLogs(log);
    const primero = billetera.tokenUsdOk({ url: TOKEN_URL });
    const segundo = billetera.tokenUsdOk({ url: TOKEN_URL });
    const rechazo = billetera.acreditaUsdFalla({ status: 403, code: 'FORBIDDEN' });
    const siguiente = billetera.acreditaUsdOk();

    await esperaNoDisponible(cliente.acreditar(datosCreditoUsd(), CORRELATION_ID));
    expect(rechazo.peticiones).toHaveLength(1);
    expect(siguiente.peticiones).toHaveLength(0);

    await expect(cliente.acreditar(datosCreditoUsd(), CORRELATION_ID))
      .resolves.toEqual({ estado: 'ACREDITADO' });
    expect(primero.peticiones).toHaveLength(1);
    expect(segundo.peticiones).toHaveLength(0);
    expect(siguiente.peticiones[0].headers.authorization).toBe(`Bearer ${primero.accessToken}`);

    const logueado = textoLogs(espias);
    expect(logueado).not.toContain(primero.accessToken);
    expect(logueado).not.toContain(CLIENT_SECRET);
  });

  test('INT-T19 consultarCuenta con 401 → BILLETERA_NO_DISPONIBLE; la siguiente pide token nuevo. Con 403 no', async () => {
    const { cliente, logger: log } = clienteOAuth();
    const espias = espiarLogs(log);
    const primero = billetera.tokenUsdOk({ url: TOKEN_URL });
    const segundo = billetera.tokenUsdOk({ url: TOKEN_URL });
    const tercero = billetera.tokenUsdOk({ url: TOKEN_URL });

    // 401 al consultar: descarta el token guardado.
    const con401 = billetera.consultaUsdFalla(WALLET_USD, { status: 401 });
    await esperaNoDisponible(cliente.consultarCuenta(WALLET_USD, CORRELATION_ID));
    expect(con401.peticiones).toHaveLength(1);
    expect(primero.peticiones).toHaveLength(1);
    expect(segundo.peticiones).toHaveLength(0);

    // 403 al consultar: usa el token nuevo (pedido por el 401 anterior) y no lo descarta.
    const con403 = billetera.consultaUsdFalla(WALLET_USD, { status: 403 });
    await esperaNoDisponible(cliente.consultarCuenta(WALLET_USD, CORRELATION_ID));
    expect(segundo.peticiones).toHaveLength(1);
    expect(con403.peticiones[0].headers.authorization).toBe(`Bearer ${segundo.accessToken}`);

    // Tras el 403, la siguiente reutiliza el segundo token.
    const ok = billetera.billeteraUsdExiste(WALLET_USD);
    await expect(cliente.consultarCuenta(WALLET_USD, CORRELATION_ID)).resolves.toMatchObject({
      numero: WALLET_USD, estado: 'ACTIVA',
    });
    expect(tercero.peticiones).toHaveLength(0);
    expect(ok.peticiones[0].headers.authorization).toBe(`Bearer ${segundo.accessToken}`);

    const logueado = textoLogs(espias);
    expect(logueado).not.toContain(primero.accessToken);
    expect(logueado).not.toContain(segundo.accessToken);
  });
});
