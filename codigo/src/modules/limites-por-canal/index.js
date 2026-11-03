'use strict';

const Decimal = require('decimal.js');

const { ErrorApp } = require('../../core/errores');
const repository = require('./repository');

const errores = Object.freeze({
  LIMITE_CANAL_EXCEDIDO: {
    status: 422,
    mensaje: 'El monto supera el máximo permitido para el canal.',
  },
});

// LC-R05: solo lee; no modifica `deposito` ni devuelve nada.
async function ejecutar(deposito, contexto) {
  const { canal, moneda, monto } = deposito;
  // LC-R01: canal y moneda del depósito, antes de cualquier conversión.
  const maximo = await repository.buscarLimite(contexto.db, canal, moneda);
  if (maximo === null) {
    // LC-R03
    contexto.logger.warn({ canal, moneda }, 'Sin límite configurado para el canal y la moneda');
    return;
  }
  // LC-R02 / LC-R04: igual al límite se permite; comparación con Decimal.
  if (new Decimal(monto).gt(maximo)) throw new ErrorApp('LIMITE_CANAL_EXCEDIDO');
}

module.exports = { id: 'limites-por-canal', tipo: 'validador', errores, ejecutar };
