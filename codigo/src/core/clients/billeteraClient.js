'use strict';

const axios = require('axios');
const Decimal = require('decimal.js');

const config = require('../../config');
const { ErrorApp } = require('../errores');
const { logger, enmascararCuenta } = require('../logger');

// INT-R01 / INT-R03: único lugar que conoce BILLETERA_URL y BILLETERA_USD_URL; solo HTTP, con timeout.
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
const RE_PEN = /^\d{4}-\d{4}-\d{6}$/;
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// INT-R10: enrutamiento según formato de la cuenta.
function esCuentaUsd(cuenta) {
  return RE_UUID.test(cuenta);
}

// INT-R02: cabeceras para PEN y USD.
function cabecerasPen(correlationId) {
  return {
    Authorization: `Bearer ${config.billetera.token}`,
    'X-Correlation-Id': correlationId,
  };
}

function cabecerasUsd(correlationId, depositoId) {
  const headers = {
    'X-Correlation-Id': correlationId,
  };
  if (config.billeteraUsd && config.billeteraUsd.token) {
    headers.Authorization = `Bearer ${config.billeteraUsd.token}`;
  }
  if (depositoId) {
    headers['Idempotency-Key'] = depositoId;
  }
  return headers;
}

function noDisponible(operacion, numero, correlationId, detalle) {
  logger.warn(
    { correlationId, operacion, cuenta: enmascararCuenta(numero), ...detalle },
    'billetera-service falló o no respondió',
  );
  return new ErrorApp('BILLETERA_NO_DISPONIBLE');
}

// INT-R07: mapeo de canal a metodo_origen para Billetera USD.
function mapearMetodoOrigen(canal) {
  if (canal === 'APP') return 'TRANSFERENCIA';
  return 'EFECTIVO'; // VENTANILLA y AGENTE
}

// ==========================================
// Billetera PEN
// ==========================================

async function consultarCuentaPen(numero, correlationId) {
  let res;
  try {
    res = await httpPen.request({
      method: 'GET',
      url: `/api/v1/cuentas/${encodeURIComponent(numero)}`,
      headers: cabecerasPen(correlationId),
    });
  } catch (err) {
    throw noDisponible('consultarCuenta', numero, correlationId, { error: err.code || err.message });
  }

  if (res.status === 404) return null;
  if (res.status !== 200 || !res.data || typeof res.data !== 'object') {
    throw noDisponible('consultarCuenta', numero, correlationId, { status: res.status });
  }
  const { estado, moneda, titularId } = res.data;
  return { numero: res.data.numero, estado, moneda, titularId };
}

async function acreditarPen({ depositoId, cuenta, monto, moneda }, correlationId) {
  let res;
  try {
    res = await httpPen.request({
      method: 'POST',
      url: `/api/v1/cuentas/${encodeURIComponent(cuenta)}/creditos`,
      headers: cabecerasPen(correlationId),
      data: {
        depositoId,
        monto: new Decimal(monto).toFixed(2),
        moneda,
        concepto: CONCEPTO_PEN,
      },
    });
  } catch (err) {
    throw noDisponible('acreditar', cuenta, correlationId, { error: err.code || err.message, depositoId });
  }

  if (res.status === 200 || res.status === 201 || res.status === 409) return;
  throw noDisponible('acreditar', cuenta, correlationId, { status: res.status, depositoId });
}

// ==========================================
// Billetera USD
// ==========================================

async function consultarCuentaUsd(id, correlationId) {
  let res;
  try {
    res = await httpUsd.request({
      method: 'GET',
      url: `/api/v1/billetera/wallets/${encodeURIComponent(id)}`,
      headers: cabecerasUsd(correlationId),
    });
  } catch (err) {
    throw noDisponible('consultarCuenta', id, correlationId, { error: err.code || err.message });
  }

  if (res.status === 404) return null;
  if (res.status !== 200 || !res.data || typeof res.data !== 'object') {
    throw noDisponible('consultarCuenta', id, correlationId, { status: res.status });
  }

  // INT-R04: se tratan como ACTIVA; se ignoran balance y nombre
  return {
    numero: id,
    estado: 'ACTIVA',
    moneda: res.data.moneda,
    titularId: res.data.user_id,
  };
}

async function acreditarUsd({ depositoId, cuenta, monto, moneda, usuarioId, canal }, correlationId) {
  let res;
  try {
    res = await httpUsd.request({
      method: 'POST',
      url: '/api/v1/depositos/usd',
      headers: cabecerasUsd(correlationId, depositoId),
      data: {
        cliente_id: usuarioId,
        cuenta_destino_id: cuenta,
        monto: new Decimal(monto).toFixed(2),
        moneda: 'USD',
        metodo_origen: mapearMetodoOrigen(canal),
        referencia_externa: depositoId,
      },
    });
  } catch (err) {
    throw noDisponible('acreditar', cuenta, correlationId, { error: err.code || err.message, depositoId });
  }

  if (res.status === 409) {
    logger.error(
      { correlationId, cuenta: enmascararCuenta(cuenta), depositoId, status: res.status },
      'IDEMPOTENCY_CONFLICT en Billetera USD',
    );
    throw new ErrorApp('BILLETERA_NO_DISPONIBLE');
  }

  if ((res.status === 201 || res.status === 200) && res.data && res.data.estado === 'COMPLETADO') {
    return;
  }

  throw noDisponible('acreditar', cuenta, correlationId, { status: res.status, depositoId, estado: res.data?.estado });
}

// ==========================================
// Fachada pública con enrutamiento (INT-R10)
// ==========================================

async function consultarCuenta(numero, correlationId) {
  if (esCuentaUsd(numero)) {
    return consultarCuentaUsd(numero, correlationId);
  }
  return consultarCuentaPen(numero, correlationId);
}

async function acreditar(datos, correlationId) {
  if (esCuentaUsd(datos.cuenta)) {
    return acreditarUsd(datos, correlationId);
  }
  return acreditarPen(datos, correlationId);
}

module.exports = { consultarCuenta, acreditar };
