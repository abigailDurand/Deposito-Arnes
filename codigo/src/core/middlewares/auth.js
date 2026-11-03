'use strict';

const jwt = require('jsonwebtoken');

const config = require('../../config');
const { ErrorApp } = require('../errores');

const PATRON_BEARER = /^Bearer[ ]+(\S+)[ ]*$/i;

// SEG-R05: aunque la configuración lo incluyera, 'none' nunca se acepta.
const ALGORITMOS = config.jwt.algorithms.filter((alg) => alg.toLowerCase() !== 'none');

function payloadValido(payload) {
  return Boolean(payload)
    && typeof payload.sub === 'string'
    && payload.sub !== ''
    && Array.isArray(payload.roles)
    && payload.roles.length > 0;
}

// Global, salvo /health: crearApp (SPEC-06, PIP-R11) lo monta después de GET /health.
// SEG-R07: se valida localmente con JWT_PUBLIC_KEY; nunca se llama a usuario-service.
function autenticar(req, res, next) {
  const cabecera = req.get('Authorization');
  const coincidencia = typeof cabecera === 'string' ? PATRON_BEARER.exec(cabecera) : null;
  // SEG-R04
  if (!coincidencia) return next(new ErrorApp('TOKEN_REQUERIDO'));

  let payload;
  try {
    // SEG-R05
    payload = jwt.verify(coincidencia[1], config.jwt.publicKey, {
      algorithms: ALGORITMOS,
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
    });
  } catch (err) {
    // SEG-R06
    const codigo = err instanceof jwt.TokenExpiredError ? 'TOKEN_EXPIRADO' : 'TOKEN_INVALIDO';
    return next(new ErrorApp(codigo));
  }

  if (!payloadValido(payload)) return next(new ErrorApp('TOKEN_INVALIDO'));

  // SEG-R08
  req.usuario = { id: payload.sub, roles: [...payload.roles] };
  return next();
}

// SEG-R09: basta con que uno de los roles del usuario esté en la lista (SEG-R13).
function requiereRol(...roles) {
  if (roles.length === 0) throw new Error('requiereRol necesita al menos un rol');
  return function verificarRol(req, res, next) {
    const rolesUsuario = Array.isArray(req.usuario?.roles) ? req.usuario.roles : [];
    if (!rolesUsuario.some((rol) => roles.includes(rol))) {
      return next(new ErrorApp('SIN_PERMISO'));
    }
    return next();
  };
}

module.exports = { autenticar, requiereRol };
