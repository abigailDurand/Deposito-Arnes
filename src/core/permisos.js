'use strict';

const { ErrorApp } = require('./errores');

// SPEC-03 §4: canal desde el que opera cada rol.
const CANAL_POR_ROL = Object.freeze({
  CLIENTE: 'APP',
  AGENTE: 'AGENTE',
  CAJERO: 'VENTANILLA',
});

function rolesDe(usuario) {
  return Array.isArray(usuario?.roles) ? usuario.roles : [];
}

// SEG-R10 / SEG-R13: con varios roles basta con que uno corresponda al canal.
function verificarCanal(usuario, canal) {
  const permitido = rolesDe(usuario)
    .some((rol) => Object.hasOwn(CANAL_POR_ROL, rol) && CANAL_POR_ROL[rol] === canal);
  if (!permitido) throw new ErrorApp('SIN_PERMISO');
}

// SEG-R12
function esTitular(usuario, cuenta) {
  return cuenta != null
    && usuario?.id != null
    && cuenta.titularId === usuario.id;
}

// SEG-R11: solo el canal APP (CLIENTE) exige ser titular; AGENTE y VENTANILLA depositan a cualquiera.
function verificarTitular(usuario, canal, cuenta) {
  if (canal === CANAL_POR_ROL.CLIENTE && !esTitular(usuario, cuenta)) {
    throw new ErrorApp('SIN_PERMISO');
  }
}

module.exports = { verificarCanal, verificarTitular, esTitular, CANAL_POR_ROL };
