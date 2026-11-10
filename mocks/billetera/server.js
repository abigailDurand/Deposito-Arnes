'use strict';

const crypto = require('node:crypto');

const express = require('express');

// SPEC-02 §5: mock en memoria de la billetera PEN (propuesta) y de Billetera USD
// (docs/referencia/Billetera_USD_openapi_v1.2.0.yaml). Solo para probar a mano con docker compose;
// las pruebas automáticas usan nock (tests/helpers/billetera.js). Rutas USD basadas en
// docs/specs-propuestas/mock-billetera-usd/server.js.
const PUERTO = 4000;
const DEMORA_LENTA_MS = 6000;
// Tiempo hasta que un depósito 202 (VALIDADO) pasa a su estado final (§4: usr-pendiente*).
const DEMORA_PENDIENTE_MS = 5000;
const RETRY_AFTER_S = '5';
// INT-R13: credenciales del cliente OAuth del mock (solo valen contra este mock).
const CLIENT_ID = process.env.MOCK_CLIENT_ID || 'deposito-service';
const CLIENT_SECRET = process.env.MOCK_CLIENT_SECRET || 'secreto-solo-para-el-mock';
const TOKEN_EXPIRA_S = 3600;
const SCOPES_POR_DEFECTO = 'billetera/wallets.read billetera/depositos.write';

// SPEC-02 §4: datos de prueba compartidos. No se agregan otros.
// Las cuentas especiales no tienen titular en §4: null (solo AGENTE/CAJERO depositan).
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
// INT-R09 / INT-R14: el mock nunca cambia balance.
function wallet(userId, estado = 'ACTIVE', nombre = null, balance = '0.00') {
  return { user_id: userId, nombre, balance, moneda: 'USD', estado };
}

const BILLETERAS_USD = {
  '11111111-1111-4111-8111-111111111111': wallet('usr-cliente-1', 'ACTIVE', 'Cliente Uno',
    '350.75'),
  '22222222-2222-4222-8222-222222222222': wallet('usr-cliente-2'),
  '33333333-3333-4333-8333-333333333333': wallet('usr-bloqueada', 'BLOCKED'),
  '44444444-4444-4444-8444-444444444444': wallet('usr-cerrada', 'CLOSED'),
  '55555555-5555-4555-8555-555555555555': wallet('usr-carrera'),
  '66666666-6666-4666-8666-666666666666': wallet('usr-cliente-bloqueado'),
  '77777777-7777-4777-8777-777777777777': wallet('usr-sin-usd'),
  '88888888-8888-4888-8888-888888888888': wallet('usr-lento'),
  '99999999-9999-4999-8999-999999999999': wallet('usr-falla'),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa': wallet('usr-pendiente'),
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb': wallet('usr-pendiente-falla'),
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc': wallet('usr-falla-una-vez'),
};

// §4: como el body no lleva la billetera, los casos especiales dependen de cliente_id.
const RECHAZOS_USD = {
  'usr-bloqueada': ['WALLET_BLOCKED', 'billetera bloqueada'],
  'usr-carrera': ['WALLET_BLOCKED', 'billetera bloqueada'],
  'usr-cerrada': ['WALLET_CLOSED', 'billetera cerrada'],
  'usr-cliente-bloqueado': ['CUSTOMER_BLOCKED', 'cliente bloqueado'],
  'usr-sin-usd': ['USD_ACCOUNT_NOT_ENABLED', 'cliente sin cuenta USD'],
};
const PENDIENTES_USD = { 'usr-pendiente': 'COMPLETADO', 'usr-pendiente-falla': 'FALLIDO' };
const CLIENTE_FALLA = 'usr-falla';
const CLIENTE_FALLA_UNA_VEZ = 'usr-falla-una-vez';
const CLIENTE_LENTO = 'usr-lento';

