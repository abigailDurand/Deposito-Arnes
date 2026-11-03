'use strict';

const { z } = require('zod');

const { ErrorApp } = require('../../core/errores');
const service = require('./service');

// CD-R01
const esquemaId = z.string().uuid();

// PRY-R02: lee la petición, llama al service y responde.
async function consultar(req, res) {
  const validado = esquemaId.safeParse(req.params.id);
  if (!validado.success) throw new ErrorApp('FORMATO_INVALIDO');

  const deposito = await service.consultar(validado.data, req.usuario, req.correlationId);

  // AUD-R06: solo se asigna cuando el depósito existe y el usuario puede verlo.
  res.locals.depositoId = deposito.id;
  res.status(200).json(deposito);
}

module.exports = { consultar };
