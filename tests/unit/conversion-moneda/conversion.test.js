'use strict';

const Decimal = require('decimal.js');

const service = require('../../../src/modules/conversion-moneda/service');
const modulo = require('../../../src/modules/conversion-moneda');

const CUENTA = '0011-0123-456789';
const ID = '7f1c2e9a-0b1d-4c5e-9f00-123456789abc';
const TIPO_USD_PEN = { id: '00000000-0000-0000-0000-000000000001', valor: '3.7500' };

function deposito(monto, moneda, extra = {}) {
  const m = new Decimal(monto);
  return {
    id: ID,
    cuentaDestino: CUENTA,
    monto: m,
    moneda,
    canal: 'APP',
    referencia: null,
    usuarioId: 'usr-cliente-1',
    montoAcreditar: m,
    monedaAcreditar: moneda,
    extensiones: {},
    ...extra,
  };
}

// `db` falso: devuelve `filas` a cualquier SELECT y guarda las llamadas.
function dbFalso(filas = []) {
  return { query: jest.fn(async () => ({ rows: filas })) };
}

function contexto(db, monedaCuenta = 'PEN') {
  return {
    usuario: { id: 'usr-cliente-1', roles: ['CLIENTE'] },
    cuenta: { numero: CUENTA, estado: 'ACTIVA', moneda: monedaCuenta, titularId: 'usr-cliente-1' },
    correlationId: 'cm-unit',
    db,
    privado: {},
  };
}

describe('SPEC-11 conversion-moneda: casos unitarios', () => {
  test('CM-T06 convertir("10.01", "3.7555") → "37.59"; convertir("1.00", "3.7550") → "3.76"',
    () => {
      expect(service.convertir('10.01', '3.7555')).toBe('37.59');
      expect(service.convertir('1.00', '3.7550')).toBe('3.76');
    });
});

