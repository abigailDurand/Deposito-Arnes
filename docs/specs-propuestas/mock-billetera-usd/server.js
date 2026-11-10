'use strict';

// Mock en memoria de Billetera Digital USD v1.2.0 (docs/referencia/Billetera_USD_openapi_v1.2.0.yaml).
// Solo atiende lo que consume deposito-service. PROPUESTA: no sustituye a mocks/billetera/server.js hasta que
// se aplique docs/specs-propuestas/02-integraciones.md.

const crypto = require('node:crypto');

const express = require('express');

const PUERTO = Number(process.env.PUERTO || 4100);
const DEMORA_LENTA_MS = 6000;
const DEMORA_PENDIENTE_MS = Number(process.env.DEMORA_PENDIENTE_MS || 5000);
const CLIENT_ID = process.env.MOCK_CLIENT_ID || 'deposito-service';
const CLIENT_SECRET = process.env.MOCK_CLIENT_SECRET || 'secreto-solo-para-el-mock';
const TOKEN_EXPIRA_S = 3600;

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RE_MONTO = /^\d+(\.\d{1,2})?$/;
const CAMPOS_DEPOSITO = [
  'cliente_id', 'cuenta_destino_id', 'monto', 'moneda', 'canal', 'metodo_origen', 'referencia_externa',
];
const POLITICA_CANAL = {
  VENTANILLA: ['EFECTIVO'],
  AGENTE: ['EFECTIVO'],
  APP: ['TRANSFERENCIA', 'TARJETA', 'OTRO'],
};
const RECHAZOS = {
  'usr-bloqueada': ['WALLET_BLOCKED', 'billetera bloqueada'],
  'usr-carrera': ['WALLET_BLOCKED', 'billetera bloqueada'],
  'usr-cerrada': ['WALLET_CLOSED', 'billetera cerrada'],
  'usr-cliente-bloqueado': ['CUSTOMER_BLOCKED', 'cliente bloqueado'],
  'usr-sin-usd': ['USD_ACCOUNT_NOT_ENABLED', 'cliente sin cuenta USD'],
};
const PENDIENTES = { 'usr-pendiente': 'COMPLETADO', 'usr-pendiente-falla': 'FALLIDO' };

function billeterasIniciales() {
  const b = (user_id, nombre, balance, estado = 'ACTIVE') => ({
    user_id, nombre, balance, moneda: 'USD', estado,
  });
  return {
    '11111111-1111-4111-8111-111111111111': b('usr-cliente-1', 'Cliente Uno', '350.75'),
    '22222222-2222-4222-8222-222222222222': b('usr-cliente-2', null, '0.00'),
    '33333333-3333-4333-8333-333333333333': b('usr-bloqueada', null, '0.00', 'BLOCKED'),
    '44444444-4444-4444-8444-444444444444': b('usr-cerrada', null, '0.00', 'CLOSED'),
    '55555555-5555-4555-8555-555555555555': b('usr-carrera', null, '0.00'),
    '66666666-6666-4666-8666-666666666666': b('usr-cliente-bloqueado', null, '0.00'),
    '77777777-7777-4777-8777-777777777777': b('usr-sin-usd', null, '0.00'),
    '88888888-8888-4888-8888-888888888888': b('usr-lento', null, '0.00'),
    '99999999-9999-4999-8999-999999999999': b('usr-falla', null, '0.00'),
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa': b('usr-pendiente', null, '0.00'),
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb': b('usr-pendiente-falla', null, '0.00'),
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc': b('usr-falla-una-vez', null, '0.00'),
  };
}

function configInicial() {
  return {
    // Hoy el servidor real publica v1.2.0 pero no exige token.
    exigirOauth: false,
    // true = contrato v1.2.0 estricto. false = deja ver los demás fallos de un cliente que aún no envía `canal`.
    exigirCanal: true,
    // false = respuesta del equipo de Billetera USD: el depósito no actualiza automáticamente el saldo (Q13).
    abonarBilletera: false,
    // Q8 sin confirmar: true = el replay devuelve el estado actual.
    replayEstadoActual: true,
  };
}

let config = configInicial();
let billeteras = billeterasIniciales();
let depositos = new Map(); // clave de idempotencia → { hash, deposito, primero }
let fallosConsumidos = new Set();
let tokens = new Map();
let tokensEmitidos = 0;
let peticiones = [];

