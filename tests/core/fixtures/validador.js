'use strict';

const { ErrorApp } = require('../../../src/core/errores');
const registro = require('./registro');

// Validador falso: registra la llamada y, si su id está en registro.lanzar, rechaza con su error.
function crearValidador(id, codigo) {
  return {
    id,
    tipo: 'validador',
    errores: { [codigo]: { status: 422, mensaje: `Rechazo de prueba de ${id}.` } },
    async ejecutar(deposito, contexto) {
      registro.llamadas.push({ id, fase: 'ejecutar', deposito, contexto });
      if (registro.lanzar.has(id)) throw new ErrorApp(codigo);
    },
    async leerExtension(depositoId, contexto) {
      registro.llamadas.push({ id, fase: 'leerExtension', depositoId, contexto });
      return Object.hasOwn(registro.extensiones, id) ? registro.extensiones[id] : null;
    },
  };
}

module.exports = { crearValidador };
