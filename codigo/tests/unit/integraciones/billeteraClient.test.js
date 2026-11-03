'use strict';

const nock = require('nock');
const Decimal = require('decimal.js');

const config = require('../../../src/config');
const { consultarCuenta, acreditar } = require('../../../src/core/clients/billeteraClient');
const { ErrorApp } = require('../../../src/core/errores');
const billetera = require('../../helpers/billetera');

const CUENTA_PEN = '0011-0123-456789';
const WALLET_USD = '11111111-1111-4111-8111-111111111111';
const WALLET_USD_2 = '22222222-2222-4222-8222-222222222222';
const DEPOSITO_ID = '7f1c2e9a-0b1d-4c5e-9f00-123456789abc';
const CORRELATION_ID = 'abc-123';
const USUARIO_ID = 'usr-agente-1';
const TIMEOUT_CORTO_MS = 100;
const DEMORA_MS = 1000;

function datosCreditoPen(extra = {}) {
  return { depositoId: DEPOSITO_ID, cuenta: CUENTA_PEN, monto: '150.00', moneda: 'PEN', ...extra };
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

function clienteConTimeoutCorto() {
  const previo = process.env.BILLETERA_TIMEOUT_MS;
  process.env.BILLETERA_TIMEOUT_MS = String(TIMEOUT_CORTO_MS);
  let cliente;
  try {
    jest.isolateModules(() => {
      cliente = require('../../../src/core/clients/billeteraClient');
    });
  } finally {
    process.env.BILLETERA_TIMEOUT_MS = previo;
  }
  return cliente;
}

async function esperaNoDisponible(promesa) {
  await expect(promesa).rejects.toMatchObject({
    name: 'ErrorApp',
    codigo: 'BILLETERA_NO_DISPONIBLE',
    status: 502,
  });
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
});

afterAll(() => {
  nock.enableNetConnect();
});

// ========================================================
// Billetera PEN
// ========================================================

describe('Billetera PEN - consultarCuenta', () => {
  test('INT-T01 consultar con 200 → devuelve la cuenta', async () => {
    const scope = billetera.cuentaActiva(CUENTA_PEN);

    const cuenta = await consultarCuenta(CUENTA_PEN, CORRELATION_ID);

    expect(cuenta).toEqual({
      numero: '0011-0123-456789',
      estado: 'ACTIVA',
      moneda: 'PEN',
      titularId: 'usr-cliente-1',
    });
    expect(scope.isDone()).toBe(true);
    expect(scope.peticiones).toHaveLength(1);
  });

  test('INT-T01 (cuentas BLOQUEADA y cuenta 2 de §4) → devuelve su estado y moneda reales', async () => {
    const bloqueada = billetera.cuentaActiva('0011-0123-000003');
    const cuenta2 = billetera.cuentaActiva('0011-0123-000002');

    await expect(consultarCuenta('0011-0123-000003', CORRELATION_ID)).resolves.toEqual({
      numero: '0011-0123-000003', estado: 'BLOQUEADA', moneda: 'PEN', titularId: 'usr-cliente-1',
    });
    await expect(consultarCuenta('0011-0123-000002', CORRELATION_ID)).resolves.toEqual({
      numero: '0011-0123-000002', estado: 'ACTIVA', moneda: 'PEN', titularId: 'usr-cliente-2',
    });
    expect(bloqueada.isDone()).toBe(true);
    expect(cuenta2.isDone()).toBe(true);
  });

  test('INT-T02 consultar con 404 → devuelve null', async () => {
    const scope = billetera.cuentaNoExiste(CUENTA_PEN);

    await expect(consultarCuenta(CUENTA_PEN, CORRELATION_ID)).resolves.toBeNull();
    expect(scope.isDone()).toBe(true);
  });

  test('INT-T03 consultar con 500 → BILLETERA_NO_DISPONIBLE', async () => {
    const scope = billetera.consultaFalla(CUENTA_PEN, { status: 500 });
    const promesa = consultarCuenta(CUENTA_PEN, CORRELATION_ID);

    await expect(promesa).rejects.toBeInstanceOf(ErrorApp);
    await esperaNoDisponible(promesa);
    expect(scope.isDone()).toBe(true);
  });

  test('INT-T03 consultar con timeout → BILLETERA_NO_DISPONIBLE', async () => {
    const cliente = clienteConTimeoutCorto();
    const scope = billetera.consultaFalla(CUENTA_PEN, { status: 200, demora: DEMORA_MS });

    const inicio = Date.now();
    await esperaNoDisponible(cliente.consultarCuenta(CUENTA_PEN, CORRELATION_ID));

    expect(Date.now() - inicio).toBeLessThan(DEMORA_MS);
    expect(scope.isDone()).toBe(true);
  });
});

