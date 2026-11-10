'use strict';

const axios = require('axios');
const Decimal = require('decimal.js');

const config = require('../../config');
const { ErrorApp } = require('../errores');
const { logger, enmascararCuenta } = require('../logger');

// INT-R01 / INT-R03: único lugar que conoce BILLETERA_URL y BILLETERA_USD_URL; solo HTTP, con
// el mismo timeout para ambas billeteras. validateStatus deja pasar todo status: cada función
// decide qué es éxito.
const httpPen = axios.create({
  baseURL: config.billetera.url,
  timeout: config.billetera.timeoutMs,
  validateStatus: () => true,
});

const httpUsd = axios.create({
  baseURL: config.billeteraUsd.url,
  timeout: config.billetera.timeoutMs,
  validateStatus: () => true,
});

const CONCEPTO_PEN = 'DEPOSITO';
const MONEDA_USD = 'USD';
// INT-R14: única ruta de acreditación USD; nunca POST /wallets/{id}/depositos (no idempotente).
const RUTA_DEPOSITOS_USD = '/api/v1/depositos/usd';
// INT-R10: UUID en minúsculas → Billetera USD; el resto (0000-0000-000000) → billetera PEN.
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// INT-R07 (x-channel-method-policy): canal → metodo_origen.
const METODO_ORIGEN = {
  VENTANILLA: 'EFECTIVO',
  AGENTE: 'EFECTIVO',
  APP: 'TRANSFERENCIA',
};
// INT-R04: Wallet.estado → estado de cuenta de deposito-service.
const ESTADOS_BILLETERA_USD = {
  ACTIVE: 'ACTIVA',
  BLOCKED: 'BLOQUEADA',
  CLOSED: 'CERRADA',
};
// INT-R05 / D3: rechazos de negocio de Billetera USD → CUENTA_INACTIVA.
const RECHAZOS_USD = new Set([
  'WALLET_BLOCKED',
  'WALLET_CLOSED',
  'CUSTOMER_BLOCKED',
  'USD_ACCOUNT_NOT_ENABLED',
]);
const ESTADOS_PENDIENTES_USD = new Set(['VALIDADO', 'PENDIENTE']);
// INT-R13: scopes mínimos y margen de renovación del token.
const SCOPES_USD = 'billetera/wallets.read billetera/depositos.write';
const MARGEN_TOKEN_MS = 60 * 1000;

const ACREDITADO = { estado: 'ACREDITADO' };
const PENDIENTE = { estado: 'PENDIENTE' };
// INT-R05: 200 (replay) con FALLIDO = Billetera USD rechazó el depósito de forma definitiva.
const RECHAZADO = { estado: 'RECHAZADO' };

// INT-R13: token en memoria y solicitud en curso compartida por las peticiones simultáneas.
let tokenUsd = null;
let solicitudTokenUsd = null;

function esBilleteraUsd(cuenta) {
  return typeof cuenta === 'string' && RE_UUID.test(cuenta);
}

function noDisponible(operacion, cuenta, correlationId, detalle) {
  logger.warn(
    { correlationId, operacion, cuenta: enmascararCuenta(cuenta), ...detalle },
    'billetera falló o no respondió',
  );
  return new ErrorApp('BILLETERA_NO_DISPONIBLE');
}

// INT-R06: una sola petición, sin reintentos. Timeout o error de red → BILLETERA_NO_DISPONIBLE.
// Solo se loguea el código o el mensaje del error: el error de axios lleva la configuración de la
// petición (cabeceras y credenciales) y nunca se loguea entero (PRY-R10).
async function llamar(http, operacion, cuenta, correlationId, peticion) {
  try {
    return await http.request(peticion);
  } catch (err) {
    throw noDisponible(operacion, cuenta, correlationId, { error: err.code || err.message });
  }
}

// ── OAuth de Billetera USD (INT-R13) ──

function tokenVigente() {
  return tokenUsd !== null && tokenUsd.expiraEn - Date.now() > MARGEN_TOKEN_MS;
}

// Client credentials (RFC 6749 §4.4): credenciales en Basic, cuerpo form-urlencoded. Ni el secreto
// ni el token se loguean: el log de fallo solo lleva el status o el código de error (PRY-R10).
async function pedirTokenUsd(operacion, cuenta, correlationId) {
  const { tokenUrl, clientId, clientSecret } = config.billeteraUsd;
  let res;
  try {
    res = await axios.post(
      tokenUrl,
      new URLSearchParams({ grant_type: 'client_credentials', scope: SCOPES_USD }).toString(),
      {
        timeout: config.billetera.timeoutMs,
        validateStatus: () => true,
        auth: { username: clientId, password: clientSecret },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Correlation-Id': correlationId,
        },
      },
    );
  } catch (err) {
    throw noDisponible(operacion, cuenta, correlationId, {
      motivo: 'token', error: err.code || err.message,
    });
  }
  const datos = res.data && typeof res.data === 'object' ? res.data : {};
  const valido = res.status === 200
    && typeof datos.access_token === 'string' && datos.access_token !== ''
    && Number.isInteger(datos.expires_in) && datos.expires_in > 0;
  if (!valido) {
    throw noDisponible(operacion, cuenta, correlationId, { motivo: 'token', status: res.status });
  }
  tokenUsd = { valor: datos.access_token, expiraEn: Date.now() + datos.expires_in * 1000 };
  return tokenUsd.valor;
}

