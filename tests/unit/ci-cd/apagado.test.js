'use strict';

const http = require('node:http');
const net = require('node:net');

const config = require('../../../src/config');
const { crearApagado } = require('../../../src/server');
const reconciliacion = require('../../../src/modules/registrar-deposito/reconciliacion');
const service = require('../../../src/modules/registrar-deposito/service');
const limpiarClaves = require('../../../src/core/tareas/limpiarClaves');
const idempotenciaRepository = require('../../../src/core/repositories/idempotenciaRepository');

const pausa = (ms) => new Promise((r) => { setTimeout(r, ms); });

function diferido() {
  let resolve;
  const promesa = new Promise((r) => { resolve = r; });
  return { promesa, resolve };
}

function loggerFalso() {
  return { info: jest.fn(), error: jest.fn() };
}

function escuchar(server) {
  return new Promise((r) => { server.listen(0, '127.0.0.1', () => r(server.address().port)); });
}

// Resuelve con el código de error de una conexión nueva (o 'CONECTADO' si el puerto sigue abierto).
function intentarConectar(port) {
  return new Promise((r) => {
    const s = net.connect(port, '127.0.0.1');
    s.once('connect', () => { s.destroy(); r('CONECTADO'); });
    s.once('error', (err) => r(err.code));
  });
}

afterEach(async () => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  await reconciliacion.detener();
  await limpiarClaves.detener();
});

