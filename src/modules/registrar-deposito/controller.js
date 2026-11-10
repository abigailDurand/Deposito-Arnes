'use strict';

const { ErrorApp } = require('../../core/errores');
const { esquemaDeposito } = require('./schema');
const service = require('./service');

// PRY-R02: lee la petición, llama al service y responde. El reintento lo marca idempotencia (SPEC-05).
async function registrar(req, res) {
  const validado = esquemaDeposito.safeParse(req.body);
  if (!validado.success) throw new ErrorApp('FORMATO_INVALIDO');

  const depositoIdPrevio = req.idempotencia?.depositoIdPrevio;
  const deposito = depositoIdPrevio
    ? await service.reintentar(depositoIdPrevio, req.usuario, req.correlationId)
    : await service.registrar(validado.data, req.usuario, req.correlationId);

  // AUD-R06 / IDE-R08: aquí la fila del depósito ya existe (hay FK).
  res.locals.depositoId = deposito.id;
  // RD-R12: 202 si la acreditación sigue pendiente (PROCESANDO); si no, 201.
  res.status(deposito.estado === 'PROCESANDO' ? 202 : 201).json(deposito);
}

module.exports = { registrar };
