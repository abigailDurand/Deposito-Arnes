'use strict';

const config = require('../../config');
const { logger } = require('../../core/logger');
const service = require('./service');

let temporizador = null;
let enCurso = false;

// Un ciclo nunca lanza: si falla (p. ej. la BD), se registra y se reintenta en el siguiente.
async function ciclo() {
  if (enCurso) return;
  enCurso = true;
  try {
    await service.reconciliar();
  } catch (err) {
    logger.error(
      { error: err?.message ?? String(err), codigoError: err?.code ?? null },
      'Falló el ciclo de reconciliación de depósitos',
    );
  } finally {
    enCurso = false;
  }
}

// RD-R13 / PIP-R12: lo llama server.js. unref: el temporizador no mantiene vivo el proceso.
// Un ciclo no arranca mientras el anterior siga en curso en este proceso.
function iniciar() {
  if (temporizador !== null) return temporizador;
  temporizador = setInterval(ciclo, config.reconciliacion.intervaloMs);
  temporizador.unref();
  return temporizador;
}

function detener() {
  if (temporizador !== null) clearInterval(temporizador);
  temporizador = null;
}

module.exports = { iniciar, detener, reconciliar: service.reconciliar };
