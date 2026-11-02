'use strict';

const registro = require('./registro');

function crearPostProceso(id) {
  return {
    id,
    tipo: 'post-proceso',
    async ejecutar(deposito, contexto) {
      registro.llamadas.push({ id, fase: 'ejecutar', deposito, contexto });
      if (registro.lanzar.has(id)) throw new Error(`post-proceso ${id} falló`);
    },
    async leerExtension(depositoId, contexto) {
      registro.llamadas.push({ id, fase: 'leerExtension', depositoId, contexto });
      return Object.hasOwn(registro.extensiones, id) ? registro.extensiones[id] : null;
    },
  };
}

module.exports = { crearPostProceso };