describe('Billetera PEN - acreditar', () => {
  test('INT-T04 acreditar con 201 → resuelve sin valor', async () => {
    const scope = billetera.acreditaOk(CUENTA_PEN);

    await expect(acreditar(datosCreditoPen(), CORRELATION_ID)).resolves.toBeUndefined();
    expect(scope.isDone()).toBe(true);
    expect(scope.peticiones).toHaveLength(1);
  });

  test('INT-T04 acreditar con 409 (depositoId ya acreditado) → resuelve sin valor', async () => {
    const scope = billetera.acreditaYaExiste(CUENTA_PEN);

    await expect(acreditar(datosCreditoPen(), CORRELATION_ID)).resolves.toBeUndefined();
    expect(scope.isDone()).toBe(true);
  });

  test.each([400, 500])(
    'INT-T05 acreditar con %i → BILLETERA_NO_DISPONIBLE y nock recibió 1 sola llamada',
    async (status) => {
      const scope = billetera.acreditaFalla(CUENTA_PEN, { status });
      const reintento = billetera.acreditaFalla(CUENTA_PEN, { status });

      const promesa = acreditar(datosCreditoPen(), CORRELATION_ID);

      await expect(promesa).rejects.toBeInstanceOf(ErrorApp);
      await esperaNoDisponible(promesa);
      expect(scope.isDone()).toBe(true);
      expect(scope.peticiones).toHaveLength(1);
      expect(reintento.isDone()).toBe(false);
    },
  );

  test('INT-T05 acreditar con timeout → BILLETERA_NO_DISPONIBLE y nock recibió 1 sola llamada', async () => {
    const cliente = clienteConTimeoutCorto();
    const scope = billetera.acreditaLento(CUENTA_PEN, { demora: DEMORA_MS });
    const reintento = billetera.acreditaLento(CUENTA_PEN, { demora: DEMORA_MS });

    const inicio = Date.now();
    await esperaNoDisponible(cliente.acreditar(datosCreditoPen(), CORRELATION_ID));

    expect(Date.now() - inicio).toBeLessThan(DEMORA_MS);
    expect(scope.isDone()).toBe(true);
    expect(reintento.isDone()).toBe(false);
  });

  test('INT-T06 consultar y acreditar llevan Authorization y X-Correlation-Id', async () => {
    const consulta = billetera.cuentaActiva(CUENTA_PEN);
    const credito = billetera.acreditaOk(CUENTA_PEN);

    await consultarCuenta(CUENTA_PEN, 'corr-consulta');
    await acreditar(datosCreditoPen(), 'corr-credito');

    expect(consulta.peticiones[0].headers).toMatchObject({
      authorization: 'Bearer token-de-prueba',
      'x-correlation-id': 'corr-consulta',
    });
    expect(credito.peticiones[0].headers).toMatchObject({
      authorization: 'Bearer token-de-prueba',
      'x-correlation-id': 'corr-credito',
    });
  });

  test('INT-T07 monto Decimal(150) → el body lleva "150.00"', async () => {
    const scope = billetera.acreditaOk(CUENTA_PEN);

    await acreditar(datosCreditoPen({ monto: new Decimal(150) }), CORRELATION_ID);

    expect(scope.peticiones[0].body).toEqual({
      depositoId: DEPOSITO_ID,
      monto: '150.00',
      moneda: 'PEN',
      concepto: 'DEPOSITO',
    });
  });
});

// ========================================================
// Billetera USD (INT-T08 .. INT-T15)
// ========================================================

describe('Billetera USD - consultarCuenta', () => {
  test('INT-T08 consultar con 200 → devuelve datos sin balance ni nombre', async () => {
    const scope = billetera.billeteraUsdExiste(WALLET_USD);

    const cuenta = await consultarCuenta(WALLET_USD, CORRELATION_ID);

    expect(cuenta).toEqual({
      numero: WALLET_USD,
      estado: 'ACTIVA',
      moneda: 'USD',
      titularId: 'usr-cliente-1',
    });
    expect(cuenta.balance).toBeUndefined();
    expect(cuenta.nombre).toBeUndefined();
    expect(scope.isDone()).toBe(true);
  });

  test('INT-T09 consultar con 404 → devuelve null', async () => {
    const scope = billetera.billeteraUsdNoExiste(WALLET_USD);

    await expect(consultarCuenta(WALLET_USD, CORRELATION_ID)).resolves.toBeNull();
    expect(scope.isDone()).toBe(true);
  });

  test('INT-T09 consultar con 500 y con timeout → BILLETERA_NO_DISPONIBLE', async () => {
    const scope500 = billetera.consultaUsdFalla(WALLET_USD, { status: 500 });
    await esperaNoDisponible(consultarCuenta(WALLET_USD, CORRELATION_ID));
    expect(scope500.isDone()).toBe(true);

    const cliente = clienteConTimeoutCorto();
    const scopeTimeout = billetera.consultaUsdFalla(WALLET_USD, { status: 200, demora: DEMORA_MS });
    await esperaNoDisponible(cliente.consultarCuenta(WALLET_USD, CORRELATION_ID));
    expect(scopeTimeout.isDone()).toBe(true);
  });
});

