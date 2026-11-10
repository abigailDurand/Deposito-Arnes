'use strict';

const nock = require('nock');
const request = require('supertest');

const { crearApp } = require('../../../src/app');
const { pool: poolApp } = require('../../../src/core/db');
const pipeline = require('../../../src/core/pipeline');
const repository = require('../../../src/modules/historial-depositos/repository');
const modulo = require('../../../src/modules/historial-depositos');
const billetera = require('../../helpers/billetera');
const { limpiar, cerrar, pool } = require('../../helpers/db');
const { token } = require('../../helpers/tokens');
const { registrarFixtures, activa } = require('../../core/fixtures/modulos');
const registro = require('../../core/fixtures/registro');
const config = require('../../../src/config');

registrarFixtures(jest);

const CUENTA = '0011-0123-456789';
// SPEC-02 §4: 0011-0123-000002 es PEN de usr-cliente-2; las billeteras USD son UUID.
const CUENTA_2 = '0011-0123-000002';
const WALLET_USD = '11111111-1111-4111-8111-111111111111';
const WALLET_USD_2 = '22222222-2222-4222-8222-222222222222';
const BASE_MS = Date.parse('2026-10-13T19:20:00.000Z');
const UN_MINUTO = 60 * 1000;

// SPEC-09: endpoint activo; extensiones de SPEC-10..12 inactivas.
function manifest({ historial = 'activo', extra = [] } = {}) {
  return {
    version: 1,
    servicio: 'deposito-service',
    features: [
      { id: 'registrar-deposito', estado: 'activo', tipo: 'endpoint' },
      { id: 'consultar-deposito', estado: 'activo', tipo: 'endpoint' },
      { id: 'historial-depositos', estado: historial, tipo: 'endpoint' },
      { id: 'limites-por-canal', estado: 'inactivo', tipo: 'validador', orden: 10 },
      { id: 'conversion-moneda', estado: 'inactivo', tipo: 'transformador', orden: 10 },
      { id: 'alerta-uif', estado: 'inactivo', tipo: 'post-proceso', orden: 10 },
      ...extra,
    ],
  };
}

function idDe(n) {
  return `7f1c2e9a-0b1d-4c5e-9f00-${String(n).padStart(12, '0')}`;
}

// El depósito n se crea n minutos después de BASE (en ms: ver nota de impl_09 sobre HD-T05).
function instante(n) {
  return new Date(BASE_MS + n * UN_MINUTO).toISOString();
}

async function insertarDeposito(n, {
  cuenta = CUENTA,
  moneda = 'PEN',
  usuario = 'usr-agente-1',
  canal = 'AGENTE',
  estado = 'COMPLETADO',
  referencia = null,
  creado = instante(n),
  id = idDe(n),
} = {}) {
  await pool.query(
    `INSERT INTO depositos (id, cuenta_destino, monto, moneda, monto_acreditar,
                            moneda_acreditar, canal, referencia, estado, usuario_id,
                            creado_en, actualizado_en)
     VALUES ($1, $2, '150.00', $3, '150.00', $3, $4, $5, $6, $7, $8, $8)`,
    [id, cuenta, moneda, canal, referencia, estado, usuario, creado],
  );
}

async function insertarVarios(desde, hasta, opciones = {}) {
  for (let n = desde; n <= hasta; n += 1) {
    await insertarDeposito(n, opciones);
  }
}

function get(app, numero, { usuario = 'usr-cliente-1', query = '', correlation } = {}) {
  const url = `/api/v1/cuentas/${numero}/depositos${query ? `?${query}` : ''}`;
  let r = request(app).get(url).set('Authorization', `Bearer ${token(usuario)}`);
  if (correlation) r = r.set('X-Correlation-Id', correlation);
  return r;
}

function esError(res, status, codigo) {
  expect(res.status).toBe(status);
  expect(res.body).toEqual({
    codigo,
    mensaje: expect.any(String),
    correlationId: res.headers['x-correlation-id'],
  });
}

