'use strict';

const express = require('express');
const request = require('supertest');

const {
  ErrorApp, catalogo, registrarErrores, manejar,
} = require('../../../src/core/errores');
const manejadorErrores = require('../../../src/core/middlewares/manejadorErrores');
const { logger } = require('../../../src/core/logger');

const CORRELATION_ID = 'abc-123';

// SPEC-03 aún no existe: el propio test asigna req.correlationId.
function crearAppPrueba(registrarRutas, { conCorrelationId = true } = {}) {
  const app = express();
  app.use((req, res, next) => {
    if (conCorrelationId) req.correlationId = CORRELATION_ID;
    next();
  });
  app.use(express.json());
  registrarRutas(app);
  app.use(manejadorErrores);
  return app;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('manejadorErrores', () => {
  test('DOM-T01 ErrorApp(MONTO_INVALIDO) → 422 con el formato de §5 y el correlationId', async () => {
    const app = crearAppPrueba((a) => {
      a.get('/x', (req, res, next) => next(new ErrorApp('MONTO_INVALIDO')));
    });

    const res = await request(app).get('/x');

    expect(res.status).toBe(422);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({
      codigo: 'MONTO_INVALIDO',
      mensaje: 'Monto menor o igual a 0 o con más de 2 decimales.',
      correlationId: CORRELATION_ID,
    });
  });

  test('DOM-T02 error desconocido → 500 ERROR_INTERNO sin stack en la respuesta', async () => {
    const espiaLog = jest.spyOn(logger, 'error').mockImplementation(() => {});
    const error = new Error('detalle-secreto-interno');
    const app = crearAppPrueba((a) => {
      a.get('/x', () => { throw error; });
    });

    const res = await request(app).get('/x');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      codigo: 'ERROR_INTERNO',
      mensaje: 'Error no controlado.',
      correlationId: CORRELATION_ID,
    });
    expect(res.text).not.toContain('detalle-secreto-interno');
    expect(res.text).not.toContain(error.stack.split('\n')[1].trim());
    expect(res.text).not.toContain('stack');
    // DOM-R07: logger.error con el correlationId.
    expect(espiaLog).toHaveBeenCalledTimes(1);
    expect(espiaLog.mock.calls[0][0]).toEqual(
      expect.objectContaining({ err: error, correlationId: CORRELATION_ID }),
    );
  });

  test('DOM-T03 JSON mal formado → 400 FORMATO_INVALIDO', async () => {
    const app = crearAppPrueba((a) => {
      a.post('/x', (req, res) => res.status(201).json({ ok: true }));
    });

    const res = await request(app)
      .post('/x')
      .set('Content-Type', 'application/json')
      .send('{malo');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      codigo: 'FORMATO_INVALIDO',
      mensaje: 'JSON mal formado o campos con tipo incorrecto.',
      correlationId: CORRELATION_ID,
    });
  });

  test('DOM-T04 ErrorApp(BILLETERA_NO_DISPONIBLE, { depositoId: "x" }) → res.locals.depositoId === "x"', async () => {
    let locals;
    const app = crearAppPrueba((a) => {
      a.use((req, res, next) => {
        res.on('finish', () => { locals = { ...res.locals }; });
        next();
      });
      a.get('/x', (req, res, next) => next(new ErrorApp('BILLETERA_NO_DISPONIBLE', { depositoId: 'x' })));
    });

    const res = await request(app).get('/x');

    expect(res.status).toBe(502);
    expect(res.body).toEqual({
      codigo: 'BILLETERA_NO_DISPONIBLE',
      mensaje: 'billetera-service falló o no respondió.',
      correlationId: CORRELATION_ID,
    });
    expect(locals.depositoId).toBe('x');
  });

  test('DOM-T04 ErrorApp sin depositoId → res.locals.depositoId no se asigna', async () => {
    let locals;
    const app = crearAppPrueba((a) => {
      a.use((req, res, next) => {
        res.on('finish', () => { locals = { ...res.locals }; });
        next();
      });
      a.get('/x', (req, res, next) => next(new ErrorApp('BILLETERA_NO_DISPONIBLE')));
    });

    const res = await request(app).get('/x');

    expect(res.status).toBe(502);
    expect(locals).not.toHaveProperty('depositoId');
  });

  test('DOM-T07 controller async que lanza, envuelto en manejar → responde el error (no se cuelga)', async () => {
    const app = crearAppPrueba((a) => {
      a.get('/x', manejar(async () => {
        await Promise.resolve();
        throw new ErrorApp('SIN_PERMISO');
      }));
    });

    const res = await request(app).get('/x').timeout(2000);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      codigo: 'SIN_PERMISO',
      mensaje: 'El rol o la cuenta no permiten la operación.',
      correlationId: CORRELATION_ID,
    });
  });

  test('DOM-T07 manejar no altera la respuesta de un controller async que no lanza', async () => {
    const app = crearAppPrueba((a) => {
      a.get('/x', manejar(async (req, res) => { res.status(200).json({ ok: true }); }));
    });

    const res = await request(app).get('/x');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  test('DOM-R07 sin req.correlationId la clave correlationId sigue presente (null)', async () => {
    const app = crearAppPrueba((a) => {
      a.get('/x', (req, res, next) => next(new ErrorApp('DEPOSITO_NO_ENCONTRADO')));
    }, { conCorrelationId: false });

    const res = await request(app).get('/x');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      codigo: 'DEPOSITO_NO_ENCONTRADO',
      mensaje: 'No existe un depósito con ese id.',
      correlationId: null,
    });
  });

  test('DOM-R07 si las cabeceras ya se enviaron delega en next(err)', () => {
    const next = jest.fn();
    const res = { headersSent: true, status: jest.fn(), json: jest.fn() };
    const err = new Error('tarde');

    manejadorErrores(err, {}, res, next);

    expect(next).toHaveBeenCalledWith(err);
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('ErrorApp y catálogo', () => {
  test('DOM-R06 ErrorApp toma status y mensaje del catálogo; depositoId opcional', () => {
    const conId = new ErrorApp('BILLETERA_NO_DISPONIBLE', { depositoId: 'x' });
    expect(conId).toBeInstanceOf(Error);
    expect(conId.codigo).toBe('BILLETERA_NO_DISPONIBLE');
    expect(conId.status).toBe(502);
    expect(conId.depositoId).toBe('x');

    const sinId = new ErrorApp('TOKEN_REQUERIDO');
    expect(sinId.status).toBe(401);
    expect(sinId.mensaje).toBe('Falta el token.');
    expect(sinId).not.toHaveProperty('depositoId');
  });

  test('DOM-R06 código fuera del catálogo → lanza', () => {
    expect(() => new ErrorApp('NO_EXISTE_EN_CATALOGO')).toThrow(/NO_EXISTE_EN_CATALOGO/);
  });

  test('§5 catálogo del core con sus status', () => {
    const esperado = {
      FORMATO_INVALIDO: 400,
      IDEMPOTENCY_KEY_REQUERIDA: 400,
      TOKEN_REQUERIDO: 401,
      TOKEN_INVALIDO: 401,
      TOKEN_EXPIRADO: 401,
      SIN_PERMISO: 403,
      DEPOSITO_NO_ENCONTRADO: 404,
      RUTA_NO_ENCONTRADA: 404,
      IDEMPOTENCY_KEY_REUTILIZADA: 409,
      SOLICITUD_EN_PROCESO: 409,
      MONTO_INVALIDO: 422,
      CUENTA_NO_ENCONTRADA: 422,
      CUENTA_INACTIVA: 422,
      MONEDA_NO_SOPORTADA: 422,
      ERROR_INTERNO: 500,
      BILLETERA_NO_DISPONIBLE: 502,
    };
    for (const [codigo, status] of Object.entries(esperado)) {
      expect(catalogo[codigo].status).toBe(status);
      expect(typeof catalogo[codigo].mensaje).toBe('string');
    }
  });

  test('DOM-T05 registrarErrores con un código ya existente → lanza error', () => {
    const antes = { ...catalogo.MONTO_INVALIDO };

    expect(() => registrarErrores({ MONTO_INVALIDO: { status: 400, mensaje: 'otro' } }))
      .toThrow(/MONTO_INVALIDO/);
    expect(catalogo.MONTO_INVALIDO).toEqual(antes);
  });

  test('DOM-T05 registrar dos veces el mismo código nuevo → la segunda lanza', () => {
    registrarErrores({ DOM_T05_PRUEBA_REPETIDO: { status: 422, mensaje: 'Prueba repetido.' } });

    expect(() => registrarErrores({ DOM_T05_PRUEBA_REPETIDO: { status: 422, mensaje: 'Prueba repetido.' } }))
      .toThrow(/DOM_T05_PRUEBA_REPETIDO/);
  });

  test('DOM-R09 registrarErrores agrega un código nuevo y manejadorErrores lo responde', async () => {
    registrarErrores({ DOM_R09_PRUEBA_NUEVO: { status: 422, mensaje: 'Código de prueba.' } });
    const app = crearAppPrueba((a) => {
      a.get('/x', (req, res, next) => next(new ErrorApp('DOM_R09_PRUEBA_NUEVO')));
    });

    const res = await request(app).get('/x');

    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      codigo: 'DOM_R09_PRUEBA_NUEVO',
      mensaje: 'Código de prueba.',
      correlationId: CORRELATION_ID,
    });
  });

  test('DOM-R09 definición inválida → lanza y no deja el catálogo a medias', () => {
    expect(() => registrarErrores({
      DOM_R09_PRUEBA_VALIDO: { status: 422, mensaje: 'ok' },
      DOM_R09_PRUEBA_INVALIDO: { status: '422' },
    })).toThrow(/DOM_R09_PRUEBA_INVALIDO/);
    expect(catalogo).not.toHaveProperty('DOM_R09_PRUEBA_VALIDO');
    expect(catalogo).not.toHaveProperty('DOM_R09_PRUEBA_INVALIDO');
  });
});
