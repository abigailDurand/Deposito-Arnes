'use strict';

const crypto = require('node:crypto');
const { Writable } = require('node:stream');
const express = require('express');
const nock = require('nock');
const request = require('supertest');

const { crearApp } = require('../../../src/app');
const { pool: poolApp } = require('../../../src/core/db');
const billetera = require('../../helpers/billetera');
const { limpiar, cerrar, pool } = require('../../helpers/db');
const { token } = require('../../helpers/tokens');

const CUENTA = '0011-0123-456789';
const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// SPEC-03 §6: app Express mínima con el orden de PIP-R11:
// correlationId → /health → autenticar → rutas → manejadorErrores.
function crearAppPrueba({ correlationId, autenticar, requiereRol, manejadorErrores }) {
  const app = express();
  app.use(correlationId);
  app.get('/health', (req, res) => res.json({ estado: 'ok' }));
  app.use(autenticar);
  app.get('/yo', (req, res) => res.json({ usuario: req.usuario }));
  app.get('/solo-agente', requiereRol('AGENTE'), (req, res) => res.json({ ok: true }));
  app.get('/agente-o-cajero', requiereRol('AGENTE', 'CAJERO'), (req, res) => res.json({ ok: true }));
  app.get('/cuentas/:numero/depositos', (req, res) => res.json({ numero: req.params.numero }));
  app.post('/cuentas/:numero/depositos', () => {
    throw new Error('fallo forzado');
  });
  app.use(manejadorErrores);
  return app;
}

function cargarModulos() {
  const correlationId = require('../../../src/core/middlewares/correlationId');
  const { autenticar, requiereRol } = require('../../../src/core/middlewares/auth');
  const manejadorErrores = require('../../../src/core/middlewares/manejadorErrores');
  return { correlationId, autenticar, requiereRol, manejadorErrores };
}

const app = crearAppPrueba(cargarModulos());

function bearer(t) {
  return { Authorization: `Bearer ${t}` };
}

async function esperar401(headers, codigo) {
  const res = await request(app).get('/yo').set(headers);
  expect(res.status).toBe(401);
  expect(res.body).toEqual({
    codigo,
    mensaje: expect.any(String),
    correlationId: res.headers['x-correlation-id'],
  });
  expect(res.body.correlationId).toMatch(PATRON_UUID);
  return res;
}

beforeEach(limpiar);

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await poolApp.end();
  await cerrar();
});

