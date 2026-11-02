'use strict';

const { z } = require('zod');

// RD-R01 / RD-R02: forma y formato. El valor del monto (> 0, 2 decimales) es del service (RD-R03).
const esquemaDeposito = z.object({
  cuentaDestino: z.string().regex(/^\d{4}-\d{4}-\d{6}$/),
  monto: z.string().regex(/^-?\d{1,13}(\.\d+)?$/),
  moneda: z.enum(['PEN', 'USD']),
  canal: z.enum(['AGENTE', 'VENTANILLA', 'APP']),
  referencia: z.string().min(1).max(140).optional(),
}).strict();

module.exports = { esquemaDeposito };
