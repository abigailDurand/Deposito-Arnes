'use strict';

const { ErrorApp } = require('../../core/errores');
const { esquemaNumero, esquemaQuery } = require('./schema');
const service = require('./service');

// PRY-R02: lee la petición, llama al service y responde.
async function listar(req, res) {
  const numero = esquemaNumero.safeParse(req.params.numero);
  if (!numero.success) throw new ErrorApp('FORMATO_INVALIDO');
  const filtros = esquemaQuery.safeParse(req.query);
  if (!filtros.success) throw new ErrorApp('FORMATO_INVALIDO');

  const resultado = await service.listar(
    numero.data,
    filtros.data,
    req.usuario,
    req.correlationId,
  );
  res.status(200).json(resultado);
}

module.exports = { listar };
