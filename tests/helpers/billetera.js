'use strict';

const crypto = require('node:crypto');

const nock = require('nock');

const config = require('../../src/config');

// SPEC-02 §4: datos de prueba compartidos. Ninguna prueba inventa otros.
const CUENTAS = {
  '0011-0123-456789': { estado: 'ACTIVA', moneda: 'PEN', titularId: 'usr-cliente-1' },
  '0011-0123-000002': { estado: 'ACTIVA', moneda: 'PEN', titularId: 'usr-cliente-2' },
  '0011-0123-000003': { estado: 'BLOQUEADA', moneda: 'PEN', titularId: 'usr-cliente-1' },
};
// nombre y balance van en la respuesta (contrato Wallet) para comprobar que se descartan (INT-R04).
// Los de 11111111-… son los del ejemplo de §5; el resto, nombre null (nullable) y saldo 0.00.
const BILLETERAS_USD = {
  '11111111-1111-4111-8111-111111111111': {
    user_id: 'usr-cliente-1', nombre: 'Cliente Uno', balance: '350.75', moneda: 'USD',
  },
  '22222222-2222-4222-8222-222222222222': {
    user_id: 'usr-cliente-2', nombre: null, balance: '0.00', moneda: 'USD',
  },
};
const CUENTA_POR_DEFECTO = '0011-0123-456789';
const BILLETERA_USD_POR_DEFECTO = '11111111-1111-4111-8111-111111111111';
const RUTA_DEPOSITOS_USD = '/api/v1/depositos/usd';
// Igual que la cuenta y la billetera lentas del mock (§4): supera BILLETERA_TIMEOUT_MS (def. 5000).
const DEMORA_LENTA_MS = 6000;

function cuentaDePrueba(numero) {
  const cuenta = CUENTAS[numero];
  if (!cuenta) throw new Error(`Cuenta fuera de los datos de prueba de SPEC-02 §4: ${numero}`);
  return { numero, ...cuenta };
}

function billeteraUsdDePrueba(id) {
  const billetera = BILLETERAS_USD[id];
  if (!billetera) throw new Error(`Billetera USD fuera de los datos de SPEC-02 §4: ${id}`);
  return { id, ...billetera };
}

function ruta(numero) {
  return `/api/v1/cuentas/${encodeURIComponent(numero)}`;
}

function rutaUsd(id) {
  return `/api/v1/billetera/wallets/${encodeURIComponent(id)}`;
}

// El scope de nock se devuelve con `peticiones`: cada llamada recibida como { headers, body },
// para comprobar cabeceras (INT-T06, INT-T10, INT-T15), el body (INT-T07, INT-T13) y cuántas
// hubo (INT-T05, INT-T12).
function interceptar(url, metodo, path, responder, { demora = 0 } = {}) {
  const peticiones = [];
  const interceptor = nock(url)[metodo](path).delay(demora);
  const scope = interceptor.reply(function respuesta(_uri, body) {
    peticiones.push({ headers: { ...this.req.headers }, body });
    return responder(body);
  });
  scope.peticiones = peticiones;
  return scope;
}

function pen(metodo, path, responder, opciones) {
  return interceptar(config.billetera.url, metodo, path, responder, opciones);
}

function usd(metodo, path, responder, opciones) {
  return interceptar(config.billeteraUsd.url, metodo, path, responder, opciones);
}

// Formato ApiError de Billetera USD.
function errorUsd(status, code, message) {
  return {
    status,
    code,
    message,
    correlation_id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  };
}

// Deposito de Billetera USD (contrato) armado con el body recibido.
function depositoUsd(body, estado) {
  const ahora = new Date().toISOString();
  return {
    deposito_id: crypto.randomUUID(),
    cliente_id: body && body.cliente_id,
    cuenta_destino_id: body && body.cuenta_destino_id,
    monto: body && body.monto,
    moneda: 'USD',
    estado,
    movimiento_saldo_id: null,
    creado_en: ahora,
    completado_en: estado === 'COMPLETADO' ? ahora : null,
  };
}

// ── Billetera PEN ──

// GET 200 con la cuenta de §4 (incluida la BLOQUEADA, con su estado real).
function cuentaActiva(numero = CUENTA_POR_DEFECTO) {
  const cuenta = cuentaDePrueba(numero);
  return pen('get', ruta(numero), () => [200, cuenta]);
}

