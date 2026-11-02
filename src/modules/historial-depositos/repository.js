'use strict';

// Solo SELECT sobre depositos (SPEC-09 §2). PRY-R08: los valores van siempre como parámetros;
// lo único que se arma es la lista fija de condiciones.
function armarWhere({ cuenta, usuarioId, estado, desde, hasta }) {
  const condiciones = [];
  const valores = [];
  function agregar(condicion, valor) {
    valores.push(valor);
    condiciones.push(`${condicion} $${valores.length}`);
  }
  agregar('cuenta_destino =', cuenta);
  if (usuarioId !== undefined) agregar('usuario_id =', usuarioId);
  if (estado !== undefined) agregar('estado =', estado);
  // HD-R03: inclusivos.
  if (desde !== undefined) agregar('creado_en >=', desde);
  if (hasta !== undefined) agregar('creado_en <=', hasta);
  return { where: condiciones.join(' AND '), valores };
}

// HD-R06
async function listar(db, filtros) {
  const { where, valores } = armarWhere(filtros);
  const n = valores.length;
  const { rows } = await db.query(
    `SELECT * FROM depositos WHERE ${where}
     ORDER BY creado_en DESC, id DESC LIMIT $${n + 1} OFFSET $${n + 2}`,
    [...valores, filtros.limite, filtros.desplazamiento],
  );
  return rows;
}

// HD-R07: mismos filtros que listar.
async function contar(db, filtros) {
  const { where, valores } = armarWhere(filtros);
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS total FROM depositos WHERE ${where}`,
    valores,
  );
  return rows[0].total;
}

module.exports = { listar, contar };
