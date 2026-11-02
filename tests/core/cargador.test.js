'use strict';

const request = require('supertest');

const { catalogo, ErrorApp } = require('../../src/core/errores');
const { cargar } = require('../../src/core/cargador');
const pipeline = require('../../src/core/pipeline');
const { crearApp } = require('../../src/app');
const registro = require('./fixtures/registro');
const endpointFalso = require('./fixtures/endpoint');
const {
  registrarFixtures, rutaModulo, manifest, activa, inactiva,
} = require('./fixtures/modulos');
const { token } = require('../helpers/tokens');

registrarFixtures(jest);

function bearer(usuario) {
  return { Authorization: `Bearer ${token(usuario)}` };
}

const deposito = () => ({ id: '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d', extensiones: {} });
const contexto = () => ({ correlationId: 'corr-cargador-1' });

beforeEach(() => {
  registro.reiniciar();
  pipeline.reiniciar();
});

describe('SPEC-06 · cargador', () => {
  test('PIP-T07 feature activa inexistente → cargar lanza', () => {
    expect(() => cargar(manifest(activa('fx-no-existe', 'validador', 10))))
      .toThrow('La feature activa "fx-no-existe" no existe en src/modules/');
  });

  test('PIP-T07 crearApp con una feature activa inexistente → la app no arranca', () => {
    expect(() => crearApp({ manifest: manifest(activa('fx-no-existe', 'endpoint')) }))
      .toThrow(/fx-no-existe/);
  });

  test('PIP-T08 feature con tipo distinto al del manifest → cargar lanza', () => {
    expect(() => cargar(manifest(activa('fx-tipo-equivocado', 'validador', 10))))
      .toThrow(/fx-tipo-equivocado.*post-proceso.*validador/);
  });

  test('PIP-T08 un manifest inválido no deja el pipeline a medias', async () => {
    cargar(manifest(activa('fx-validador-diez', 'validador', 10)));
    expect(() => cargar(manifest(
      activa('fx-validador-veinte', 'validador', 20),
      activa('fx-tipo-equivocado', 'validador', 30),
    ))).toThrow();

    await pipeline.ejecutarValidadores(deposito(), contexto());
    expect(registro.llamadas.map((l) => l.id)).toEqual(['fx-validador-diez']);
  });

  test('PIP-T09 feature inactivo → no se hace require de su carpeta', () => {
    let requerido = false;
    jest.doMock(rutaModulo('fx-inactivo'), () => {
      requerido = true;
      return { id: 'fx-inactivo', tipo: 'validador', async ejecutar() {} };
    }, { virtual: true });

    const { routers } = cargar(manifest(
      inactiva('fx-inactivo', 'validador', 10),
      // Una inactiva que ni existe tampoco hace fallar al cargador.
      inactiva('fx-no-existe', 'post-proceso', 10),
      activa('fx-validador-diez', 'validador', 10),
    ));

    expect(requerido).toBe(false);
    expect(routers).toEqual([]);
  });

  test('PIP-T09 la misma feature activa → sí se hace require (control de la prueba anterior)', () => {
    let requerido = false;
    jest.doMock(rutaModulo('fx-activo-control'), () => {
      requerido = true;
      return { id: 'fx-activo-control', tipo: 'validador', async ejecutar() {} };
    }, { virtual: true });

    cargar(manifest(activa('fx-activo-control', 'validador', 10)));

    expect(requerido).toBe(true);
  });

  describe('reglas PIP-R08 a R10 y contrato del módulo', () => {
    test('PIP-R08 devuelve los routers de los endpoints activos', () => {
      expect(cargar(manifest(activa('fx-endpoint', 'endpoint'))).routers).toEqual([endpointFalso.router]);
      expect(cargar(manifest(inactiva('fx-endpoint', 'endpoint'))).routers).toEqual([]);
    });

    test('PIP-R10 registra los errores del módulo en el catálogo; cargar dos veces no falla', () => {
      const m = manifest(activa('fx-validador-veinte', 'validador', 20));
      cargar(m);
      expect(() => cargar(m)).not.toThrow();
      expect(catalogo.FX_RECHAZO_VEINTE).toEqual({ status: 422, mensaje: 'Rechazo de prueba de fx-validador-veinte.' });
      expect(new ErrorApp('FX_RECHAZO_VEINTE').status).toBe(422);
    });

    test('SPEC-06 §4 un validador que declara un error con status ≠ 422 → cargar lanza', () => {
      jest.doMock(rutaModulo('fx-validador-500'), () => ({
        id: 'fx-validador-500',
        tipo: 'validador',
        errores: { FX_VALIDADOR_500: { status: 500, mensaje: 'x' } },
        async ejecutar() {},
      }), { virtual: true });
      expect(() => cargar(manifest(activa('fx-validador-500', 'validador', 10)))).toThrow(/≠ 422/);
      expect(catalogo.FX_VALIDADOR_500).toBeUndefined();
    });

    test.each([
      ['sin manifest', undefined, /falta la lista features/],
      ['sin features', { version: 1 }, /falta la lista features/],
      ['feature activa sin id', manifest({ estado: 'activo', tipo: 'validador', orden: 1 }), /necesita un id/],
      ['tipo desconocido', manifest(activa('fx-validador-diez', 'otro', 1)), /tipo "otro" desconocido/],
      ['extensión sin orden', manifest(activa('fx-validador-diez', 'validador')), /orden numérico/],
      ['id repetido', manifest(activa('fx-endpoint', 'endpoint'), activa('fx-endpoint', 'endpoint')), /repetida/],
      ['id con separadores', manifest(activa('../core', 'endpoint')), /no existe en src\/modules/],
    ])('manifest inválido (%s) → cargar lanza', (_nombre, m, mensaje) => {
      expect(() => cargar(m)).toThrow(mensaje);
    });

    test('módulo que exporta otro id → cargar lanza', () => {
      jest.doMock(rutaModulo('fx-id-distinto'), () => ({ id: 'otro', tipo: 'endpoint', router() {} }), { virtual: true });
      expect(() => cargar(manifest(activa('fx-id-distinto', 'endpoint')))).toThrow(/exporta el id "otro"/);
    });

    test('endpoint sin router y extensión sin ejecutar → cargar lanza', () => {
      jest.doMock(rutaModulo('fx-sin-router'), () => ({ id: 'fx-sin-router', tipo: 'endpoint' }), { virtual: true });
      jest.doMock(rutaModulo('fx-sin-ejecutar'), () => ({ id: 'fx-sin-ejecutar', tipo: 'post-proceso' }), { virtual: true });
      expect(() => cargar(manifest(activa('fx-sin-router', 'endpoint')))).toThrow(/no exporta un router/);
      expect(() => cargar(manifest(activa('fx-sin-ejecutar', 'post-proceso', 1)))).toThrow(/no exporta ejecutar/);
    });

    test('un MODULE_NOT_FOUND de una dependencia interna del módulo se relanza tal cual', () => {
      const interno = Object.assign(new Error("Cannot find module 'paquete-que-falta'"), { code: 'MODULE_NOT_FOUND' });
      jest.doMock(rutaModulo('fx-dependencia-rota'), () => {
        throw interno;
      }, { virtual: true });
      expect(() => cargar(manifest(activa('fx-dependencia-rota', 'endpoint')))).toThrow(interno);
    });
  });
});

