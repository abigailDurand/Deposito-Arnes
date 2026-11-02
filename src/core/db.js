'use strict';

const { Pool } = require('pg');

const config = require('../config');
const { logger } = require('./logger');

// En las pruebas, tests/setup/env.js asigna DATABASE_URL = DATABASE_URL_TEST antes de cargar
// config.js, así que este mismo pool apunta a la BD de pruebas sin código especial.
const pool = new Pool({ connectionString: config.databaseUrl });

// Un cliente inactivo que pierde la conexión emite 'error'; sin listener tumbaría el proceso.
pool.on('error', (err) => {
  logger.error({ err }, 'Error en un cliente inactivo del pool de PostgreSQL');
});

// fn recibe el ejecutor tx (misma API query que pool); su resultado se devuelve tras el COMMIT.
async function enTransaccion(fn) {
  const tx = await pool.connect();
  let conexionRota;
  try {
    await tx.query('BEGIN');
    const resultado = await fn(tx);
    await tx.query('COMMIT');
    return resultado;
  } catch (err) {
    try {
      await tx.query('ROLLBACK');
    } catch (errRollback) {
      // La conexión quedó inservible: se descarta en vez de devolverla al pool.
      conexionRota = errRollback;
      logger.error({ err: errRollback }, 'Falló el ROLLBACK de la transacción');
    }
    throw err;
  } finally {
    tx.release(conexionRota);
  }
}

module.exports = { pool, enTransaccion };
