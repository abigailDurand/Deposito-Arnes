'use strict';

const { ErrorApp } = require('./errores');
const { logger } = require('./logger');

// Hueco de cada tipo de extensión. El pipeline no conoce ninguna feature por su nombre:
// solo lo que el cargador registra según el manifest.
const HUECO_POR_TIPO = Object.freeze({
  validador: 'validadores',
  transformador: 'transformadores',
  'post-proceso': 'postProcesos',
});

let huecos = huecosVacios();

function huecosVacios() {
  return { validadores: [], transformadores: [], postProcesos: [] };
}

// Lo llama el cargador antes de registrar: cada crearApp parte de huecos vacíos.
function reiniciar() {
  huecos = huecosVacios();
}

// Inserción estable: a igual orden se conserva el orden de registro (el del manifest).
function registrar(modulo, orden) {
  const nombreHueco = HUECO_POR_TIPO[modulo.tipo];
  if (!nombreHueco) throw new Error(`Tipo de extensión desconocido: ${modulo.tipo}`);
  const hueco = huecos[nombreHueco];
  const posicion = hueco.findIndex((entrada) => entrada.orden > orden);
  const entrada = { id: modulo.id, orden, modulo };
  if (posicion === -1) hueco.push(entrada);
  else hueco.splice(posicion, 0, entrada);
}

// PIP-R07: un `privado` por módulo y por contexto; el mismo objeto llega a ejecutar y a persistir
// mientras el service pase el mismo `contexto`.
const privadosPorContexto = new WeakMap();

function privadoDe(id, contexto) {
  let privados = privadosPorContexto.get(contexto);
  if (!privados) {
    privados = new Map();
    privadosPorContexto.set(contexto, privados);
  }
  if (!privados.has(id)) privados.set(id, {});
  return privados.get(id);
}

// SPEC-06 §4: contexto.logger = logger.child({ correlationId, modulo: id }).
function contextoDe(id, contexto) {
  return {
    ...contexto,
    logger: logger.child({ correlationId: contexto.correlationId ?? null, modulo: id }),
    privado: privadoDe(id, contexto),
  };
}

// PRY-R10: sin el error completo (el `detail` de PostgreSQL puede traer valores de la fila).
function datosDelError(err) {
  return { error: err?.message ?? String(err), codigoError: err?.code ?? null };
}

// PIP-R01: en orden ascendente; el primero que lanza corta y su error se propaga tal cual.
async function ejecutarValidadores(deposito, contexto) {
  for (const { id, modulo } of huecos.validadores) {
    await modulo.ejecutar(deposito, contextoDe(id, contexto));
  }
}

// PIP-R02: en cadena; cualquier error sale como 500 ERROR_INTERNO.
async function ejecutarTransformadores(deposito, contexto) {
  let actual = deposito;
  for (const { id, modulo } of huecos.transformadores) {
    const contextoModulo = contextoDe(id, contexto);
    try {
      actual = await modulo.ejecutar(actual, contextoModulo);
    } catch (err) {
      contextoModulo.logger.error(
        { depositoId: actual?.id ?? null, ...datosDelError(err) },
        'Falló un transformador',
      );
      throw new ErrorApp('ERROR_INTERNO');
    }
  }
  return actual;
}

// PIP-R03: dentro de la tx del service; si uno lanza, se propaga y el service hace rollback.
async function persistirTransformadores(deposito, tx, contexto) {
  for (const { id, modulo } of huecos.transformadores) {
    if (typeof modulo.persistir === 'function') {
      await modulo.persistir(deposito, tx, contextoDe(id, contexto));
    }
  }
}

// PIP-R04: un post-proceso que falla se registra y se sigue con el siguiente. Nunca lanza.
async function ejecutarPostProcesos(deposito, contexto) {
  for (const { id, modulo } of huecos.postProcesos) {
    let contextoModulo;
    try {
      contextoModulo = contextoDe(id, contexto);
      await modulo.ejecutar(deposito, contextoModulo);
    } catch (err) {
      const log = contextoModulo ? contextoModulo.logger : logger.child({ modulo: id });
      log.error(
        { depositoId: deposito?.id ?? null, ...datosDelError(err) },
        'Falló un post-proceso',
      );
    }
  }
}

// PIP-R05: { [id]: objeto } de cada extensión activa con leerExtension; se omiten los null.
async function leerExtensiones(depositoId, contexto) {
  const extensiones = {};
  const todas = [...huecos.validadores, ...huecos.transformadores, ...huecos.postProcesos];
  for (const { id, modulo } of todas) {
    if (typeof modulo.leerExtension !== 'function') continue;
    const objeto = await modulo.leerExtension(depositoId, contextoDe(id, contexto));
    if (objeto !== null && objeto !== undefined) extensiones[id] = objeto;
  }
  return extensiones;
}

module.exports = {
  HUECO_POR_TIPO,
  reiniciar,
  registrar,
  ejecutarValidadores,
  ejecutarTransformadores,
  persistirTransformadores,
  ejecutarPostProcesos,
  leerExtensiones,
};
