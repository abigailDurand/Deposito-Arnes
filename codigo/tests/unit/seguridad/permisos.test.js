'use strict';

const { ErrorApp } = require('../../../src/core/errores');
const {
  verificarCanal,
  verificarTitular,
  esTitular,
  CANAL_POR_ROL,
} = require('../../../src/core/permisos');

// SPEC-02 §4: usuarios y cuentas de prueba.
const CLIENTE_1 = { id: 'usr-cliente-1', roles: ['CLIENTE'] };
const CLIENTE_2 = { id: 'usr-cliente-2', roles: ['CLIENTE'] };
const AGENTE_1 = { id: 'usr-agente-1', roles: ['AGENTE'] };
const CAJERO_1 = { id: 'usr-cajero-1', roles: ['CAJERO'] };

const CUENTA_PEN = { numero: '0011-0123-456789', estado: 'ACTIVA', moneda: 'PEN', titularId: 'usr-cliente-1' };
const CUENTA_PEN_2 = { numero: '0011-0123-000002', estado: 'ACTIVA', moneda: 'PEN', titularId: 'usr-cliente-2' };
const CUENTA_USD = { numero: '22222222-2222-4222-8222-222222222222', estado: 'ACTIVA', moneda: 'USD', titularId: 'usr-cliente-2' };

function capturar(fn) {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('se esperaba que lanzara');
}

function esperarSinPermiso(fn) {
  const err = capturar(fn);
  expect(err).toBeInstanceOf(ErrorApp);
  expect(err.codigo).toBe('SIN_PERMISO');
  expect(err.status).toBe(403);
}

describe('verificarCanal (SEG-R10)', () => {
  test('SEG-T07 verificarCanal con CLIENTE y canal VENTANILLA → lanza SIN_PERMISO', () => {
    esperarSinPermiso(() => verificarCanal(CLIENTE_1, 'VENTANILLA'));
  });

  test('cada rol pasa solo por su canal de la tabla', () => {
    expect(() => verificarCanal(CLIENTE_1, 'APP')).not.toThrow();
    expect(() => verificarCanal(AGENTE_1, 'AGENTE')).not.toThrow();
    expect(() => verificarCanal(CAJERO_1, 'VENTANILLA')).not.toThrow();

    esperarSinPermiso(() => verificarCanal(CLIENTE_1, 'AGENTE'));
    esperarSinPermiso(() => verificarCanal(AGENTE_1, 'APP'));
    esperarSinPermiso(() => verificarCanal(AGENTE_1, 'VENTANILLA'));
    esperarSinPermiso(() => verificarCanal(CAJERO_1, 'APP'));
    esperarSinPermiso(() => verificarCanal(CAJERO_1, 'AGENTE'));
  });

  test('canal desconocido, rol desconocido, sin roles o sin usuario → SIN_PERMISO', () => {
    esperarSinPermiso(() => verificarCanal(AGENTE_1, 'WEB'));
    esperarSinPermiso(() => verificarCanal({ id: 'usr-agente-1', roles: ['toString'] }, 'APP'));
    esperarSinPermiso(() => verificarCanal({ id: 'usr-agente-1', roles: [] }, 'AGENTE'));
    esperarSinPermiso(() => verificarCanal({ id: 'usr-agente-1' }, 'AGENTE'));
    esperarSinPermiso(() => verificarCanal(undefined, 'AGENTE'));
  });

  test('SEG-R13: con varios roles basta con que uno corresponda al canal', () => {
    const varios = { id: 'usr-cajero-1', roles: ['CLIENTE', 'CAJERO'] };
    expect(() => verificarCanal(varios, 'APP')).not.toThrow();
    expect(() => verificarCanal(varios, 'VENTANILLA')).not.toThrow();
    esperarSinPermiso(() => verificarCanal(varios, 'AGENTE'));
  });

  test('la tabla rol → canal es la de §4 y no se puede modificar', () => {
    expect(CANAL_POR_ROL).toEqual({ CLIENTE: 'APP', AGENTE: 'AGENTE', CAJERO: 'VENTANILLA' });
    expect(Object.isFrozen(CANAL_POR_ROL)).toBe(true);
  });
});

describe('verificarTitular (SEG-R11)', () => {
  test('CLIENTE por APP a su propia cuenta → pasa', () => {
    expect(() => verificarTitular(CLIENTE_1, 'APP', CUENTA_PEN)).not.toThrow();
    expect(() => verificarTitular(CLIENTE_2, 'APP', CUENTA_USD)).not.toThrow();
    expect(() => verificarTitular(CLIENTE_2, 'APP', CUENTA_PEN_2)).not.toThrow();
  });

  test('CLIENTE por APP a cuenta ajena o inexistente → SIN_PERMISO', () => {
    esperarSinPermiso(() => verificarTitular(CLIENTE_1, 'APP', CUENTA_USD));
    esperarSinPermiso(() => verificarTitular(CLIENTE_1, 'APP', CUENTA_PEN_2));
    esperarSinPermiso(() => verificarTitular(CLIENTE_2, 'APP', CUENTA_PEN));
    esperarSinPermiso(() => verificarTitular(CLIENTE_1, 'APP', null));
  });

  test('AGENTE y CAJERO pueden depositar a cualquier cuenta', () => {
    expect(() => verificarTitular(AGENTE_1, 'AGENTE', CUENTA_PEN)).not.toThrow();
    expect(() => verificarTitular(AGENTE_1, 'AGENTE', CUENTA_USD)).not.toThrow();
    expect(() => verificarTitular(AGENTE_1, 'AGENTE', CUENTA_PEN_2)).not.toThrow();
    expect(() => verificarTitular(CAJERO_1, 'VENTANILLA', CUENTA_PEN)).not.toThrow();
    expect(() => verificarTitular(CAJERO_1, 'VENTANILLA', CUENTA_USD)).not.toThrow();
  });
});

describe('esTitular (SEG-R12)', () => {
  test('true solo si la cuenta existe y su titularId es el id del usuario', () => {
    expect(esTitular(CLIENTE_1, CUENTA_PEN)).toBe(true);
    expect(esTitular(CLIENTE_2, CUENTA_USD)).toBe(true);
    expect(esTitular(CLIENTE_2, CUENTA_PEN_2)).toBe(true);
    expect(esTitular(CLIENTE_1, CUENTA_USD)).toBe(false);
    expect(esTitular(AGENTE_1, CUENTA_PEN)).toBe(false);
  });

  test('cuenta null/undefined, titularId null o usuario sin id → false (siempre booleano)', () => {
    expect(esTitular(CLIENTE_1, null)).toBe(false);
    expect(esTitular(CLIENTE_1, undefined)).toBe(false);
    expect(esTitular({ id: null, roles: ['CLIENTE'] }, { ...CUENTA_PEN, titularId: null })).toBe(false);
    expect(esTitular(undefined, CUENTA_PEN)).toBe(false);
  });
});
