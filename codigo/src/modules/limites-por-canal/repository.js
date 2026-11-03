'use strict';

const Decimal = require('decimal.js');

// Solo SELECT sobre limites_canal (SPEC-10 §2). PRY-R06: pg entrega NUMERIC como string.
async function buscarLimite(db, canal, moneda) {
  const { rows } = await db.query(
    'SELECT monto_maximo FROM limites_canal WHERE canal = $1 AND moneda = $2',
    [canal, moneda],
  );
  return rows[0] ? new Decimal(rows[0].monto_maximo) : null;
}

module.exports = { buscarLimite };