function cuentaNoExiste(numero = CUENTA_POR_DEFECTO) {
  return pen('get', ruta(numero), () => [404, { mensaje: 'La cuenta no existe.' }]);
}

// GET con `status` (def. 500), o sin responder a tiempo si se pasa `demora` en ms.
function consultaFalla(numero = CUENTA_POR_DEFECTO, { status = 500, demora = 0 } = {}) {
  return pen('get', ruta(numero), () => [status, { mensaje: 'Falla simulada.' }], { demora });
}

// POST 201 (o el `status` de éxito que se pida: 200).
function acreditaOk(numero = CUENTA_POR_DEFECTO, { status = 201 } = {}) {
  return pen('post', `${ruta(numero)}/creditos`, (body) => [status, body]);
}

function acreditaFalla(numero = CUENTA_POR_DEFECTO, { status = 500 } = {}) {
  return pen('post', `${ruta(numero)}/creditos`, () => [status, { mensaje: 'Falla simulada.' }]);
}

// POST que responde 201 tras `demora` ms (def. 6000, la cuenta lenta de §4): provoca el timeout.
function acreditaLento(numero = CUENTA_POR_DEFECTO, { demora = DEMORA_LENTA_MS } = {}) {
  return pen('post', `${ruta(numero)}/creditos`, (body) => [201, body], { demora });
}

// POST 409: ese depositoId ya se acreditó (INT-R09).
function acreditaYaExiste(numero = CUENTA_POR_DEFECTO) {
  return pen('post', `${ruta(numero)}/creditos`, (body) => [
    409,
    { mensaje: 'Ese depositoId ya fue acreditado.', depositoId: body && body.depositoId },
  ]);
}

// ── Billetera USD ──

// GET 200 con la billetera de §4 (con nombre y balance, que el cliente debe descartar).
function billeteraUsdExiste(id = BILLETERA_USD_POR_DEFECTO) {
  const billetera = billeteraUsdDePrueba(id);
  return usd('get', rutaUsd(id), () => [200, billetera]);
}

function billeteraUsdNoExiste(id = BILLETERA_USD_POR_DEFECTO) {
  return usd('get', rutaUsd(id), () => [404, errorUsd(404, 'NOT_FOUND', 'billetera no existe')]);
}

// GET con `status` (def. 500), o sin responder a tiempo si se pasa `demora` en ms.
function consultaUsdFalla(id = BILLETERA_USD_POR_DEFECTO, { status = 500, demora = 0 } = {}) {
  return usd('get', rutaUsd(id), () => [status, errorUsd(status, 'INTERNAL_ERROR', 'falla')], {
    demora,
  });
}

// POST 201 con estado COMPLETADO (depósito nuevo).
function acreditaUsdOk() {
  return usd('post', RUTA_DEPOSITOS_USD, (body) => [201, depositoUsd(body, 'COMPLETADO')]);
}

// POST 200 con estado COMPLETADO: replay de la misma Idempotency-Key (INT-R06).
function acreditaUsdReplay() {
  return usd('post', RUTA_DEPOSITOS_USD, (body) => [200, depositoUsd(body, 'COMPLETADO')]);
}

// POST 409 IDEMPOTENCY_CONFLICT: misma clave con datos distintos (INT-R05).
function acreditaUsdConflicto() {
  return usd('post', RUTA_DEPOSITOS_USD, () => [
    409,
    errorUsd(409, 'IDEMPOTENCY_CONFLICT', 'misma clave con datos diferentes'),
  ]);
}

// POST 201 con estado PENDIENTE (INT-R05: no cuenta como acreditado).
function acreditaUsdPendiente() {
  return usd('post', RUTA_DEPOSITOS_USD, (body) => [201, depositoUsd(body, 'PENDIENTE')]);
}

function acreditaUsdFalla({ status = 500 } = {}) {
  return usd('post', RUTA_DEPOSITOS_USD, () => [status, errorUsd(status, 'ERROR', 'falla')]);
}

// POST que responde 201 COMPLETADO tras `demora` ms (def. 6000, la billetera lenta de §4).
function acreditaUsdLento({ demora = DEMORA_LENTA_MS } = {}) {
  return usd('post', RUTA_DEPOSITOS_USD, (body) => [201, depositoUsd(body, 'COMPLETADO')], {
    demora,
  });
}

module.exports = {
  CUENTAS,
  BILLETERAS_USD,
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
