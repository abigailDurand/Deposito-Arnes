'use strict';

const nock = require('nock');

const config = require('../../src/config');

// SPEC-02 §4: datos de prueba compartidos. Ninguna prueba inventa otros.
const CUENTAS = {
  '0011-0123-456789': { estado: 'ACTIVA', moneda: 'PEN', titularId: 'usr-cliente-1' },
  '0011-0123-000002': { estado: 'ACTIVA', moneda: 'USD', titularId: 'usr-cliente-2' },
  '0011-0123-000003': { estado: 'BLOQUEADA', moneda: 'PEN', titularId: 'usr-cliente-1' },
};
const CUENTA_POR_DEFECTO = '0011-0123-456789';
// Igual que la cuenta lenta del mock (§4): supera BILLETERA_TIMEOUT_MS por defecto (5000).
const DEMORA_LENTA_MS = 6000;

function cuentaDePrueba(numero) {
  const cuenta = CUENTAS[numero];
  if (!cuenta) throw new Error(`Cuenta fuera de los datos de prueba de SPEC-02 §4: ${numero}`);
  return { numero, ...cuenta };
}

function ruta(numero) {
  return `/api/v1/cuentas/${encodeURIComponent(numero)}`;
}

// El scope de nock se devuelve con `peticiones`: cada llamada recibida como
// { headers, body }, para comprobar headers (INT-T06), el body (INT-T07) y cuántas hubo (INT-T05).
function interceptar(metodo, path, responder, { demora = 0 } = {}) {
  const peticiones = [];
  const interceptor = nock(config.billetera.url)[metodo](path).delay(demora);
  const scope = interceptor.reply(function respuesta(_uri, body) {
    peticiones.push({ headers: { ...this.req.headers }, body });
    return responder(body);
  });
  scope.peticiones = peticiones;
  return scope;
}

// GET 200 con la cuenta de §4 (incluida la BLOQUEADA, con su estado real).
function cuentaActiva(numero = CUENTA_POR_DEFECTO) {
  const cuenta = cuentaDePrueba(numero);
  return interceptar('get', ruta(numero), () => [200, cuenta]);
}

function cuentaNoExiste(numero = CUENTA_POR_DEFECTO) {
  return interceptar('get', ruta(numero), () => [404, { mensaje: 'La cuenta no existe.' }]);
}

// GET con `status` (def. 500), o sin responder a tiempo si se pasa `demora` en ms.
function consultaFalla(numero = CUENTA_POR_DEFECTO, { status = 500, demora = 0 } = {}) {
  return interceptar('get', ruta(numero), () => [status, { mensaje: 'Falla simulada.' }], {
    demora,
  });
}

// POST 201 (o el `status` de éxito que se pida: 200).
function acreditaOk(numero = CUENTA_POR_DEFECTO, { status = 201 } = {}) {
  return interceptar('post', `${ruta(numero)}/creditos`, (body) => [status, body]);
}

function acreditaFalla(numero = CUENTA_POR_DEFECTO, { status = 500 } = {}) {
  return interceptar('post', `${ruta(numero)}/creditos`, () => [
    status,
    { mensaje: 'Falla simulada.' },
  ]);
}

// POST que responde 201 tras `demora` ms (def. 6000, la cuenta lenta de §4): provoca el timeout.
function acreditaLento(numero = CUENTA_POR_DEFECTO, { demora = DEMORA_LENTA_MS } = {}) {
  return interceptar('post', `${ruta(numero)}/creditos`, (body) => [201, body], { demora });
}

// POST 409: ese depositoId ya se acreditó (INT-R09).
function acreditaYaExiste(numero = CUENTA_POR_DEFECTO) {
  return interceptar('post', `${ruta(numero)}/creditos`, (body) => [
    409,
    { mensaje: 'Ese depositoId ya fue acreditado.', depositoId: body && body.depositoId },
  ]);
}

module.exports = {
  CUENTAS,
  cuentaActiva,
  cuentaNoExiste,
  consultaFalla,
  acreditaOk,
  acreditaFalla,
  acreditaLento,
  acreditaYaExiste,
};
