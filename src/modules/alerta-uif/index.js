'use strict';

const crypto = require('node:crypto');

const Decimal = require('decimal.js');

const config = require('../../config');
const repository = require('./repository');

// UIF-R04: el valor real del umbral [POR ACORDAR] vive solo en UIF_UMBRAL_PEN / UIF_UMBRAL_USD.
function umbralDe(moneda) {
  return config.uif?.[`umbral${moneda}`] ?? null;
}

// UIF-R01: el pipeline solo lo llama con el depósito COMPLETADO.
// UIF-R05: no modifica `deposito` ni devuelve nada; sin leerExtension.
async function ejecutar(deposito, contexto) {
  const { id: depositoId, moneda } = deposito;
  const umbralTexto = umbralDe(moneda);
  if (umbralTexto === null) {
    contexto.logger.warn({ depositoId, moneda }, 'Sin umbral UIF configurado para la moneda');
    return;
  }
  // UIF-R02: el monto depositado, en la moneda del depósito (no el convertido).
  const monto = new Decimal(deposito.monto);
  const umbral = new Decimal(umbralTexto);
  // UIF-R03: mayor o igual, con Decimal.
  if (!monto.gte(umbral)) return;

  try {
    await repository.insertar(contexto.db, {
      id: crypto.randomUUID(),
      depositoId,
      monto: monto.toFixed(2),
      moneda,
      umbral: umbral.toFixed(2),
    });
  } catch (err) {
    // UIF-R06: se registra para reprocesar y no se relanza. PRY-R10: sin el error completo.
    contexto.logger.error(
      { depositoId, error: err?.message ?? String(err), codigoError: err?.code ?? null },
      'No se pudo registrar la alerta UIF',
    );
  }
}

module.exports = { id: 'alerta-uif', tipo: 'post-proceso', ejecutar };
