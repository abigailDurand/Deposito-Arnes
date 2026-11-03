'use strict';

const config = require('../../config');
const { pool } = require('../db');
const { logger } = require('../logger');
const idempotenciaRepository = require('../repositories/idempotenciaRepository');

const UNA_HORA_MS = 60 * 60 * 1000;

async function limpiar() {
  try {
    const borradas = await idempotenciaRepository.borrarAntiguas(pool, config.idempotenciaDias);
    logger.info({ borradas }, 'Limpieza de claves de idempotencia');
  } catch (err) {
    logger.error({ codigoError: err?.code ?? null }, 'Falló la limpieza de claves de idempotencia');
  }
}

// IDE-R09 / PIP-R12: lo llama server.js. unref: el temporizador no mantiene vivo el proceso.
function iniciar() {
  const temporizador = setInterval(limpiar, UNA_HORA_MS);
  temporizador.unref();
  return temporizador;
}

module.exports = { iniciar };
