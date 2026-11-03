'use strict';

const path = require('node:path');

const { registrarErrores } = require('./errores');
const pipeline = require('./pipeline');

const DIR_MODULOS = path.join(__dirname, '..', 'modules');
const TIPOS = ['endpoint', ...Object.keys(pipeline.HUECO_POR_TIPO)];

// El catálogo de errores es global: si crearApp se llama varias veces con el mismo módulo, sus
// errores ya están registrados y registrarErrores lanzaría por código repetido.
const erroresRegistrados = new WeakSet();

// PIP-R09: la feature debe existir en src/modules/<id>/. Se distingue "no existe la carpeta"
// de un error interno del módulo (por ejemplo, una dependencia suya que falta).
function requerirModulo(id) {
  const ruta = path.join(DIR_MODULOS, id);
  if (path.dirname(ruta) !== DIR_MODULOS) {
    throw new Error(`La feature activa "${id}" no existe en src/modules/`);
  }
  try {
    return require(ruta);
  } catch (err) {
    if (err?.code === 'MODULE_NOT_FOUND' && String(err.message).includes(ruta)) {
      throw new Error(`La feature activa "${id}" no existe en src/modules/`);
    }
    throw err;
  }
}

function validarFeature(feature) {
  if (!feature || typeof feature.id !== 'string' || feature.id === '') {
    throw new Error('Manifest inválido: cada feature necesita un id');
  }
  if (!TIPOS.includes(feature.tipo)) {
    throw new Error(`Manifest inválido: tipo "${feature.tipo}" desconocido en "${feature.id}"`);
  }
  if (feature.tipo !== 'endpoint' && !Number.isFinite(feature.orden)) {
    throw new Error(`Manifest inválido: la extensión "${feature.id}" necesita un orden numérico`);
  }
}

// SPEC-06 §4: contrato de un módulo.
function validarModulo(feature, modulo) {
  if (!modulo || modulo.tipo !== feature.tipo) {
    throw new Error(
      `La feature "${feature.id}" es de tipo "${modulo?.tipo}" y el manifest dice "${feature.tipo}"`,
    );
  }
  if (modulo.id !== feature.id) {
    throw new Error(`La feature "${feature.id}" exporta el id "${modulo.id}"`);
  }
  if (feature.tipo === 'endpoint' && typeof modulo.router !== 'function') {
    throw new Error(`La feature "${feature.id}" no exporta un router`);
  }
  if (feature.tipo !== 'endpoint' && typeof modulo.ejecutar !== 'function') {
    throw new Error(`La feature "${feature.id}" no exporta ejecutar`);
  }
  // SPEC-06 §4: un validador solo declara errores 422.
  if (feature.tipo === 'validador') {
    const otroStatus = Object.entries(modulo.errores || {})
      .find(([, definicion]) => definicion?.status !== 422);
    if (otroStatus) {
      throw new Error(`El validador "${feature.id}" declara ${otroStatus[0]} con status ≠ 422`);
    }
  }
}

// PIP-R08..R10: valida todo antes de tocar el catálogo o el pipeline, así un manifest inválido
// no deja nada a medias. Devuelve los routers de los endpoints activos, en el orden del manifest.
function cargar(manifest) {
  if (!manifest || !Array.isArray(manifest.features)) {
    throw new Error('Manifest inválido: falta la lista features');
  }

  const activas = manifest.features.filter((feature) => feature?.estado === 'activo');
  const ids = new Set();
  const cargadas = activas.map((feature) => {
    validarFeature(feature);
    if (ids.has(feature.id)) throw new Error(`Manifest inválido: "${feature.id}" está repetida`);
    ids.add(feature.id);
    // PIP-R08: solo se hace require de las activas.
    const modulo = requerirModulo(feature.id);
    validarModulo(feature, modulo);
    return { feature, modulo };
  });

  // PIP-R10
  for (const { modulo } of cargadas) {
    if (modulo.errores && !erroresRegistrados.has(modulo.errores)) {
      registrarErrores(modulo.errores);
      erroresRegistrados.add(modulo.errores);
    }
  }

  pipeline.reiniciar();
  const routers = [];
  for (const { feature, modulo } of cargadas) {
    if (feature.tipo === 'endpoint') routers.push(modulo.router);
    else pipeline.registrar(modulo, feature.orden);
  }
  return { routers };
}

module.exports = { cargar };
