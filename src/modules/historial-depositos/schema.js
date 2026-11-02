'use strict';

const { z } = require('zod');

const ESTADOS = ['PENDIENTE', 'PROCESANDO', 'COMPLETADO', 'FALLIDO'];

// HD-R01
const esquemaNumero = z.string().regex(/^\d{4}-\d{4}-\d{6}$/);

// Solo dígitos: rechaza '', '1.5', '1e2', ' 3' y valores repetidos (llegan como arreglo).
function entero({ min, max, porDefecto }) {
  return z.string()
    .regex(/^\d{1,9}$/)
    .transform((valor) => parseInt(valor, 10))
    .pipe(z.number().int().min(min).max(max))
    .optional()
    .default(String(porDefecto));
}

const fechaHora = z.string().datetime({ offset: true }).transform((valor) => new Date(valor));

// HD-R02
const esquemaQuery = z.object({
  pagina: entero({ min: 1, max: Number.MAX_SAFE_INTEGER, porDefecto: 1 }),
  tamano: entero({ min: 1, max: 100, porDefecto: 20 }),
  estado: z.enum(ESTADOS).optional(),
  desde: fechaHora.optional(),
  hasta: fechaHora.optional(),
}).refine(
  ({ desde, hasta }) => desde === undefined || hasta === undefined || desde <= hasta,
);

module.exports = { esquemaNumero, esquemaQuery };
