'use strict';

const fs = require('node:fs');
const path = require('node:path');

const yaml = require('js-yaml');

const { crearApp } = require('./app');
const config = require('./config');
const { logger } = require('./core/logger');
const limpiarClaves = require('./core/tareas/limpiarClaves');
const reconciliacion = require('./modules/registrar-deposito/reconciliacion');

// MANIFEST_PATH relativo se resuelve desde la raíz del proyecto (D15: así lo copia el Dockerfile).
const RAIZ = path.join(__dirname, '..');

function leerManifest(ruta) {
  return yaml.load(fs.readFileSync(path.resolve(RAIZ, ruta), 'utf8'));
}

function iniciar() {
  const app = crearApp({ manifest: leerManifest(config.manifestPath) });
  // PIP-R12: tras crearApp (que valida el manifest), nunca dentro de él.
  limpiarClaves.iniciar();
  reconciliacion.iniciar();
  return app.listen(config.port, () => {
    logger.info({ port: config.port }, 'deposito-service escuchando');
  });
}

try {
  iniciar();
} catch (err) {
  logger.fatal({ err }, 'deposito-service no pudo arrancar');
  process.exitCode = 1;
}
