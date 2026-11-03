'use strict';

const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST });

// limites_canal es configuración (SPEC-10): limpiar() no la vacía.
const CONSERVAR = ['limites_canal'];

async function limpiar() {
  const { rows } = await pool.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT (tablename = ANY($1))",
    [CONSERVAR],
  );
  if (rows.length === 0) return;
  const tablas = rows.map((r) => `"${r.tablename.replace(/"/g, '""')}"`).join(', ');
  await pool.query(`TRUNCATE ${tablas} CASCADE`);
}

async function cerrar() {
  await pool.end();
}

module.exports = { pool, limpiar, cerrar };
