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

// nombre y balance van en la respuesta (contrato Wallet v1.2.0) para comprobar que se descartan
// (INT-R04). Los de 11111111-… son los del ejemplo de §5; el resto, nombre null y saldo 0.00.
function wallet(userId, estado = 'ACTIVE', nombre = null, balance = '0.00') {
  return { user_id: userId, nombre, balance, moneda: 'USD', estado };
}

const BILLETERAS_USD = {
  '11111111-1111-4111-8111-111111111111': wallet('usr-cliente-1', 'ACTIVE', 'Cliente Uno',
    '350.75'),
  '22222222-2222-4222-8222-222222222222': wallet('usr-cliente-2'),
  '33333333-3333-4333-8333-333333333333': wallet('usr-bloqueada', 'BLOCKED'),
  '44444444-4444-4444-8444-444444444444': wallet('usr-cerrada', 'CLOSED'),
  // Especiales del mock (§4): ACTIVE; su comportamiento al acreditar depende de cliente_id.
  '55555555-5555-4555-8555-555555555555': wallet('usr-carrera'),
  '66666666-6666-4666-8666-666666666666': wallet('usr-cliente-bloqueado'),
  '77777777-7777-4777-8777-777777777777': wallet('usr-sin-usd'),
  '88888888-8888-4888-8888-888888888888': wallet('usr-lento'),
  '99999999-9999-4999-8999-999999999999': wallet('usr-falla'),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa': wallet('usr-pendiente'),
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb': wallet('usr-pendiente-falla'),
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc': wallet('usr-falla-una-vez'),
};
const CUENTA_POR_DEFECTO = '0011-0123-456789';
const BILLETERA_USD_POR_DEFECTO = '11111111-1111-4111-8111-111111111111';
const BILLETERA_USD_BLOQUEADA = '33333333-3333-4333-8333-333333333333';
const BILLETERA_USD_CERRADA = '44444444-4444-4444-8444-444444444444';
const RUTA_DEPOSITOS_USD = '/api/v1/depositos/usd';
// INT-R05: los 4 rechazos de negocio (422) que se traducen a CUENTA_INACTIVA.
const RECHAZOS_USD = [
  'WALLET_BLOCKED', 'WALLET_CLOSED', 'CUSTOMER_BLOCKED', 'USD_ACCOUNT_NOT_ENABLED',
];
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
// hubo (INT-T05, INT-T12, INT-T16). `responder` devuelve [status, body] o [status, body, headers].
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

