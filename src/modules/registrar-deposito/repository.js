'use strict';

// DOM-R01: únicas transiciones permitidas (SPEC-01 §3).
const TRANSICIONES = Object.freeze({
  PENDIENTE: ['PROCESANDO'],
  PROCESANDO: ['COMPLETADO', 'FALLIDO'],
  FALLIDO: ['PROCESANDO'],
});

// PRY-R06: el dinero llega como Decimal y se guarda como string con 2 decimales.
async function insertar(tx, deposito) {
  const { rows } = await tx.query(
    `INSERT INTO depositos (
       id, cuenta_destino, monto, moneda, monto_acreditar, moneda_acreditar,
       canal, referencia, estado, usuario_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDIENTE', $9)
     RETURNING *`,
    [
      deposito.id,
      deposito.cuentaDestino,
      deposito.monto.toFixed(2),
      deposito.moneda,
      deposito.montoAcreditar.toFixed(2),
      deposito.monedaAcreditar,
      deposito.canal,
      deposito.referencia,
      deposito.usuarioId,
    ],
  );
  return rows[0];
}

async function buscarPorId(db, id) {
  const { rows } = await db.query('SELECT * FROM depositos WHERE id = $1', [id]);
  return rows[0] ?? null;
}

// RD-R06: solo cambia si sigue en el estado `de`; 0 filas → error (500).
async function cambiarEstado(db, id, de, a) {
  if (!(TRANSICIONES[de] || []).includes(a)) {
    throw new Error(`Transición de estado no permitida: ${de} → ${a}`);
  }
  const { rows } = await db.query(
    `UPDATE depositos SET estado = $3, actualizado_en = now()
     WHERE id = $1 AND estado = $2
     RETURNING *`,
    [id, de, a],
  );
  if (rows.length === 0) {
    throw new Error(`El depósito ${id} no estaba en ${de}; no se pudo pasar a ${a}`);
  }
  return rows[0];
}

module.exports = { insertar, buscarPorId, cambiarEstado };
