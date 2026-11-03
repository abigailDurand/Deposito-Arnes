'use strict';

// Estado compartido de los módulos falsos de SPEC-06: qué se llamó y qué módulo debe fallar.
const registro = {
  llamadas: [],
  lanzar: new Set(),
  extensiones: {},
  reiniciar() {
    registro.llamadas.length = 0;
    registro.lanzar.clear();
    registro.extensiones = {};
  },
};

module.exports = registro;
