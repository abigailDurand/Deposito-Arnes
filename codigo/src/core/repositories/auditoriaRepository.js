'use strict';

// AUD-R05: la tabla es solo de inserción; este repository no ofrece nada más.
// monto llega como string ("150.00") o null; PostgreSQL lo convierte a NUMERIC(15,2).
async function insertar(db, fila) {
  await db.query(
    `INSERT INTO auditoria_depositos
       (deposito_id, usuario_id, accion, ip, canal, monto, resultado, correlation_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      fila.depositoId,
      fila.usuarioId,
      fila.accion,
      fila.ip,
      fila.canal,
      fila.monto,
      fila.resultado,
      fila.correlationId,
    ],
  );
}

module.exports = { insertar };
