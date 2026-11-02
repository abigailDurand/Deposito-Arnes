'use strict';

const request = require('supertest');

const { pool: poolApp } = require('../../../src/core/db');
const { crearApp } = require('../../../src/app');
const { limpiar, cerrar, pool } = require('../../helpers/db');
const { token } = require('../../helpers/tokens');

// Sin endpoints reales (SPEC-07 pending): POST /api/v1/depositos igual se audita (AUD-R02) y
// responde 401 (sin token) o 404 (con token), lo que basta para ver el orden de PIP-R11.
const MANIFEST = { version: 1, servicio: 'deposito-service', features: [] };

// SPEC-04 §6: la fila se escribe después de responder → reintentos cortos hasta 1 s.
async function filasAuditoria(minimo = 1, limiteMs = 1000) {
  const inicio = Date.now();
  for (;;) {
    const { rows } = await pool.query(
      `SELECT usuario_id, accion, ip, canal, monto::text AS monto, resultado, correlation_id
         FROM auditoria_depositos ORDER BY id`,
    );
    if (rows.length >= minimo || Date.now() - inicio >= limiteMs) return rows;
    await new Promise((r) => setTimeout(r, 20));
  }
}

beforeEach(limpiar);

afterAll(async () => {
  await poolApp.end();
  await cerrar();
});

describe('SPEC-06 · crearApp con PostgreSQL real (arrastre de SPEC-04)', () => {
  test('PIP-R11 TRUST_PROXY=1 → auditoría registra req.ip = último salto de X-Forwarded-For', async () => {
    const app = crearApp({ manifest: MANIFEST });

    const res = await request(app)
      .post('/api/v1/depositos')
      .set('X-Forwarded-For', '198.51.100.1, 203.0.113.7')
      .set('X-Correlation-Id', 'corr-xff-0001')
      .send({ cuentaDestino: '0011-0123-456789', monto: '150.00', moneda: 'PEN', canal: 'AGENTE' });

    expect(res.status).toBe(401);
    expect(res.body.codigo).toBe('TOKEN_REQUERIDO');
    const filas = await filasAuditoria();
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      usuario_id: null,
      accion: 'CREAR_DEPOSITO',
      ip: '203.0.113.7',
      resultado: 'ERROR_401',
      correlation_id: 'corr-xff-0001',
    });
  });

  test('PIP-R11 sin X-Forwarded-For → ip de la conexión, no un valor inventado', async () => {
    const app = crearApp({ manifest: MANIFEST });

    await request(app).post('/api/v1/depositos').expect(401);

    const filas = await filasAuditoria();
    expect(filas).toHaveLength(1);
    expect(filas[0].ip).toMatch(/127\.0\.0\.1|::1/);
  });

  test('PIP-R11 auditoria antes de autenticar y express.json antes del 404: fila con usuario, canal y monto', async () => {
    const app = crearApp({ manifest: MANIFEST });

    const res = await request(app)
      .post('/api/v1/depositos')
      .set('Authorization', `Bearer ${token('usr-agente-1')}`)
      .set('X-Forwarded-For', '203.0.113.7')
      .send({ cuentaDestino: '0011-0123-456789', monto: '150.00', moneda: 'PEN', canal: 'AGENTE' });

    expect(res.status).toBe(404);
    expect(res.body.codigo).toBe('RUTA_NO_ENCONTRADA');
    const filas = await filasAuditoria();
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      usuario_id: 'usr-agente-1',
      accion: 'CREAR_DEPOSITO',
      ip: '203.0.113.7',
      canal: 'AGENTE',
      monto: '150.00',
      resultado: 'ERROR_404',
      correlation_id: res.headers['x-correlation-id'],
    });
  });

  test('PIP-R11 GET /health y rutas no auditadas no escriben en auditoria_depositos', async () => {
    const app = crearApp({ manifest: MANIFEST });

    await request(app).get('/health').expect(200, { estado: 'ok' });
    await request(app).get('/api/v1/no-existe').set('Authorization', `Bearer ${token('usr-cajero-1')}`).expect(404);

    const filas = await filasAuditoria(1, 300);
    expect(filas).toEqual([]);
  });
});
