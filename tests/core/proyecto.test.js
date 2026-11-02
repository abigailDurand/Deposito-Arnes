'use strict';

const { Writable } = require('node:stream');

const { cargarConfig } = require('../../src/config');

// Entorno mínimo válido (las 4 obligatorias de SPEC-00 §5); cada prueba parte de una copia.
function envBase() {
  return {
    DATABASE_URL: 'postgres://deposito:deposito@localhost:5432/deposito_test',
    JWT_PUBLIC_KEY: '-----BEGIN PUBLIC KEY-----\\nABC\\n-----END PUBLIC KEY-----',
    BILLETERA_URL: 'http://billetera.test',
    BILLETERA_TOKEN: 'token-de-prueba',
  };
}

describe('SPEC-00 · proyecto', () => {
  test('PRY-T01 GET /health sin token → 200 { "estado": "ok" }', async () => {
    const request = require('supertest');
    const { crearApp } = require('../../src/app');
    // Manifest a medida: con el real, cargar() exige src/modules/* (SPEC-07..12 pending).
    const app = crearApp({ manifest: { version: 1, servicio: 'deposito-service', features: [] } });

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ estado: 'ok' });
    expect(res.headers['x-correlation-id']).toEqual(expect.any(String));
  });

  test('PRY-T02 config.js sin DATABASE_URL → lanza error con el nombre de la variable', () => {
    const env = envBase();
    delete env.DATABASE_URL;
    expect(() => cargarConfig(env)).toThrow(/DATABASE_URL/);
  });

  test('PRY-T02 require de config.js sin DATABASE_URL en process.env → el servicio no arranca', () => {
    const original = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      jest.isolateModules(() => {
        expect(() => require('../../src/config')).toThrow(/DATABASE_URL/);
      });
    } finally {
      process.env.DATABASE_URL = original;
    }
  });

  test('PRY-T03 enmascararCuenta("0011-0123-456789") → "****-****-456789"', () => {
    const { enmascararCuenta } = require('../../src/core/logger');
    expect(enmascararCuenta('0011-0123-456789')).toBe('****-****-456789');
  });
});

describe('SPEC-00 §5 · variables de entorno de config.js', () => {
  test.each(['JWT_PUBLIC_KEY', 'BILLETERA_URL', 'BILLETERA_TOKEN'])(
    'obligatoria %s ausente → error con su nombre',
    (nombre) => {
      const env = envBase();
      delete env[nombre];
      expect(() => cargarConfig(env)).toThrow(new RegExp(nombre));
    },
  );

  test('obligatoria vacía cuenta como ausente', () => {
    const env = { ...envBase(), DATABASE_URL: '   ' };
    expect(() => cargarConfig(env)).toThrow(/DATABASE_URL/);
  });

  test('valores por defecto de §5', () => {
    const c = cargarConfig(envBase());
    expect(c.port).toBe(3000);
    expect(c.logLevel).toBe('info');
    expect(c.trustProxy).toBe(1);
    expect(c.manifestPath).toBe('specs-v2/manifest.yaml');
    expect(c.jwt.algorithms).toEqual(['RS256']);
    expect(c.jwt.issuer).toBe('usuario-service');
    expect(c.jwt.audience).toBe('banco-api');
    expect(c.idempotenciaDias).toBe(7);
    expect(c.billetera).toEqual({
      url: 'http://billetera.test',
      token: 'token-de-prueba',
      timeoutMs: 5000,
    });
    expect(c.databaseUrl).toBe('postgres://deposito:deposito@localhost:5432/deposito_test');
  });

  test('UIF_UMBRAL_* opcionales: ausentes → null; presentes → string (PRY-R06, nunca Number)', () => {
    expect(cargarConfig(envBase()).uif).toEqual({ umbralPEN: null, umbralUSD: null });
    const c = cargarConfig({ ...envBase(), UIF_UMBRAL_PEN: '1000.00', UIF_UMBRAL_USD: '300.00' });
    expect(c.uif).toEqual({ umbralPEN: '1000.00', umbralUSD: '300.00' });
  });

  test('JWT_PUBLIC_KEY acepta "\\n" escritos y los convierte en saltos reales', () => {
    const c = cargarConfig(envBase());
    expect(c.jwt.publicKey).toBe('-----BEGIN PUBLIC KEY-----\nABC\n-----END PUBLIC KEY-----');
    expect(c.jwt.publicKey).not.toContain('\\n');
  });

  test('valores explícitos sobrescriben los por defecto', () => {
    const c = cargarConfig({
      ...envBase(),
      PORT: '8080',
      LOG_LEVEL: 'debug',
      TRUST_PROXY: 'loopback',
      MANIFEST_PATH: 'otro/manifest.yaml',
      JWT_ALGORITHMS: 'RS256, RS512',
      IDEMPOTENCIA_DIAS: '3',
      BILLETERA_TIMEOUT_MS: '1500',
    });
    expect(c.port).toBe(8080);
    expect(c.logLevel).toBe('debug');
    expect(c.trustProxy).toBe('loopback');
    expect(c.manifestPath).toBe('otro/manifest.yaml');
    expect(c.jwt.algorithms).toEqual(['RS256', 'RS512']);
    expect(c.idempotenciaDias).toBe(3);
    expect(c.billetera.timeoutMs).toBe(1500);
  });

  test('variable entera inválida → error con su nombre', () => {
    expect(() => cargarConfig({ ...envBase(), PORT: 'abc' })).toThrow(/PORT/);
  });
});

describe('SPEC-00 §2 / PRY-R10 · logger', () => {
  test('enmascararCuenta sin guiones deja visibles solo los 6 últimos dígitos', () => {
    const { enmascararCuenta } = require('../../src/core/logger');
    expect(enmascararCuenta('00110123456789')).toBe('********456789');
  });

  test('enmascararCuenta con un valor no string lo devuelve igual', () => {
    const { enmascararCuenta } = require('../../src/core/logger');
    expect(enmascararCuenta(undefined)).toBeUndefined();
  });

  test('el logger redacta req.headers.authorization y nunca escribe el token', () => {
    const lineas = [];
    const destino = new Writable({
      write(chunk, _enc, cb) {
        lineas.push(chunk.toString());
        cb();
      },
    });
    let logger;
    const nivelOriginal = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = 'info';
    try {
      jest.isolateModules(() => {
        // Se usa el pino real y las opciones reales del logger; solo se cambia el destino.
        jest.doMock('pino', () => {
          const pinoReal = jest.requireActual('pino');
          return (opciones) => pinoReal(opciones, destino);
        });
        ({ logger } = require('../../src/core/logger'));
      });
    } finally {
      process.env.LOG_LEVEL = nivelOriginal;
      jest.dontMock('pino');
    }

    logger.info({ req: { headers: { authorization: 'Bearer secreto.jwt.token' } } }, 'peticion');

    expect(lineas).toHaveLength(1);
    const registro = JSON.parse(lineas[0]);
    expect(registro.req.headers.authorization).toBe('[REDACTED]');
    expect(lineas[0]).not.toContain('secreto.jwt.token');
  });
});
