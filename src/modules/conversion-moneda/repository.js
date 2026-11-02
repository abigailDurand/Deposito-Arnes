'use strict';

// CM-R02: la vigente más reciente con vigente_desde <= now(). PRY-R06: NUMERIC llega como string.
async function buscarVigente(db, origen, destino) {
  const { rows } = await db.query(
    `SELECT id, valor FROM tipos_cambio
      WHERE moneda_origen = $1 AND moneda_destino = $2 AND vigente_desde <= now()
      ORDER BY vigente_desde DESC
      LIMIT 1`,
    [origen, destino],
  );
  return rows[0] ?? null;
}

// CM-R07: recibe la tx del INSERT del depósito.
async function insertar(tx, fila) {
  await tx.query(
    `INSERT INTO conversiones_deposito (
       deposito_id, tipo_cambio_id, moneda_cuenta, tipo_cambio, monto_final
     ) VALUES ($1, $2, $3, $4, $5)`,
    [fila.depositoId, fila.tipoCambioId, fila.monedaCuenta, fila.tipoCambio, fila.montoFinal],
  );
}

async function buscarPorDeposito(db, depositoId) {
  const { rows } = await db.query(
    `SELECT moneda_cuenta, tipo_cambio, monto_final FROM conversiones_deposito
      WHERE deposito_id = $1`,
    [depositoId],
  );
  return rows[0] ?? null;
}

module.exports = { buscarVigente, insertar, buscarPorDeposito };
