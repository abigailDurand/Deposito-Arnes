'use strict';

const axios = require('axios');
const Decimal = require('decimal.js');

const config = require('../../config');
const { ErrorApp } = require('../errores');
const { logger, enmascararCuenta } = require('../logger');

// INT-R01 / INT-R03: único lugar que conoce BILLETERA_URL; solo HTTP, con timeout.
// validateStatus deja pasar todo status: cada función decide qué es éxito.
const http = axios.create({
  baseURL: config.billetera.url,
  timeout: config.billetera.timeoutMs,
  validateStatus: () => true,
});

const CONCEPTO = 'DEPOSITO';

// INT-R02: toda llamada lleva el token de servicio y el correlation id.
function cabeceras(correlationId) {
  return {
    Authorization: `Bearer ${config.billetera.token}`,
    'X-Correlation-Id': correlationId,
  };
}

function rutaCuenta(numero) {
  return `/api/v1/cuentas/${encodeURIComponent(numero)}`;
}

function noDisponible(operacion, numero, correlationId, detalle) {
  logger.warn(
    { correlationId, operacion, cuenta: enmascararCuenta(numero), ...detalle },
    'billetera-service falló o no respondió',
  );
  return new ErrorApp('BILLETERA_NO_DISPONIBLE');
}

async function llamar(operacion, numero, correlationId, peticion) {
  try {
    return await http.request({ ...peticion, headers: cabeceras(correlationId) });
  } catch (err) {
    // Timeout (INT-R03) o error de red.
    throw noDisponible(operacion, numero, correlationId, { error: err.code || err.message });
  }
}

// INT-R04: 200 → cuenta; 404 → null; cualquier otro status o timeout → BILLETERA_NO_DISPONIBLE.
async function consultarCuenta(numero, correlationId) {
  const res = await llamar('consultarCuenta', numero, correlationId, {
    method: 'GET',
    url: rutaCuenta(numero),
  });
  if (res.status === 404) return null;
  if (res.status !== 200 || !res.data || typeof res.data !== 'object') {
    throw noDisponible('consultarCuenta', numero, correlationId, { status: res.status });
  }
  const { estado, moneda, titularId } = res.data;
  return { numero: res.data.numero, estado, moneda, titularId };
}

// INT-R05: 200, 201 o 409 (ese depositoId ya se acreditó) → resuelve sin valor.
// INT-R06: sin reintentos; el depositoId es la clave de idempotencia de billetera.
// INT-R07: monto como string con 2 decimales a partir de Decimal; concepto fijo.
async function acreditar({ depositoId, cuenta, monto, moneda }, correlationId) {
  const res = await llamar('acreditar', cuenta, correlationId, {
    method: 'POST',
    url: `${rutaCuenta(cuenta)}/creditos`,
    data: { depositoId, monto: new Decimal(monto).toFixed(2), moneda, concepto: CONCEPTO },
  });
  if (res.status === 200 || res.status === 201 || res.status === 409) return;
  throw noDisponible('acreditar', cuenta, correlationId, { status: res.status, depositoId });
}

module.exports = { consultarCuenta, acreditar };
