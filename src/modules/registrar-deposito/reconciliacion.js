'use strict';

const config = require('../../config');
const { logger } = require('../../core/logger');
const service = require('./service');

let temporizador = null;
// CI-R10: promesa del ciclo en curso (null si no hay ninguno); detener() la espera.
let cicloEnCurso = null;

// Un ciclo nunca lanza: si falla (p. ej. la BD), se registra y se reintenta en el siguiente.
async function ejecutarCiclo() {
  try {
    await service.reconciliar();
  } catch (err) {
    logger.error(
      { error: err?.message ?? String(err), codigoError: err?.code ?? null },
      'Falló el ciclo de reconciliación de depósitos',
    );
  }
}

function ciclo() {
  if (cicloEnCurso !== null) return undefined;
  cicloEnCurso = ejecutarCiclo().finally(() => {
    cicloEnCurso = null;
  });
  return cicloEnCurso;
}

// RD-R13 / PIP-R12: lo llama server.js. unref: el temporizador no mantiene vivo el proceso.
// Un ciclo no arranca mientras el anterior siga en curso en este proceso.
function iniciar() {
  if (temporizador !== null) return temporizador;
  temporizador = setInterval(ciclo, config.reconciliacion.intervaloMs);
  temporizador.unref();
  return temporizador;
}

// CI-R10 / CI-R12: deja de programar ciclos y espera al que esté en curso (nunca rechaza).
// Sin iniciar() previo no falla.
async function detener() {
  if (temporizador !== null) clearInterval(temporizador);
  temporizador = null;
  if (cicloEnCurso !== null) await cicloEnCurso;
}

module.exports = { iniciar, detener, reconciliar: service.reconciliar };
