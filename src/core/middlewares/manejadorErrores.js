'use strict';

const { ErrorApp, catalogo } = require('../errores');
const { logger } = require('../logger');

function responder(res, codigo, correlationId) {
  const { status, mensaje } = catalogo[codigo];
  res.status(status).json({ codigo, mensaje, correlationId });
}

// DOM-R07: último middleware; todo error sale con { codigo, mensaje, correlationId }.
// req.correlationId lo asigna el middleware correlationId (SPEC-03); si no está → null.
// Express reconoce un manejador de errores por sus 4 parámetros: next debe declararse.
function manejadorErrores(err, req, res, next) {
  if (res.headersSent) return next(err);

  const correlationId = req.correlationId ?? null;

  if (err instanceof ErrorApp) {
    if (err.depositoId !== undefined) res.locals.depositoId = err.depositoId;
    return responder(res, err.codigo, correlationId);
  }

  if (err && err.type === 'entity.parse.failed') {
    return responder(res, 'FORMATO_INVALIDO', correlationId);
  }

  // El stack solo va al log, nunca a la respuesta.
  logger.error({ err, correlationId }, 'Error no controlado');
  return responder(res, 'ERROR_INTERNO', correlationId);
}

module.exports = manejadorErrores;
