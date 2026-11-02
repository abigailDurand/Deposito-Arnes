'use strict';

const { randomUUID } = require('node:crypto');

const { logger, enmascararCuenta } = require('../logger');

// SEG-R01: 1 a 100 caracteres [A-Za-z0-9_-].
const PATRON_ID = /^[A-Za-z0-9_-]{1,100}$/;

// PRY-R10 / SEG-R03: una ruta como /cuentas/0011-0123-456789/depositos llevaría la cuenta completa.
// Se enmascara toda secuencia aislada de dígitos y guiones de 10+ caracteres (también las mal
// formadas, que igual llegan al log antes de que la ruta responda 400). Los UUID no coinciden
// porque sus grupos contienen letras o están pegados a ellas.
const PATRON_CUENTA = /(?<![0-9A-Za-z-])\d[\d-]{8,}\d(?![0-9A-Za-z-])/g;

// Sin query string: no se registra nada que no sea la ruta.
function rutaParaLog(req) {
  const ruta = (req.originalUrl || req.url || '').split('?')[0];
  return ruta.replace(PATRON_CUENTA, (cuenta) => enmascararCuenta(cuenta));
}

// Global y primero (PIP-R11): asigna req.correlationId y registra la petición al terminar.
function correlationId(req, res, next) {
  const recibido = req.get('X-Correlation-Id');
  req.correlationId = typeof recibido === 'string' && PATRON_ID.test(recibido)
    ? recibido
    : randomUUID();
  // SEG-R02: toda respuesta lleva el header, también las de error.
  res.set('X-Correlation-Id', req.correlationId);

  const inicio = performance.now();
  // SEG-R03: nunca headers ni body (ahí viajan el token y la cuenta).
  res.on('finish', () => {
    logger.info({
      correlationId: req.correlationId,
      usuarioId: req.usuario?.id ?? null,
      metodo: req.method,
      ruta: rutaParaLog(req),
      status: res.statusCode,
      duracionMs: Math.round(performance.now() - inicio),
    }, 'Petición atendida');
  });

  next();
}

module.exports = correlationId;
module.exports.rutaParaLog = rutaParaLog;