// Contrato CrearDepositoRequest (additionalProperties: false) y x-channel-method-policy.
const CAMPOS_DEPOSITO_USD = [
  'cliente_id', 'cuenta_destino_id', 'monto', 'moneda', 'canal', 'metodo_origen',
  'referencia_externa',
];
const POLITICA_CANAL = {
  VENTANILLA: ['EFECTIVO'],
  AGENTE: ['EFECTIVO'],
  APP: ['TRANSFERENCIA', 'TARJETA', 'OTRO'],
};
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RE_MONTO = /^\d+(\.\d{1,2})?$/;

// INT-R09: PEN guarda los depositoId acreditados; USD guarda cada Idempotency-Key con su body.
const acreditadosPen = new Set();
const depositosUsd = new Map();
const fallosConsumidos = new Set();
const tokens = new Map();

function esperar(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// Formato ApiError de Billetera USD.
function errorUsd(req, res, status, code, message, extra = {}) {
  return res.status(status).json({
    status,
    code,
    message,
    correlation_id: req.get('X-Correlation-Id') || crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...extra,
  });
}

function bodyCanonico(body) {
  return JSON.stringify(CAMPOS_DEPOSITO_USD.map((campo) => body[campo] ?? null));
}

function validarDepositoUsd(body) {
  const extra = Object.keys(body).filter((campo) => !CAMPOS_DEPOSITO_USD.includes(campo));
  if (extra.length) return `campos no permitidos: ${extra.join(', ')}`;
  if (typeof body.cliente_id !== 'string' || !body.cliente_id) return 'cliente_id obligatorio';
  if (typeof body.monto !== 'string' || !RE_MONTO.test(body.monto)) return 'monto inválido';
  if (body.moneda !== undefined && body.moneda !== 'USD') return 'solo se acepta USD';
  if (typeof body.canal !== 'string' || !POLITICA_CANAL[body.canal]) return 'canal inválido';
  if (!POLITICA_CANAL[body.canal].includes(body.metodo_origen)) {
    return 'metodo_origen no permitido para el canal';
  }
  return null;
}

// INT-R13: como el servidor real durante la transición (Q7), una petición sin Authorization se
// atiende; si trae un Bearer, debe ser un token vigente de este mock con el scope (401 / 403).
function requiereScope(scope) {
  return (req, res, next) => {
    const cabecera = req.get('Authorization');
    if (!cabecera) return next();
    const [tipo, valor] = cabecera.split(' ');
    const token = tipo === 'Bearer' ? tokens.get(valor) : undefined;
    if (!token || token.expira <= Date.now()) {
      res.set('WWW-Authenticate', 'Bearer realm="billetera-usd", error="invalid_token"');
      return errorUsd(req, res, 401, 'UNAUTHORIZED', 'access token ausente o inválido');
    }
    if (!token.scopes.includes(scope)) {
      res.set('WWW-Authenticate', `Bearer error="insufficient_scope", scope="${scope}"`);
      return errorUsd(req, res, 403, 'INSUFFICIENT_SCOPE', 'el token no posee el scope requerido');
    }
    return next();
  };
}

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

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

// ── Billetera USD · OAuth 2.0 client credentials (INT-R13) ──

app.post('/oauth2/token', (req, res) => {
  const basic = (req.get('Authorization') || '').match(/^Basic (.+)$/);
  const [idBasic, secretoBasic] = basic
    ? Buffer.from(basic[1], 'base64').toString().split(':')
    : [];
  const id = idBasic ?? (req.body && req.body.client_id);
  const secreto = secretoBasic ?? (req.body && req.body.client_secret);
  if (!req.body || req.body.grant_type !== 'client_credentials') {
    return res.status(400).json({ error: 'unsupported_grant_type' });
  }
  if (id !== CLIENT_ID || secreto !== CLIENT_SECRET) {
    return res.status(401).json({ error: 'invalid_client' });
  }
  const accessToken = crypto.randomBytes(24).toString('hex');
  const scope = req.body.scope || SCOPES_POR_DEFECTO;
  tokens.set(accessToken, {
    scopes: scope.split(' '),
    expira: Date.now() + TOKEN_EXPIRA_S * 1000,
  });
  return res.status(200).json({
    access_token: accessToken, token_type: 'Bearer', expires_in: TOKEN_EXPIRA_S, scope,
  });
});

// ── Billetera USD · Billeteras ──

app.get('/api/v1/billetera/wallets/:id', requiereScope('billetera/wallets.read'), (req, res) => {
  const { id } = req.params;
  if (!RE_UUID.test(id)) return errorUsd(req, res, 400, 'VALIDATION_ERROR', 'id inválido');
  const billetera = BILLETERAS_USD[id];
  if (!billetera) return errorUsd(req, res, 404, 'NO_ENCONTRADA', 'billetera no encontrada');
  return res.status(200).json({ id, ...billetera });
});

// ── Billetera USD · Depósitos (INT-R09) ──

function completar(deposito) {
  deposito.estado = 'COMPLETADO';
  deposito.movimiento_saldo_id = `mov_${crypto.randomUUID()}`;
  deposito.completado_en = new Date().toISOString();
}

function responderNuevo(res, deposito) {
  if (deposito.estado === 'VALIDADO') {
    res.set('Location', `/api/v1/depositos/usd/${deposito.deposito_id}`);
    res.set('Retry-After', RETRY_AFTER_S);
    return res.status(202).json(deposito);
  }
  return res.status(201).json(deposito);
}

app.post('/api/v1/depositos/usd', requiereScope('billetera/depositos.write'),
  async (req, res, next) => {
    try {
      const clave = req.get('Idempotency-Key');
      if (!clave || !RE_UUID_V4.test(clave)) {
        return errorUsd(req, res, 400, 'VALIDATION_ERROR', 'Idempotency-Key obligatorio');
      }
      const body = req.body || {};
      const invalido = validarDepositoUsd(body);
      if (invalido) return errorUsd(req, res, 400, 'VALIDATION_ERROR', invalido);

      // Replay: misma clave + mismo body → 200 con el estado actual del depósito.
      const previo = depositosUsd.get(clave);
      if (previo) {
        if (previo.canonico !== bodyCanonico(body)) {
          return errorUsd(req, res, 409, 'IDEMPOTENCY_CONFLICT',
            'misma clave con datos diferentes');
        }
        return res.status(200).json(previo.deposito);
      }

      const cliente = body.cliente_id;
      if (RECHAZOS_USD[cliente]) {
        const [codigo, mensaje] = RECHAZOS_USD[cliente];
        return errorUsd(req, res, 422, codigo, mensaje);
      }
      if (cliente === CLIENTE_FALLA
        || (cliente === CLIENTE_FALLA_UNA_VEZ && !fallosConsumidos.has(clave))) {
        fallosConsumidos.add(clave);
        res.set('Retry-After', '1');
        return errorUsd(req, res, 503, 'BALANCE_UNAVAILABLE', 'Saldos no disponible',
          { retryable: true });
      }

      const deposito = {
        deposito_id: crypto.randomUUID(),
        cliente_id: cliente,
        cuenta_destino_id: body.cuenta_destino_id ?? null,
        monto: body.monto,
        moneda: 'USD',
        canal: body.canal,
        metodo_origen: body.metodo_origen,
        estado: 'VALIDADO',
        movimiento_saldo_id: null,
        creado_en: new Date().toISOString(),
        completado_en: null,
      };
      const final = PENDIENTES_USD[cliente];
      if (final) {
        setTimeout(() => {
          if (final === 'COMPLETADO') completar(deposito);
          else deposito.estado = 'FALLIDO';
        }, DEMORA_PENDIENTE_MS).unref();
      } else {
        completar(deposito);
      }
      const primero = { ...deposito };
      depositosUsd.set(clave, { canonico: bodyCanonico(body), deposito });

      // Registra primero y tarda después: un timeout con el depósito ya aceptado (§4).
      if (cliente === CLIENTE_LENTO) await esperar(DEMORA_LENTA_MS);
      return responderNuevo(res, primero);
    } catch (err) {
      return next(err);
    }
  });

app.listen(PUERTO, () => {
  process.stdout.write(`billetera-mock escuchando en el puerto ${PUERTO}\n`);
});
