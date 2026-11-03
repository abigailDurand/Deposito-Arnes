'use strict';

const { pool, enTransaccion } = require('../../../src/core/db');
const { limpiar, cerrar, pool: poolPrueba } = require('../../helpers/db');
const { logger } = require('../../../src/core/logger');
const { aJson } = require('../../../src/core/depositoMapper');

const INSERTAR = `INSERT INTO depositos
  (id, cuenta_destino, monto, moneda, monto_acreditar, moneda_acreditar, canal, referencia, estado, usuario_id)
  VALUES ($1, $2, $3, $4, $3, $4, $5, $6, $7, $8)`;

const ID_1 = '7f1c2e9a-0b1d-4c5e-9f00-123456789abc';
const ID_2 = '7f1c2e9a-0b1d-4c5e-9f00-123456789abd';

function valores(id, monto = '150.00') {
  return [id, '0011-0123-456789', monto, 'PEN', 'AGENTE', null, 'PENDIENTE', 'usr-agente-1'];
}

async function contarDepositos() {
  const { rows } = await poolPrueba.query('SELECT count(*) AS n FROM depositos');
  return rows[0].n;
}

beforeEach(limpiar);

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await pool.end();
  await cerrar();
});

describe('enTransaccion', () => {
  test('DOM-T08 enTransaccion cuya función lanza → ninguna fila insertada', async () => {
    const error = new Error('fallo a mitad de la transacción');

    await expect(enTransaccion(async (tx) => {
      await tx.query(INSERTAR, valores(ID_1));
      await tx.query(INSERTAR, valores(ID_2));
      throw error;
    })).rejects.toBe(error);

    expect(await contarDepositos()).toBe('0');
  });

  test('DOM-T08 función que no lanza → COMMIT y devuelve su resultado', async () => {
    const resultado = await enTransaccion(async (tx) => {
      await tx.query(INSERTAR, valores(ID_1));
      return 'ok';
    });

    expect(resultado).toBe('ok');
    expect(await contarDepositos()).toBe('1');
  });

  test('DOM-T08 error de BD dentro de la transacción (CHECK monto > 0) → rollback de lo anterior', async () => {
    await expect(enTransaccion(async (tx) => {
      await tx.query(INSERTAR, valores(ID_1));
      await tx.query(INSERTAR, valores(ID_2, '0'));
    })).rejects.toThrow();

    expect(await contarDepositos()).toBe('0');
  });

  test('DOM-T08 si el ROLLBACK también falla → relanza el error original, lo loguea y el pool sigue usable', async () => {
    const espiaLog = jest.spyOn(logger, 'error').mockImplementation(() => {});
    const original = new Error('error original');

    await expect(enTransaccion(async (tx) => {
      const queryReal = tx.query.bind(tx);
      jest.spyOn(tx, 'query').mockImplementation((sql, ...resto) => {
        if (sql === 'ROLLBACK') return Promise.reject(new Error('rollback roto'));
        return queryReal(sql, ...resto);
      });
      throw original;
    })).rejects.toBe(original);

    expect(espiaLog).toHaveBeenCalled();
    expect(await enTransaccion(async () => 'sigue')).toBe('sigue');
  });

  test('DOM-R10 fila real de depositos pasada por aJson → forma de §5', async () => {
    await poolPrueba.query(INSERTAR, valores(ID_1));
    const { rows } = await poolPrueba.query('SELECT * FROM depositos');

    expect(aJson(rows[0], {})).toEqual({
      id: ID_1,
      cuentaDestino: '0011-0123-456789',
      monto: '150.00',
      moneda: 'PEN',
      canal: 'AGENTE',
      referencia: null,
      estado: 'PENDIENTE',
      creadoEn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      actualizadoEn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      extensiones: {},
    });
  });
});