function esperar(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function aCentavos(monto) {
  const [entero, decimal = ''] = monto.split('.');
  return BigInt(entero) * 100n + BigInt(decimal.padEnd(2, '0'));
}

function deCentavos(centavos) {
  const texto = centavos.toString().padStart(3, '0');
  return `${texto.slice(0, -2)}.${texto.slice(-2)}`;
}

function billeteraDeCliente(clienteId) {
  return Object.values(billeteras).find((b) => b.user_id === clienteId);
}

function completar(deposito) {
  deposito.estado = 'COMPLETADO';
  deposito.movimiento_saldo_id = `mov_${crypto.randomUUID()}`;
  deposito.completado_en = new Date().toISOString();
  const billetera = billeteraDeCliente(deposito.cliente_id);
  if (config.abonarBilletera && billetera) {
    billetera.balance = deCentavos(aCentavos(billetera.balance) + aCentavos(deposito.monto));
  }
}

// Formato ApiError del contrato.
function error(req, res, status, code, message, extra = {}) {
  return res.status(status).json({
    status,
    code,
    message,
    correlation_id: res.get('X-Correlation-Id'),
    timestamp: new Date().toISOString(),
    ...extra,
  });
}

function hashBody(body) {
  return JSON.stringify(CAMPOS_DEPOSITO.map((campo) => body[campo] ?? null));
}

function validar(body) {
  const permitidos = new Set(CAMPOS_DEPOSITO);
  const extra = Object.keys(body).filter((k) => !permitidos.has(k));
  if (config.exigirCanal && extra.length) return `campos no permitidos: ${extra.join(', ')}`;
  if (typeof body.cliente_id !== 'string' || !body.cliente_id) return 'cliente_id obligatorio';
  if (typeof body.monto !== 'string' || !RE_MONTO.test(body.monto)) return 'monto inválido';
  if (body.moneda !== undefined && body.moneda !== 'USD') return 'solo se acepta USD';
  if (typeof body.metodo_origen !== 'string') return 'metodo_origen obligatorio';
  if (config.exigirCanal && !body.canal) return 'canal obligatorio';
  if (body.canal !== undefined) {
    const metodos = POLITICA_CANAL[body.canal];
    if (!metodos) return 'canal inválido';
    if (!metodos.includes(body.metodo_origen)) return 'metodo_origen no permitido para el canal';
  }
  return null;
}

// Si exigirOauth está activo: 401 sin token válido y 403 sin el scope (Unauthorized, Forbidden).
function requiereScope(scope) {
  return (req, res, next) => {
    if (!config.exigirOauth) return next();
    const [tipo, valor] = (req.get('Authorization') || '').split(' ');
    const token = tipo === 'Bearer' ? tokens.get(valor) : undefined;
    if (!token || token.expira <= Date.now()) {
      res.set('WWW-Authenticate', 'Bearer realm="billetera-usd", error="invalid_token"');
      return error(req, res, 401, 'UNAUTHORIZED', 'access token ausente o inválido');
    }
    if (!token.scopes.includes(scope)) {
      res.set('WWW-Authenticate', `Bearer error="insufficient_scope", scope="${scope}"`);
      return error(req, res, 403, 'INSUFFICIENT_SCOPE', 'el token no posee el scope requerido');
    }
    return next();
  };
}

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const recibido = req.get('X-Correlation-Id');
  res.set('X-Correlation-Id', recibido && RE_UUID.test(recibido) ? recibido : crypto.randomUUID());
  if (!req.path.startsWith('/__mock') && !req.path.startsWith('/health')) {
    const registro = {
      metodo: req.method,
      ruta: req.path,
      clave: req.get('Idempotency-Key') ?? null,
      conToken: Boolean(req.get('Authorization')),
      cuerpo: req.path === '/oauth2/token' ? null : req.body,
    };
    peticiones.push(registro);
    res.on('finish', () => {
      registro.status = res.statusCode;
    });
  }
  next();
});

// ── OAuth 2.0 client credentials ──

app.post('/oauth2/token', (req, res) => {
  const basic = (req.get('Authorization') || '').match(/^Basic (.+)$/);
  const [idBasic, secretoBasic] = basic
    ? Buffer.from(basic[1], 'base64').toString().split(':')
    : [];
  const id = idBasic ?? req.body?.client_id;
  const secreto = secretoBasic ?? req.body?.client_secret;
  if (req.body?.grant_type !== 'client_credentials') {
    return res.status(400).json({ error: 'unsupported_grant_type' });
  }
  if (id !== CLIENT_ID || secreto !== CLIENT_SECRET) {
    return res.status(401).json({ error: 'invalid_client' });
  }
  const accessToken = crypto.randomBytes(24).toString('hex');
  const scope = req.body.scope
    || 'billetera/wallets.read billetera/depositos.read billetera/depositos.write';
  tokens.set(accessToken, { scopes: scope.split(' '), expira: Date.now() + TOKEN_EXPIRA_S * 1000 });
  tokensEmitidos += 1;
  return res.status(200).json({
    access_token: accessToken, token_type: 'Bearer', expires_in: TOKEN_EXPIRA_S, scope,
  });
});

// ── Salud ──

app.get('/health/live', (req, res) => res.status(200).json({ status: 'alive' }));
app.get('/health/ready', (req, res) => res.status(200).json({ status: 'ready', db: 'up', fakes: true }));

// ── Billeteras ──

