'use strict';

const billeteraClient = require('../../core/clients/billeteraClient');
const db = require('../../core/db');
const { aJson } = require('../../core/depositoMapper');
const { ErrorApp } = require('../../core/errores');
const permisos = require('../../core/permisos');
const repository = require('./repository');

const ROLES_OPERADOR = Object.freeze(['AGENTE', 'CAJERO']);

function tieneRol(usuario, roles) {
  const propios = Array.isArray(usuario?.roles) ? usuario.roles : [];
  return propios.some((rol) => roles.includes(rol));
}

// Diagrama de §3.
async function listar(numero, filtros, usuario, correlationId) {
  const { pagina, tamano, estado, desde, hasta } = filtros;
  const criterios = {
    cuenta: numero,
    estado,
    desde,
    hasta,
    limite: tamano,
    desplazamiento: (pagina - 1) * tamano,
  };

  if (tieneRol(usuario, ROLES_OPERADOR)) {
    // HD-R04: solo los propios; no se llama a billetera.
    if (usuario?.id == null) throw new ErrorApp('SIN_PERMISO');
    criterios.usuarioId = usuario.id;
  } else {
    // HD-R05: billetera 404 → null → esTitular false. 5xx/timeout → 502 (INT-R04).
    const cuenta = await billeteraClient.consultarCuenta(numero, correlationId);
    if (!permisos.esTitular(usuario, cuenta)) throw new ErrorApp('SIN_PERMISO');
  }

  const [filas, total] = await Promise.all([
    repository.listar(db.pool, criterios),
    repository.contar(db.pool, criterios),
  ]);

  // HD-R08: sin `extensiones`.
  return { datos: filas.map((fila) => aJson(fila)), pagina, tamano, total };
}

module.exports = { listar };
