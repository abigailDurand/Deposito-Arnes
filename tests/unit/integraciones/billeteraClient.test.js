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
const USUARIO_ID = 'usr-agente-1';
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
    usuarioId: USUARIO_ID,
    canal: 'AGENTE',
    ...extra,
  };
}

// Carga el cliente en un registro aislado con variables de entorno distintas (config.js lee el
// entorno al cargarse). No se toca ningún archivo; el entorno se restaura siempre.
function clienteCon(variables) {
  const previos = {};
  for (const [nombre, valor] of Object.entries(variables)) {
    previos[nombre] = process.env[nombre];
    process.env[nombre] = valor;
  }
  let cliente;
  try {
    jest.isolateModules(() => {
      cliente = require('../../../src/core/clients/billeteraClient');
    });
  } finally {
    for (const [nombre, valor] of Object.entries(previos)) {
      if (valor === undefined) delete process.env[nombre];
      else process.env[nombre] = valor;
    }
  }
  return cliente;
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
  test('INT-T04 acreditar con 201 → resuelve sin valor', async () => {
    const scope = billetera.acreditaOk(CUENTA);

    await expect(acreditar(datosCredito(), CORRELATION_ID)).resolves.toBeUndefined();
    expect(scope.isDone()).toBe(true);
    expect(scope.peticiones).toHaveLength(1);
  });

  test('INT-T04 acreditar con 409 (depositoId ya acreditado) → resuelve sin valor', async () => {
    const scope = billetera.acreditaYaExiste(CUENTA);

    await expect(acreditar(datosCredito(), CORRELATION_ID)).resolves.toBeUndefined();
    expect(scope.isDone()).toBe(true);
    expect(scope.peticiones).toHaveLength(1);
  });

  test('INT-R12 acreditar con 200 → resuelve sin valor', async () => {
    const scope = billetera.acreditaOk(CUENTA, { status: 200 });

    await expect(acreditar(datosCredito(), CORRELATION_ID)).resolves.toBeUndefined();
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

// ── Billetera USD (INT-R04, INT-R05, INT-R07) ──

describe('Billetera USD · consultarCuenta', () => {
  test('INT-T08 consultar con 200 → { numero: id, estado ACTIVA, moneda USD, titularId: user_id }, sin balance ni nombre', async () => {
    const uno = billetera.billeteraUsdExiste(WALLET_USD);
    const dos = billetera.billeteraUsdExiste(WALLET_USD_2);

    const cuenta = await consultarCuenta(WALLET_USD, CORRELATION_ID);
    const cuenta2 = await consultarCuenta(WALLET_USD_2, CORRELATION_ID);

    // toEqual exacto: ninguna clave extra (balance, nombre, id, user_id).
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

  test('INT-T08 consultar no loguea balance ni nombre', async () => {
    billetera.billeteraUsdExiste(WALLET_USD);
    const espias = ['trace', 'debug', 'info', 'warn', 'error', 'fatal']
      .map((nivel) => jest.spyOn(logger, nivel));

    await consultarCuenta(WALLET_USD, CORRELATION_ID);

    const logueado = JSON.stringify(espias.flatMap((spy) => spy.mock.calls));
    expect(logueado).not.toContain('350.75');
    expect(logueado).not.toContain('Cliente Uno');
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
});

describe('Billetera USD · acreditar', () => {
  test('INT-T10 acreditar con 201 COMPLETADO → resuelve; Idempotency-Key = depositoId', async () => {
    const scope = billetera.acreditaUsdOk();

    await expect(acreditar(datosCreditoUsd(), CORRELATION_ID)).resolves.toBeUndefined();

    expect(scope.isDone()).toBe(true);
    expect(scope.peticiones).toHaveLength(1);
    expect(scope.peticiones[0].headers['idempotency-key']).toBe(DEPOSITO_ID);
  });

  test('INT-T10 acreditar con 200 (replay) COMPLETADO → resuelve; misma Idempotency-Key y mismo body', async () => {
    const primera = billetera.acreditaUsdOk();
    const replay = billetera.acreditaUsdReplay();

    await expect(acreditar(datosCreditoUsd(), CORRELATION_ID)).resolves.toBeUndefined();
    await expect(acreditar(datosCreditoUsd(), CORRELATION_ID)).resolves.toBeUndefined();

    expect(primera.isDone()).toBe(true);
    expect(replay.isDone()).toBe(true);
    expect(replay.peticiones).toHaveLength(1);
    expect(replay.peticiones[0].headers['idempotency-key']).toBe(DEPOSITO_ID);
    // INT-R06: un reintento manual reenvía exactamente el mismo body.
    expect(replay.peticiones[0].body).toEqual(primera.peticiones[0].body);
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

  test('INT-T11 acreditar con 201 estado PENDIENTE → BILLETERA_NO_DISPONIBLE', async () => {
    const scope = billetera.acreditaUsdPendiente();

    const promesa = acreditar(datosCreditoUsd(), CORRELATION_ID);

    await expect(promesa).rejects.toBeInstanceOf(ErrorApp);
    await esperaNoDisponible(promesa);
    expect(scope.isDone()).toBe(true);
    expect(scope.peticiones).toHaveLength(1);
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

  test('INT-R05 error de red al acreditar → BILLETERA_NO_DISPONIBLE', async () => {
    const scope = nock(config.billeteraUsd.url)
      .post('/api/v1/depositos/usd')
      .replyWithError({ code: 'ECONNRESET', message: 'conexión cortada' });

    await esperaNoDisponible(acreditar(datosCreditoUsd(), CORRELATION_ID));
    expect(scope.isDone()).toBe(true);
  });

  test('INT-T13 body exacto: Decimal(150) → "150.00", moneda USD, cliente_id, referencia_externa, sin concepto', async () => {
    const scope = billetera.acreditaUsdOk();

    await acreditar(datosCreditoUsd({ monto: new Decimal(150), canal: 'AGENTE' }), CORRELATION_ID);

    expect(scope.peticiones[0].body).toEqual({
      cliente_id: USUARIO_ID,
      cuenta_destino_id: WALLET_USD,
      monto: '150.00',
      moneda: 'USD',
      metodo_origen: 'EFECTIVO',
      referencia_externa: DEPOSITO_ID,
    });
    expect(scope.peticiones[0].body).not.toHaveProperty('concepto');
  });

  test.each([
    ['VENTANILLA', 'usr-cajero-1', 'EFECTIVO'],
    ['AGENTE', 'usr-agente-1', 'EFECTIVO'],
    ['APP', 'usr-cliente-1', 'TRANSFERENCIA'],
  ])('INT-T13 canal %s (usuario %s) → metodo_origen %s y cliente_id = usuarioId', async (canal, usuarioId, metodo) => {
    const scope = billetera.acreditaUsdOk();

    await acreditar(datosCreditoUsd({ canal, usuarioId }), CORRELATION_ID);

    expect(scope.peticiones[0].body).toMatchObject({
      cliente_id: usuarioId,
      metodo_origen: metodo,
      moneda: 'USD',
      monto: '150.00',
    });
  });
});

// ── Enrutamiento (INT-R10) y cabeceras USD (INT-R02) ──

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

  test('INT-T15 Billetera USD sin BILLETERA_USD_TOKEN → sin Authorization; X-Correlation-Id siempre', async () => {
    expect(config.billeteraUsd.token).toBeNull();
    const consulta = billetera.billeteraUsdExiste(WALLET_USD);
    const credito = billetera.acreditaUsdOk();

    await consultarCuenta(WALLET_USD, 'corr-usd-consulta');
    await acreditar(datosCreditoUsd(), 'corr-usd-credito');

    expect(consulta.peticiones[0].headers).not.toHaveProperty('authorization');
    expect(credito.peticiones[0].headers).not.toHaveProperty('authorization');
    expect(consulta.peticiones[0].headers['x-correlation-id']).toBe('corr-usd-consulta');
    expect(credito.peticiones[0].headers['x-correlation-id']).toBe('corr-usd-credito');
  });

  test('INT-T15 Billetera USD con BILLETERA_USD_TOKEN → lleva Authorization Bearer; X-Correlation-Id siempre', async () => {
    const cliente = clienteCon({ BILLETERA_USD_TOKEN: 'token-usd-de-prueba' });
    const consulta = billetera.billeteraUsdExiste(WALLET_USD);
    const credito = billetera.acreditaUsdOk();
    const pen = billetera.cuentaActiva(CUENTA);

    await cliente.consultarCuenta(WALLET_USD, 'corr-usd-consulta');
    await cliente.acreditar(datosCreditoUsd(), 'corr-usd-credito');
    await cliente.consultarCuenta(CUENTA, 'corr-pen');

    expect(consulta.peticiones[0].headers).toMatchObject({
      authorization: 'Bearer token-usd-de-prueba',
      'x-correlation-id': 'corr-usd-consulta',
    });
    expect(credito.peticiones[0].headers).toMatchObject({
      authorization: 'Bearer token-usd-de-prueba',
      'x-correlation-id': 'corr-usd-credito',
    });
    // Cada billetera con su token: la PEN sigue usando BILLETERA_TOKEN.
    expect(pen.peticiones[0].headers.authorization).toBe('Bearer token-de-prueba');
  });

  test('INT-T15 llamadas USD con 404 y 500 también llevan X-Correlation-Id', async () => {
    const noExiste = billetera.billeteraUsdNoExiste(WALLET_USD);
    const falla = billetera.acreditaUsdFalla({ status: 500 });

    await consultarCuenta(WALLET_USD, CORRELATION_ID);
    await expect(acreditar(datosCreditoUsd(), CORRELATION_ID)).rejects.toBeInstanceOf(ErrorApp);

    expect(noExiste.peticiones[0].headers['x-correlation-id']).toBe(CORRELATION_ID);
    expect(falla.peticiones[0].headers['x-correlation-id']).toBe(CORRELATION_ID);
  });
});
