'use strict';

const billeteraClient = require('../../core/clients/billeteraClient');
const db = require('../../core/db');
const { aJson } = require('../../core/depositoMapper');
const { ErrorApp } = require('../../core/errores');
const { logger } = require('../../core/logger');
const permisos = require('../../core/permisos');
const pipeline = require('../../core/pipeline');
const repository = require('./repository');

const ROLES_OPERADOR = Object.freeze(['AGENTE', 'CAJERO']);

function tieneRol(usuario, roles) {
  const propios = Array.isArray(usuario?.roles) ? usuario.roles : [];
  return propios.some((rol) => roles.includes(rol));
}

// CD-R02 (1ª condición)
function loRegistro(usuario, fila) {
  return tieneRol(usuario, ROLES_OPERADOR)
    && usuario?.id != null
    && fila.usuario_id === usuario.id;
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

// Diagrama de §3. CD-R05: sin permiso → 404, igual que si no existiera.
async function consultar(id, usuario, correlationId) {
  const fila = await repository.buscarPorId(db.pool, id);
  if (fila === null) throw new ErrorApp('DEPOSITO_NO_ENCONTRADO');

  let cuenta = null;
  if (!loRegistro(usuario, fila)) {
    // CD-R03: billetera solo si es CLIENTE y no se cumplió la 1ª condición.
    if (!tieneRol(usuario, ['CLIENTE'])) throw new ErrorApp('DEPOSITO_NO_ENCONTRADO');
    // CD-R06: un fallo de billetera ya llega como BILLETERA_NO_DISPONIBLE (INT-R04).
    cuenta = await billeteraClient.consultarCuenta(fila.cuenta_destino, correlationId);
    // CD-R04: cuenta null → esTitular devuelve false.
    if (!permisos.esTitular(usuario, cuenta)) throw new ErrorApp('DEPOSITO_NO_ENCONTRADO');
  }

  // CD-R07
  const contexto = armarContexto(usuario, cuenta, correlationId);
  return aJson(fila, await pipeline.leerExtensiones(id, contexto));
}

module.exports = { consultar };
