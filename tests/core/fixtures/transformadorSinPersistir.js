'use strict';

const registro = require('./registro');

module.exports = {
  id: 'fx-transformador-sin-persistir',
  tipo: 'transformador',
  async ejecutar(deposito, contexto) {
    registro.llamadas.push({ id: 'fx-transformador-sin-persistir', fase: 'ejecutar', deposito, contexto });
    return deposito;
  },
};
