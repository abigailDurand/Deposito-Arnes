'use strict';

const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST });

// limites_canal es configuración (SPEC-10): limpiar() no la vacía.
const CONSERVAR = ['limites_canal'];

// Espera acotada a que no quede trabajo vivo de la prueba anterior (ver progress/deadlock_truncate.md).
const ESPERA_MAX_MS = 5000;
const PAUSA_MS = 5;

const pausa = (ms) => new Promise((r) => { setTimeout(r, ms); });

// Pool de la app (src/core/db) del mismo registro de módulos que la prueba: la auditoría
// (AUD-R03) escribe en res.on('finish'), después de que supertest ya devolvió la respuesta.
// Una consulta en cola o conectando aún no se ve en pg_stat_activity, por eso se mira el pool.
function poolAppOcioso() {
  let poolApp;
  try {
    ({ pool: poolApp } = require('../../src/core/db'));
  } catch {
    return true;
  }
  return poolApp.waitingCount === 0 && poolApp.idleCount === poolApp.totalCount;
}

// Otras sesiones de esta BD con una sentencia o transacción en curso (cualquier pool del proceso,
// incluidos los de jest.isolateModules).
async function otrasSesionesOcupadas() {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid()
        AND backend_type = 'client backend' AND state <> 'idle'`,
  );
  return rows[0].n;
}

async function esperarInactividad() {
  const limite = Date.now() + ESPERA_MAX_MS;
  let quietas = 0;
  while (quietas < 2 && Date.now() < limite) {
    await pausa(PAUSA_MS);
    const quieto = poolAppOcioso() && (await otrasSesionesOcupadas()) === 0 && poolAppOcioso();
    quietas = quieto ? quietas + 1 : 0;
  }
}

// TRUNCATE toma AccessExclusiveLock tabla por tabla en el orden de la lista. Un INSERT en una
// tabla hija (p. ej. auditoria_depositos) bloquea primero la hija y luego, en el chequeo de la
// FK, la madre (depositos). Si el TRUNCATE va madre → hija, el ciclo es un deadlock; con las
// hijas primero ambos bloquean en el mismo orden y el TRUNCATE solo espera.
// pg_tables no tiene orden estable (cambia tras cada TRUNCATE), así que el orden se calcula.
async function tablasHijasPrimero() {
  const { rows } = await pool.query(
    `SELECT c.relname AS tabla,
            COALESCE(array_agg(p.relname) FILTER (WHERE p.relname IS NOT NULL AND p.oid <> c.oid), '{}') AS madres
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_constraint k ON k.conrelid = c.oid AND k.contype = 'f'
       LEFT JOIN pg_class p ON p.oid = k.confrelid
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT (c.relname = ANY($1))
      GROUP BY c.relname
      ORDER BY c.relname`,
    [CONSERVAR],
  );
  const pendientes = new Map(rows.map((r) => [r.tabla, r.madres]));
  const orden = [];
  while (pendientes.size > 0) {
    // Sale una tabla de la que ya no depende ninguna pendiente (ninguna pendiente la tiene de madre).
    const madresPendientes = new Set([...pendientes.values()].flat());
    const libres = [...pendientes.keys()].filter((t) => !madresPendientes.has(t));
    // Ciclo de FKs (no lo hay hoy): se vacía el resto en orden alfabético.
    const lote = libres.length > 0 ? libres : [...pendientes.keys()];
    for (const t of lote) {
      orden.push(t);
      pendientes.delete(t);
    }
  }
  return orden;
}

async function limpiar() {
  await esperarInactividad();
  const orden = await tablasHijasPrimero();
  if (orden.length === 0) return;
  const tablas = orden.map((t) => `"${t.replace(/"/g, '""')}"`).join(', ');
  await pool.query(`TRUNCATE ${tablas} CASCADE`);
}

async function cerrar() {
  await pool.end();
}

module.exports = { pool, limpiar, cerrar };