describe('autenticar (SEG-R04 a SEG-R08)', () => {
  test('SEG-T01 sin header Authorization → 401 TOKEN_REQUERIDO', async () => {
    const res = await esperar401({}, 'TOKEN_REQUERIDO');
    expect(res.body.mensaje).toBe('Falta el token.');
  });

  test('SEG-T01 Authorization que no es Bearer <token> → 401 TOKEN_REQUERIDO', async () => {
    await esperar401({ Authorization: 'Basic dXNyOnB3ZA==' }, 'TOKEN_REQUERIDO');
    await esperar401({ Authorization: 'Bearer ' }, 'TOKEN_REQUERIDO');
    await esperar401({ Authorization: token('usr-agente-1') }, 'TOKEN_REQUERIDO');
  });

  test('SEG-T02 token con exp en el pasado → 401 TOKEN_EXPIRADO', async () => {
    const vencido = token('usr-agente-1', { exp: Math.floor(Date.now() / 1000) - 60 });
    const res = await esperar401(bearer(vencido), 'TOKEN_EXPIRADO');
    expect(res.body.mensaje).toBe('Token vencido.');
  });

  test('SEG-T03 token firmado con otra clave → 401 TOKEN_INVALIDO', async () => {
    const { privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    await esperar401(bearer(token('usr-agente-1', { clave: privateKey })), 'TOKEN_INVALIDO');
  });

  test('SEG-T04 token con alg: none → 401 TOKEN_INVALIDO', async () => {
    const sinFirma = token('usr-agente-1', { alg: 'none' });
    expect(sinFirma.endsWith('.')).toBe(true);
    await esperar401(bearer(sinFirma), 'TOKEN_INVALIDO');
  });

  test('SEG-T05 token con aud distinto → 401 TOKEN_INVALIDO', async () => {
    await esperar401(bearer(token('usr-agente-1', { aud: 'otra-api' })), 'TOKEN_INVALIDO');
  });

  test('SEG-R06: token mal formado → 401 TOKEN_INVALIDO', async () => {
    await esperar401(bearer('no.es.un-jwt'), 'TOKEN_INVALIDO');
  });

  describe('SEG-R06 payload firmado correctamente pero incompleto', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const jwt = require('jsonwebtoken');
    const config = require('../../../src/config');

    // Misma clave privada de prueba que usa tests/helpers/tokens.js (generada por globalSetup).
    function firmar(campos) {
      const privada = fs.readFileSync(path.join(__dirname, '..', '..', '.tmp', 'privada.pem'), 'utf8');
      const payload = {
        iss: config.jwt.issuer,
        aud: config.jwt.audience,
        exp: Math.floor(Date.now() / 1000) + 3600,
        ...campos,
      };
      return jwt.sign(payload, privada, { algorithm: 'RS256', noTimestamp: true });
    }

    test('SEG-R06 control: el mismo firmado con sub y roles → 200', async () => {
      const res = await request(app).get('/yo').set(bearer(firmar({ sub: 'usr-agente-1', roles: ['AGENTE'] })));
      expect(res.status).toBe(200);
    });

    test('SEG-R06 token sin sub → 401 TOKEN_INVALIDO', async () => {
      await esperar401(bearer(firmar({ roles: ['AGENTE'] })), 'TOKEN_INVALIDO');
    });

    test('SEG-R06 token con sub vacío → 401 TOKEN_INVALIDO', async () => {
      await esperar401(bearer(firmar({ sub: '', roles: ['AGENTE'] })), 'TOKEN_INVALIDO');
    });

    test('SEG-R06 token con roles: [] → 401 TOKEN_INVALIDO', async () => {
      await esperar401(bearer(firmar({ sub: 'usr-agente-1', roles: [] })), 'TOKEN_INVALIDO');
    });

    test('SEG-R06 token sin roles → 401 TOKEN_INVALIDO', async () => {
      await esperar401(bearer(firmar({ sub: 'usr-agente-1' })), 'TOKEN_INVALIDO');
    });

    test('SEG-R06 token con roles que no es arreglo → 401 TOKEN_INVALIDO', async () => {
      await esperar401(bearer(firmar({ sub: 'usr-agente-1', roles: 'AGENTE' })), 'TOKEN_INVALIDO');
    });
  });

  test('SEG-R08: token válido → req.usuario = { id: sub, roles }', async () => {
    const res = await request(app).get('/yo').set(bearer(token('usr-agente-1')));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ usuario: { id: 'usr-agente-1', roles: ['AGENTE'] } });
  });

  test('GET /health se monta antes de autenticar y responde sin token', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ estado: 'ok' });
  });
});

describe('requiereRol (SEG-R09)', () => {
  test('SEG-T10 requiereRol(\'AGENTE\') con token CLIENTE → 403 SIN_PERMISO', async () => {
    const res = await request(app)
      .get('/solo-agente')
      .set({ ...bearer(token('usr-cliente-1')), 'X-Correlation-Id': 'abc-123' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      codigo: 'SIN_PERMISO',
      mensaje: 'El rol o la cuenta no permiten la operación.',
      correlationId: 'abc-123',
    });
  });

  test('rol permitido pasa; con varios roles permitidos basta uno', async () => {
    const agente = await request(app).get('/solo-agente').set(bearer(token('usr-agente-1')));
    expect(agente.status).toBe(200);
    const cajero = await request(app).get('/agente-o-cajero').set(bearer(token('usr-cajero-1')));
    expect(cajero.status).toBe(200);
    const cliente = await request(app).get('/agente-o-cajero').set(bearer(token('usr-cliente-2')));
    expect(cliente.status).toBe(403);
    expect(cliente.body.codigo).toBe('SIN_PERMISO');
  });

  test('sin req.usuario → SIN_PERMISO; sin roles al construir → error de programación', () => {
    const { requiereRol } = cargarModulos();
    const next = jest.fn();
    requiereRol('AGENTE')({}, {}, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].codigo).toBe('SIN_PERMISO');
    expect(() => requiereRol()).toThrow();
  });
});

