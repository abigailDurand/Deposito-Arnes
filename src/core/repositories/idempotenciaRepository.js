'use strict';

const COLUMNAS = 'usuario_id, clave, hash_solicitud, estado, status_http, respuesta, deposito_id, '
  + 'creado_en';

// IDE-R04: reserva atómica. true = la clave es nueva; false = ya existía.
async function reservar(db, { usuarioId, clave, hashSolicitud }) {
  const { rowCount } = await db.query(
    `INSERT INTO claves_idempotencia (usuario_id, clave, hash_solicitud, estado)
     VALUES ($1, $2, $3, 'EN_PROCESO')
     ON CONFLICT DO NOTHING`,
    [usuarioId, clave, hashSolicitud],
  );
  return rowCount === 1;
}

async function buscar(db, usuarioId, clave) {
  const { rows } = await db.query(
    `SELECT ${COLUMNAS} FROM claves_idempotencia WHERE usuario_id = $1 AND clave = $2`,
    [usuarioId, clave],
  );
  return rows[0] ?? null;
}

// IDE-R06: solo una petición gana el paso REINTENTABLE → EN_PROCESO. null = 0 filas.
async function tomarReintento(db, usuarioId, clave) {
  const { rows } = await db.query(
    `UPDATE claves_idempotencia SET estado = 'EN_PROCESO'
     WHERE usuario_id = $1 AND clave = $2 AND estado = 'REINTENTABLE'
     RETURNING ${COLUMNAS}`,
    [usuarioId, clave],
  );
  return rows[0] ?? null;
}

async function terminar(db, usuarioId, clave, { statusHttp, respuesta, depositoId }) {
  await db.query(
    `UPDATE claves_idempotencia
     SET estado = 'TERMINADO', status_http = $3, respuesta = $4, deposito_id = $5
     WHERE usuario_id = $1 AND clave = $2 AND estado = 'EN_PROCESO'`,
    [usuarioId, clave, statusHttp, JSON.stringify(respuesta ?? null), depositoId ?? null],
  );
}

async function marcarReintentable(db, usuarioId, clave, depositoId) {
  await db.query(
    `UPDATE claves_idempotencia SET estado = 'REINTENTABLE', deposito_id = $3
     WHERE usuario_id = $1 AND clave = $2 AND estado = 'EN_PROCESO'`,
    [usuarioId, clave, depositoId],
  );
}

async function borrar(db, usuarioId, clave) {
  await db.query(
    'DELETE FROM claves_idempotencia WHERE usuario_id = $1 AND clave = $2',
    [usuarioId, clave],
  );
}

// IDE-R09: en cualquier estado. Devuelve cuántas claves borró.
async function borrarAntiguas(db, dias) {
  const { rowCount } = await db.query(
    'DELETE FROM claves_idempotencia WHERE creado_en < now() - make_interval(days => $1::int)',
    [dias],
  );
  return rowCount;
}

module.exports = {
  reservar,
  buscar,
  tomarReintento,
  terminar,
  marcarReintentable,
  borrar,
  borrarAntiguas,
};
