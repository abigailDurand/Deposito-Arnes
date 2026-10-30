'use strict';

const Decimal = require('decimal.js');

function aIso(fecha) {
  return (fecha instanceof Date ? fecha : new Date(fecha)).toISOString();
}

// DOM-R10: fila de depositos → objeto Deposito de SPEC-01 §5. No expone usuario_id ni *_acreditar.
// Sin `extensiones` la clave no aparece (lista liviana de HD-R08).
function aJson(fila, extensiones) {
  const deposito = {
    id: fila.id,
    cuentaDestino: fila.cuenta_destino,
    // PRY-R06: pg entrega NUMERIC como string; Decimal fija exactamente 2 decimales.
    monto: new Decimal(fila.monto).toFixed(2),
    moneda: fila.moneda,
    canal: fila.canal,
    referencia: fila.referencia ?? null,
    estado: fila.estado,
    creadoEn: aIso(fila.creado_en),
    actualizadoEn: aIso(fila.actualizado_en),
  };
  if (extensiones !== undefined) deposito.extensiones = extensiones;
  return deposito;
}

module.exports = { aJson };