// SPEC-07 ya existe: ruta real con crearApp, PostgreSQL real y billetera con nock (extensiones inactivas).
describe('SEG-T06 titular de la cuenta', () => {
  // SPEC-02 §4 (v2.0): 0011-0123-000002 es ACTIVA PEN con titular usr-cliente-2.
  const CUENTA_AJENA = '0011-0123-000002';
  const MANIFEST = {
    version: 1,
    servicio: 'deposito-service',
    features: [
      { id: 'registrar-deposito', estado: 'activo', tipo: 'endpoint' },
      { id: 'limites-por-canal', estado: 'inactivo', tipo: 'validador', orden: 10 },
      { id: 'conversion-moneda', estado: 'inactivo', tipo: 'transformador', orden: 10 },
      { id: 'alerta-uif', estado: 'inactivo', tipo: 'post-proceso', orden: 10 },
    ],
  };

  beforeAll(() => {
    nock.disableNetConnect();
    nock.enableNetConnect(/127\.0\.0\.1|localhost/);
  });

  // AUD-R03: la auditoría se escribe en res.on('finish'), después de que supertest recibe la
  // respuesta. Si el TRUNCATE de limpiar() (siguiente beforeEach) coincide con ese INSERT,
  // PostgreSQL detecta un deadlock. Se espera a que el pool de la app quede sin consultas en curso
  // y a que el conteo de auditoria_depositos sea estable (mismo patrón que registrar.test.js).
  async function esperarAuditoria() {
    const pausa = (ms) => new Promise((r) => { setTimeout(r, ms); });
    const ocioso = () => poolApp.waitingCount === 0 && poolApp.totalCount === poolApp.idleCount;
    let previo = -1;
    let estables = 0;
    for (let i = 0; i < 100 && estables < 2; i += 1) {
      await pausa(25);
      const { rows } = await pool.query('SELECT count(*)::int AS n FROM auditoria_depositos');
      estables = ocioso() && rows[0].n === previo ? estables + 1 : 0;
      previo = rows[0].n;
    }
  }

  afterEach(async () => {
    await esperarAuditoria();
    nock.abortPendingRequests();
    nock.cleanAll();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  test('SEG-T06 usr-cliente-1 deposita a 0011-0123-000002 → 403; billetera no recibe acreditación', async () => {
    const app = crearApp({ manifest: MANIFEST });
    // La cuenta es PEN y ACTIVA y la moneda coincide: si no fuera por el titular, el depósito pasaría.
    const consulta = billetera.cuentaActiva(CUENTA_AJENA);
    const credito = billetera.acreditaOk(CUENTA_AJENA);

    const res = await request(app)
      .post('/api/v1/depositos')
      .set(bearer(token('usr-cliente-1')))
      .set('Idempotency-Key', 'seg-t06-clave')
      .set('X-Correlation-Id', 'seg-t06')
      .send({ cuentaDestino: CUENTA_AJENA, monto: '100.00', moneda: 'PEN', canal: 'APP' });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      codigo: 'SIN_PERMISO',
      mensaje: 'El rol o la cuenta no permiten la operación.',
      correlationId: 'seg-t06',
    });
    expect(consulta.peticiones).toHaveLength(1);
    expect(credito.peticiones).toHaveLength(0);
    const { rows } = await pool.query('SELECT id FROM depositos');
    expect(rows).toHaveLength(0);

    // La auditoría escribe después de responder: se espera su fila antes de terminar la prueba.
    let auditadas = [];
    for (let i = 0; i < 50 && auditadas.length === 0; i += 1) {
      ({ rows: auditadas } = await pool.query('SELECT resultado, usuario_id FROM auditoria_depositos'));
      if (auditadas.length === 0) await new Promise((r) => { setTimeout(r, 20); });
    }
    expect(auditadas).toEqual([{ resultado: 'ERROR_403', usuario_id: 'usr-cliente-1' }]);
  });

  test('SEG-T06 control: usr-cliente-1 deposita por APP a su cuenta 0011-0123-456789 → 201 y una acreditación', async () => {
    const app = crearApp({ manifest: MANIFEST });
    billetera.cuentaActiva(CUENTA);
    const credito = billetera.acreditaOk(CUENTA);

    const res = await request(app)
      .post('/api/v1/depositos')
      .set(bearer(token('usr-cliente-1')))
      .set('Idempotency-Key', 'seg-t06-control')
      .send({ cuentaDestino: CUENTA, monto: '100.00', moneda: 'PEN', canal: 'APP' });

    expect(res.status).toBe(201);
    expect(res.body.estado).toBe('COMPLETADO');
    expect(credito.peticiones).toHaveLength(1);

    let auditadas = [];
    for (let i = 0; i < 50 && auditadas.length === 0; i += 1) {
      ({ rows: auditadas } = await pool.query('SELECT resultado FROM auditoria_depositos'));
      if (auditadas.length === 0) await new Promise((r) => { setTimeout(r, 20); });
    }
    expect(auditadas).toEqual([{ resultado: 'EXITO' }]);
  });

  test('SEG-T06 control: usr-cliente-2 (titular) deposita por APP a 0011-0123-000002 → 201 y una acreditación', async () => {
    const app = crearApp({ manifest: MANIFEST });
    billetera.cuentaActiva(CUENTA_AJENA);
    const credito = billetera.acreditaOk(CUENTA_AJENA);

    const res = await request(app)
      .post('/api/v1/depositos')
      .set(bearer(token('usr-cliente-2')))
      .set('Idempotency-Key', 'seg-t06-control-2')
      .send({ cuentaDestino: CUENTA_AJENA, monto: '100.00', moneda: 'PEN', canal: 'APP' });

    expect(res.status).toBe(201);
    expect(res.body.estado).toBe('COMPLETADO');
    expect(credito.peticiones).toHaveLength(1);
    expect(credito.peticiones[0].body).toMatchObject({ monto: '100.00', moneda: 'PEN' });
  });
});

