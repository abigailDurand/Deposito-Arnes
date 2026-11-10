'use strict';

const Decimal = require('decimal.js');

// UIF-T07: config simulado sin UIF_UMBRAL_PEN; solo queda el de USD (300.00, valor de prueba).
jest.mock('../../../src/config', () => {
  const real = jest.requireActual('../../../src/config');
  return { ...real, uif: { umbralPEN: null, umbralUSD: '300.00' } };
});

const modulo = require('../../../src/modules/alerta-uif');
const repository = require('../../../src/modules/alerta-uif/repository');

const CUENTA = '0011-0123-456789';
// SPEC-02 §4 v2.0: los dólares van a billeteras USD (UUID), no a cuentas 0011-….
const WALLET_USD = '22222222-2222-4222-8222-222222222222';
const ID = '7f1c2e9a-0b1d-4c5e-9f00-123456789abc';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function deposito(monto, { moneda = 'PEN', ...extra } = {}) {
  const m = new Decimal(monto);
  return {
    id: ID,
    cuentaDestino: CUENTA,
    monto: m,
    moneda,
    canal: 'VENTANILLA',
    referencia: null,
    usuarioId: 'usr-cajero-1',
    montoAcreditar: m,
    monedaAcreditar: moneda,
    estado: 'COMPLETADO',
    extensiones: {},
    ...extra,
  };
}

function contexto() {
  return {
    db: { query: jest.fn(async () => ({ rowCount: 1, rows: [] })) },
    logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
    correlationId: 'uif-unit',
    privado: {},
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('SPEC-12 alerta-uif: unitarias', () => {
  test('UIF-T07 sin UIF_UMBRAL_PEN (config simulado), 5000.00 PEN → 0 filas; logger.warn',
    async () => {
      const ctx = contexto();
      const insertar = jest.spyOn(repository, 'insertar');

      await expect(modulo.ejecutar(deposito('5000.00'), ctx)).resolves.toBeUndefined();

      expect(insertar).not.toHaveBeenCalled();
      expect(ctx.db.query).not.toHaveBeenCalled();
      expect(ctx.logger.warn).toHaveBeenCalledTimes(1);
      expect(ctx.logger.warn.mock.calls[0][0]).toEqual(
        expect.objectContaining({ depositoId: ID, moneda: 'PEN' }),
      );
      expect(ctx.logger.error).not.toHaveBeenCalled();
    });

  test('contrato SPEC-06: id, tipo post-proceso, ejecutar y sin leerExtension (UIF-R05)', () => {
    expect(modulo.id).toBe('alerta-uif');
    expect(modulo.tipo).toBe('post-proceso');
    expect(typeof modulo.ejecutar).toBe('function');
    expect(modulo.leerExtension).toBeUndefined();
  });

  test('UIF-R03 USD igual al umbral (300.00) → INSERT PENDIENTE con el umbral usado', async () => {
    const ctx = contexto();
    const dep = deposito('300.00', { moneda: 'USD', cuentaDestino: WALLET_USD });

    await modulo.ejecutar(dep, ctx);

    expect(ctx.db.query).toHaveBeenCalledTimes(1);
    const [sql, valores] = ctx.db.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO alertas_uif/);
    expect(sql).toMatch(/'PENDIENTE'/);
    expect(valores).toEqual([expect.any(String), ID, '300.00', 'USD', '300.00']);
    expect(valores[0]).toMatch(UUID_V4);
    expect(ctx.logger.warn).not.toHaveBeenCalled();
  });

  test('UIF-R03 USD 299.99 (bajo el umbral) → sin INSERT', async () => {
    const ctx = contexto();

    await modulo.ejecutar(deposito('299.99', { moneda: 'USD', cuentaDestino: WALLET_USD }), ctx);

    expect(ctx.db.query).not.toHaveBeenCalled();
    expect(ctx.logger.warn).not.toHaveBeenCalled();
  });

  test('UIF-R02 compara el monto depositado, no el convertido', async () => {
    const ctx = contexto();
    const dep = deposito('100.00', {
      moneda: 'USD',
      cuentaDestino: WALLET_USD,
      montoAcreditar: new Decimal('375.00'),
      monedaAcreditar: 'PEN',
    });

    await modulo.ejecutar(dep, ctx);

    expect(ctx.db.query).not.toHaveBeenCalled();
  });

  test('UIF-R05 no modifica el depósito', async () => {
    const ctx = contexto();
    const dep = deposito('300.00', { moneda: 'USD', cuentaDestino: WALLET_USD });
    const antes = JSON.stringify(dep);

    await modulo.ejecutar(dep, ctx);

    expect(JSON.stringify(dep)).toBe(antes);
  });

  test('UIF-R06 el INSERT falla → logger.error con depositoId y no relanza', async () => {
    const ctx = contexto();
    const error = Object.assign(new Error('fallo simulado'), { code: '23505' });
    ctx.db.query.mockRejectedValueOnce(error);

    const dep = deposito('300.00', { moneda: 'USD', cuentaDestino: WALLET_USD });
    await expect(modulo.ejecutar(dep, ctx))
      .resolves.toBeUndefined();

    expect(ctx.logger.error).toHaveBeenCalledTimes(1);
    expect(ctx.logger.error.mock.calls[0][0]).toEqual(
      expect.objectContaining({ depositoId: ID }),
    );
  });
});
