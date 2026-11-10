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

let temporizador = null;
let limpiezaEnCurso = null;

// CI-R10: se guarda la limpieza en curso para que detener() pueda esperarla.
function tarea() {
  if (limpiezaEnCurso === null) {
    limpiezaEnCurso = limpiar().finally(() => {
      limpiezaEnCurso = null;
    });
  }
  return limpiezaEnCurso;
}

// IDE-R09 / PIP-R12: lo llama server.js. unref: el temporizador no mantiene vivo el proceso.
function iniciar() {
  if (temporizador !== null) clearInterval(temporizador);
  temporizador = setInterval(tarea, UNA_HORA_MS);
  temporizador.unref();
  return temporizador;
}

// CI-R10 / CI-R12: deja de programar limpiezas y espera la que esté en curso.
// Sin iniciar() previo no falla. limpiar() nunca rechaza.
async function detener() {
  if (temporizador !== null) clearInterval(temporizador);
  temporizador = null;
  if (limpiezaEnCurso !== null) await limpiezaEnCurso;
}

module.exports = { iniciar, detener };