function elemento(n, extra = {}) {
  return {
    id: idDe(n),
    cuentaDestino: CUENTA,
    monto: '150.00',
    moneda: 'PEN',
    canal: 'AGENTE',
    referencia: null,
    estado: 'COMPLETADO',
    creadoEn: instante(n),
    actualizadoEn: instante(n),
    ...extra,
  };
}

// Cualquier GET a una billetera (PEN o USD): para comprobar que no se consultó.
function espia(url) {
  const peticiones = [];
  const scope = nock(url).persist().get(/.*/).reply(function respuesta(uri) {
    peticiones.push(uri);
    return [500, { mensaje: 'No debía llamarse.' }];
  });
  scope.peticiones = peticiones;
  return scope;
}

function espiaPen() {
  return espia(config.billetera.url);
}

function espiaUsd() {
  return espia(config.billeteraUsd.url);
}

// La auditoría escribe después de responder: se reintenta hasta 1 s.
async function filasAuditoria(esperadas) {
  let rows = [];
  for (let i = 0; i < 20; i += 1) {
    ({ rows } = await pool.query(
      'SELECT deposito_id, usuario_id, accion, resultado, correlation_id'
        + ' FROM auditoria_depositos',
    ));
    if (rows.length >= esperadas) return rows;
    await new Promise((r) => { setTimeout(r, 50); });
  }
  return rows;
}

// La auditoría escribe después de responder: si su INSERT coincide con el TRUNCATE de
// limpiar() de la prueba siguiente, PostgreSQL detecta un deadlock. Se espera a que el
// conteo se estabilice.
async function esperarAuditoria() {
  let previo = -1;
  for (let i = 0; i < 20; i += 1) {
    await new Promise((r) => { setTimeout(r, 50); });
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM auditoria_depositos');
    if (rows[0].n === previo) return;
    previo = rows[0].n;
  }
}

beforeAll(() => {
  nock.disableNetConnect();
  nock.enableNetConnect(/127\.0\.0\.1|localhost/);
});

beforeEach(async () => {
  await limpiar();
  nock.cleanAll();
  registro.reiniciar();
});

afterEach(async () => {
  await esperarAuditoria();
  jest.restoreAllMocks();
  nock.abortPendingRequests();
  nock.cleanAll();
});

afterAll(async () => {
  nock.enableNetConnect();
  await new Promise((r) => { setTimeout(r, 200); });
  await poolApp.end();
  await cerrar();
});

