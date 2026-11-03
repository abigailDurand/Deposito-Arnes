'use strict';

const pino = require('pino');

const config = require('../config');

// PRY-R10: el token nunca llega a los logs.
const logger = pino({
  level: config.logLevel,
  redact: { paths: ['req.headers.authorization'], censor: '[REDACTED]' },
});

// PRY-R10: '0011-0123-456789' → '****-****-456789'.
function enmascararCuenta(cuenta) {
  if (typeof cuenta !== 'string') return cuenta;
  const partes = cuenta.split('-');
  if (partes.length === 1) {
    return '*'.repeat(Math.max(cuenta.length - 6, 0)) + cuenta.slice(-6);
  }
  const ultima = partes.pop();
  return [...partes.map((p) => '*'.repeat(p.length)), ultima].join('-');
}

module.exports = { logger, enmascararCuenta };
