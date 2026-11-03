'use strict';

const path = require('node:path');

const DIR_MODULOS = path.join(__dirname, '..', '..', '..', 'src', 'modules');

// id del manifest → archivo de fixture. cargar() hace require(src/modules/<id>), así que cada
// id se registra como mock virtual de esa ruta.
const FIXTURES = {
  'fx-validador-diez': 'validadorDiez',
  'fx-validador-veinte': 'validadorVeinte',
  'fx-transformador-a': 'transformadorA',
  'fx-transformador-b': 'transformadorB',
  'fx-transformador-sin-persistir': 'transformadorSinPersistir',
  'fx-post-a': 'postProcesoA',
  'fx-post-b': 'postProcesoB',
  'fx-endpoint': 'endpoint',
  'fx-tipo-equivocado': 'tipoEquivocado',
};

function rutaModulo(id) {
  return path.join(DIR_MODULOS, id);
}

// Debe llamarse con el `jest` del archivo de prueba (los mocks son por archivo).
function registrarFixtures(jestDelTest) {
  for (const [id, archivo] of Object.entries(FIXTURES)) {
    const ruta = path.join(__dirname, archivo);
    jestDelTest.doMock(rutaModulo(id), () => require(ruta), { virtual: true });
  }
}

function manifest(...features) {
  return { version: 1, servicio: 'deposito-service', features };
}

function activa(id, tipo, orden) {
  return orden === undefined ? { id, estado: 'activo', tipo } : { id, estado: 'activo', tipo, orden };
}

function inactiva(id, tipo, orden) {
  return { ...activa(id, tipo, orden), estado: 'inactivo' };
}

module.exports = { DIR_MODULOS, rutaModulo, registrarFixtures, manifest, activa, inactiva };
