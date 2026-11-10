'use strict';

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Client, Pool } = require('pg');

const { migrar, archivosSql, CLAVE_BLOQUEO } = require('../../../scripts/migrar');
const { limpiar, cerrar } = require('../../helpers/db');

const RAIZ = path.join(__dirname, '..', '..', '..');
const DIR_SQL = path.join(RAIZ, 'db');
const SCRIPT = path.join(RAIZ, 'scripts', 'migrar.js');
const URL_PRUEBAS = process.env.DATABASE_URL_TEST;

const TABLAS = [
  'alertas_uif', 'auditoria_depositos', 'claves_idempotencia', 'conversiones_deposito',
  'depositos', 'limites_canal', 'tipos_cambio',
];

// Esquema de depositos anterior a SPEC-01 v1.2 (sin titular_id), tal como estaba en db/00-core.sql.
const CORE_ANTERIOR_V12 = `
CREATE TABLE depositos (
    id                UUID PRIMARY KEY,
    cuenta_destino    VARCHAR(36)   NOT NULL,
    monto             NUMERIC(15,2) NOT NULL CHECK (monto > 0),
    moneda            CHAR(3)       NOT NULL CHECK (moneda IN ('PEN','USD')),
    monto_acreditar   NUMERIC(15,2) NOT NULL CHECK (monto_acreditar > 0),
    moneda_acreditar  CHAR(3)       NOT NULL CHECK (moneda_acreditar IN ('PEN','USD')),
    canal             VARCHAR(20)   NOT NULL CHECK (canal IN ('AGENTE','VENTANILLA','APP')),
    referencia        VARCHAR(140),
    estado            VARCHAR(20)   NOT NULL CHECK (estado IN ('PENDIENTE','PROCESANDO','COMPLETADO','FALLIDO')),
    usuario_id        VARCHAR(50)   NOT NULL,
    creado_en         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    actualizado_en    TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX idx_depositos_cuenta  ON depositos (cuenta_destino, creado_en DESC);
CREATE INDEX idx_depositos_usuario ON depositos (usuario_id, creado_en DESC);
`;

const loggerMudo = { info: () => {}, error: () => {} };

// ── BD temporales (CI-T01..T04 nunca tocan deposito_test) ──

const creadas = [];
const pools = [];
const carpetas = [];

function urlDe(nombre) {
  const url = new URL(URL_PRUEBAS);
  url.pathname = `/${nombre}`;
  return url.toString();
}

async function conAdmin(fn) {
  const cliente = new Client({ connectionString: urlDe('postgres') });
  await cliente.connect();
  try {
    return await fn(cliente);
  } finally {
    await cliente.end();
  }
}

async function crearBdTemporal() {
  const nombre = `deposito_ci_${process.pid}_${crypto.randomBytes(4).toString('hex')}`;
  await conAdmin((c) => c.query(`CREATE DATABASE "${nombre}"`));
  creadas.push(nombre);
  return urlDe(nombre);
}

function nuevoPool(url) {
  const pool = new Pool({ connectionString: url });
  pools.push(pool);
  return pool;
}

async function consultar(url, sql, params) {
  const cliente = new Client({ connectionString: url });
  await cliente.connect();
  try {
    return (await cliente.query(sql, params)).rows;
  } finally {
    await cliente.end();
  }
}

function carpetaTemporal() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrar-ci-'));
  carpetas.push(dir);
  return dir;
}

function copiarSql(destino) {
  for (const f of archivosSql(DIR_SQL)) fs.copyFileSync(path.join(DIR_SQL, f), path.join(destino, f));
}

// Esquema comparable: columnas, restricciones, índices, triggers y funciones del esquema public.
async function esquema(url) {
  const columnas = await consultar(url, `
    SELECT table_name, column_name, ordinal_position, data_type, character_maximum_length,
           numeric_precision, numeric_scale, is_nullable, column_default
      FROM information_schema.columns WHERE table_schema = 'public'
     ORDER BY table_name, ordinal_position`);
  const restricciones = await consultar(url, `
    SELECT c.relname AS tabla, k.conname, pg_get_constraintdef(k.oid) AS def
      FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' ORDER BY 1, 2`);
  const indices = await consultar(url, `
    SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1, 2`);
  const triggers = await consultar(url, `
    SELECT c.relname AS tabla, t.tgname, pg_get_triggerdef(t.oid) AS def
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND NOT t.tgisinternal ORDER BY 1, 2`);
  const funciones = await consultar(url, `
    SELECT p.proname, pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' ORDER BY 1`);
  return { columnas, restricciones, indices, triggers, funciones };
}

async function tablas(url) {
  const filas = await consultar(url, `
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`);
  return filas.map((f) => f.tablename);
}

// Datos de todas las tablas, en orden estable.
async function datos(url) {
  const resultado = {};
  for (const t of await tablas(url)) {
    resultado[t] = await consultar(url, `SELECT * FROM "${t}" ORDER BY 1, 2`);
  }
  return resultado;
}

