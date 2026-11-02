'use strict';

const Decimal = require('decimal.js');

const { ErrorApp, catalogo, registrarErrores } = require('../../../src/core/errores');

// LC-T04: buscarLimite se simula con jest.mock. Por defecto delega en la implementación real
// (que consulta el `db` falso con la tabla de ejemplo de SPEC-10 §4).
jest.mock('../../../src/modules/limites-por-canal/repository', () => {
  const real = jest.requireActual('../../../src/modules/limites-por-canal/repository');
  return { buscarLimite: jest.fn(real.buscarLimite) };
});

const repository = require('../../../src/modules/limites-por-canal/repository');
const modulo = require('../../../src/modules/limites-por-canal');

const { buscarLimite: buscarLimiteReal } = jest.requireActual(
  '../../../src/modules/limites-por-canal/repository',
);

// SPEC-10 §4: datos de EJEMPLO de limites_canal. pg entrega NUMERIC como string.
const TABLA = [
  { canal: 'AGENTE', moneda: 'PEN', monto_maximo: '2000.00' },
  { canal: 'AGENTE', moneda: 'USD', monto_maximo: '500.00' },
  { canal: 'APP', moneda: 'PEN', monto_maximo: '5000.00' },
  { canal: 'APP', moneda: 'USD', monto_maximo: '1500.00' },
  { canal: 'VENTANILLA', moneda: 'PEN', monto_maximo: '50000.00' },
  { canal: 'VENTANILLA', moneda: 'USD', monto_maximo: '15000.00' },
];

const CUENTA = '0011-0123-456789';
const ID = '7f1c2e9a-0b1d-4c5e-9f00-123456789abc';

// `db` falso: responde al SELECT parametrizado de buscarLimite con la tabla de ejemplo.
function dbFalso(tabla = TABLA) {
  return {
    query: jest.fn(async (_sql, [canal, moneda]) => ({
      rows: tabla
        .filter((f) => f.canal === canal && f.moneda === moneda)
        .map(({ monto_maximo }) => ({ monto_maximo })),
    })),
  };
}

function deposito(monto, { canal = 'AGENTE', moneda = 'PEN', ...extra } = {}) {
  const m = new Decimal(monto);
  return {
    id: ID,
    cuentaDestino: CUENTA,
    monto: m,
    moneda,
    canal,
    referencia: null,
    usuarioId: 'usr-agente-1',
    montoAcreditar: m,
    monedaAcreditar: moneda,
    extensiones: {},
    ...extra,
  };
}

function contexto(db = dbFalso()) {
  return {
    usuario: { id: 'usr-agente-1', roles: ['AGENTE'] },
    cuenta: { numero: CUENTA, estado: 'ACTIVA', moneda: 'PEN', titularId: 'usr-cliente-1' },
    correlationId: 'lc-unit',
    db,
    logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
    privado: {},
  };
}

async function errorDe(promesa) {
  try {
    await promesa;
  } catch (e) {
    return e;
  }
  throw new Error('se esperaba que lanzara');
}

beforeAll(() => {
  // El cargador registra `errores` al activar la feature (PIP-R10); aquí se hace a mano.
  if (!Object.hasOwn(catalogo, 'LIMITE_CANAL_EXCEDIDO')) registrarErrores(modulo.errores);
});

beforeEach(() => {
  repository.buscarLimite.mockReset();
  repository.buscarLimite.mockImplementation(buscarLimiteReal);
});

describe('SPEC-10 limites-por-canal: casos', () => {
  test('LC-T01 AGENTE 1500.00 PEN → no lanza', async () => {
    const ctx = contexto();

    await expect(modulo.ejecutar(deposito('1500.00'), ctx)).resolves.toBeUndefined();

    expect(repository.buscarLimite).toHaveBeenCalledWith(ctx.db, 'AGENTE', 'PEN');
    expect(ctx.logger.warn).not.toHaveBeenCalled();
  });

  test('LC-T02 AGENTE 2000.00 PEN → no lanza (igual al límite)', async () => {
    const ctx = contexto();

    await expect(modulo.ejecutar(deposito('2000.00'), ctx)).resolves.toBeUndefined();

    expect(ctx.db.query).toHaveBeenCalledTimes(1);
    expect(ctx.logger.warn).not.toHaveBeenCalled();
  });

  test('LC-T03 AGENTE 2000.01 PEN → lanza LIMITE_CANAL_EXCEDIDO', async () => {
    const ctx = contexto();

    const err = await errorDe(modulo.ejecutar(deposito('2000.01'), ctx));

    expect(err).toBeInstanceOf(ErrorApp);
    expect(err.codigo).toBe('LIMITE_CANAL_EXCEDIDO');
    expect(err.status).toBe(422);
    expect(err.mensaje).toBe('El monto supera el máximo permitido para el canal.');
  });

  test('LC-T04 buscarLimite simulado con jest.mock devuelve null → no lanza; logger.warn '
    + 'llamado', async () => {
    repository.buscarLimite.mockResolvedValue(null);
    const ctx = contexto();

    await expect(modulo.ejecutar(deposito('999999.99'), ctx)).resolves.toBeUndefined();

    expect(repository.buscarLimite).toHaveBeenCalledWith(ctx.db, 'AGENTE', 'PEN');
    expect(ctx.db.query).not.toHaveBeenCalled();
    expect(ctx.logger.warn).toHaveBeenCalledTimes(1);
    // LC-R03: el warn lleva canal y moneda.
    expect(ctx.logger.warn.mock.calls[0][0]).toEqual(
      expect.objectContaining({ canal: 'AGENTE', moneda: 'PEN' }),
    );
  });
});