// Deposito de Billetera USD v1.2.0 armado con el body recibido. COMPLETADO lleva
// movimiento_saldo_id (INT-R14); `cambios` sobrescribe campos (p. ej. movimiento_saldo_id: null).
function depositoUsd(body, estado, cambios = {}) {
  const ahora = new Date().toISOString();
  const completado = estado === 'COMPLETADO';
  return {
    deposito_id: crypto.randomUUID(),
    cliente_id: body && body.cliente_id,
    cuenta_destino_id: null,
    monto: body && body.monto,
    moneda: 'USD',
    canal: body && body.canal,
    metodo_origen: body && body.metodo_origen,
    estado,
    movimiento_saldo_id: completado ? `mov_${crypto.randomUUID()}` : null,
    creado_en: ahora,
    completado_en: completado ? ahora : null,
    ...cambios,
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
// `cambios` sobrescribe campos: { estado: 'OTRO' } (desconocido), { estado: undefined } (ausente,
// JSON lo omite), { user_id: undefined }...
function billeteraUsdExiste(id = BILLETERA_USD_POR_DEFECTO, cambios = {}) {
  const billetera = { ...billeteraUsdDePrueba(id), ...cambios };
  return usd('get', rutaUsd(id), () => [200, billetera]);
}

// GET 200 con estado BLOCKED (def. la billetera 33333333-… de §4).
function billeteraUsdBloqueada(id = BILLETERA_USD_BLOQUEADA) {
  return billeteraUsdExiste(id, { estado: 'BLOCKED' });
}

// GET 200 con estado CLOSED (def. la billetera 44444444-… de §4).
function billeteraUsdCerrada(id = BILLETERA_USD_CERRADA) {
  return billeteraUsdExiste(id, { estado: 'CLOSED' });
}

function billeteraUsdNoExiste(id = BILLETERA_USD_POR_DEFECTO) {
  return usd('get', rutaUsd(id), () => [
    404, errorUsd(404, 'NO_ENCONTRADA', 'billetera no encontrada'),
  ]);
}

// GET con `status` (def. 500), o sin responder a tiempo si se pasa `demora` en ms.
function consultaUsdFalla(id = BILLETERA_USD_POR_DEFECTO, { status = 500, demora = 0 } = {}) {
  return usd('get', rutaUsd(id), () => [status, errorUsd(status, 'INTERNAL_ERROR', 'falla')], {
    demora,
  });
}

// POST 201 COMPLETADO con movimiento_saldo_id (depósito nuevo). `cambios` sobrescribe campos del
// Deposito: { movimiento_saldo_id: null } para el caso sin movimiento (INT-T10).
function acreditaUsdOk({ status = 201, cambios = {} } = {}) {
  return usd('post', RUTA_DEPOSITOS_USD, (body) => [
    status, depositoUsd(body, 'COMPLETADO', cambios),
  ]);
}

// POST 200: replay de la misma Idempotency-Key (INT-R06), con el `estado` actual del depósito
// (def. COMPLETADO; también VALIDADO, PENDIENTE o FALLIDO).
function acreditaUsdReplay({ estado = 'COMPLETADO', cambios = {} } = {}) {
  return usd('post', RUTA_DEPOSITOS_USD, (body) => [200, depositoUsd(body, estado, cambios)]);
}

// POST 409 IDEMPOTENCY_CONFLICT: misma clave con datos distintos (INT-R05).
function acreditaUsdConflicto() {
  return usd('post', RUTA_DEPOSITOS_USD, () => [
    409,
    errorUsd(409, 'IDEMPOTENCY_CONFLICT', 'misma clave con datos diferentes'),
  ]);
}

// POST 202 VALIDADO con Location y Retry-After (§5): aceptado, abono pendiente (INT-R05).
function acreditaUsdPendiente({ retryAfter = 5 } = {}) {
  return usd('post', RUTA_DEPOSITOS_USD, (body) => {
    const deposito = depositoUsd(body, 'VALIDADO');
    return [202, deposito, {
      Location: `${RUTA_DEPOSITOS_USD}/${deposito.deposito_id}`,
      'Retry-After': String(retryAfter),
    }];
  });
}

// POST 422 con un rechazo de negocio (def. WALLET_BLOCKED; ver RECHAZOS_USD).
function acreditaUsdRechazo(codigo = 'WALLET_BLOCKED') {
  return usd('post', RUTA_DEPOSITOS_USD, () => [422, errorUsd(422, codigo, 'rechazo simulado')]);
}

// POST con `status` (def. 500): 400, 401, 403, 429, 503...
function acreditaUsdFalla({ status = 500, code = 'ERROR' } = {}) {
  return usd('post', RUTA_DEPOSITOS_USD, () => [status, errorUsd(status, code, 'falla')]);
}

// POST que responde 201 COMPLETADO tras `demora` ms (def. 6000, la billetera lenta de §4).
function acreditaUsdLento({ demora = DEMORA_LENTA_MS } = {}) {
  return usd('post', RUTA_DEPOSITOS_USD, (body) => [201, depositoUsd(body, 'COMPLETADO')], {
    demora,
  });
}

// ── OAuth de Billetera USD (INT-R13) ──

// URL de tokens: la de `url`, o BILLETERA_USD_TOKEN_URL del entorno de la prueba (que la prueba
// asigna antes de cargar src/config.js), o la de config.
function urlToken(url) {
  const texto = url || process.env.BILLETERA_USD_TOKEN_URL || config.billeteraUsd.tokenUrl;
  if (!texto) throw new Error('tokenUsd*: falta BILLETERA_USD_TOKEN_URL en la prueba');
  const destino = new URL(texto);
  return { origen: destino.origin, path: destino.pathname };
}

// POST 200 con un access token que dura `expiresIn` s (def. 3600). El scope lleva `accessToken`
// para comprobar la cabecera Authorization; las peticiones registradas incluyen el body
// form-urlencoded y la cabecera Basic.
function tokenUsdOk({
  url,
  expiresIn = 3600,
  accessToken = crypto.randomBytes(24).toString('hex'),
} = {}) {
  const { origen, path } = urlToken(url);
  const scope = interceptar(origen, 'post', path, () => [200, {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: expiresIn,
    scope: 'billetera/wallets.read billetera/depositos.write',
  }]);
  scope.accessToken = accessToken;
  return scope;
}

// POST con `status` (def. 401 invalid_client), o sin responder a tiempo si se pasa `demora`.
function tokenUsdFalla({ url, status = 401, demora = 0 } = {}) {
  const { origen, path } = urlToken(url);
  return interceptar(origen, 'post', path, () => [status, { error: 'invalid_client' }], {
    demora,
  });
}

module.exports = {
  CUENTAS,
  BILLETERAS_USD,
  RECHAZOS_USD,
  cuentaActiva,
  cuentaNoExiste,
  consultaFalla,
  acreditaOk,
  acreditaFalla,
  acreditaLento,
  acreditaYaExiste,
  billeteraUsdExiste,
  billeteraUsdBloqueada,
  billeteraUsdCerrada,
  billeteraUsdNoExiste,
  consultaUsdFalla,
  acreditaUsdOk,
  acreditaUsdReplay,
  acreditaUsdConflicto,
  acreditaUsdPendiente,
  acreditaUsdRechazo,
  acreditaUsdFalla,
  acreditaUsdLento,
  tokenUsdOk,
  tokenUsdFalla,
};