describe('SPEC-11 conversion-moneda: reglas', () => {
  test('CM-R04 convertir acepta Decimal, redondea HALF_UP a 2 decimales y devuelve string', () => {
    expect(service.convertir(new Decimal('100.00'), '3.7500')).toBe('375.00');
    expect(service.convertir('0.01', '0.2600')).toBe('0.00');
    expect(service.convertir('0.02', '0.2500')).toBe('0.01');
    expect(service.convertir('99999999.99', '3.7555')).toBe('375549999.96');
  });

  test('CM-R01 misma moneda que la cuenta → el mismo depósito, sin consultar la BD', async () => {
    const db = dbFalso([TIPO_USD_PEN]);
    const ctx = contexto(db);
    const original = deposito('150.00', 'PEN');

    const resultado = await modulo.ejecutar(original, ctx);

    expect(resultado).toBe(original);
    expect(resultado.extensiones).toEqual({});
    expect(db.query).not.toHaveBeenCalled();
    expect(ctx.privado).toEqual({});
  });

  test('CM-R02/CM-R03 busca la fila origen = moneda del depósito, destino = moneda de la cuenta',
    async () => {
      const db = dbFalso([TIPO_USD_PEN]);

      await modulo.ejecutar(deposito('100.00', 'USD'), contexto(db, 'PEN'));

      expect(db.query).toHaveBeenCalledTimes(1);
      const [sql, params] = db.query.mock.calls[0];
      expect(params).toEqual(['USD', 'PEN']);
      expect(sql).toMatch(/vigente_desde <= now\(\)/);
      expect(sql).toMatch(/ORDER BY vigente_desde DESC/);
    });

  test('CM-R05 con tipo de cambio → montoAcreditar, monedaAcreditar, extensión y tipoCambioId',
    async () => {
      const ctx = contexto(dbFalso([TIPO_USD_PEN]));
      const original = deposito('100.00', 'USD');

      const resultado = await modulo.ejecutar(original, ctx);

      expect(Decimal.isDecimal(resultado.montoAcreditar)).toBe(true);
      expect(resultado.montoAcreditar.toFixed(2)).toBe('375.00');
      expect(resultado.monedaAcreditar).toBe('PEN');
      expect(resultado.monto.toFixed(2)).toBe('100.00');
      expect(resultado.moneda).toBe('USD');
      expect(resultado.extensiones).toEqual({
        'conversion-moneda': {
          monedaCuenta: 'PEN', tipoCambio: '3.7500', montoAcreditado: '375.00',
        },
      });
      expect(ctx.privado.tipoCambioId).toBe(TIPO_USD_PEN.id);
    });

  test('CM-R05 PEN → USD con 0.26: 150.00 PEN → 39.00 USD', async () => {
    const ctx = contexto(
      dbFalso([{ id: '00000000-0000-0000-0000-000000000002', valor: '0.2600' }]),
      'USD',
    );

    const resultado = await modulo.ejecutar(deposito('150.00', 'PEN'), ctx);

    expect(resultado.montoAcreditar.toFixed(2)).toBe('39.00');
    expect(resultado.monedaAcreditar).toBe('USD');
    expect(resultado.extensiones['conversion-moneda'])
      .toEqual({ monedaCuenta: 'USD', tipoCambio: '0.2600', montoAcreditado: '39.00' });
  });

  test('CM-R06 sin tipo de cambio → el mismo depósito, sin lanzar y sin tipoCambioId', async () => {
    const ctx = contexto(dbFalso([]));
    const original = deposito('100.00', 'USD');

    const resultado = await modulo.ejecutar(original, ctx);

    expect(resultado).toBe(original);
    expect(resultado.monedaAcreditar).toBe('USD');
    expect(resultado.extensiones).toEqual({});
    expect(ctx.privado.tipoCambioId).toBeUndefined();
  });

  test('CM-R07 persistir con extensión → INSERT con la tx recibida (no con contexto.db)',
    async () => {
      const ctx = contexto(dbFalso([TIPO_USD_PEN]));
      const convertido = await modulo.ejecutar(deposito('100.00', 'USD'), ctx);
      const tx = { query: jest.fn(async () => ({ rows: [] })) };

      await modulo.persistir(convertido, tx, ctx);

      expect(tx.query).toHaveBeenCalledTimes(1);
      const [sql, params] = tx.query.mock.calls[0];
      expect(sql).toMatch(/INSERT INTO conversiones_deposito/);
      expect(params).toEqual([ID, TIPO_USD_PEN.id, 'PEN', '3.7500', '375.00']);
      expect(ctx.db.query).toHaveBeenCalledTimes(1);
    });

  test('CM-R07 persistir sin extensión → no hace nada', async () => {
    const tx = { query: jest.fn() };

    await modulo.persistir(deposito('150.00', 'PEN'), tx, contexto(dbFalso()));

    expect(tx.query).not.toHaveBeenCalled();
  });

  test('CM-R08 leerExtension → bloque de §5 desde la fila; sin fila → null', async () => {
    const conFila = contexto(dbFalso([
      { moneda_cuenta: 'PEN', tipo_cambio: '3.7500', monto_final: '375.00' },
    ]));
    const sinFila = contexto(dbFalso([]));

    const extension = await modulo.leerExtension(ID, conFila);
    const nada = await modulo.leerExtension(ID, sinFila);

    expect(extension).toEqual({
      monedaCuenta: 'PEN', tipoCambio: '3.7500', montoAcreditado: '375.00',
    });
    expect(conFila.db.query.mock.calls[0][1]).toEqual([ID]);
    expect(nada).toBeNull();
  });

  test('index.js cumple el contrato de transformador de SPEC-06 §4', () => {
    expect(modulo.id).toBe('conversion-moneda');
    expect(modulo.tipo).toBe('transformador');
    expect(typeof modulo.ejecutar).toBe('function');
    expect(typeof modulo.persistir).toBe('function');
    expect(typeof modulo.leerExtension).toBe('function');
  });
});