describe('correlationId (SEG-R01, SEG-R02)', () => {
  test('SEG-T08 sin X-Correlation-Id → la respuesta trae uno no vacío; con abc → trae abc', async () => {
    const sin = await request(app).get('/health');
    expect(sin.headers['x-correlation-id']).toMatch(PATRON_UUID);

    const otro = await request(app).get('/health');
    expect(otro.headers['x-correlation-id']).not.toBe(sin.headers['x-correlation-id']);

    const con = await request(app).get('/health').set('X-Correlation-Id', 'abc');
    expect(con.headers['x-correlation-id']).toBe('abc');
  });

  test('SEG-T08 el correlation id recibido sale también en el header y cuerpo de un error', async () => {
    const res = await request(app).get('/yo').set('X-Correlation-Id', 'abc');
    expect(res.status).toBe(401);
    expect(res.headers['x-correlation-id']).toBe('abc');
    expect(res.body.correlationId).toBe('abc');
  });

  test('SEG-R01: id con caracteres no permitidos o de más de 100 → se genera uno nuevo', async () => {
    const limite = 'a'.repeat(100);
    const ok = await request(app).get('/health').set('X-Correlation-Id', limite);
    expect(ok.headers['x-correlation-id']).toBe(limite);

    for (const invalido of ['a'.repeat(101), 'a b', 'abc;rm', 'abc.def']) {
      const res = await request(app).get('/health').set('X-Correlation-Id', invalido);
      expect(res.headers['x-correlation-id']).toMatch(PATRON_UUID);
    }
  });
});