describe('SPEC-09 historial-depositos: casos', () => {
  test('HD-T01 usr-cliente-1, 3 depósitos en 0011-0123-456789 → 200, 3 elementos, '
    + 'más reciente primero, sin extensiones', async () => {
    const app = crearApp({ manifest: manifest() });
    await insertarDeposito(2, { referencia: 'Pago alquiler' });
    await insertarDeposito(1);
    await insertarDeposito(3, { usuario: 'usr-cajero-1', canal: 'VENTANILLA' });
    const consulta = billetera.cuentaActiva(CUENTA);

    const res = await get(app, CUENTA, { correlation: 'hd-t01' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      datos: [
        elemento(3, { canal: 'VENTANILLA' }),
        elemento(2, { referencia: 'Pago alquiler' }),
        elemento(1),
      ],
      pagina: 1,
      tamano: 20,
      total: 3,
    });
    for (const e of res.body.datos) expect(e).not.toHaveProperty('extensiones');
    expect(consulta.peticiones).toHaveLength(1);
    expect(consulta.peticiones[0].headers['x-correlation-id']).toBe('hd-t01');
  });

  test('HD-T02 cuenta propia sin depósitos (usr-cliente-2, 22222222-2222-4222-8222-'
    + '222222222222) → datos: [], total: 0', async () => {
    const app = crearApp({ manifest: manifest() });
    await insertarVarios(1, 3);
    await insertarDeposito(4, { cuenta: WALLET_USD, moneda: 'USD' });
    const consulta = billetera.billeteraUsdExiste(WALLET_USD_2);

    const res = await get(app, WALLET_USD_2, { usuario: 'usr-cliente-2' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ datos: [], pagina: 1, tamano: 20, total: 0 });
    expect(consulta.peticiones).toHaveLength(1);
  });

  test('HD-T03 25 depósitos, pagina=2&tamano=20 → 5 elementos, total: 25', async () => {
    const app = crearApp({ manifest: manifest() });
    await insertarVarios(1, 25);
    billetera.cuentaActiva(CUENTA);

    const res = await get(app, CUENTA, { query: 'pagina=2&tamano=20' });

    expect(res.status).toBe(200);
    expect(res.body.pagina).toBe(2);
    expect(res.body.tamano).toBe(20);
    expect(res.body.total).toBe(25);
    expect(res.body.datos).toEqual([5, 4, 3, 2, 1].map((n) => elemento(n)));
  });

  test('HD-T04 estado=FALLIDO → solo FALLIDOS; total cuenta solo FALLIDOS', async () => {
    const app = crearApp({ manifest: manifest() });
    const estados = ['COMPLETADO', 'FALLIDO', 'PENDIENTE', 'FALLIDO', 'PROCESANDO', 'FALLIDO'];
    for (const [i, estado] of estados.entries()) {
      await insertarDeposito(i + 1, { estado });
    }
    billetera.cuentaActiva(CUENTA);

    const res = await get(app, CUENTA, { query: 'estado=FALLIDO' });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.datos).toEqual([6, 4, 2].map((n) => elemento(n, { estado: 'FALLIDO' })));
  });

  test('HD-T05 desde igual al creado_en de un depósito → ese depósito se incluye', async () => {
    const app = crearApp({ manifest: manifest() });
    await insertarVarios(1, 3);
    billetera.cuentaActiva(CUENTA);

    const res = await get(app, CUENTA, { query: `desde=${instante(2)}` });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.datos).toEqual([elemento(3), elemento(2)]);
  });

  test('HD-T06 usr-cliente-2 pide 0011-0123-456789 → 403 SIN_PERMISO', async () => {
    const app = crearApp({ manifest: manifest() });
    await insertarVarios(1, 3);
    const consulta = billetera.cuentaActiva(CUENTA);
    const listar = jest.spyOn(repository, 'listar');

    const res = await get(app, CUENTA, { usuario: 'usr-cliente-2' });

    esError(res, 403, 'SIN_PERMISO');
    expect(res.body.mensaje).toBe('El rol o la cuenta no permiten la operación.');
    expect(consulta.peticiones).toHaveLength(1);
    expect(listar).not.toHaveBeenCalled();
  });

  test('HD-T07 tamano=500, pagina=0, desde > hasta → 400 FORMATO_INVALIDO', async () => {
    const app = crearApp({ manifest: manifest() });
    await insertarVarios(1, 3);
    const consulta = billetera.cuentaActiva(CUENTA);
    const listar = jest.spyOn(repository, 'listar');
    const queries = [
      'tamano=500',
      'pagina=0',
      `desde=${instante(3)}&hasta=${instante(1)}`,
    ];

    for (const query of queries) {
      const res = await get(app, CUENTA, { query });
      esError(res, 400, 'FORMATO_INVALIDO');
    }
    expect(listar).not.toHaveBeenCalled();
    expect(consulta.peticiones).toHaveLength(0);
  });

  test('HD-T08 usr-agente-1 con depósitos suyos y de usr-agente-2 → solo los suyos; '
    + 'billetera no llamada', async () => {
    const app = crearApp({ manifest: manifest() });
    await insertarDeposito(1, { usuario: 'usr-agente-1' });
    await insertarDeposito(2, { usuario: 'usr-agente-2' });
    await insertarDeposito(3, { usuario: 'usr-agente-1' });
    await insertarDeposito(4, { usuario: 'usr-agente-2' });
    const consulta = billetera.cuentaActiva(CUENTA);

    const res = await get(app, CUENTA, { usuario: 'usr-agente-1' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      datos: [elemento(3), elemento(1)],
      pagina: 1,
      tamano: 20,
      total: 2,
    });
    expect(consulta.isDone()).toBe(false);
    expect(consulta.peticiones).toHaveLength(0);
  });
});

