'use strict';

const crypto = require('node:crypto');
const Decimal = require('decimal.js');

const config = require('../../config');
const billeteraClient = require('../../core/clients/billeteraClient');
const db = require('../../core/db');
const { aJson } = require('../../core/depositoMapper');
const { ErrorApp } = require('../../core/errores');
const { logger } = require('../../core/logger');
const permisos = require('../../core/permisos');
const pipeline = require('../../core/pipeline');
const repository = require('./repository');

const CUENTA_ACTIVA = 'ACTIVA';
// RD-R13: tope de depósitos que toma cada ciclo de reconciliación ("hasta un lote").
const LOTE_RECONCILIACION = 50;

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
    titularId: fila.titular_id ?? null,
    montoAcreditar: new Decimal(fila.monto_acreditar),
    monedaAcreditar: fila.moneda_acreditar,
    extensiones,
  };
}

// INT-R05 / INT-R12 en un solo resultado: 'ACREDITADO' | 'PENDIENTE' | 'RECHAZADO' |
// 'CUENTA_INACTIVA' | 'BILLETERA_NO_DISPONIBLE'. Los datos salen del depósito (guardados en un
// reintento o una reconciliación), así el body a Billetera USD es idéntico (RD-R08, INT-R06).
async function pedirAcreditacion(deposito, correlationId) {
  try {
    const { estado } = await billeteraClient.acreditar({
      depositoId: deposito.id,
      cuenta: deposito.cuentaDestino,
      monto: deposito.montoAcreditar,
      moneda: deposito.monedaAcreditar,
      titularId: deposito.titularId,
      canal: deposito.canal,
    }, correlationId);
    return estado;
  } catch (err) {
    if (!(err instanceof ErrorApp)) throw err;
    return err.codigo === 'CUENTA_INACTIVA' ? 'CUENTA_INACTIVA' : 'BILLETERA_NO_DISPONIBLE';
  }
}

// `alt` del diagrama de §3: el depósito ya está en PROCESANDO (`filaProcesando`).
async function acreditarYCerrar(deposito, filaProcesando, contexto) {
  const resultado = await pedirAcreditacion(deposito, contexto.correlationId);

  // RD-R12: sigue en PROCESANDO, sin post-procesos; el controller responde 202.
  if (resultado === 'PENDIENTE') return aJson(filaProcesando, deposito.extensiones);

  if (resultado !== 'ACREDITADO') {
    await repository.cambiarEstado(db.pool, deposito.id, 'PROCESANDO', 'FALLIDO');
    // RD-R11: CUENTA_INACTIVA (422, TERMINADO en idempotencia); el resto, incluido RECHAZADO
    // (RD-R08), es 502 y la clave queda REINTENTABLE.
    const codigo = resultado === 'CUENTA_INACTIVA' ? 'CUENTA_INACTIVA' : 'BILLETERA_NO_DISPONIBLE';
    throw new ErrorApp(codigo, { depositoId: deposito.id });
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
  // RD-R11: en ambas billeteras.
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
    titularId: cuenta.titularId,
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

  const fila = await repository.cambiarEstado(db.pool, deposito.id, 'PENDIENTE', 'PROCESANDO');
  return acreditarYCerrar(deposito, fila, contexto);
}

// RD-R08: sin consultar la cuenta ni repetir validadores ni transformadores. Acredita con
// monto_acreditar, moneda_acreditar, titular_id y canal guardados (body idéntico → replay USD).
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

  const filaProcesando = await repository
    .cambiarEstado(db.pool, depositoId, 'FALLIDO', 'PROCESANDO');
  return acreditarYCerrar(depositoDesdeFila(fila, extensiones), filaProcesando, contexto);
}

// RD-R13: un depósito del lote, con su fila bloqueada en `tx`. Devuelve el resultado aplicado.
async function reconciliarUno(tx, fila, correlationId, log) {
  let resultado;
  try {
    resultado = await pedirAcreditacion(depositoDesdeFila(fila, {}), correlationId);
  } catch (err) {
    // Error inesperado: no se cambia el estado; se reintenta en el siguiente ciclo.
    log.error(
      { depositoId: fila.id, error: err?.message ?? String(err) },
      'Falló la reconciliación del depósito',
    );
    resultado = 'BILLETERA_NO_DISPONIBLE';
  }

  if (resultado === 'ACREDITADO') {
    const completada = await repository.cambiarEstado(tx, fila.id, 'PROCESANDO', 'COMPLETADO');
    return { resultado, fila: completada };
  }
  if (resultado === 'CUENTA_INACTIVA' || resultado === 'RECHAZADO') {
    await repository.cambiarEstado(tx, fila.id, 'PROCESANDO', 'FALLIDO');
    log.warn({ depositoId: fila.id, resultado }, 'Depósito reconciliado como FALLIDO');
    return { resultado, fila };
  }
  // PENDIENTE o BILLETERA_NO_DISPONIBLE: sigue en PROCESANDO.
  const enProcesandoMs = Date.now() - new Date(fila.actualizado_en).getTime();
  if (enProcesandoMs > config.reconciliacion.alertaMs) {
    log.error(
      { depositoId: fila.id, enProcesandoMs },
      'Depósito USD en PROCESANDO más tiempo que RECONCILIACION_ALERTA_MS',
    );
  }
  return { resultado, fila };
}

// RD-R13: post-procesos fuera de la tx (la fila ya es COMPLETADO para todos), una sola vez: solo
// los ejecuta quien hizo la transición PROCESANDO → COMPLETADO. contexto.cuenta = null
// (SPEC-06 §4).
async function cerrarReconciliado(fila, correlationId, log) {
  const contexto = armarContexto({ id: fila.usuario_id, roles: [] }, null, correlationId);
  try {
    const extensiones = await pipeline.leerExtensiones(fila.id, contexto);
    const deposito = depositoDesdeFila(fila, extensiones);
    deposito.estado = 'COMPLETADO';
    await pipeline.ejecutarPostProcesos(deposito, contexto);
  } catch (err) {
    log.error(
      { depositoId: fila.id, error: err?.message ?? String(err) },
      'No se pudieron ejecutar los post-procesos del depósito reconciliado',
    );
  }
}

// RD-R13: un ciclo. Solo Billetera USD (lo filtra el repository); con FOR UPDATE SKIP LOCKED
// dos ciclos simultáneos no toman el mismo depósito. Devuelve cuántos terminó en cada estado.
async function reconciliar() {
  const { antiguedadMs } = config.reconciliacion;
  const procesados = await db.enTransaccion(async (tx) => {
    const filas = await repository.tomarParaReconciliar(tx, antiguedadMs, LOTE_RECONCILIACION);
    const resultados = [];
    for (const fila of filas) {
      const correlationId = crypto.randomUUID();
      const log = logger.child({ correlationId });
      const aplicado = await reconciliarUno(tx, fila, correlationId, log);
      resultados.push({ ...aplicado, correlationId, log });
    }
    return resultados;
  });

  const resumen = { completados: 0, fallidos: 0, pendientes: 0 };
  for (const { resultado, fila, correlationId, log } of procesados) {
    if (resultado === 'ACREDITADO') {
      resumen.completados += 1;
      await cerrarReconciliado(fila, correlationId, log);
    } else if (resultado === 'CUENTA_INACTIVA' || resultado === 'RECHAZADO') {
      resumen.fallidos += 1;
    } else {
      resumen.pendientes += 1;
    }
  }
  return resumen;
}

module.exports = { registrar, reintentar, reconciliar };
