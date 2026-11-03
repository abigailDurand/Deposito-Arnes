'use strict';

const crypto = require('node:crypto');

const express = require('express');

// SPEC-02 §5: mock en memoria de la billetera PEN (propuesta) y de Billetera USD
// (Billetera_USD_openapi.yaml v1.1.0). Solo para probar a mano con docker compose; las pruebas
// automáticas usan nock (tests/helpers/billetera.js).
const PUERTO = 4000;
const DEMORA_LENTA_MS = 6000;

// SPEC-02 §4: datos de prueba compartidos. No se agregan otros.
// Las cuentas y billeteras especiales no tienen titular en §4: null (solo AGENTE/CAJERO depositan).
const CUENTAS_PEN = {
  '0011-0123-456789': { estado: 'ACTIVA', moneda: 'PEN', titularId: 'usr-cliente-1' },
  '0011-0123-000002': { estado: 'ACTIVA', moneda: 'PEN', titularId: 'usr-cliente-2' },
  '0011-0123-000003': { estado: 'BLOQUEADA', moneda: 'PEN', titularId: 'usr-cliente-1' },
  '0011-0123-999999': { estado: 'ACTIVA', moneda: 'PEN', titularId: null },
  '0011-0123-888888': { estado: 'ACTIVA', moneda: 'PEN', titularId: null },
};
const CUENTA_PEN_FALLA = '0011-0123-999999';
const CUENTA_PEN_LENTA = '0011-0123-888888';

// nombre y balance existen en el contrato (Wallet) pero deposito-service los ignora (INT-R04).
// Los de 11111111-… son los del ejemplo de §5; el resto, nombre null (nullable) y saldo 0.00.
const BILLETERAS_USD = {
  '11111111-1111-4111-8111-111111111111': {
    user_id: 'usr-cliente-1', nombre: 'Cliente Uno', balance: '350.75', moneda: 'USD',
  },
  '22222222-2222-4222-8222-222222222222': {
    user_id: 'usr-cliente-2', nombre: null, balance: '0.00', moneda: 'USD',
  },
  '99999999-9999-4999-8999-999999999999': {
    user_id: null, nombre: null, balance: '0.00', moneda: 'USD',
  },
  '88888888-8888-4888-8888-888888888888': {
    user_id: null, nombre: null, balance: '0.00', moneda: 'USD',
  },
};
const BILLETERA_USD_FALLA = '99999999-9999-4999-8999-999999999999';
const BILLETERA_USD_LENTA = '88888888-8888-4888-8888-888888888888';
const CAMPOS_DEPOSITO_USD = [
  'cliente_id', 'cuenta_destino_id', 'monto', 'moneda', 'metodo_origen', 'referencia_externa',
];

// INT-R09: PEN guarda los depositoId acreditados; USD guarda cada Idempotency-Key con su body.
const acreditadosPen = new Set();
const depositosUsd = new Map();

function esperar(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// Formato ApiError de Billetera USD.
function errorUsd(req, res, status, code, message) {
  return res.status(status).json({
    status,
    code,
    message,
    correlation_id: req.get('X-Correlation-Id') || crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  });
}

function bodyCanonico(body) {
  return JSON.stringify(CAMPOS_DEPOSITO_USD.map((campo) => body[campo] ?? null));
}

const app = express();
app.use(express.json());

// ── Billetera PEN (propuesta) ──

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
    if (numero === CUENTA_PEN_FALLA) return res.status(500).json({ mensaje: 'Falla simulada.' });
    if (numero === CUENTA_PEN_LENTA) await esperar(DEMORA_LENTA_MS);

    if (acreditadosPen.has(depositoId)) {
      return res.status(409).json({ mensaje: 'Ese depositoId ya fue acreditado.', depositoId });
    }
    acreditadosPen.add(depositoId);
    return res.status(201).json({ depositoId, numero, monto, moneda, concepto });
  } catch (err) {
    return next(err);
  }
});

// ── Billetera USD ──

app.get('/api/v1/billetera/wallets/:id', (req, res) => {
  const { id } = req.params;
  const billetera = BILLETERAS_USD[id];
  if (!billetera) return errorUsd(req, res, 404, 'NOT_FOUND', 'billetera no existe');
  return res.status(200).json({ id, ...billetera });
});

app.post('/api/v1/depositos/usd', async (req, res, next) => {
  try {
    const clave = req.get('Idempotency-Key');
    if (!clave) return errorUsd(req, res, 400, 'VALIDATION_ERROR', 'Idempotency-Key obligatorio');

    const body = req.body || {};
    if (typeof body.cliente_id !== 'string' || !body.cliente_id
      || typeof body.monto !== 'string' || typeof body.metodo_origen !== 'string') {
      return errorUsd(req, res, 400, 'VALIDATION_ERROR', 'faltan campos obligatorios');
    }
    if (!BILLETERAS_USD[body.cuenta_destino_id]) {
      return errorUsd(req, res, 404, 'NOT_FOUND', 'billetera no existe');
    }

    const previo = depositosUsd.get(clave);
    if (previo) {
      if (previo.canonico !== bodyCanonico(body)) {
        return errorUsd(req, res, 409, 'IDEMPOTENCY_CONFLICT', 'misma clave con datos diferentes');
      }
      return res.status(200).json(previo.deposito);
    }

    if (body.cuenta_destino_id === BILLETERA_USD_FALLA) {
      return errorUsd(req, res, 500, 'INTERNAL_ERROR', 'falla simulada');
    }
    if (body.cuenta_destino_id === BILLETERA_USD_LENTA) await esperar(DEMORA_LENTA_MS);

    const ahora = new Date().toISOString();
    const deposito = {
      deposito_id: crypto.randomUUID(),
      cliente_id: body.cliente_id,
      cuenta_destino_id: body.cuenta_destino_id,
      monto: body.monto,
      moneda: body.moneda || 'USD',
      estado: 'COMPLETADO',
      movimiento_saldo_id: null,
      creado_en: ahora,
      completado_en: ahora,
    };
    depositosUsd.set(clave, { canonico: bodyCanonico(body), deposito });
    return res.status(201).json(deposito);
  } catch (err) {
    return next(err);
  }
});

app.listen(PUERTO, () => {
  process.stdout.write(`billetera-mock escuchando en el puerto ${PUERTO}\n`);
});
