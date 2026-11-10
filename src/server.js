'use strict';

const fs = require('node:fs');
const path = require('node:path');

const yaml = require('js-yaml');

const { crearApp } = require('./app');
const config = require('./config');
const { pool } = require('./core/db');
const { logger } = require('./core/logger');
const limpiarClaves = require('./core/tareas/limpiarClaves');
const reconciliacion = require('./modules/registrar-deposito/reconciliacion');

// MANIFEST_PATH relativo se resuelve desde la raíz del proyecto (D15: así lo copia el Dockerfile).
const RAIZ = path.join(__dirname, '..');
const SENALES = ['SIGTERM', 'SIGINT'];

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

const BARRIDO_MS = 50;

// CI-R10: server.close deja de aceptar conexiones y resuelve cuando se cierran todas las existentes.
// Una conexión keep-alive que estaba atendiendo una petición queda ociosa al responder, pero
// server.close no la cierra por sí solo (esperaría el keepAliveTimeout): se barren las ociosas
// hasta que no quede ninguna. Las activas nunca se cortan.
function cerrarServidor(server) {
  return new Promise((resolve, reject) => {
    let barrido = null;
    server.close((err) => {
      if (barrido !== null) clearInterval(barrido);
      if (err && err.code !== 'ERR_SERVER_NOT_RUNNING') reject(err);
      else resolve();
    });
    if (typeof server.closeIdleConnections === 'function') {
      server.closeIdleConnections();
      barrido = setInterval(() => server.closeIdleConnections(), BARRIDO_MS);
      barrido.unref();
    }
  });
}

// CI-R10..R12. Dependencias inyectables para las pruebas (CI-T05..T07); en producción las pone main().
// Devuelve apagar(senal): la primera llamada inicia el apagado y las siguientes devuelven la misma
// promesa sin repetirlo (CI-R12). Termina siempre llamando a salir(0) o salir(1).
function crearApagado({ server, tareas, pool: poolBd, logger: log, timeoutMs, salir }) {
  let apagado = null;

  async function cerrarTodo() {
    // Las tareas dejan de programarse en cuanto llega la señal; se espera lo que esté en curso.
    await Promise.all([cerrarServidor(server), ...tareas.map((t) => t.detener())]);
    // Solo cuando no queda nada usando la BD (peticiones ni ciclo de reconciliación).
    await poolBd.end();
  }

  return function apagar(senal) {
    if (apagado !== null) {
      log.info({ senal }, 'Apagado ya en curso: se ignora la señal');
      return apagado;
    }
    log.info({ senal, timeoutMs }, 'Apagando deposito-service');

    let temporizador;
    const limite = new Promise((resolve) => {
      temporizador = setTimeout(() => resolve('timeout'), timeoutMs);
      temporizador.unref();
    });
    const trabajo = cerrarTodo().then(() => 'ok', (err) => err);

    apagado = Promise.race([trabajo, limite]).then((resultado) => {
      clearTimeout(temporizador);
      if (resultado === 'ok') {
        log.info('deposito-service apagado limpiamente');
        salir(0);
      } else if (resultado === 'timeout') {
        // CI-R11
        log.error({ timeoutMs }, 'El apagado no terminó a tiempo: se fuerza la salida');
        salir(1);
      } else {
        log.error(
          { error: resultado?.message ?? String(resultado), codigoError: resultado?.code ?? null },
          'Falló el apagado limpio',
        );
        salir(1);
      }
    });
    return apagado;
  };
}

function main() {
  let server;
  try {
    server = iniciar();
  } catch (err) {
    logger.fatal({ err }, 'deposito-service no pudo arrancar');
    process.exitCode = 1;
    return;
  }
  const apagar = crearApagado({
    server,
    tareas: [reconciliacion, limpiarClaves],
    pool,
    logger,
    timeoutMs: config.apagadoTimeoutMs,
    salir: (codigo) => process.exit(codigo),
  });
  for (const senal of SENALES) process.on(senal, () => apagar(senal));
}

if (require.main === module) main();

module.exports = { iniciar, crearApagado, main };