describe('SPEC-10 limites-por-canal: reglas', () => {
  test('contrato SPEC-06: { id, tipo: validador, errores, ejecutar } y error 422', () => {
    expect(modulo).toEqual({
      id: 'limites-por-canal',
      tipo: 'validador',
      errores: {
        LIMITE_CANAL_EXCEDIDO: {
          status: 422,
          mensaje: 'El monto supera el máximo permitido para el canal.',
        },
      },
      ejecutar: expect.any(Function),
    });
  });

  test('LC-R01 busca por canal y moneda DEL depósito, no por monedaAcreditar', async () => {
    const ctx = contexto();
    // 600.00 USD supera AGENTE/USD (500.00) pero no AGENTE/PEN (2000.00).
    const d = deposito('600.00', { moneda: 'USD', monedaAcreditar: 'PEN' });

    const err = await errorDe(modulo.ejecutar(d, ctx));

    expect(err.codigo).toBe('LIMITE_CANAL_EXCEDIDO');
    expect(repository.buscarLimite).toHaveBeenCalledWith(ctx.db, 'AGENTE', 'USD');
  });

  test('LC-R01 cada canal usa su propio límite (VENTANILLA 2500.00 PEN → no lanza)', async () => {
    const ctx = contexto();

    await expect(modulo.ejecutar(deposito('2500.00', { canal: 'VENTANILLA' }), ctx))
      .resolves.toBeUndefined();
    const err = await errorDe(modulo.ejecutar(deposito('5000.01', { canal: 'APP' }), ctx));
    expect(err.codigo).toBe('LIMITE_CANAL_EXCEDIDO');
  });

  test('LC-R02 un centavo sobre el límite USD (AGENTE 500.01 USD) → lanza', async () => {
    const ctx = contexto();

    await expect(modulo.ejecutar(deposito('500.00', { moneda: 'USD' }), ctx))
      .resolves.toBeUndefined();
    const err = await errorDe(modulo.ejecutar(deposito('500.01', { moneda: 'USD' }), ctx));
    expect(err.codigo).toBe('LIMITE_CANAL_EXCEDIDO');
  });

  test('LC-R04 compara con Decimal: montos que Number no distingue del límite', async () => {
    // Como Number, ambos valen 9007199254740992 (no sería "mayor"); con Decimal sí lo es.
    const tabla = [{ canal: 'AGENTE', moneda: 'PEN', monto_maximo: '9007199254740993.00' }];
    const ctx = contexto(dbFalso(tabla));

    const err = await errorDe(modulo.ejecutar(deposito('9007199254740993.01'), ctx));

    expect(err.codigo).toBe('LIMITE_CANAL_EXCEDIDO');
  });

  test('LC-R04 el límite sale de la tabla: cambiarlo cambia el resultado', async () => {
    const tabla = [{ canal: 'AGENTE', moneda: 'PEN', monto_maximo: '1000.00' }];
    const ctx = contexto(dbFalso(tabla));

    const err = await errorDe(modulo.ejecutar(deposito('1500.00'), ctx));

    expect(err.codigo).toBe('LIMITE_CANAL_EXCEDIDO');
  });

  test('LC-R05 no modifica deposito ni devuelve nada', async () => {
    const ctx = contexto();
    const d = deposito('1500.00');
    const copia = { ...d, monto: d.monto.toString(), montoAcreditar: d.montoAcreditar.toString() };

    const resultado = await modulo.ejecutar(d, ctx);

    expect(resultado).toBeUndefined();
    expect({ ...d, monto: d.monto.toString(), montoAcreditar: d.montoAcreditar.toString() })
      .toEqual(copia);
    expect(d.monto).toBeInstanceOf(Decimal);
  });

  test('repository.buscarLimite → Decimal con el máximo, o null sin fila; SQL '
    + 'parametrizado', async () => {
    const db = dbFalso();

    const maximo = await buscarLimiteReal(db, 'AGENTE', 'PEN');
    expect(maximo).toBeInstanceOf(Decimal);
    expect(maximo.toFixed(2)).toBe('2000.00');

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/limites_canal/);
    expect(sql).toMatch(/\$1/);
    expect(sql).toMatch(/\$2/);
    expect(sql).not.toMatch(/AGENTE|PEN/);
    expect(params).toEqual(['AGENTE', 'PEN']);

    expect(await buscarLimiteReal(dbFalso([]), 'AGENTE', 'PEN')).toBeNull();
  });
});
