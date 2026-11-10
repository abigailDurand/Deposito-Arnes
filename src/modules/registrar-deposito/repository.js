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
       canal, referencia, estado, usuario_id, titular_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDIENTE', $9, $10)
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
      // DOM-R11: el titular se guarda para reenviar un body idéntico (RD-R08, RD-R13).
      deposito.titularId ?? null,
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

// RD-R13: solo Billetera USD (cuenta_destino UUID en minúsculas, RD-R02). Las filas quedan
// bloqueadas hasta el fin de `tx`; SKIP LOCKED: dos reconciliaciones simultáneas no toman la misma.
async function tomarParaReconciliar(tx, antiguedadMs, limite) {
  const { rows } = await tx.query(
    `SELECT * FROM depositos
     WHERE estado = 'PROCESANDO'
       AND cuenta_destino ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND actualizado_en < now() - ($1::bigint * interval '1 millisecond')
     ORDER BY actualizado_en
     LIMIT $2
     FOR UPDATE SKIP LOCKED`,
    [antiguedadMs, limite],
  );
  return rows;
}

module.exports = { insertar, buscarPorId, cambiarEstado, tomarParaReconciliar };