// INT-R13: un 401 de Billetera USD descarta el token guardado (la siguiente llamada pide uno
// nuevo); no se reintenta la llamada (INT-R06). Solo se descarta si sigue siendo el token que se
// envió: si otra petición ya lo renovó, el nuevo se conserva. Un 403 no lo descarta.
function descartarTokenUsdSi401(status, tokenEnviado) {
  if (status === 401 && tokenUsd !== null && tokenUsd.valor === tokenEnviado) tokenUsd = null;
}

// Transición (Q7) = sin BILLETERA_USD_TOKEN_URL → null: no se envía Authorization (INT-R13).
async function obtenerTokenUsd(operacion, cuenta, correlationId) {
  if (!config.billeteraUsd.tokenUrl) return null;
  if (tokenVigente()) return tokenUsd.valor;
  if (solicitudTokenUsd === null) {
    solicitudTokenUsd = pedirTokenUsd(operacion, cuenta, correlationId).finally(() => {
      solicitudTokenUsd = null;
    });
  }
  return solicitudTokenUsd;
}

// INT-R02: PEN siempre con su token; USD con el token OAuth de INT-R13, si está configurado.
function cabecerasPen(correlationId) {
  return {
    Authorization: `Bearer ${config.billetera.token}`,
    'X-Correlation-Id': correlationId,
  };
}

// Devuelve también el token enviado (o null) para poder descartarlo ante un 401 (INT-R13).
async function cabecerasUsd(operacion, cuenta, correlationId, extra = {}) {
  const cabeceras = { 'X-Correlation-Id': correlationId, ...extra };
  const token = await obtenerTokenUsd(operacion, cuenta, correlationId);
  if (token !== null) cabeceras.Authorization = `Bearer ${token}`;
  return { cabeceras, token };
}

// ── Billetera PEN (propuesta) ──

function rutaCuentaPen(numero) {
  return `/api/v1/cuentas/${encodeURIComponent(numero)}`;
}

// INT-R11: 200 → cuenta; 404 → null; otro status o timeout → BILLETERA_NO_DISPONIBLE.
async function consultarCuentaPen(numero, correlationId) {
  const res = await llamar(httpPen, 'consultarCuenta', numero, correlationId, {
    method: 'GET',
    url: rutaCuentaPen(numero),
    headers: cabecerasPen(correlationId),
  });
  if (res.status === 404) return null;
  if (res.status !== 200 || !res.data || typeof res.data !== 'object') {
    throw noDisponible('consultarCuenta', numero, correlationId, { status: res.status });
  }
  const { estado, moneda, titularId } = res.data;
  return { numero: res.data.numero, estado, moneda, titularId };
}

// INT-R12: 200, 201 o 409 (ese depositoId ya se acreditó) → { estado: 'ACREDITADO' }.
async function acreditarPen({ depositoId, cuenta, monto, moneda }, correlationId) {
  const res = await llamar(httpPen, 'acreditar', cuenta, correlationId, {
    method: 'POST',
    url: `${rutaCuentaPen(cuenta)}/creditos`,
    headers: cabecerasPen(correlationId),
    data: { depositoId, monto: new Decimal(monto).toFixed(2), moneda, concepto: CONCEPTO_PEN },
  });
  if (res.status === 200 || res.status === 201 || res.status === 409) return { ...ACREDITADO };
  throw noDisponible('acreditar', cuenta, correlationId, { status: res.status, depositoId });
}

// ── Billetera USD ──

// INT-R04: estado ausente solo se acepta como ACTIVA durante la transición (Q7), es decir, sin
// BILLETERA_USD_TOKEN_URL; con ella → undefined (BILLETERA_NO_DISPONIBLE). Desconocido → undefined.
function estadoBilleteraUsd(estado) {
  if ((estado === undefined || estado === null) && !config.billeteraUsd.tokenUrl) return 'ACTIVA';
  return ESTADOS_BILLETERA_USD[estado];
}

