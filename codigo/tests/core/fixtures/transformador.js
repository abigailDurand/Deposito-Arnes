'use strict';

const registro = require('./registro');

// Transformador falso: devuelve un depósito NUEVO con su marca en extensiones y guarda en
// contexto.privado lo que luego lee su persistir (PIP-R07).
function crearTransformador(id) {
  return {
    id,
    tipo: 'transformador',
    async ejecutar(deposito, contexto) {
      registro.llamadas.push({ id, fase: 'ejecutar', deposito, contexto });
      if (registro.lanzar.has(id)) {
        const err = new Error(`fallo de prueba en ${id}`);
        err.code = '23505';
        throw err;
      }
      contexto.privado.marca = `privado-${id}`;
      return { ...deposito, extensiones: { ...deposito.extensiones, [id]: { aplicado: true } } };
    },
    async persistir(deposito, tx, contexto) {
      registro.llamadas.push({ id, fase: 'persistir', deposito, tx, contexto });
      if (registro.lanzar.has(`${id}:persistir`)) throw new Error(`persistir falló en ${id}`);
    },
    async leerExtension(depositoId, contexto) {
      registro.llamadas.push({ id, fase: 'leerExtension', depositoId, contexto });
      return Object.hasOwn(registro.extensiones, id) ? registro.extensiones[id] : null;
    },
  };
}

module.exports = { crearTransformador };
