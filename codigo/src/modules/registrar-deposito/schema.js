'use strict';

const { z } = require('zod');

// RD-R01 / RD-R02: forma y formato (cuenta PEN de 14 dígitos o UUID minúsculas para USD).
const RE_CUENTA = /^(?:\d{4}-\d{4}-\d{6}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

const esquemaDeposito = z.object({
  cuentaDestino: z.string().regex(RE_CUENTA),
  monto: z.string().regex(/^-?\d{1,13}(\.\d+)?$/),
  moneda: z.enum(['PEN', 'USD']),
  canal: z.enum(['AGENTE', 'VENTANILLA', 'APP']),
  referencia: z.string().min(1).max(140).optional(),
}).strict();

module.exports = { esquemaDeposito };