// INT-R04: 200 → { numero: id, estado, moneda, titularId: user_id }; 404 → null.
// balance y nombre no se devuelven ni se loguean (PRY-R10).
async function consultarCuentaUsd(id, correlationId) {
  const { cabeceras, token } = await cabecerasUsd('consultarCuenta', id, correlationId);
  const res = await llamar(httpUsd, 'consultarCuenta', id, correlationId, {
    method: 'GET',
    url: `/api/v1/billetera/wallets/${encodeURIComponent(id)}`,
    headers: cabeceras,
  });
  descartarTokenUsdSi401(res.status, token);
  if (res.status === 404) return null;
  if (res.status !== 200 || !res.data || typeof res.data !== 'object') {
    throw noDisponible('consultarCuenta', id, correlationId, { status: res.status });
  }
  const estado = estadoBilleteraUsd(res.data.estado);
  const titularId = res.data.user_id;
  if (estado === undefined || typeof titularId !== 'string' || titularId === '') {
    throw noDisponible('consultarCuenta', id, correlationId, {
      status: res.status, estadoBilletera: res.data.estado, conTitular: Boolean(titularId),
    });
  }
  return { numero: id, estado, moneda: res.data.moneda, titularId };
}

function logErrorUsd(mensaje, cuenta, correlationId, detalle) {
  logger.error(
    { correlationId, operacion: 'acreditar', cuenta: enmascararCuenta(cuenta), ...detalle },
    mensaje,
  );
}

// INT-R05: traduce la respuesta de POST /depositos/usd.
function resultadoUsd(res, cuenta, depositoId, correlationId) {
  const datos = res.data && typeof res.data === 'object' ? res.data : {};
  const detalle = { status: res.status, depositoId, estado: datos.estado, code: datos.code };

  if ((res.status === 201 || res.status === 200) && datos.estado === 'COMPLETADO'
    && datos.movimiento_saldo_id !== undefined && datos.movimiento_saldo_id !== null) {
    return { ...ACREDITADO };
  }
  if ((res.status === 202 || res.status === 200) && ESTADOS_PENDIENTES_USD.has(datos.estado)) {
    return { ...PENDIENTE };
  }
  if (res.status === 200 && datos.estado === 'FALLIDO') {
    logger.warn(
      { correlationId, operacion: 'acreditar', cuenta: enmascararCuenta(cuenta), ...detalle },
      'Billetera USD rechazó el depósito de forma definitiva',
    );
    return { ...RECHAZADO };
  }
  if (res.status === 422 && RECHAZOS_USD.has(datos.code)) {
    logger.warn(
      { correlationId, operacion: 'acreditar', cuenta: enmascararCuenta(cuenta), ...detalle },
      'Billetera USD rechazó el depósito',
    );
    throw new ErrorApp('CUENTA_INACTIVA');
  }
  if (res.status === 409) {
    // IDEMPOTENCY_CONFLICT = misma clave con datos distintos; es un error, no un éxito.
    logErrorUsd('Billetera USD respondió IDEMPOTENCY_CONFLICT', cuenta, correlationId, detalle);
    throw new ErrorApp('BILLETERA_NO_DISPONIBLE');
  }
  if (res.status === 401 || res.status === 403) {
    logErrorUsd('Billetera USD rechazó la autenticación (configuración)', cuenta, correlationId,
      detalle);
    throw new ErrorApp('BILLETERA_NO_DISPONIBLE');
  }
  // COMPLETADO sin movimiento_saldo_id, FALLIDO con status distinto de 200, otro estado, 429, 5xx...
  throw noDisponible('acreditar', cuenta, correlationId, detalle);
}

// INT-R05 / INT-R06 / INT-R07: Idempotency-Key = depositoId; body armado solo con los datos del
// depósito, así un reintento o una reconciliación reenvía exactamente el mismo body (replay 200).
async function acreditarUsd({ depositoId, cuenta, monto, titularId, canal }, correlationId) {
  const { cabeceras, token } = await cabecerasUsd('acreditar', cuenta, correlationId, {
    'Idempotency-Key': depositoId,
  });
  const res = await llamar(httpUsd, 'acreditar', cuenta, correlationId, {
    method: 'POST',
    url: RUTA_DEPOSITOS_USD,
    headers: cabeceras,
    data: {
      cliente_id: titularId,
      monto: new Decimal(monto).toFixed(2),
      moneda: MONEDA_USD,
      canal,
      metodo_origen: METODO_ORIGEN[canal],
      referencia_externa: depositoId,
    },
  });
  descartarTokenUsdSi401(res.status, token);
  return resultadoUsd(res, cuenta, depositoId, correlationId);
}

// INT-R10: quien llama no sabe a qué billetera va.
async function consultarCuenta(numero, correlationId) {
  if (esBilleteraUsd(numero)) return consultarCuentaUsd(numero, correlationId);
  return consultarCuentaPen(numero, correlationId);
}

async function acreditar(datos, correlationId) {
  if (esBilleteraUsd(datos.cuenta)) return acreditarUsd(datos, correlationId);
  return acreditarPen(datos, correlationId);
}

module.exports = { consultarCuenta, acreditar };
