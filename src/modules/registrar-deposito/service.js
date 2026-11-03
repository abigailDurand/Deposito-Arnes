'use strict';

const crypto = require('node:crypto');
const Decimal = require('decimal.js');

const billeteraClient = require('../../core/clients/billeteraClient');
const db = require('../../core/db');
const { aJson } = require('../../core/depositoMapper');
const { ErrorApp } = require('../../core/errores');
const { logger } = require('../../core/logger');
const permisos = require('../../core/permisos');
const pipeline = require('../../core/pipeline');
const repository = require('./repository');

const CUENTA_ACTIVA = 'ACTIVA';

// RD-R03: se convierte a Decimal de inmediato. Los decimales se cuentan en el string recibido.
function montoValido(texto) {
  const monto = new Decimal(texto);
  const decimales = (texto.split('.')[1] || '').length;
  if (monto.lte(0) || decimales > 2) throw new ErrorApp('MONTO_INVALIDO');
  return monto;
}

// SPEC-06 §4. `privado` y el logger por módulo los agrega el pipeline.
function armarContexto(usuario, cuenta, correlationId) {
  return {
    usuario,
    cuenta,
    correlationId,
    logger: logger.child({ correlationId }),
    db: db.pool,
  };
}

function depositoDesdeFila(fila, extensiones) {
  return {
    id: fila.id,
    cuentaDestino: fila.cuenta_destino,
    monto: new Decimal(fila.monto),
    moneda: fila.moneda,
    canal: fila.canal,
    referencia: fila.referencia ?? null,
    usuarioId: fila.usuario_id,
    montoAcreditar: new Decimal(fila.monto_acreditar),
    monedaAcreditar: fila.moneda_acreditar,
    extensiones,
  };
}

// `alt` del diagrama de §3: el depósito ya está en PROCESANDO.
async function acreditarYCerrar(deposito, contexto) {
  try {
    await billeteraClient.acreditar({
      depositoId: deposito.id,
      cuenta: deposito.cuentaDestino,
      monto: deposito.montoAcreditar,
      moneda: deposito.monedaAcreditar,
      usuarioId: deposito.usuarioId,
      canal: deposito.canal,
    }, contexto.correlationId);
  } catch (err) {
    if (!(err instanceof ErrorApp)) throw err;
    await repository.cambiarEstado(db.pool, deposito.id, 'PROCESANDO', 'FALLIDO');
    throw new ErrorApp('BILLETERA_NO_DISPONIBLE', { depositoId: deposito.id });
  }
  const fila = await repository.cambiarEstado(db.pool, deposito.id, 'PROCESANDO', 'COMPLETADO');
  deposito.estado = 'COMPLETADO';
  await pipeline.ejecutarPostProcesos(deposito, contexto);
  // RD-R09
  return aJson(fila, deposito.extensiones);
}

// RD-R04: orden exacto del diagrama; nada se guarda antes de la TX.
async function registrar(datos, usuario, correlationId) {
  const monto = montoValido(datos.monto);

  const cuenta = await billeteraClient.consultarCuenta(datos.cuentaDestino, correlationId);
  if (cuenta === null) throw new ErrorApp('CUENTA_NO_ENCONTRADA');
  // RD-R11: en la práctica solo aplica a la billetera PEN; las USD llegan siempre ACTIVA (INT-R04).
  if (cuenta.estado !== CUENTA_ACTIVA) throw new ErrorApp('CUENTA_INACTIVA');

  permisos.verificarCanal(usuario, datos.canal);
  permisos.verificarTitular(usuario, datos.canal, cuenta);

  // RD-R05
  let deposito = {
    id: crypto.randomUUID(),
    cuentaDestino: datos.cuentaDestino,
    monto,
    moneda: datos.moneda,
    canal: datos.canal,
    referencia: datos.referencia ?? null,
    usuarioId: usuario.id,
    montoAcreditar: monto,
    monedaAcreditar: datos.moneda,
    extensiones: {},
  };
  // PIP-R07: el MISMO objeto contexto va a ejecutarTransformadores y a persistirTransformadores.
  const contexto = armarContexto(usuario, cuenta, correlationId);

  await pipeline.ejecutarValidadores(deposito, contexto);
  deposito = await pipeline.ejecutarTransformadores(deposito, contexto);

  if (deposito.monedaAcreditar !== cuenta.moneda) throw new ErrorApp('MONEDA_NO_SOPORTADA');

  // RD-R07: si el INSERT o un persistir falla → rollback y no se llama a billetera.
  await db.enTransaccion(async (tx) => {
    await repository.insertar(tx, deposito);
    await pipeline.persistirTransformadores(deposito, tx, contexto);
  });

  await repository.cambiarEstado(db.pool, deposito.id, 'PENDIENTE', 'PROCESANDO');
  return acreditarYCerrar(deposito, contexto);
}

// RD-R08: sin consultar la cuenta ni repetir validadores ni transformadores. Acredita con
// monto_acreditar, moneda_acreditar, usuario_id y canal guardados (body idéntico → replay USD).
async function reintentar(depositoId, usuario, correlationId) {
  const fila = await repository.buscarPorId(db.pool, depositoId);
  if (fila === null) throw new Error(`El depósito ${depositoId} del reintento no existe`);

  if (fila.estado !== 'COMPLETADO' && fila.estado !== 'FALLIDO') {
    throw new ErrorApp('SOLICITUD_EN_PROCESO', { depositoId });
  }

  const contexto = armarContexto(usuario, null, correlationId);

  // RD-R09. Se lee antes de cambiar de estado: si falla, el depósito sigue FALLIDO y no se acredita.
  const extensiones = await pipeline.leerExtensiones(depositoId, contexto);
  if (fila.estado === 'COMPLETADO') return aJson(fila, extensiones);

  await repository.cambiarEstado(db.pool, depositoId, 'FALLIDO', 'PROCESANDO');
  return acreditarYCerrar(depositoDesdeFila(fila, extensiones), contexto);
}

module.exports = { registrar, reintentar };