describe('SPEC-09 historial-depositos: reglas', () => {
  test('feature historial-depositos inactiva → 404 RUTA_NO_ENCONTRADA; ni BD ni billetera',
    async () => {
      const app = crearApp({ manifest: manifest({ historial: 'inactivo' }) });
      const listar = jest.spyOn(repository, 'listar');
      const consulta = billetera.cuentaActiva(CUENTA);

      const res = await get(app, CUENTA);

      esError(res, 404, 'RUTA_NO_ENCONTRADA');
      expect(listar).not.toHaveBeenCalled();
      expect(consulta.peticiones).toHaveLength(0);
    });

  test('HD-R01 numero con formato inválido → 400 FORMATO_INVALIDO sin billetera ni BD',
    async () => {
      const app = crearApp({ manifest: manifest() });
      const listar = jest.spyOn(repository, 'listar');
      const consulta = billetera.cuentaActiva(CUENTA);

      for (const numero of ['0011-0123-45678', '0011-0123-4567890', '0011-0123-45678a', 'abc']) {
        const res = await get(app, numero);
        esError(res, 400, 'FORMATO_INVALIDO');
      }
      expect(listar).not.toHaveBeenCalled();
      expect(consulta.peticiones).toHaveLength(0);
    });

  test('HD-R02 valores por defecto pagina=1 y tamano=20; 25 depósitos → 20 en la página 1',
    async () => {
      const app = crearApp({ manifest: manifest() });
      await insertarVarios(1, 25);
      billetera.cuentaActiva(CUENTA);

      const res = await get(app, CUENTA);

      expect(res.status).toBe(200);
      expect(res.body.pagina).toBe(1);
      expect(res.body.tamano).toBe(20);
      expect(res.body.total).toBe(25);
      expect(res.body.datos.map((d) => d.id)).toEqual(
        Array.from({ length: 20 }, (_, i) => idDe(25 - i)),
      );
    });

  test('HD-R02 límites válidos tamano=1 y tamano=100 → 200', async () => {
    const app = crearApp({ manifest: manifest() });
    await insertarVarios(1, 3);
    billetera.cuentaActiva(CUENTA);
    billetera.cuentaActiva(CUENTA);

    const uno = await get(app, CUENTA, { query: 'tamano=1&pagina=3' });
    const cien = await get(app, CUENTA, { query: 'tamano=100' });

    expect(uno.status).toBe(200);
    expect(uno.body).toEqual({ datos: [elemento(1)], pagina: 3, tamano: 1, total: 3 });
    expect(cien.status).toBe(200);
    expect(cien.body.tamano).toBe(100);
    expect(cien.body.datos).toHaveLength(3);
  });

  test('HD-R02 query inválida (tamano=0, tamano=101, pagina=-1, pagina=1.5, estado=OTRO, '
    + 'desde no ISO) → 400', async () => {
    const app = crearApp({ manifest: manifest() });
    const consulta = billetera.cuentaActiva(CUENTA);
    const queries = [
      'tamano=0', 'tamano=101', 'pagina=-1', 'pagina=1.5', 'pagina=abc',
      'estado=OTRO', 'estado=fallido', 'desde=ayer', 'hasta=2026-13-01T00:00:00Z',
    ];

    for (const query of queries) {
      const res = await get(app, CUENTA, { usuario: 'usr-agente-1', query });
      esError(res, 400, 'FORMATO_INVALIDO');
    }
    expect(consulta.peticiones).toHaveLength(0);
  });

  test('HD-R02 desde = hasta es válido (no es desde > hasta)', async () => {
    const app = crearApp({ manifest: manifest() });
    await insertarVarios(1, 3);

    const res = await get(app, CUENTA, {
      usuario: 'usr-agente-1',
      query: `desde=${instante(2)}&hasta=${instante(2)}`,
    });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.datos).toEqual([elemento(2)]);
  });

  test('HD-R03 hasta igual al creado_en de un depósito → se incluye; rango desde/hasta '
    + 'inclusivo en ambos extremos', async () => {
    const app = crearApp({ manifest: manifest() });
    await insertarVarios(1, 5);

    const soloHasta = await get(app, CUENTA, {
      usuario: 'usr-agente-1',
      query: `hasta=${instante(2)}`,
    });
    const rango = await get(app, CUENTA, {
      usuario: 'usr-agente-1',
      query: `desde=${instante(2)}&hasta=${instante(4)}`,
    });

    expect(soloHasta.body.total).toBe(2);
    expect(soloHasta.body.datos).toEqual([elemento(2), elemento(1)]);
    expect(rango.body.total).toBe(3);
    expect(rango.body.datos).toEqual([elemento(4), elemento(3), elemento(2)]);
  });

  test('HD-R04 usr-cajero-1 ve solo los suyos en la cuenta, sin billetera', async () => {
    const app = crearApp({ manifest: manifest() });
    await insertarDeposito(1, { usuario: 'usr-cajero-1', canal: 'VENTANILLA' });
    await insertarDeposito(2, { usuario: 'usr-agente-1' });
    await insertarDeposito(3, {
      usuario: 'usr-cajero-1', canal: 'VENTANILLA', cuenta: WALLET_USD, moneda: 'USD',
    });
    const consulta = billetera.cuentaActiva(CUENTA);

    const res = await get(app, CUENTA, { usuario: 'usr-cajero-1' });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.datos).toEqual([elemento(1, { canal: 'VENTANILLA' })]);
    expect(consulta.peticiones).toHaveLength(0);
  });

  test('HD-R04 operador sin depósitos propios en la cuenta → datos: [], total: 0', async () => {
    const app = crearApp({ manifest: manifest() });
    await insertarVarios(1, 3, { usuario: 'usr-agente-1' });

    const res = await get(app, CUENTA, { usuario: 'usr-agente-2' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ datos: [], pagina: 1, tamano: 20, total: 0 });
  });

  test('HD-R05 cliente: solo depósitos de la cuenta pedida, de cualquier operador', async () => {
    const app = crearApp({ manifest: manifest() });
    await insertarDeposito(1, { usuario: 'usr-agente-2' });
    await insertarDeposito(2, {
      usuario: 'usr-cajero-1', canal: 'VENTANILLA', cuenta: CUENTA_2,
    });
    billetera.cuentaActiva(CUENTA_2);

    const res = await get(app, CUENTA_2, { usuario: 'usr-cliente-2' });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.datos).toEqual([elemento(2, {
      canal: 'VENTANILLA', cuentaDestino: CUENTA_2,
    })]);
  });

  test('HD-R05 billetera 404 (null) → 403 SIN_PERMISO', async () => {
    const app = crearApp({ manifest: manifest() });
    await insertarVarios(1, 2);
    const consulta = billetera.cuentaNoExiste(CUENTA);

    const res = await get(app, CUENTA);

    esError(res, 403, 'SIN_PERMISO');
    expect(consulta.peticiones).toHaveLength(1);
  });

  test('HD-R05 billetera 500 → 502 BILLETERA_NO_DISPONIBLE', async () => {
    const app = crearApp({ manifest: manifest() });
    const listar = jest.spyOn(repository, 'listar');
    billetera.consultaFalla(CUENTA, { status: 500 });

    const res = await get(app, CUENTA);

    esError(res, 502, 'BILLETERA_NO_DISPONIBLE');
    expect(listar).not.toHaveBeenCalled();
  });

  test('HD-R05 billetera no responde a tiempo → 502 BILLETERA_NO_DISPONIBLE', async () => {
    const app = crearApp({ manifest: manifest() });
    billetera.consultaFalla(CUENTA, { demora: 6000 });

    const res = await get(app, CUENTA);

    esError(res, 502, 'BILLETERA_NO_DISPONIBLE');
  });

  test('HD-R05 cuenta BLOQUEADA propia (0011-0123-000003) → 200: solo se exige titularidad',
    async () => {
      const app = crearApp({ manifest: manifest() });
      billetera.cuentaActiva('0011-0123-000003');

      const res = await get(app, '0011-0123-000003');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ datos: [], pagina: 1, tamano: 20, total: 0 });
    });

  test('HD-R06 empate en creado_en → id DESC', async () => {
    const app = crearApp({ manifest: manifest() });
    const mismo = instante(5);
    await insertarDeposito(1, { creado: mismo });
    await insertarDeposito(3, { creado: mismo });
    await insertarDeposito(2, { creado: mismo });

    const res = await get(app, CUENTA, { usuario: 'usr-agente-1' });

    expect(res.status).toBe(200);
    expect(res.body.datos.map((d) => d.id)).toEqual([idDe(3), idDe(2), idDe(1)]);
  });

  test('HD-R06 LIMIT y OFFSET van como parámetros (no interpolados)', async () => {
    const app = crearApp({ manifest: manifest() });
    const query = jest.spyOn(poolApp, 'query');

    const res = await get(app, CUENTA, { usuario: 'usr-agente-1', query: 'pagina=3&tamano=7' });

    expect(res.status).toBe(200);
    const llamada = query.mock.calls.find(([sql]) => /LIMIT/.test(sql));
    const [sql, valores] = llamada;
    expect(sql).toMatch(/ORDER BY creado_en DESC, id DESC\s+LIMIT \$\d+ OFFSET \$\d+/);
    expect(sql).not.toMatch(/\b7\b|\b14\b/);
    expect(valores.slice(-2)).toEqual([7, 14]);
  });

  test('HD-R07 total coherente con filtros combinados (estado + rango + página)', async () => {
    const app = crearApp({ manifest: manifest() });
    for (let n = 1; n <= 10; n += 1) {
      await insertarDeposito(n, { estado: n % 2 === 0 ? 'FALLIDO' : 'COMPLETADO' });
    }
    await insertarDeposito(11, { estado: 'FALLIDO', usuario: 'usr-agente-2' });

    const res = await get(app, CUENTA, {
      usuario: 'usr-agente-1',
      query: `estado=FALLIDO&desde=${instante(3)}&hasta=${instante(11)}&tamano=2&pagina=2`,
    });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(4);
    expect(res.body.datos).toEqual([6, 4].map((n) => elemento(n, { estado: 'FALLIDO' })));
  });

  test('HD-R07 página más allá del final → datos: [] con el total real', async () => {
    const app = crearApp({ manifest: manifest() });
    await insertarVarios(1, 3);

    const res = await get(app, CUENTA, { usuario: 'usr-agente-1', query: 'pagina=5' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ datos: [], pagina: 5, tamano: 20, total: 3 });
  });

  test('HD-R08 extensión activa con datos → la lista sigue sin extensiones y no las lee',
    async () => {
      registro.extensiones['fx-transformador-a'] = { marca: 'datos-a' };
      await insertarVarios(1, 2);
      const app = crearApp({
        manifest: manifest({ extra: [activa('fx-transformador-a', 'transformador', 20)] }),
      });
      const leer = jest.spyOn(pipeline, 'leerExtensiones');

      const res = await get(app, CUENTA, { usuario: 'usr-agente-1' });

      expect(res.status).toBe(200);
      expect(res.body.datos).toEqual([elemento(2), elemento(1)]);
      expect(leer).not.toHaveBeenCalled();
      expect(registro.llamadas.filter((l) => l.fase === 'leerExtension')).toHaveLength(0);
    });

  test('§2 repository solo SELECT: listar no modifica depositos', async () => {
    const app = crearApp({ manifest: manifest() });
    await insertarVarios(1, 3);
    const antes = (await pool.query('SELECT * FROM depositos ORDER BY id')).rows;

    await get(app, CUENTA, { usuario: 'usr-agente-1' });

    const despues = (await pool.query('SELECT * FROM depositos ORDER BY id')).rows;
    expect(despues).toEqual(antes);
  });

  test('repository.listar y contar directos con los mismos criterios', async () => {
    await insertarVarios(1, 4);
    await insertarDeposito(5, { estado: 'FALLIDO' });
    const criterios = {
      cuenta: CUENTA, estado: 'COMPLETADO', limite: 2, desplazamiento: 1,
    };

    const filas = await repository.listar(pool, criterios);
    const total = await repository.contar(pool, criterios);

    expect(filas.map((f) => f.id)).toEqual([idDe(3), idDe(2)]);
    expect(total).toBe(4);
  });

  test('index.js cumple el contrato de endpoint de SPEC-06 §4', () => {
    expect(modulo.id).toBe('historial-depositos');
    expect(modulo.tipo).toBe('endpoint');
    expect(typeof modulo.router).toBe('function');
  });
});