app.get('/api/v1/billetera/wallets/:id', requiereScope('billetera/wallets.read'), (req, res) => {
  const { id } = req.params;
  if (!RE_UUID.test(id)) return error(req, res, 400, 'VALIDATION_ERROR', 'id inválido');
  const billetera = billeteras[id];
  if (!billetera) return error(req, res, 404, 'NO_ENCONTRADA', 'billetera no encontrada');
  return res.status(200).json({ id, ...billetera });
});

// ── Depósitos USD ──

function responderNuevo(res, deposito) {
  if (deposito.estado === 'VALIDADO') {
    res.set('Location', `/api/v1/depositos/usd/${deposito.deposito_id}`);
    res.set('Retry-After', '5');
    return res.status(202).json(deposito);
  }
  return res.status(201).json(deposito);
}

app.post('/api/v1/depositos/usd', requiereScope('billetera/depositos.write'), async (req, res, next) => {
  try {
    const clave = req.get('Idempotency-Key');
    if (!clave || !RE_UUID_V4.test(clave)) {
      return error(req, res, 400, 'VALIDATION_ERROR', 'Idempotency-Key obligatorio');
    }
    const body = req.body || {};
    const invalido = validar(body);
    if (invalido) return error(req, res, 400, 'VALIDATION_ERROR', invalido);

    const hash = hashBody(body);
    const previo = depositos.get(clave);
    if (previo) {
      if (previo.hash !== hash) {
        return error(req, res, 409, 'IDEMPOTENCY_CONFLICT', 'misma clave con datos diferentes');
      }
      return res.status(200).json(config.replayEstadoActual ? previo.deposito : previo.primero);
    }

    const cliente = body.cliente_id;
    if (RECHAZOS[cliente]) {
      const [codigo, mensaje] = RECHAZOS[cliente];
      return error(req, res, 422, codigo, mensaje);
    }
    if (cliente === 'usr-falla' || (cliente === 'usr-falla-una-vez' && !fallosConsumidos.has(clave))) {
      fallosConsumidos.add(clave);
      res.set('Retry-After', '1');
      return error(req, res, 503, 'BALANCE_UNAVAILABLE', 'Saldos no disponible', { retryable: true });
    }

    const ahora = new Date().toISOString();
    const deposito = {
      deposito_id: crypto.randomUUID(),
      cliente_id: cliente,
      cuenta_destino_id: body.cuenta_destino_id ?? null,
      monto: body.monto,
      moneda: 'USD',
      canal: body.canal ?? null,
      metodo_origen: body.metodo_origen,
      estado: 'VALIDADO',
      movimiento_saldo_id: null,
      creado_en: ahora,
      completado_en: null,
    };

    const final = PENDIENTES[cliente];
    if (final) {
      setTimeout(() => {
        if (final === 'COMPLETADO') completar(deposito);
        else deposito.estado = 'FALLIDO';
      }, DEMORA_PENDIENTE_MS).unref();
    } else {
      completar(deposito);
    }
    const primero = { ...deposito };
    depositos.set(clave, { hash, deposito, primero });

    // Registra primero y tarda después: es el caso ambiguo de un timeout con el depósito ya aceptado.
    if (cliente === 'usr-lento') await esperar(DEMORA_LENTA_MS);
    return responderNuevo(res, primero);
  } catch (err) {
    return next(err);
  }
});

app.get('/api/v1/depositos/usd/:id', requiereScope('billetera/depositos.read'), (req, res) => {
  const registro = [...depositos.values()].find((d) => d.deposito.deposito_id === req.params.id);
  if (!registro) return error(req, res, 404, 'NOT_FOUND', 'depósito no existe');
  return res.status(200).json(registro.deposito);
});

// ── Control de la prueba (no forma parte del contrato) ──

app.get('/__mock/estado', (req, res) => {
  res.status(200).json({
    config,
    peticiones,
    tokensEmitidos,
    acreditacionesEfectivas: depositos.size,
    depositos: [...depositos.entries()].map(([clave, d]) => ({ clave, ...d.deposito })),
    billeteras,
  });
});

app.post('/__mock/config', (req, res) => {
  config = { ...config, ...req.body };
  res.status(200).json(config);
});

app.post('/__mock/peticiones/limpiar', (req, res) => {
  peticiones = [];
  tokensEmitidos = 0;
  res.status(204).end();
});

app.post('/__mock/reiniciar', (req, res) => {
  config = configInicial();
  billeteras = billeterasIniciales();
  depositos = new Map();
  fallosConsumidos = new Set();
  tokens = new Map();
  tokensEmitidos = 0;
  peticiones = [];
  res.status(204).end();
});

app.use((req, res) => error(req, res, 404, 'NOT_FOUND', 'ruta no emulada por el mock'));

app.listen(PUERTO, () => {
  process.stdout.write(`billetera-usd-mock v1.2.0 escuchando en el puerto ${PUERTO}\n`);
});