function ejecutarScript(url) {
  return new Promise((resolve, reject) => {
    const hijo = spawn(process.execPath, [SCRIPT], {
      cwd: RAIZ,
      env: { ...process.env, DATABASE_URL: url, LOG_LEVEL: 'silent' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    hijo.stdout.resume();
    hijo.stderr.on('data', (d) => { stderr += d; });
    hijo.on('error', reject);
    hijo.on('close', (codigo) => resolve({ codigo, stderr }));
  });
}

const pausa = (ms) => new Promise((r) => { setTimeout(r, ms); });

beforeEach(async () => {
  await limpiar();
});

afterEach(async () => {
  await Promise.all(pools.splice(0).map((p) => p.end().catch(() => {})));
  for (const dir of carpetas.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  const nombres = creadas.splice(0);
  if (nombres.length > 0) {
    await conAdmin(async (c) => {
      for (const n of nombres) await c.query(`DROP DATABASE IF EXISTS "${n}" WITH (FORCE)`);
    });
  }
});

afterAll(async () => {
  await cerrar();
});

describe('SPEC-13 migraciones (CI-R07..R09)', () => {
  test('CI-T01 migrar sobre una base vacía → esquema completo (igual al de globalSetup); otra vez → mismo esquema y datos, sin error', async () => {
    const url = await crearBdTemporal();
    expect(await tablas(url)).toEqual([]);

    const aplicados = await migrar({ pool: nuevoPool(url), logger: loggerMudo });
    expect(aplicados).toEqual(archivosSql(DIR_SQL));
    expect(aplicados.length).toBeGreaterThan(0);
    expect(await tablas(url)).toEqual(TABLAS);
    // CI-R09: el mismo resultado que los db/*.sql aplicados por globalSetup en deposito_test.
    const esquema1 = await esquema(url);
    expect(esquema1).toEqual(await esquema(URL_PRUEBAS));
    expect(esquema1.columnas).toContainEqual(expect.objectContaining({
      table_name: 'depositos', column_name: 'titular_id', is_nullable: 'YES',
    }));

    const datos1 = await datos(url);
    expect(datos1.limites_canal).toHaveLength(6);
    expect(datos1.tipos_cambio).toHaveLength(1);

    await expect(migrar({ pool: nuevoPool(url), logger: loggerMudo })).resolves.toEqual(aplicados);
    expect(await esquema(url)).toEqual(esquema1);
    expect(await datos(url)).toEqual(datos1);
  });

  test('CI-T01 node scripts/migrar.js sobre una base vacía sale con código 0, y otra vez también', async () => {
    const url = await crearBdTemporal();

    const primera = await ejecutarScript(url);
    expect(primera).toEqual({ codigo: 0, stderr: '' });
    expect(await tablas(url)).toEqual(TABLAS);
    const esquema1 = await esquema(url);
    const datos1 = await datos(url);

    const segunda = await ejecutarScript(url);
    expect(segunda).toEqual({ codigo: 0, stderr: '' });
    expect(await esquema(url)).toEqual(esquema1);
    expect(await datos(url)).toEqual(datos1);
  }, 30000);

  test('CI-T01 migrar no pisa los datos ya cargados: un límite cambiado a mano se conserva', async () => {
    const url = await crearBdTemporal();
    await migrar({ pool: nuevoPool(url), logger: loggerMudo });
    await consultar(url, `UPDATE limites_canal SET monto_maximo = 2500.00 WHERE canal = 'AGENTE' AND moneda = 'PEN'`);

    await migrar({ pool: nuevoPool(url), logger: loggerMudo });

    const filas = await consultar(url, 'SELECT canal, moneda, monto_maximo FROM limites_canal ORDER BY 1, 2');
    expect(filas).toHaveLength(6);
    expect(filas).toContainEqual({ canal: 'AGENTE', moneda: 'PEN', monto_maximo: '2500.00' });
  });

  test('CI-T02 base con el esquema anterior a SPEC-01 v1.2 (sin titular_id) y filas → la columna aparece y las filas se conservan', async () => {
    const url = await crearBdTemporal();
    const anterior = carpetaTemporal();
    copiarSql(anterior);
    fs.writeFileSync(path.join(anterior, '00-core.sql'), CORE_ANTERIOR_V12);
    await migrar({ pool: nuevoPool(url), dir: anterior, logger: loggerMudo });
    const sinTitular = await consultar(url, `
      SELECT 1 FROM information_schema.columns
       WHERE table_name = 'depositos' AND column_name = 'titular_id'`);
    expect(sinTitular).toHaveLength(0);

    const id = crypto.randomUUID();
    await consultar(url, `
      INSERT INTO depositos (id, cuenta_destino, monto, moneda, monto_acreditar, moneda_acreditar,
                             canal, referencia, estado, usuario_id)
      VALUES ($1, '0011-0123-456789', 150.00, 'PEN', 150.00, 'PEN', 'AGENTE', 'ref-1', 'COMPLETADO', 'usr-agente-1')`,
    [id]);
    await consultar(url, `
      INSERT INTO auditoria_depositos (deposito_id, usuario_id, accion, canal, monto, resultado)
      VALUES ($1, 'usr-agente-1', 'REGISTRAR_DEPOSITO', 'AGENTE', 150.00, 'COMPLETADO')`, [id]);
    const antes = await datos(url);

    await migrar({ pool: nuevoPool(url), logger: loggerMudo });

    const columna = await consultar(url, `
      SELECT data_type, character_maximum_length, is_nullable FROM information_schema.columns
       WHERE table_name = 'depositos' AND column_name = 'titular_id'`);
    expect(columna).toEqual([{ data_type: 'character varying', character_maximum_length: 100, is_nullable: 'YES' }]);

    const despues = await datos(url);
    expect(despues.depositos).toHaveLength(1);
    expect(despues.depositos[0]).toEqual({ ...antes.depositos[0], titular_id: null });
    for (const t of TABLAS.filter((x) => x !== 'depositos')) expect(despues[t]).toEqual(antes[t]);
    expect(despues.auditoria_depositos).toHaveLength(1);
  });

  test('CI-T03 dos migrar simultáneos con pools distintos → ambos terminan bien, sin duplicar datos de ejemplo', async () => {
    const url = await crearBdTemporal();
    const resultados = await Promise.allSettled([
      migrar({ pool: nuevoPool(url), logger: loggerMudo }),
      migrar({ pool: nuevoPool(url), logger: loggerMudo }),
      migrar({ pool: nuevoPool(url), logger: loggerMudo }),
    ]);

    expect(resultados.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
    expect(await tablas(url)).toEqual(TABLAS);
    expect(await esquema(url)).toEqual(await esquema(URL_PRUEBAS));
    const [{ n: limites }] = await consultar(url, 'SELECT count(*)::int AS n FROM limites_canal');
    const [{ n: tipos }] = await consultar(url, 'SELECT count(*)::int AS n FROM tipos_cambio');
    expect(limites).toBe(6);
    expect(tipos).toBe(1);
  });

  test('CI-T03 migrar espera al advisory lock que tiene otra sesión y no aplica nada hasta que se libera', async () => {
    const url = await crearBdTemporal();
    const otro = new Client({ connectionString: url });
    await otro.connect();
    try {
      await otro.query('BEGIN');
      await otro.query('SELECT pg_advisory_xact_lock(hashtext($1))', [CLAVE_BLOQUEO]);

      let terminado = false;
      const enCurso = migrar({ pool: nuevoPool(url), logger: loggerMudo }).then((r) => { terminado = true; return r; });
      await pausa(300);
      expect(terminado).toBe(false);
      expect(await tablas(url)).toEqual([]);

      await otro.query('COMMIT');
      await expect(enCurso).resolves.toEqual(archivosSql(DIR_SQL));
      expect(await tablas(url)).toEqual(TABLAS);
    } finally {
      await otro.query('ROLLBACK').catch(() => {});
      await otro.end();
    }
  });

  test('CI-T04 carpeta con un .sql roto → migrar rechaza nombrando el archivo y no aplica nada (rollback)', async () => {
    const url = await crearBdTemporal();
    const dir = carpetaTemporal();
    copiarSql(dir);
    fs.writeFileSync(path.join(dir, '99-roto.sql'), 'CREATE TABLE roto (id INT PRIMARY KEY,, );');

    await expect(migrar({ pool: nuevoPool(url), dir, logger: loggerMudo }))
      .rejects.toThrow(/99-roto\.sql/);

    expect(await tablas(url)).toEqual([]);
    const funciones = await consultar(url, `
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'`);
    expect(funciones).toHaveLength(0);
    // El bloqueo se liberó con el ROLLBACK: otra migración entra sin esperar.
    await expect(migrar({ pool: nuevoPool(url), logger: loggerMudo })).resolves.toEqual(archivosSql(DIR_SQL));
  });

  test('CI-T04 node scripts/migrar.js con un db/*.sql que falla en esa base → código ≠ 0 y nada aplicado', async () => {
    const url = await crearBdTemporal();
    // tipos_cambio con otras columnas: 11-conversion-moneda.sql falla al crear su índice.
    await consultar(url, 'CREATE TABLE tipos_cambio (x INT)');

    const { codigo } = await ejecutarScript(url);

    expect(codigo).not.toBe(0);
    expect(await tablas(url)).toEqual(['tipos_cambio']);
    const columnas = await consultar(url, `
      SELECT column_name FROM information_schema.columns WHERE table_name = 'tipos_cambio'`);
    expect(columnas).toEqual([{ column_name: 'x' }]);
  }, 30000);
});
