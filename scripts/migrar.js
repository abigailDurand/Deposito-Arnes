'use strict';

const fs = require('node:fs');
const path = require('node:path');

// SPEC-13 §2: aplica db/*.sql (idempotentes, CI-R08) contra DATABASE_URL.
// Uso: npm run migrar   (en Kubernetes: node scripts/migrar.js, Job o initContainer).
const DIR_SQL = path.join(__dirname, '..', 'db');

// CI-R07: clave fija del advisory lock; dos Jobs o réplicas simultáneos se esperan entre sí.
const CLAVE_BLOQUEO = 'deposito-service:migrar';

function archivosSql(dir) {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
}

// CI-R07: todos los archivos en orden alfabético, en UNA transacción y con pg_advisory_xact_lock
// (se libera solo al COMMIT/ROLLBACK). Si uno falla, ROLLBACK completo y se relanza el error.
// pool y dir son inyectables para las pruebas (CI-T01..T04).
async function migrar({ pool, dir = DIR_SQL, logger }) {
  const archivos = archivosSql(dir);
  const cliente = await pool.connect();
  let conexionRota;
  try {
    await cliente.query('BEGIN');
    await cliente.query('SELECT pg_advisory_xact_lock(hashtext($1))', [CLAVE_BLOQUEO]);
    for (const archivo of archivos) {
      try {
        await cliente.query(fs.readFileSync(path.join(dir, archivo), 'utf8'));
      } catch (err) {
        err.message = `db/${archivo}: ${err.message}`;
        throw err;
      }
      logger.info({ archivo }, 'Migración aplicada');
    }
    await cliente.query('COMMIT');
    return archivos;
  } catch (err) {
    try {
      await cliente.query('ROLLBACK');
    } catch (errRollback) {
      conexionRota = errRollback;
    }
    throw err;
  } finally {
    cliente.release(conexionRota);
  }
}

async function main() {
  // PRY-R09: la conexión sale de src/core/db (config.js), sin duplicar configuración.
  const { pool } = require('../src/core/db');
  const { logger } = require('../src/core/logger');
  try {
    const archivos = await migrar({ pool, logger });
    logger.info({ archivos: archivos.length }, 'Migraciones completas');
  } catch (err) {
    logger.error({ error: err?.message ?? String(err), codigoError: err?.code ?? null }, 'Falló la migración (rollback)');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    // Solo llega aquí si falla cargar la configuración o cerrar el pool.
    process.stderr.write(`migrar: ${err?.message ?? String(err)}\n`);
    process.exitCode = 1;
  });
}

module.exports = { migrar, archivosSql, CLAVE_BLOQUEO };