describe('SPEC-13 apagado limpio (CI-R10..R12)', () => {
  test('CI-T05 SIGTERM con una petición en curso → la petición responde, luego pool.end() y salida 0; no acepta conexiones nuevas', async () => {
    const eventos = [];
    const liberar = diferido();
    const peticionLlego = diferido();
    const server = http.createServer(async (req, res) => {
      peticionLlego.resolve();
      await liberar.promesa;
      res.on('finish', () => eventos.push('respuesta'));
      res.end(JSON.stringify({ estado: 'ok' }));
    });
    const port = await escuchar(server);
    const agente = new http.Agent({ keepAlive: true });

    const respuesta = new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path: '/lento', agent: agente }, (res) => {
        let cuerpo = '';
        res.setEncoding('utf8');
        res.on('data', (d) => { cuerpo += d; });
        res.on('end', () => resolve({ status: res.statusCode, cuerpo }));
      }).on('error', reject);
    });
    await peticionLlego.promesa;

    const pool = { end: jest.fn(async () => { eventos.push('pool.end'); }) };
    const salir = jest.fn((codigo) => eventos.push(`salir:${codigo}`));
    const logger = loggerFalso();
    // CI-R12: las tareas reales, sin iniciar() previo; su detener() no falla.
    const apagar = crearApagado({
      server, tareas: [reconciliacion, limpiarClaves], pool, logger, timeoutMs: 5000, salir,
    });

    const apagado = apagar('SIGTERM');

    expect(server.listening).toBe(false);
    expect(await intentarConectar(port)).toBe('ECONNREFUSED');
    await pausa(100);
    expect(pool.end).not.toHaveBeenCalled();
    expect(salir).not.toHaveBeenCalled();

    liberar.resolve();
    await expect(respuesta).resolves.toEqual({ status: 200, cuerpo: '{"estado":"ok"}' });
    await apagado;

    expect(eventos).toEqual(['respuesta', 'pool.end', 'salir:0']);
    expect(pool.end).toHaveBeenCalledTimes(1);
    expect(salir).toHaveBeenCalledTimes(1);
    expect(salir).toHaveBeenCalledWith(0);
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ senal: 'SIGTERM' }), expect.any(String));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('apagado'));
    agente.destroy();
  }, 15000);

  test('CI-T06 SIGTERM con un ciclo de reconciliación en curso → espera a que termine antes de cerrar el pool', async () => {
    const intervaloOriginal = config.reconciliacion.intervaloMs;
    config.reconciliacion.intervaloMs = 20;
    const fin = diferido();
    const eventos = [];
    const ciclo = jest.spyOn(service, 'reconciliar').mockImplementation(async () => {
      eventos.push('ciclo:inicio');
      await fin.promesa;
      eventos.push('ciclo:fin');
      return { completados: 0, fallidos: 0, pendientes: 0 };
    });
    try {
      reconciliacion.iniciar();
      while (ciclo.mock.calls.length === 0) await pausa(5);

      const server = http.createServer();
      await escuchar(server);
      const pool = { end: jest.fn(async () => { eventos.push('pool.end'); }) };
      const salir = jest.fn((codigo) => eventos.push(`salir:${codigo}`));
      const apagar = crearApagado({
        server, tareas: [reconciliacion, limpiarClaves], pool, logger: loggerFalso(), timeoutMs: 5000, salir,
      });

      const apagado = apagar('SIGTERM');
      await pausa(150);
      expect(pool.end).not.toHaveBeenCalled();
      expect(salir).not.toHaveBeenCalled();
      // detener() dejó de programar ciclos: en 150 ms (7 intervalos) no arrancó otro.
      expect(ciclo).toHaveBeenCalledTimes(1);

      fin.resolve();
      await apagado;
      expect(eventos).toEqual(['ciclo:inicio', 'ciclo:fin', 'pool.end', 'salir:0']);
      expect(ciclo).toHaveBeenCalledTimes(1);
    } finally {
      fin.resolve();
      config.reconciliacion.intervaloMs = intervaloOriginal;
    }
  });

  test('CI-T06 limpiarClaves.detener() espera la limpieza de claves en curso antes de cerrar el pool', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
    const fin = diferido();
    const eventos = [];
    const borrar = jest.spyOn(idempotenciaRepository, 'borrarAntiguas').mockImplementation(async () => {
      await fin.promesa;
      eventos.push('limpieza:fin');
      return 0;
    });
    limpiarClaves.iniciar();
    await jest.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(borrar).toHaveBeenCalledTimes(1);
    jest.useRealTimers();

    const server = { close: jest.fn((cb) => cb()) };
    const pool = { end: jest.fn(async () => { eventos.push('pool.end'); }) };
    const salir = jest.fn((codigo) => eventos.push(`salir:${codigo}`));
    const apagar = crearApagado({
      server, tareas: [reconciliacion, limpiarClaves], pool, logger: loggerFalso(), timeoutMs: 5000, salir,
    });

    const apagado = apagar('SIGINT');
    await pausa(50);
    expect(pool.end).not.toHaveBeenCalled();

    fin.resolve();
    await apagado;
    expect(eventos).toEqual(['limpieza:fin', 'pool.end', 'salir:0']);
    expect(server.close).toHaveBeenCalledTimes(1);
  });

  test('CI-T07 apagado que no termina en timeoutMs → logger.error y salida 1; una segunda señal no duplica el apagado', async () => {
    const nuncaTermina = diferido();
    const tarea = { detener: jest.fn(() => nuncaTermina.promesa) };
    const server = { close: jest.fn((cb) => cb()) };
    const pool = { end: jest.fn(async () => {}) };
    const salir = jest.fn();
    const logger = loggerFalso();
    const apagar = crearApagado({ server, tareas: [tarea], pool, logger, timeoutMs: 100, salir });

    try {
      const primero = apagar('SIGTERM');
      await pausa(20);
      const segundo = apagar('SIGINT');
      expect(segundo).toBe(primero);

      const inicio = Date.now();
      await primero;
      expect(Date.now() - inicio).toBeLessThan(1000);

      expect(salir).toHaveBeenCalledTimes(1);
      expect(salir).toHaveBeenCalledWith(1);
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 100 }), expect.any(String));
      expect(pool.end).not.toHaveBeenCalled();
      expect(tarea.detener).toHaveBeenCalledTimes(1);
      expect(server.close).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ senal: 'SIGINT' }), expect.any(String));

      // Una tercera señal tras el timeout tampoco repite nada.
      await apagar('SIGTERM');
      expect(salir).toHaveBeenCalledTimes(1);
      expect(tarea.detener).toHaveBeenCalledTimes(1);
    } finally {
      nuncaTermina.resolve();
    }
  });

  test('CI-T07 la segunda señal durante un apagado que sí termina no repite detener(), pool.end() ni salir()', async () => {
    const fin = diferido();
    const tarea = { detener: jest.fn(() => fin.promesa) };
    const server = { close: jest.fn((cb) => cb()) };
    const pool = { end: jest.fn(async () => {}) };
    const salir = jest.fn();
    const apagar = crearApagado({ server, tareas: [tarea], pool, logger: loggerFalso(), timeoutMs: 5000, salir });

    const primero = apagar('SIGTERM');
    const segundo = apagar('SIGTERM');
    fin.resolve();
    await Promise.all([primero, segundo]);

    expect(segundo).toBe(primero);
    expect(tarea.detener).toHaveBeenCalledTimes(1);
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(pool.end).toHaveBeenCalledTimes(1);
    expect(salir).toHaveBeenCalledTimes(1);
    expect(salir).toHaveBeenCalledWith(0);
  });
});
