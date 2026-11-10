'use strict';

// PRY-R09: único lugar del código que lee variables de entorno.
const OBLIGATORIAS = [
  'DATABASE_URL',
  'JWT_PUBLIC_KEY',
  'BILLETERA_URL',
  'BILLETERA_TOKEN',
  'BILLETERA_USD_URL',
];

// Solo obligatorias si hay BILLETERA_USD_TOKEN_URL (OAuth 2.0 client credentials, INT-R13).
const OBLIGATORIAS_OAUTH_USD = [
  'BILLETERA_USD_CLIENT_ID',
  'BILLETERA_USD_CLIENT_SECRET',
];

function valor(env, nombre, defecto) {
  const v = env[nombre];
  return v === undefined || v.trim() === '' ? defecto : v.trim();
}

function entero(env, nombre, defecto) {
  const texto = valor(env, nombre, defecto);
  if (!/^\d+$/.test(texto)) {
    throw new Error(`Variable de entorno ${nombre} inválida: debe ser un entero (${texto})`);
  }
  return Number.parseInt(texto, 10);
}

function trustProxy(texto) {
  return /^\d+$/.test(texto) ? Number.parseInt(texto, 10) : texto;
}

function cargarConfig(env) {
  // SPEC-00 §5 / INT-R13: con BILLETERA_USD_TOKEN_URL, el client id y el secreto son obligatorios.
  const obligatorias = valor(env, 'BILLETERA_USD_TOKEN_URL') === undefined
    ? OBLIGATORIAS
    : [...OBLIGATORIAS, ...OBLIGATORIAS_OAUTH_USD];
  const faltan = obligatorias.filter((nombre) => valor(env, nombre) === undefined);
  if (faltan.length) {
    throw new Error(`Faltan variables de entorno obligatorias: ${faltan.join(', ')}`);
  }

  return {
    port: entero(env, 'PORT', '3000'),
    logLevel: valor(env, 'LOG_LEVEL', 'info'),
    trustProxy: trustProxy(valor(env, 'TRUST_PROXY', '1')),
    databaseUrl: valor(env, 'DATABASE_URL'),
    databaseUrlTest: valor(env, 'DATABASE_URL_TEST', null),
    manifestPath: valor(env, 'MANIFEST_PATH', 'specs-v2/manifest.yaml'),
    jwt: {
      publicKey: valor(env, 'JWT_PUBLIC_KEY').replace(/\\n/g, '\n'),
      algorithms: valor(env, 'JWT_ALGORITHMS', 'RS256').split(',').map((a) => a.trim()),
      issuer: valor(env, 'JWT_ISSUER', 'usuario-service'),
      audience: valor(env, 'JWT_AUDIENCE', 'banco-api'),
    },
    idempotenciaDias: entero(env, 'IDEMPOTENCIA_DIAS', '7'),
    billetera: {
      url: valor(env, 'BILLETERA_URL'),
      token: valor(env, 'BILLETERA_TOKEN'),
      timeoutMs: entero(env, 'BILLETERA_TIMEOUT_MS', '5000'),
    },
    // Billetera USD (SPEC-02). Usa el mismo BILLETERA_TIMEOUT_MS (INT-R03).
    // INT-R13: OAuth opcional mientras dure la transición (Q7); sin tokenUrl → null y no se
    // envía Authorization. Las credenciales sin tokenUrl se ignoran (null).
    billeteraUsd: {
      url: valor(env, 'BILLETERA_USD_URL'),
      tokenUrl: valor(env, 'BILLETERA_USD_TOKEN_URL', null),
      clientId: valor(env, 'BILLETERA_USD_TOKEN_URL') === undefined
        ? null : valor(env, 'BILLETERA_USD_CLIENT_ID'),
      clientSecret: valor(env, 'BILLETERA_USD_TOKEN_URL') === undefined
        ? null : valor(env, 'BILLETERA_USD_CLIENT_SECRET'),
    },
    // RD-R13: reconciliación de depósitos USD en PROCESANDO.
    reconciliacion: {
      intervaloMs: entero(env, 'RECONCILIACION_INTERVALO_MS', '30000'),
      antiguedadMs: entero(env, 'RECONCILIACION_ANTIGUEDAD_MS', '10000'),
      alertaMs: entero(env, 'RECONCILIACION_ALERTA_MS', '3600000'),
    },
    // CI-R11: tope del apagado limpio; menor que terminationGracePeriodSeconds (30 s) de Kubernetes.
    apagadoTimeoutMs: entero(env, 'APAGADO_TIMEOUT_MS', '10000'),
    // PRY-R06 / UIF-R04: los umbrales son dinero; se entregan como string para usarlos con Decimal.
    uif: {
      umbralPEN: valor(env, 'UIF_UMBRAL_PEN', null),
      umbralUSD: valor(env, 'UIF_UMBRAL_USD', null),
    },
  };
}

module.exports = cargarConfig(process.env);
module.exports.cargarConfig = cargarConfig;
