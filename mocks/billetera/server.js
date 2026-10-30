'use strict';

const express = require('express');

// SPEC-02 §5: mock en memoria de billetera-service [POR ACORDAR]. Solo para probar a mano con
// docker compose; las pruebas automáticas usan nock (tests/helpers/billetera.js).
const PUERTO = 4000;
const DEMORA_LENTA_MS = 6000;

// SPEC-02 §4: datos de prueba compartidos. No se agregan otros.
const CUENTAS = {
  '0011-0123-456789': { estado: 'ACTIVA', moneda: 'PEN', titularId: 'usr-cliente-1' },
  '0011-0123-000002': { estado: 'ACTIVA', moneda: 'USD', titularId: 'usr-cliente-2' },
  '0011-0123-000003': { estado: 'BLOQUEADA', moneda: 'PEN', titularId: 'usr-cliente-1' },
  // Cuentas especiales del mock. §4 no les asigna titular: null (solo AGENTE/CAJERO depositan).
  '0011-0123-999999': { estado: 'ACTIVA', moneda: 'PEN', titularId: null },
  '0011-0123-888888': { estado: 'ACTIVA', moneda: 'PEN', titularId: null },
};
const CUENTA_FALLA = '0011-0123-999999';
const CUENTA_LENTA = '0011-0123-888888';

// INT-R09: depositoId ya acreditados, en memoria.
const acreditados = new Set();

function esperar(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const app = express();
app.use(express.json());

app.get('/api/v1/cuentas/:numero', (req, res) => {
  const { numero } = req.params;
  const cuenta = CUENTAS[numero];
  if (!cuenta) return res.status(404).json({ mensaje: 'La cuenta no existe.' });
  return res.status(200).json({ numero, ...cuenta });
});

app.post('/api/v1/cuentas/:numero/creditos', async (req, res, next) => {
  try {
    const { numero } = req.params;
    if (!CUENTAS[numero]) return res.status(404).json({ mensaje: 'La cuenta no existe.' });

    const { depositoId, monto, moneda, concepto } = req.body || {};
    if (typeof depositoId !== 'string' || !depositoId || typeof monto !== 'string') {
      return res.status(400).json({ mensaje: 'Faltan depositoId o monto.' });
    }
    if (numero === CUENTA_FALLA) return res.status(500).json({ mensaje: 'Falla simulada.' });
    if (numero === CUENTA_LENTA) await esperar(DEMORA_LENTA_MS);

    if (acreditados.has(depositoId)) {
      return res.status(409).json({ mensaje: 'Ese depositoId ya fue acreditado.', depositoId });
    }
    acreditados.add(depositoId);
    return res.status(201).json({ depositoId, numero, monto, moneda, concepto });
  } catch (err) {
    return next(err);
  }
});

app.listen(PUERTO, () => {
  process.stdout.write(`billetera-mock escuchando en el puerto ${PUERTO}\n`);
});