describe('SPEC-09 auditoría del listado (AUD-R06)', () => {
  test('200 → fila LISTAR_DEPOSITOS EXITO sin deposito_id; 403 → ERROR_403', async () => {
    const app = crearApp({ manifest: manifest() });
    await insertarVarios(1, 2);
    billetera.cuentaActiva(CUENTA);

    await get(app, CUENTA, { usuario: 'usr-agente-1', correlation: 'hd-aud-ok' });
    await get(app, CUENTA, { usuario: 'usr-cliente-2', correlation: 'hd-aud-403' });

    const filas = await filasAuditoria(2);
    expect(filas).toHaveLength(2);
    expect(filas.find((f) => f.correlation_id === 'hd-aud-ok')).toEqual({
      deposito_id: null,
      usuario_id: 'usr-agente-1',
      accion: 'LISTAR_DEPOSITOS',
      resultado: 'EXITO',
      correlation_id: 'hd-aud-ok',
    });
    expect(filas.find((f) => f.correlation_id === 'hd-aud-403')).toEqual({
      deposito_id: null,
      usuario_id: 'usr-cliente-2',
      accion: 'LISTAR_DEPOSITOS',
      resultado: 'ERROR_403',
      correlation_id: 'hd-aud-403',
    });
  });
});

describe('SPEC-09 Billetera USD (HD-T09..HD-T12)', () => {
  function elementoUsd(n, extra = {}) {
    return elemento(n, { cuentaDestino: WALLET_USD, moneda: 'USD', ...extra });
  }

  test('HD-T09 usr-cliente-1, historial de 11111111-1111-4111-8111-111111111111 con 2 '
    + 'depósitos → 200, 2 elementos; se consultó Billetera USD y no la PEN', async () => {
    const app = crearApp({ manifest: manifest() });
    await insertarDeposito(1, { cuenta: WALLET_USD, moneda: 'USD' });
    await insertarDeposito(2, { cuenta: WALLET_USD, moneda: 'USD', usuario: 'usr-cajero-1' });
    await insertarDeposito(3);
    const usd = billetera.billeteraUsdExiste(WALLET_USD);
    const pen = espiaPen();

    const res = await get(app, WALLET_USD, { correlation: 'hd-t09' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      datos: [elementoUsd(2), elementoUsd(1)],
      pagina: 1,
      tamano: 20,
      total: 2,
    });
    for (const e of res.body.datos) expect(e).not.toHaveProperty('extensiones');
    expect(usd.peticiones).toHaveLength(1);
    expect(usd.peticiones[0].headers['x-correlation-id']).toBe('hd-t09');
    expect(pen.peticiones).toHaveLength(0);
  });

  test('HD-T10 usr-cliente-2 pide 11111111-1111-4111-8111-111111111111 → 403 SIN_PERMISO',
    async () => {
      const app = crearApp({ manifest: manifest() });
      await insertarDeposito(1, { cuenta: WALLET_USD, moneda: 'USD' });
      const usd = billetera.billeteraUsdExiste(WALLET_USD);
      const pen = espiaPen();
      const listar = jest.spyOn(repository, 'listar');

      const res = await get(app, WALLET_USD, { usuario: 'usr-cliente-2' });

      esError(res, 403, 'SIN_PERMISO');
      expect(res.body.mensaje).toBe('El rol o la cuenta no permiten la operación.');
      expect(usd.peticiones).toHaveLength(1);
      expect(pen.peticiones).toHaveLength(0);
      expect(listar).not.toHaveBeenCalled();
    });

  test('HD-T11 numero UUID en mayúsculas o incompleto → 400 FORMATO_INVALIDO; '
    + 'billetera no llamada', async () => {
    const app = crearApp({ manifest: manifest() });
    await insertarDeposito(1, { cuenta: WALLET_USD, moneda: 'USD' });
    const usd = espiaUsd();
    const pen = espiaPen();
    const listar = jest.spyOn(repository, 'listar');
    const numeros = [
      // 11111111-… solo tiene dígitos: en mayúsculas no cambia. Se usa el UUID del ejemplo de
      // SPEC-02 §4 (3fa85f64-…) en mayúsculas.
      '3FA85F64-5717-4562-B3FC-2C963F66AFA6',
      '11111111-1111-4111-8111-11111111111A',
      '11111111-1111-4111-8111',
      '11111111-1111-4111-8111-11111111111',
      '111111111111411181111111111111111111',
    ];

    for (const numero of numeros) {
      const res = await get(app, numero);
      esError(res, 400, 'FORMATO_INVALIDO');
    }
    expect(usd.peticiones).toHaveLength(0);
    expect(pen.peticiones).toHaveLength(0);
    expect(listar).not.toHaveBeenCalled();
  });

  test('HD-T12 Billetera USD 500 al verificar titular → 502 BILLETERA_NO_DISPONIBLE',
    async () => {
      const app = crearApp({ manifest: manifest() });
      await insertarDeposito(1, { cuenta: WALLET_USD, moneda: 'USD' });
      const usd = billetera.consultaUsdFalla(WALLET_USD, { status: 500 });
      const pen = espiaPen();
      const listar = jest.spyOn(repository, 'listar');

      const res = await get(app, WALLET_USD);

      esError(res, 502, 'BILLETERA_NO_DISPONIBLE');
      expect(usd.peticiones).toHaveLength(1);
      expect(pen.peticiones).toHaveLength(0);
      expect(listar).not.toHaveBeenCalled();
    });

  test('HD-R04 usr-agente-1 en billetera USD → solo los suyos; ninguna billetera llamada',
    async () => {
      const app = crearApp({ manifest: manifest() });
      await insertarDeposito(1, { cuenta: WALLET_USD, moneda: 'USD' });
      await insertarDeposito(2, { cuenta: WALLET_USD, moneda: 'USD', usuario: 'usr-agente-2' });
      const usd = espiaUsd();
      const pen = espiaPen();

      const res = await get(app, WALLET_USD, { usuario: 'usr-agente-1' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ datos: [elementoUsd(1)], pagina: 1, tamano: 20, total: 1 });
      expect(usd.peticiones).toHaveLength(0);
      expect(pen.peticiones).toHaveLength(0);
    });

  test('HD-R05 Billetera USD 404 (null) → 403 SIN_PERMISO', async () => {
    const app = crearApp({ manifest: manifest() });
    const usd = billetera.billeteraUsdNoExiste(WALLET_USD);

    const res = await get(app, WALLET_USD);

    esError(res, 403, 'SIN_PERMISO');
    expect(usd.peticiones).toHaveLength(1);
  });
});