describe('SPEC-06 · crearApp (PIP-R11)', () => {
  test('PIP-T10 ruta inexistente con token → 404 RUTA_NO_ENCONTRADA', async () => {
    const app = crearApp({ manifest: manifest(activa('fx-endpoint', 'endpoint')) });

    const res = await request(app)
      .get('/api/v1/no-existe')
      .set(bearer('usr-agente-1'))
      .set('X-Correlation-Id', 'abc-123');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      codigo: 'RUTA_NO_ENCONTRADA',
      mensaje: 'La ruta no existe.',
      correlationId: 'abc-123',
    });
    expect(res.headers['x-correlation-id']).toBe('abc-123');
  });

  test('PIP-T10 ruta fuera de /api/v1 con token → 404 RUTA_NO_ENCONTRADA', async () => {
    const app = crearApp({ manifest: manifest() });
    const res = await request(app).post('/depositos').set(bearer('usr-cajero-1'));
    expect(res.status).toBe(404);
    expect(res.body.codigo).toBe('RUTA_NO_ENCONTRADA');
    expect(res.body.correlationId).toBe(res.headers['x-correlation-id']);
  });

  test('PIP-R11 ruta inexistente sin token → 401 TOKEN_REQUERIDO (autenticar va antes del 404)', async () => {
    const app = crearApp({ manifest: manifest() });
    const res = await request(app).get('/api/v1/no-existe');
    expect(res.status).toBe(401);
    expect(res.body.codigo).toBe('TOKEN_REQUERIDO');
  });

  test('PIP-R11 el router de un endpoint activo se monta en /api/v1 y recibe req.usuario', async () => {
    const app = crearApp({ manifest: manifest(activa('fx-endpoint', 'endpoint')) });
    const res = await request(app).get('/api/v1/fx-ping').set(bearer('usr-agente-2'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pong: true, usuarioId: 'usr-agente-2' });

    const sinToken = await request(app).get('/api/v1/fx-ping');
    expect(sinToken.status).toBe(401);
  });

  test('PIP-R11 el mismo endpoint inactivo → 404 RUTA_NO_ENCONTRADA', async () => {
    const app = crearApp({ manifest: manifest(inactiva('fx-endpoint', 'endpoint')) });
    const res = await request(app).get('/api/v1/fx-ping').set(bearer('usr-agente-2'));
    expect(res.status).toBe(404);
    expect(res.body.codigo).toBe('RUTA_NO_ENCONTRADA');
  });

  test('PIP-R11 express.json está montado: el router recibe el body parseado', async () => {
    const app = crearApp({ manifest: manifest(activa('fx-endpoint', 'endpoint')) });
    const res = await request(app)
      .post('/api/v1/fx-eco')
      .set(bearer('usr-agente-1'))
      .send({ cuentaDestino: '0011-0123-456789', monto: '150.00' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ recibido: { cuentaDestino: '0011-0123-456789', monto: '150.00' } });
  });

  test('PIP-R11 JSON mal formado → 400 FORMATO_INVALIDO (manejadorErrores al final)', async () => {
    const app = crearApp({ manifest: manifest(activa('fx-endpoint', 'endpoint')) });
    const res = await request(app)
      .post('/api/v1/fx-eco')
      .set(bearer('usr-agente-1'))
      .set('Content-Type', 'application/json')
      .send('{"monto":');
    expect(res.status).toBe(400);
    expect(res.body.codigo).toBe('FORMATO_INVALIDO');
  });

  test('PIP-R11 body de más de 100kb → no llega al router', async () => {
    const app = crearApp({ manifest: manifest(activa('fx-endpoint', 'endpoint')) });
    const res = await request(app)
      .post('/api/v1/fx-eco')
      .set(bearer('usr-agente-1'))
      .send({ referencia: 'x'.repeat(101 * 1024) });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.recibido).toBeUndefined();
    expect(res.body.correlationId).toBe(res.headers['x-correlation-id']);
  });

  test('PIP-R11 trust proxy toma el valor de TRUST_PROXY (config.trustProxy)', () => {
    const config = require('../../src/config');
    const app = crearApp({ manifest: manifest() });
    expect(app.get('trust proxy')).toBe(config.trustProxy);
  });

  test('PIP-R12 crearApp no inicia la tarea de limpieza', () => {
    const limpiarClaves = require('../../src/core/tareas/limpiarClaves');
    const iniciar = jest.spyOn(limpiarClaves, 'iniciar');
    crearApp({ manifest: manifest() });
    expect(iniciar).not.toHaveBeenCalled();
    iniciar.mockRestore();
  });
});
