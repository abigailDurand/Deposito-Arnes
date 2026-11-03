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
const ESTADO_COMPLETADO = 'COMPLETADO';
const RUTA_DEPOSITOS_USD = '/api/v1/depositos/usd';
// INT-R10: UUID en minúsculas → Billetera USD; el resto (0000-0000-000000) → billetera PEN.
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// INT-R07 [POR ACORDAR]: canal → metodo_origen.
const METODO_ORIGEN = {
  VENTANILLA: 'EFECTIVO',
  AGENTE: 'EFECTIVO',
  APP: 'TRANSFERENCIA',
};

function esBilleteraUsd(cuenta) {
  return typeof cuenta === 'string' && RE_UUID.test(cuenta);
}

// INT-R02: PEN siempre con su token; USD solo si BILLETERA_USD_TOKEN está configurado.
function cabecerasPen(correlationId) {
  return {
    Authorization: `Bearer ${config.billetera.token}`,
    'X-Correlation-Id': correlationId,
  };
}

function cabecerasUsd(correlationId, extra = {}) {
  const cabeceras = { 'X-Correlation-Id': correlationId, ...extra };
  if (config.billeteraUsd.token) cabeceras.Authorization = `Bearer ${config.billeteraUsd.token}`;
  return cabeceras;
}

function noDisponible(operacion, cuenta, correlationId, detalle) {
  logger.warn(
    { correlationId, operacion, cuenta: enmascararCuenta(cuenta), ...detalle },
    'billetera falló o no respondió',
  );
  return new ErrorApp('BILLETERA_NO_DISPONIBLE');
}

// INT-R06: una sola petición, sin reintentos. Timeout o error de red → BILLETERA_NO_DISPONIBLE.
async function llamar(http, operacion, cuenta, correlationId, peticion) {
  try {
    return await http.request(peticion);
  } catch (err) {
    throw noDisponible(operacion, cuenta, correlationId, { error: err.code || err.message });
  }
}

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

// INT-R12: 200, 201 o 409 (ese depositoId ya se acreditó) → resuelve sin valor.
async function acreditarPen({ depositoId, cuenta, monto, moneda }, correlationId) {
  const res = await llamar(httpPen, 'acreditar', cuenta, correlationId, {
    method: 'POST',
    url: `${rutaCuentaPen(cuenta)}/creditos`,
    headers: cabecerasPen(correlationId),
    data: { depositoId, monto: new Decimal(monto).toFixed(2), moneda, concepto: CONCEPTO_PEN },
  });
  if (res.status === 200 || res.status === 201 || res.status === 409) return;
  throw noDisponible('acreditar', cuenta, correlationId, { status: res.status, depositoId });
}

// INT-R04: 200 → { numero: id, estado: ACTIVA, moneda, titularId: user_id }; 404 → null.
// balance y nombre no se devuelven ni se loguean (PRY-R10).
async function consultarCuentaUsd(id, correlationId) {
  const res = await llamar(httpUsd, 'consultarCuenta', id, correlationId, {
    method: 'GET',
    url: `/api/v1/billetera/wallets/${encodeURIComponent(id)}`,
    headers: cabecerasUsd(correlationId),
  });
  if (res.status === 404) return null;
  if (res.status !== 200 || !res.data || typeof res.data !== 'object') {
    throw noDisponible('consultarCuenta', id, correlationId, { status: res.status });
  }
  // INT-R04 [POR ACORDAR]: Billetera USD no expone estado; toda billetera existente es ACTIVA.
  return { numero: id, estado: 'ACTIVA', moneda: res.data.moneda, titularId: res.data.user_id };
}

// INT-R05 / INT-R06 / INT-R07: Idempotency-Key = depositoId; body armado solo con los datos del
// depósito, así un reintento manual reenvía exactamente el mismo body (replay 200).
async function acreditarUsd({ depositoId, cuenta, monto, usuarioId, canal }, correlationId) {
  const res = await llamar(httpUsd, 'acreditar', cuenta, correlationId, {
    method: 'POST',
    url: RUTA_DEPOSITOS_USD,
    headers: cabecerasUsd(correlationId, { 'Idempotency-Key': depositoId }),
    data: {
      cliente_id: usuarioId,
      cuenta_destino_id: cuenta,
      monto: new Decimal(monto).toFixed(2),
      moneda: MONEDA_USD,
      metodo_origen: METODO_ORIGEN[canal],
      referencia_externa: depositoId,
    },
  });
  if (res.status === 409) {
    // INT-R05: IDEMPOTENCY_CONFLICT = misma clave con datos distintos; es un error, no un éxito.
    logger.error(
      { correlationId, operacion: 'acreditar', cuenta: enmascararCuenta(cuenta), depositoId,
        status: res.status },
      'Billetera USD respondió IDEMPOTENCY_CONFLICT',
    );
    throw new ErrorApp('BILLETERA_NO_DISPONIBLE');
  }
  const estado = res.data && typeof res.data === 'object' ? res.data.estado : undefined;
  // INT-R05 [POR ACORDAR]: solo 201/200 con estado COMPLETADO cuenta como acreditado.
  if ((res.status === 201 || res.status === 200) && estado === ESTADO_COMPLETADO) return;
  throw noDisponible('acreditar', cuenta, correlationId, {
    status: res.status, depositoId, estado,
  });
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
