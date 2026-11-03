'use strict';

// Solo SELECT sobre depositos (SPEC-08 §2).
async function buscarPorId(db, id) {
  const { rows } = await db.query('SELECT * FROM depositos WHERE id = $1', [id]);
  return rows[0] ?? null;
}

module.exports = { buscarPorId };
