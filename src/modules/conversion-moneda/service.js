'use strict';

const Decimal = require('decimal.js');

// Precisión amplia para que el producto sea exacto antes del único redondeo (CM-R04).
const DecimalExacto = Decimal.clone({ precision: 40 });

// CM-R04: monto × valor, redondeado a 2 decimales con ROUND_HALF_UP. Devuelve string "0.00".
function convertir(monto, valor) {
  return new DecimalExacto(String(monto))
    .times(new DecimalExacto(String(valor)))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    .toFixed(2);
}

module.exports = { convertir };
