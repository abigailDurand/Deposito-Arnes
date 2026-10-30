'use strict';

const nock = require('nock');
const Decimal = require('decimal.js');

const config = require('../../../src/config');
const { consultarCuenta, acreditar } = require('../../../src/core/clients/billeteraClient');
const { ErrorApp } = require('../../../src/core/errores');
const billetera = require('../../helpers/billetera');

const CUENTA = '0011-0123-456789';
const DEPOSITO_ID = '7f1c2e9a-0b1d-4c5e-9f00-123456789abc';
const CORRELATION_ID = 'abc-123';
const TIMEOUT_CORTO_MS = 100;
const DEMORA_MS = 1000;

function datosCredito(extra = {}) {
  return { depositoId: DEPOSITO_ID, cuenta: CUENTA, monto: '150.00', moneda: 'PEN', ...extra };
}

// INT-R03 sin esperar los 5 s reales: el mismo cliente, cargado en un registro aislado con
// BILLETERA_TIMEOUT_MS corto. config.js lee el entorno al cargarse; no se toca ningún archivo.
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

// El cliente aislado tiene su propia clase ErrorApp: se compara por nombre, código y status.
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

describe('consultarCuenta', () => {
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

  test('INT-T01 (cuentas BLOQUEADA y USD de §4) → devuelve su estado y moneda reales', async () => {
    const bloqueada = billetera.cuentaActiva('0011-0123-000003');
    const usd = billetera.cuentaActiva('0011-0123-000002');

    await expect(consultarCuenta('0011-0123-000003', CORRELATION_ID)).resolves.toEqual({
      numero: '0011-0123-000003', estado: 'BLOQUEADA', moneda: 'PEN', titularId: 'usr-cliente-1',
    });
    await expect(consultarCuenta('0011-0123-000002', CORRELATION_ID)).resolves.toEqual({
      numero: '0011-0123-000002', estado: 'ACTIVA', moneda: 'USD', titularId: 'usr-cliente-2',
    });
    expect(bloqueada.isDone()).toBe(true);
    expect(usd.isDone()).toBe(true);
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

  test('INT-R04 consultar con otro status (400) → BILLETERA_NO_DISPONIBLE', async () => {
    const scope = billetera.consultaFalla(CUENTA, { status: 400 });

    await esperaNoDisponible(consultarCuenta(CUENTA, CORRELATION_ID));
    expect(scope.isDone()).toBe(true);
  });

  test('INT-R04 consultar con 200 y cuerpo no objeto → BILLETERA_NO_DISPONIBLE', async () => {
    const scope = nock(config.billetera.url)
      .get(`/api/v1/cuentas/${CUENTA}`)
      .reply(200, 'texto');

    await esperaNoDisponible(consultarCuenta(CUENTA, CORRELATION_ID));
    expect(scope.isDone()).toBe(true);
  });

  test('INT-R04 error de red al consultar → BILLETERA_NO_DISPONIBLE', async () => {
    const scope = nock(config.billetera.url)
      .get(`/api/v1/cuentas/${CUENTA}`)
      .replyWithError({ code: 'ECONNREFUSED', message: 'conexión rechazada' });

    await esperaNoDisponible(consultarCuenta(CUENTA, CORRELATION_ID));
    expect(scope.isDone()).toBe(true);
  });
});

describe('acreditar', () => {
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

  test('INT-R05 acreditar con 200 → resuelve sin valor', async () => {
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

describe('cabeceras', () => {
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
});

describe('body de acreditar', () => {
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

  test('INT-R07 montos límite "0.01" y Decimal("10.5") → "0.01" y "10.50"; concepto DEPOSITO', async () => {
    const pen = billetera.acreditaOk(CUENTA);
    const usd = billetera.acreditaOk('0011-0123-000002');

    await acreditar(datosCredito({ monto: '0.01' }), CORRELATION_ID);
    await acreditar(
      datosCredito({ cuenta: '0011-0123-000002', monto: new Decimal('10.5'), moneda: 'USD' }),
      CORRELATION_ID,
    );

    expect(pen.peticiones[0].body).toMatchObject({ monto: '0.01', moneda: 'PEN', concepto: 'DEPOSITO' });
    expect(usd.peticiones[0].body).toMatchObject({ monto: '10.50', moneda: 'USD', concepto: 'DEPOSITO' });
  });
});
