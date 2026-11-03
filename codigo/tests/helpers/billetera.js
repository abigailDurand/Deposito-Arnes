'use strict';

const nock = require('nock');

const config = require('../../src/config');

// SPEC-02 §4: datos de prueba compartidos.
const CUENTAS_PEN = {
  '0011-0123-456789': { estado: 'ACTIVA', moneda: 'PEN', titularId: 'usr-cliente-1' },
  '0011-0123-000002': { estado: 'ACTIVA', moneda: 'PEN', titularId: 'usr-cliente-2' },
  '0011-0123-000003': { estado: 'BLOQUEADA', moneda: 'PEN', titularId: 'usr-cliente-1' },
};

const WALLETS_USD = {
  '11111111-1111-4111-8111-111111111111': {
    user_id: 'usr-cliente-1',
    nombre: 'Cliente Uno',
    balance: '350.75',
    moneda: 'USD',
  },
  '22222222-2222-4222-8222-222222222222': {
    user_id: 'usr-cliente-2',
    nombre: 'Cliente Dos',
    balance: '100.00',
    moneda: 'USD',
  },
};

const CUENTA_PEN_POR_DEFECTO = '0011-0123-456789';
const WALLET_USD_POR_DEFECTO = '11111111-1111-4111-8111-111111111111';
const DEMORA_LENTA_MS = 6000;

function interceptar(baseUrl, metodo, path, responder, { demora = 0 } = {}) {
  const peticiones = [];
  const interceptor = nock(baseUrl)[metodo](path).delay(demora);
  const scope = interceptor.reply(function respuesta(_uri, body) {
    peticiones.push({ headers: { ...this.req.headers }, body });
    return responder(body);
  });
  scope.peticiones = peticiones;
  return scope;
}

// ==========================================
// Billetera PEN helpers
// ==========================================

function rutaPen(numero) {
  return `/api/v1/cuentas/${encodeURIComponent(numero)}`;
}

function cuentaActiva(numero = CUENTA_PEN_POR_DEFECTO) {
  const cuenta = CUENTAS_PEN[numero];
  if (!cuenta) throw new Error(`Cuenta PEN fuera de SPEC-02 §4: ${numero}`);
  return interceptar(config.billetera.url, 'get', rutaPen(numero), () => [200, { numero, ...cuenta }]);
}

function cuentaNoExiste(numero = CUENTA_PEN_POR_DEFECTO) {
  return interceptar(config.billetera.url, 'get', rutaPen(numero), () => [404, { mensaje: 'La cuenta no existe.' }]);
}

function consultaFalla(numero = CUENTA_PEN_POR_DEFECTO, { status = 500, demora = 0 } = {}) {
  return interceptar(config.billetera.url, 'get', rutaPen(numero), () => [status, { mensaje: 'Falla simulada.' }], { demora });
}

function acreditaOk(numero = CUENTA_PEN_POR_DEFECTO, { status = 201 } = {}) {
  return interceptar(config.billetera.url, 'post', `${rutaPen(numero)}/creditos`, (body) => [status, body]);
}

function acreditaFalla(numero = CUENTA_PEN_POR_DEFECTO, { status = 500 } = {}) {
  return interceptar(config.billetera.url, 'post', `${rutaPen(numero)}/creditos`, () => [status, { mensaje: 'Falla simulada.' }]);
}

function acreditaLento(numero = CUENTA_PEN_POR_DEFECTO, { demora = DEMORA_LENTA_MS } = {}) {
  return interceptar(config.billetera.url, 'post', `${rutaPen(numero)}/creditos`, (body) => [201, body], { demora });
}

function acreditaYaExiste(numero = CUENTA_PEN_POR_DEFECTO) {
  return interceptar(config.billetera.url, 'post', `${rutaPen(numero)}/creditos`, (body) => [
    409,
    { mensaje: 'Ese depositoId ya fue acreditado.', depositoId: body && body.depositoId },
  ]);
}

// ==========================================
// Billetera USD helpers
// ==========================================

function rutaUsd(id) {
  return `/api/v1/billetera/wallets/${encodeURIComponent(id)}`;
}

function billeteraUsdExiste(id = WALLET_USD_POR_DEFECTO) {
  const wallet = WALLETS_USD[id];
  if (!wallet) throw new Error(`Wallet USD fuera de SPEC-02 §4: ${id}`);
  return interceptar(config.billeteraUsd.url, 'get', rutaUsd(id), () => [200, { id, ...wallet }]);
}

function billeteraUsdNoExiste(id = WALLET_USD_POR_DEFECTO) {
  return interceptar(config.billeteraUsd.url, 'get', rutaUsd(id), () => [404, { mensaje: 'Billetera no encontrada' }]);
}

function consultaUsdFalla(id = WALLET_USD_POR_DEFECTO, { status = 500, demora = 0 } = {}) {
  return interceptar(config.billeteraUsd.url, 'get', rutaUsd(id), () => [status, { mensaje: 'Falla USD' }], { demora });
}

function acreditaUsdOk({ status = 201 } = {}) {
  return interceptar(config.billeteraUsd.url, 'post', '/api/v1/depositos/usd', (body) => [
    status,
    { ...body, estado: 'COMPLETADO' },
  ]);
}

function acreditaUsdReplay() {
  return interceptar(config.billeteraUsd.url, 'post', '/api/v1/depositos/usd', (body) => [
    200,
    { ...body, estado: 'COMPLETADO' },
  ]);
}

function acreditaUsdConflicto() {
  return interceptar(config.billeteraUsd.url, 'post', '/api/v1/depositos/usd', () => [
    409,
    { codigo: 'IDEMPOTENCY_CONFLICT', mensaje: 'Conflicto de clave' },
  ]);
}

function acreditaUsdPendiente() {
  return interceptar(config.billeteraUsd.url, 'post', '/api/v1/depositos/usd', (body) => [
    201,
    { ...body, estado: 'PENDIENTE' },
  ]);
}

function acreditaUsdFalla({ status = 500 } = {}) {
  return interceptar(config.billeteraUsd.url, 'post', '/api/v1/depositos/usd', () => [
    status,
    { mensaje: 'Falla simulada USD' },
  ]);
}

function acreditaUsdLento({ demora = DEMORA_LENTA_MS } = {}) {
  return interceptar(config.billeteraUsd.url, 'post', '/api/v1/depositos/usd', (body) => [
    201,
    { ...body, estado: 'COMPLETADO' },
  ], { demora });
}

module.exports = {
  CUENTAS: CUENTAS_PEN,
  WALLETS_USD,
  cuentaActiva,
  cuentaNoExiste,
  consultaFalla,
  acreditaOk,
  acreditaFalla,
  acreditaLento,
  acreditaYaExiste,
  billeteraUsdExiste,
  billeteraUsdNoExiste,
  consultaUsdFalla,
  acreditaUsdOk,
  acreditaUsdReplay,
  acreditaUsdConflicto,
  acreditaUsdPendiente,
  acreditaUsdFalla,
  acreditaUsdLento,
};