describe('log de cada petición (SEG-R03, PRY-R10)', () => {
  // Pino real con las opciones reales de src/core/logger.js; solo se redirige el destino y se
  // sube LOG_LEVEL a info durante la carga (el entorno de pruebas usa silent).
  function appConLogCapturado() {
    const lineas = [];
    const destino = new Writable({
      write(chunk, _enc, cb) {
        lineas.push(chunk.toString());
        cb();
      },
    });
    let modulos;
    const nivelOriginal = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = 'info';
    try {
      jest.isolateModules(() => {
        jest.doMock('pino', () => {
          const pinoReal = jest.requireActual('pino');
          return (opciones) => pinoReal(opciones, destino);
        });
        modulos = cargarModulos();
      });
    } finally {
      process.env.LOG_LEVEL = nivelOriginal;
      jest.dontMock('pino');
    }
    return { app: crearAppPrueba(modulos), lineas };
  }

  async function registroDePeticion(lineas, correlationId) {
    for (let i = 0; i < 50; i += 1) {
      const encontrado = lineas
        .map((l) => JSON.parse(l))
        .find((r) => r.msg === 'Petición atendida' && r.correlationId === correlationId);
      if (encontrado) return encontrado;
      await new Promise((r) => setImmediate(r));
    }
    throw new Error('no se escribió el log de la petición');
  }

  test('SEG-T09 error 500 forzado → el log no contiene el token ni la cuenta completa; sí status y duración', async () => {
    const { app: appLog, lineas } = appConLogCapturado();
    const jwtCliente = token('usr-cliente-1');

    const res = await request(appLog)
      .post(`/cuentas/${CUENTA}/depositos?cuenta=${CUENTA}`)
      .set({ ...bearer(jwtCliente), 'X-Correlation-Id': 'seg-t09' })
      .send({ cuentaDestino: CUENTA, monto: '150.00', moneda: 'PEN' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ codigo: 'ERROR_INTERNO', mensaje: 'Error no controlado.', correlationId: 'seg-t09' });

    const registro = await registroDePeticion(lineas, 'seg-t09');
    expect(registro).toMatchObject({
      level: 30,
      correlationId: 'seg-t09',
      usuarioId: 'usr-cliente-1',
      metodo: 'POST',
      status: 500,
    });
    expect(Number.isInteger(registro.duracionMs)).toBe(true);
    expect(registro.duracionMs).toBeGreaterThanOrEqual(0);
    expect(registro.ruta).toBe('/cuentas/****-****-456789/depositos');

    const todo = lineas.join('');
    expect(lineas.length).toBeGreaterThan(0);
    expect(todo).not.toContain(jwtCliente);
    expect(todo).not.toContain(jwtCliente.split('.')[2]);
    expect(todo).not.toContain(CUENTA);
    expect(todo).not.toContain('0011-0123');
  });

  test('SEG-R03: petición rechazada en autenticar → se registra con usuarioId null y status 401', async () => {
    const { app: appLog, lineas } = appConLogCapturado();
    const vencido = token('usr-agente-1', { exp: Math.floor(Date.now() / 1000) - 60 });

    await request(appLog).get('/yo').set({ ...bearer(vencido), 'X-Correlation-Id': 'seg-r03' });

    const registro = await registroDePeticion(lineas, 'seg-r03');
    expect(registro).toMatchObject({ usuarioId: null, metodo: 'GET', ruta: '/yo', status: 401 });
    expect(typeof registro.duracionMs).toBe('number');
    expect(lineas.join('')).not.toContain(vencido);
  });
});
