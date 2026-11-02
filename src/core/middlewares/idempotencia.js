'use strict';

const { createHash } = require('node:crypto');

const { pool } = require('../db');
const { ErrorApp, manejar } = require('../errores');
const { logger } = require('../logger');
const idempotenciaRepository = require('../repositories/idempotenciaRepository');

const LARGO_MIN = 8;
const LARGO_MAX = 100;

// IDE-R01
function claveValida(clave) {
  return typeof clave === 'string' && clave.length >= LARGO_MIN && clave.length <= LARGO_MAX;
}

function ordenarLlaves(valor) {
  if (Array.isArray(valor)) return valor.map(ordenarLlaves);
  if (valor !== null && typeof valor === 'object') {
    return Object.keys(valor).sort().reduce((ordenado, llave) => {
      ordenado[llave] = ordenarLlaves(valor[llave]);
      return ordenado;
    }, {});
  }
  return valor;
}

// IDE-R03: SHA-256 hex de "método originalUrl body", con el body en llaves ordenadas.
function calcularHash(req) {
  const body = JSON.stringify(ordenarLlaves(req.body)) ?? '';
  return createHash('sha256').update(`${req.method} ${req.originalUrl} ${body}`).digest('hex');
}

// IDE-R08: decide qué guardar según el status. Nunca rechaza: si falla, solo se loguea.
async function guardar(req, res, usuarioId, clave, cuerpo) {
  const status = res.statusCode;
  const depositoId = res.locals.depositoId ?? null;
  try {
    if (status < 500) {
      await idempotenciaRepository.terminar(pool, usuarioId, clave, {
        statusHttp: status,
        respuesta: cuerpo,
        depositoId,
      });
    } else if (status === 502 && depositoId !== null) {
      await idempotenciaRepository.marcarReintentable(pool, usuarioId, clave, depositoId);
    } else {
      await idempotenciaRepository.borrar(pool, usuarioId, clave);
    }
  } catch (err) {
    logger.error(
      { correlationId: req.correlationId ?? null, status, codigoError: err?.code ?? null },
      'Falló el guardado de la clave de idempotencia',
    );
  }
}

// IDE-R08: se guarda ANTES de enviar; la respuesta sale igual aunque el guardado falle.
function interceptarRespuesta(req, res, usuarioId, clave) {
  const jsonOriginal = res.json;
  res.json = function jsonConGuardado(cuerpo) {
    res.json = jsonOriginal;
    guardar(req, res, usuarioId, clave, cuerpo).finally(() => {
      jsonOriginal.call(res, cuerpo);
    });
    return res;
  };
}

// IDE-R07
function repetir(req, res, fila) {
  if (fila.deposito_id !== null) res.locals.depositoId = fila.deposito_id;
  res.set('Idempotency-Replayed', 'true');
  if (req.correlationId) res.set('X-Correlation-Id', req.correlationId);
  res.status(fila.status_http).json(fila.respuesta);
}

// En POST /api/v1/depositos, después de requiereRol (SPEC-07): req.usuario ya existe.
async function idempotencia(req, res, next) {
  const clave = req.get('Idempotency-Key');
  if (!claveValida(clave)) throw new ErrorApp('IDEMPOTENCY_KEY_REQUERIDA');

  const usuarioId = req.usuario.id;
  const hashSolicitud = calcularHash(req);

  // IDE-R04: nunca "SELECT y luego INSERT".
  const reservada = await idempotenciaRepository
    .reservar(pool, { usuarioId, clave, hashSolicitud });
  if (reservada) {
    interceptarRespuesta(req, res, usuarioId, clave);
    return next();
  }

  // IDE-R05: la fila existía. Si ya no está (se borró entre el INSERT y el SELECT), al momento
  // del INSERT otra petición la tenía tomada.
  const fila = await idempotenciaRepository.buscar(pool, usuarioId, clave);
  if (!fila) throw new ErrorApp('SOLICITUD_EN_PROCESO');
  if (fila.hash_solicitud !== hashSolicitud) throw new ErrorApp('IDEMPOTENCY_KEY_REUTILIZADA');
  if (fila.estado === 'EN_PROCESO') throw new ErrorApp('SOLICITUD_EN_PROCESO');
  if (fila.estado === 'TERMINADO') return repetir(req, res, fila);

  // IDE-R06: REINTENTABLE.
  const tomada = await idempotenciaRepository.tomarReintento(pool, usuarioId, clave);
  if (!tomada) throw new ErrorApp('SOLICITUD_EN_PROCESO');
  req.idempotencia = { depositoIdPrevio: tomada.deposito_id };
  interceptarRespuesta(req, res, usuarioId, clave);
  return next();
}

module.exports = manejar(idempotencia);
module.exports.calcularHash = calcularHash;
module.exports.claveValida = claveValida;
