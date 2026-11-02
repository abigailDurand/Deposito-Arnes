'use strict';

const { pool } = require('../db');
const { logger } = require('../logger');
const auditoriaRepository = require('../repositories/auditoriaRepository');

// AUD-R02: única fuente de las acciones auditadas (como Express: sin distinguir mayúsculas y con
// barra final opcional). Lo que no coincide (/health, rutas inexistentes) no se audita.
const ACCIONES_AUDITADAS = [
  { metodo: 'POST', patron: /^\/api\/v1\/depositos\/?$/i, accion: 'CREAR_DEPOSITO' },
  { metodo: 'GET', patron: /^\/api\/v1\/depositos\/[^/]+\/?$/i, accion: 'CONSULTAR_DEPOSITO' },
  {
    metodo: 'GET',
    patron: /^\/api\/v1\/cuentas\/[^/]+\/depositos\/?$/i,
    accion: 'LISTAR_DEPOSITOS',
  },
];

const CANALES = ['AGENTE', 'VENTANILLA', 'APP'];
const PATRON_MONTO = /^-?\d{1,13}(\.\d{1,2})?$/;

// originalUrl no cambia dentro de los routers montados (req.path sí); sin query string.
function deducirAccion(req) {
  const ruta = (req.originalUrl || req.url || '').split('?')[0];
  const encontrada = ACCIONES_AUDITADAS
    .find((a) => a.metodo === req.method && a.patron.test(ruta));
  return encontrada ? encontrada.accion : null;
}

// AUD-R07: del body solo canal y monto, y solo si cumplen el patrón. Nunca el body completo.
function extraerDelBody(body) {
  const esObjeto = body !== null && typeof body === 'object' && !Array.isArray(body);
  const canal = esObjeto && typeof body.canal === 'string' && CANALES.includes(body.canal)
    ? body.canal
    : null;
  const monto = esObjeto && typeof body.monto === 'string' && PATRON_MONTO.test(body.monto)
    ? body.monto
    : null;
  return { canal, monto };
}

// AUD-R08
function resultadoDe(status) {
  return status < 400 ? 'EXITO' : `ERROR_${status}`;
}

async function registrar(req, res, accion) {
  try {
    // Se lee en finish: autenticar y express.json corren después de este middleware (D2, PIP-R11).
    const { canal, monto } = extraerDelBody(req.body);
    await auditoriaRepository.insertar(pool, {
      depositoId: res.locals.depositoId ?? null,
      usuarioId: req.usuario?.id ?? null,
      accion,
      ip: req.ip ?? null,
      canal,
      monto,
      resultado: resultadoDe(res.statusCode),
      correlationId: req.correlationId ?? null,
    });
  } catch (err) {
    // AUD-R04: la respuesta ya salió; solo se registra el fallo, sin datos de la fila ni del error
    // de PostgreSQL (su detalle puede incluir los valores de la fila).
    logger.error(
      { correlationId: req.correlationId ?? null, accion, codigoError: err?.code ?? null },
      'Falló el registro de auditoría',
    );
  }
}

// Global, después de correlationId y antes de autenticar (D2, PIP-R11): registra también los 401.
function auditoria(req, res, next) {
  const accion = deducirAccion(req);
  if (accion) {
    // AUD-R03: después de responder y sin esperar; registrar nunca rechaza (captura todo).
    res.on('finish', () => {
      registrar(req, res, accion);
    });
  }
  next();
}

module.exports = auditoria;
module.exports.deducirAccion = deducirAccion;
module.exports.extraerDelBody = extraerDelBody;
module.exports.ACCIONES_AUDITADAS = ACCIONES_AUDITADAS;
