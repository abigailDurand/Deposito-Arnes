'use strict';

const express = require('express');

// SPEC-02 §5: mock en memoria de billetera-service [POR ACORDAR].
const PUERTO = 4000;
const DEMORA_LENTA_MS = 6000;

// Cuentas PEN compartidas (§4)
const CUENTAS_PEN = {
  '0011-0123-456789': { estado: 'ACTIVA', moneda: 'PEN', titularId: 'usr-cliente-1' },
  '0011-0123-000002': { estado: 'ACTIVA', moneda: 'PEN', titularId: 'usr-cliente-2' },
  '0011-0123-000003': { estado: 'BLOQUEADA', moneda: 'PEN', titularId: 'usr-cliente-1' },
  '0011-0123-999999': { estado: 'ACTIVA', moneda: 'PEN', titularId: null },
  '0011-0123-888888': { estado: 'ACTIVA', moneda: 'PEN', titularId: null },
};

// Billeteras USD compartidas (§4)
const WALLETS_USD = {
  '11111111-1111-4111-8111-111111111111': {
    user_id: 'usr-cliente-1',
    nombre: 'Cliente Uno',
    balance: '350.75',
    moneda: 'USD',
  },
  '22222222-2222-4222-8222-222222222222': {
    user_id: 'usr-cliente-2',
    nombre: 'Cliente Dos',
    balance: '100.00',
    moneda: 'USD',
  },
  '99999999-9999-4999-8999-999999999999': {
    user_id: 'usr-cliente-1',
    nombre: 'Falla',
    balance: '0.00',
    moneda: 'USD',
  },
  '88888888-8888-4888-8888-888888888888': {
    user_id: 'usr-cliente-1',
    nombre: 'Lenta',
    balance: '0.00',
    moneda: 'USD',
  },
};

const CUENTA_FALLA_PEN = '0011-0123-999999';
const CUENTA_LENTA_PEN = '0011-0123-888888';
const WALLET_FALLA_USD = '99999999-9999-4999-8999-999999999999';
const WALLET_LENTA_USD = '88888888-8888-4888-8888-888888888888';

// INT-R09: memoria de acreditaciones
const acreditadosPen = new Set();
const idempotenciaUsd = new Map(); // key -> JSON.stringify(body)

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const app = express();
app.use(express.json());

// ==========================================
// Rutas Billetera PEN
// ==========================================

app.get('/api/v1/cuentas/:numero', (req, res) => {
  const { numero } = req.params;
  const cuenta = CUENTAS_PEN[numero];
  if (!cuenta) return res.status(404).json({ mensaje: 'La cuenta no existe.' });
  return res.status(200).json({ numero, ...cuenta });
});

app.post('/api/v1/cuentas/:numero/creditos', async (req, res, next) => {
  try {
    const { numero } = req.params;
    if (!CUENTAS_PEN[numero]) return res.status(404).json({ mensaje: 'La cuenta no existe.' });

    const { depositoId, monto, moneda, concepto } = req.body || {};
    if (typeof depositoId !== 'string' || !depositoId || typeof monto !== 'string') {
      return res.status(400).json({ mensaje: 'Faltan depositoId o monto.' });
    }
    if (numero === CUENTA_FALLA_PEN) return res.status(500).json({ mensaje: 'Falla simulada.' });
    if (numero === CUENTA_LENTA_PEN) await esperar(DEMORA_LENTA_MS);

    if (acreditadosPen.has(depositoId)) {
      return res.status(409).json({ mensaje: 'Ese depositoId ya fue acreditado.', depositoId });
    }
    acreditadosPen.add(depositoId);
    return res.status(201).json({ depositoId, numero, monto, moneda, concepto });
  } catch (err) {
    return next(err);
  }
});

// ==========================================
// Rutas Billetera USD
// ==========================================

app.get('/api/v1/billetera/wallets/:id', (req, res) => {
  const { id } = req.params;
  const wallet = WALLETS_USD[id];
  if (!wallet) return res.status(404).json({ mensaje: 'La billetera no existe.' });
  return res.status(200).json({ id, ...wallet });
});

app.post('/api/v1/depositos/usd', async (req, res, next) => {
  try {
    const key = req.headers['idempotency-key'];
    if (!key) return res.status(400).json({ mensaje: 'Idempotency-Key requerida.' });

    const { cliente_id, cuenta_destino_id, monto, moneda, metodo_origen, referencia_externa } = req.body || {};
    if (!cliente_id || !cuenta_destino_id || !monto) {
      return res.status(400).json({ mensaje: 'Faltan campos requeridos.' });
    }

    if (cuenta_destino_id === WALLET_FALLA_USD) {
      return res.status(500).json({ mensaje: 'Falla simulada USD.' });
    }
    if (cuenta_destino_id === WALLET_LENTA_USD) {
      await esperar(DEMORA_LENTA_MS);
    }

    const payloadSerializado = JSON.stringify(req.body);

    if (idempotenciaUsd.has(key)) {
      const previo = idempotenciaUsd.get(key);
      if (previo !== payloadSerializado) {
        return res.status(409).json({
          codigo: 'IDEMPOTENCY_CONFLICT',
          mensaje: 'La clave de idempotencia fue utilizada con datos distintos.',
        });
      }
      // Replay exitoso (200)
      return res.status(200).json({
        id: key,
        cliente_id,
        cuenta_destino_id,
        monto,
        moneda,
        metodo_origen,
        referencia_externa,
        estado: 'COMPLETADO',
      });
    }

    idempotenciaUsd.set(key, payloadSerializado);
    return res.status(201).json({
      id: key,
      cliente_id,
      cuenta_destino_id,
      monto,
      moneda,
      metodo_origen,
      referencia_externa,
      estado: 'COMPLETADO',
    });
  } catch (err) {
    return next(err);
  }
});

app.listen(PUERTO, () => {
  process.stdout.write(`billetera-mock escuchando en el puerto ${PUERTO}\n`);
});