describe('Billetera USD - acreditar', () => {
  test('INT-T10 acreditar con 201 y con 200 (replay) COMPLETADO → resuelve; lleva Idempotency-Key = depositoId', async () => {
    const scope201 = billetera.acreditaUsdOk({ status: 201 });
    await expect(acreditar(datosCreditoUsd(), CORRELATION_ID)).resolves.toBeUndefined();
    expect(scope201.isDone()).toBe(true);
    expect(scope201.peticiones[0].headers['idempotency-key']).toBe(DEPOSITO_ID);

    const scope200 = billetera.acreditaUsdReplay();
    await expect(acreditar(datosCreditoUsd(), CORRELATION_ID)).resolves.toBeUndefined();
    expect(scope200.isDone()).toBe(true);
    expect(scope200.peticiones[0].headers['idempotency-key']).toBe(DEPOSITO_ID);
  });

  test('INT-T11 acreditar con 409 o 201 PENDIENTE → BILLETERA_NO_DISPONIBLE', async () => {
    const scope409 = billetera.acreditaUsdConflicto();
    await esperaNoDisponible(acreditar(datosCreditoUsd(), CORRELATION_ID));
    expect(scope409.isDone()).toBe(true);

    const scopePendiente = billetera.acreditaUsdPendiente();
    await esperaNoDisponible(acreditar(datosCreditoUsd(), CORRELATION_ID));
    expect(scopePendiente.isDone()).toBe(true);
  });

  test('INT-T12 acreditar con 400, 500 y timeout → BILLETERA_NO_DISPONIBLE (1 sola llamada)', async () => {
    for (const status of [400, 500]) {
      const scope = billetera.acreditaUsdFalla({ status });
      const reintento = billetera.acreditaUsdFalla({ status });

      await esperaNoDisponible(acreditar(datosCreditoUsd(), CORRELATION_ID));
      expect(scope.isDone()).toBe(true);
      expect(reintento.isDone()).toBe(false);
    }

    const cliente = clienteConTimeoutCorto();
    const scopeLento = billetera.acreditaUsdLento({ demora: DEMORA_MS });
    const reintentoLento = billetera.acreditaUsdLento({ demora: DEMORA_MS });

    await esperaNoDisponible(cliente.acreditar(datosCreditoUsd(), CORRELATION_ID));
    expect(scopeLento.isDone()).toBe(true);
    expect(reintentoLento.isDone()).toBe(false);
  });

  test('INT-T13 body exacto: Decimal(150), moneda USD, cliente_id, referencia_externa, metodo_origen según canal', async () => {
    const scope1 = billetera.acreditaUsdOk();
    await acreditar(datosCreditoUsd({ canal: 'VENTANILLA', monto: new Decimal(150) }), CORRELATION_ID);
    expect(scope1.peticiones[0].body).toEqual({
      cliente_id: USUARIO_ID,
      cuenta_destino_id: WALLET_USD,
      monto: '150.00',
      moneda: 'USD',
      metodo_origen: 'EFECTIVO',
      referencia_externa: DEPOSITO_ID,
    });
    expect(scope1.peticiones[0].body.concepto).toBeUndefined();

    const scope2 = billetera.acreditaUsdOk();
    await acreditar(datosCreditoUsd({ canal: 'APP' }), CORRELATION_ID);
    expect(scope2.peticiones[0].body.metodo_origen).toBe('TRANSFERENCIA');

    const scope3 = billetera.acreditaUsdOk();
    await acreditar(datosCreditoUsd({ canal: 'AGENTE' }), CORRELATION_ID);
    expect(scope3.peticiones[0].body.metodo_origen).toBe('EFECTIVO');
  });

  test('INT-T14 INT-R10 enrutamiento: cuenta PEN llama solo a PEN, cuenta UUID llama solo a USD', async () => {
    const scopePen = billetera.cuentaActiva(CUENTA_PEN);
    await consultarCuenta(CUENTA_PEN, CORRELATION_ID);
    expect(scopePen.isDone()).toBe(true);

    const scopeUsd = billetera.billeteraUsdExiste(WALLET_USD);
    await consultarCuenta(WALLET_USD, CORRELATION_ID);
    expect(scopeUsd.isDone()).toBe(true);
  });

  test('INT-T15 cabeceras Billetera USD: Authorization condicional según BILLETERA_USD_TOKEN y X-Correlation-Id siempre', async () => {
    const scopeSinToken = billetera.billeteraUsdExiste(WALLET_USD);
    await consultarCuenta(WALLET_USD, 'corr-usd-1');
    expect(scopeSinToken.peticiones[0].headers['x-correlation-id']).toBe('corr-usd-1');
    expect(scopeSinToken.peticiones[0].headers.authorization).toBeUndefined();

    // Con token
    process.env.BILLETERA_USD_TOKEN = 'token-usd-secreto';
    let clienteConToken;
    try {
      jest.isolateModules(() => {
        clienteConToken = require('../../../src/core/clients/billeteraClient');
      });
      const scopeConToken = billetera.billeteraUsdExiste(WALLET_USD_2);
      await clienteConToken.consultarCuenta(WALLET_USD_2, 'corr-usd-2');
      expect(scopeConToken.peticiones[0].headers['x-correlation-id']).toBe('corr-usd-2');
      expect(scopeConToken.peticiones[0].headers.authorization).toBe('Bearer token-usd-secreto');
    } finally {
      delete process.env.BILLETERA_USD_TOKEN;
    }
  });
});
