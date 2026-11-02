'use strict';

const Decimal = require('decimal.js');

const repository = require('./repository');
const service = require('./service');

const ID = 'conversion-moneda';

async function ejecutar(deposito, contexto) {
  const monedaCuenta = contexto.cuenta.moneda;
  // CM-R01
  if (deposito.moneda === monedaCuenta) return deposito;

  // CM-R02 / CM-R03: una fila por sentido (origen = moneda del depósito).
  const tipoCambio = await repository.buscarVigente(contexto.db, deposito.moneda, monedaCuenta);
  // CM-R06: sin tipo de cambio no lanza; el service de SPEC-07 responde MONEDA_NO_SOPORTADA.
  if (tipoCambio === null) return deposito;

  const montoAcreditado = service.convertir(deposito.monto, tipoCambio.valor);
  // CM-R05
  contexto.privado.tipoCambioId = tipoCambio.id;
  return {
    ...deposito,
    montoAcreditar: new Decimal(montoAcreditado),
    monedaAcreditar: monedaCuenta,
    extensiones: {
      ...deposito.extensiones,
      [ID]: {
        monedaCuenta,
        tipoCambio: new Decimal(tipoCambio.valor).toFixed(4),
        montoAcreditado,
      },
    },
  };
}

// CM-R07: solo si hubo conversión, y siempre con la tx recibida.
async function persistir(deposito, tx, contexto) {
  const extension = deposito.extensiones[ID];
  if (!extension) return;
  await repository.insertar(tx, {
    depositoId: deposito.id,
    tipoCambioId: contexto.privado.tipoCambioId,
    monedaCuenta: extension.monedaCuenta,
    tipoCambio: extension.tipoCambio,
    montoFinal: extension.montoAcreditado,
  });
}

// CM-R08
async function leerExtension(depositoId, contexto) {
  const fila = await repository.buscarPorDeposito(contexto.db, depositoId);
  if (fila === null) return null;
  return {
    monedaCuenta: fila.moneda_cuenta,
    tipoCambio: new Decimal(fila.tipo_cambio).toFixed(4),
    montoAcreditado: new Decimal(fila.monto_final).toFixed(2),
  };
}

module.exports = { id: ID, tipo: 'transformador', ejecutar, persistir, leerExtension };
