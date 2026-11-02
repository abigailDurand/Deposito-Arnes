# Implementación SPEC-01 · dominio

- **Agente:** desarrolladorback · **Fecha:** 2026-10-30 · **Feature:** 1 (`in_progress`, no se marca `done`)

> **Atención leader/tester:** `bash init.sh --rapido` está **verde**. `bash init.sh` completo está
> **rojo solo por el umbral de cobertura del 80 % en `./src/core/`** (15 %): los 4 archivos nuevos
> de `src/core/` todavía no tienen pruebas porque los `*.test.js` son del tester. No falla ninguna
> prueba ni la BD. Se pone verde en cuanto existan `tests/unit/dominio/*.test.js` (DOM-T01..T08).
> No puedo arreglarlo yo sin escribir `*.test.js` o tocar `jest.config.js` (fuera de mi §2).
> El comportamiento de DOM-T01..T08 lo verifiqué con un script fuera del repo (ver "Verificación").

## Archivos creados (todos del §2 de SPEC-01)

| Archivo | Nota |
|---|---|
| `db/00-core.sql` | Tabla `depositos` + 2 índices, copia literal de §4 |
| `src/core/db.js` | `pool` (pg `Pool` sobre `config.databaseUrl`) y `enTransaccion(fn)` |
| `src/core/errores.js` | `ErrorApp`, `catalogo`, `registrarErrores`, `manejar` |
| `src/core/middlewares/manejadorErrores.js` | Exporta la función `(err, req, res, next)` directamente |
| `src/core/depositoMapper.js` | `aJson(fila, extensiones)` |

No creados: `tests/unit/dominio/errores.test.js` y `depositoMapper.test.js` (del tester).
Modificados fuera de código: `feature_list.json` (feature 1 → `in_progress`), `progress/current.md`.

## Reglas

- **DOM-R01 / DOM-R02**: el `CHECK` de `estado` limita los 4 estados. Las transiciones las ejecutan
  SPEC-05/07 (aún no existen); SPEC-01 no declara ningún archivo que las aplique, así que no hay
  código de transición aquí (no se inventa).
- **DOM-R03**: `cuenta_destino` y `usuario_id` son `VARCHAR` sin `REFERENCES`.
- **DOM-R04**: `depositos` tiene solo las columnas de §4, ninguna de features.
- **DOM-R05**: `monto_acreditar` / `moneda_acreditar` `NOT NULL` con sus `CHECK`.
- **DOM-R06**: `new ErrorApp(codigo, { depositoId })` toma `status` y `mensaje` del catálogo;
  `depositoId` solo se asigna si viene. Un código fuera del catálogo lanza `Error` al construir
  (programación incorrecta; si llega a `manejadorErrores` sale como 500).
- **DOM-R07**: `manejadorErrores` → `ErrorApp`: su status + `{ codigo, mensaje, correlationId }` y
  `res.locals.depositoId` si trae `depositoId`; `err.type === 'entity.parse.failed'` → 400
  `FORMATO_INVALIDO`; resto → 500 `ERROR_INTERNO` + `logger.error({ err, correlationId })`. La
  respuesta solo tiene esas 3 claves: nunca stack ni `err.message`.
- **DOM-R08**: `manejar(fn)` devuelve un middleware `async` que hace `await fn(req, res, next)` y
  pasa cualquier excepción/rechazo a `next(err)`.
- **DOM-R09**: `registrarErrores({ CODIGO: { status, mensaje } })` lanza si el código ya existe
  (del core o registrado antes). Valida todas las entradas antes de agregar ninguna.
- **DOM-R10**: `aJson` → camelCase; `monto` = `new Decimal(fila.monto).toFixed(2)`; `referencia ?? null`;
  fechas `toISOString()` (UTC); no incluye `usuario_id` ni `*_acreditar`.
- **PRY-R06**: ni `Number(`, `parseFloat` ni `+monto`; el monto pasa por `Decimal`.
- **PRY-R08**: `db.js` no construye SQL; solo `BEGIN`/`COMMIT`/`ROLLBACK` literales.
- **PRY-R09**: la URL de la BD sale de `config.databaseUrl`, ningún `process.env` en los archivos nuevos.
- **PRY-R10**: el log de 500 lleva `err` y `correlationId`, ni token ni cuenta.

## Decisiones

1. **`correlationId`** (SPEC-03 aún no existe): se usa `req.correlationId ?? null`. Con `null` la
   clave siempre aparece en el JSON (con `undefined`, `JSON.stringify` la omitiría y rompería la forma
   de §5). No se creó ningún middleware de SPEC-03. Las pruebas de DOM-T01 pueden asignar
   `req.correlationId` con un middleware propio antes de la ruta.
2. **`manejadorErrores` con `res.headersSent`** → `next(err)` (convención de Express: si ya se
   enviaron cabeceras no se puede responder; Express cierra la conexión).
3. **Exportaciones:** `errores.js` → `{ ErrorApp, catalogo, registrarErrores, manejar }`;
   `manejadorErrores.js` → la función (`app.use(require('./middlewares/manejadorErrores'))`);
   `depositoMapper.js` → `{ aJson }`; `db.js` → `{ pool, enTransaccion }`.
4. **`aJson` sin segundo argumento** no incluye la clave `extensiones` (HD-R08: el historial llama
   `aJson(fila)` "sin la clave `extensiones`"); con argumento (`{}` incluido) la incluye (RD-R09, CD-R07).
5. **`enTransaccion(fn)`**: `pool.connect()` → `BEGIN` → `fn(tx)` → `COMMIT` → devuelve lo que
   devuelve `fn`. Si `fn` (o el COMMIT) lanza → `ROLLBACK` y relanza el error original. Si el
   `ROLLBACK` también falla, se loguea y el cliente se descarta (`release(err)`) en vez de volver al
   pool. `tx` es el `PoolClient` de pg (mismo `query` que `pool`), coherente con "los repositories
   reciben el ejecutor (`db` o `tx`) como primer parámetro".
6. **`pool.on('error')`** con `logger.error`: sin ese listener, la caída de una conexión inactiva
   tumba el proceso de Node.
7. **`catalogo` es mutable y compartido por todo el proceso** (lo exige `registrarErrores`).

## Cómo usan las pruebas de integración la BD de pruebas (`db.js`)

- `tests/setup/env.js` (setupFiles) asigna `DATABASE_URL = DATABASE_URL_TEST` **antes** de que se
  cargue `src/config.js`, así que `require('../../src/core/db')` ya abre su `pool` contra
  `deposito_test`. No hace falta ninguna rama especial en `db.js` ni en `config.js`.
- `globalSetup` (proyecto `integration`) reinicia el esquema y aplica `db/00-core.sql` en cada corrida
  (D12), por lo que la tabla `depositos` existe al empezar.
- Patrón para cada archivo de integración:
  ```js
  const { pool, enTransaccion } = require('../../../src/core/db');
  const { limpiar, cerrar } = require('../../helpers/db');
  beforeEach(limpiar);
  afterAll(async () => { await pool.end(); await cerrar(); });
  ```
  **Importante:** cerrar los **dos** pools (`src/core/db` y `tests/helpers/db`); si no, Jest
  queda colgado con handles abiertos. Ambos apuntan a la misma BD.
- DOM-T08: `await expect(enTransaccion(async (tx) => { await tx.query('INSERT ...', [...]); throw ... }))
  .rejects.toThrow()` y luego `SELECT count(*) FROM depositos` → `'0'` (pg devuelve `count` como string).
- DOM-T01..T07 no necesitan BD: van como unitarias con una app Express mínima + Supertest
  (`express.json()` para DOM-T03, `manejadorErrores` al final). Ojo: `errores.js` y
  `manejadorErrores.js` importan `logger.js` → `config.js`, que necesita `JWT_PUBLIC_KEY`; en el
  proyecto `unit` ya la aporta `env.js` porque `globalSetup` genera `tests/.tmp/publica.pem`.
- DOM-T05: el catálogo es global; si una prueba registra un código nuevo, debe usar un nombre único
  (registrar el mismo dos veces lanza, por DOM-R09).

## Riesgo para specs posteriores (no es bloqueo de SPEC-01)

- **PIP-R10 + DOM-R09**: si `crearApp({ manifest })` (SPEC-06) se llama varias veces en el mismo
  proceso de Jest y cada vez hace `registrarErrores` con los mismos códigos de un módulo, la segunda
  llamada lanzará (DOM-R09 lo exige). SPEC-06 tendrá que registrar cada módulo una sola vez por proceso;
  lo anoto para el desarrollador/revisor de SPEC-06.
- Observación 2 de `review_00.md` (quitar `--passWithNoTests` de `test:integration`): `package.json`
  no está en el §2 de SPEC-01, no lo toqué.

## Verificación

Script fuera del repo (scratchpad, no versionado) que carga `tests/setup/env.js`, ejecuta el
`globalSetup` de `integration` contra PostgreSQL real (`chalenge-db-1`) y comprueba con Express +
Supertest:

- DOM-T01: `ErrorApp('MONTO_INVALIDO')` → 422 `{ codigo, mensaje del catálogo, correlationId: 'abc-123' }` (deepEqual).
- DOM-T02: `Error('secreto stack')` → 500 `ERROR_INTERNO`; el cuerpo no contiene el mensaje ni el stack.
- DOM-T03: `POST` con `{malo` → 400 `FORMATO_INVALIDO`.
- DOM-T04: `ErrorApp('BILLETERA_NO_DISPONIBLE', { depositoId: 'x' })` → 502 y `res.locals.depositoId === 'x'`.
- DOM-T05: `registrarErrores({ MONTO_INVALIDO: ... })` lanza; uno nuevo se registra y `ErrorApp` lo usa.
- DOM-T06: `aJson({ monto: 150, sin referencia })` → `"150.00"`, `referencia: null`; sin `usuario_id`/`*_acreditar`.
- DOM-T07: ruta `manejar(async () => { throw new ErrorApp('SIN_PERMISO') })` → 403 (no se cuelga).
- DOM-T08: `enTransaccion` que inserta y lanza → rechaza y `count(*) = 0`; una que no lanza → commit y
  devuelve su valor. La fila real pasada por `aJson`:
  `{"id":"7f1c...abd","cuentaDestino":"0011-0123-456789","monto":"150.00","moneda":"PEN","canal":"AGENTE","referencia":null,"estado":"PENDIENTE","creadoEn":"2026-10-30T20:46:43.154Z","actualizadoEn":"2026-10-30T20:46:43.154Z","extensiones":{}}`
- `current_database()` del pool de `src/core/db.js` bajo `env.js` → `deposito_test`.
- Resultado: `TODO OK`.

### `bash init.sh --rapido`

```
[OK]    specs-v2/ intacto (15 archivos)
[OK]    feature_list.json válido (13 features: pending=11 in_progress=1 done=1 blocked=0)
[OK]    SPEC-00: todos sus casos tienen prueba (todo: PRY-T01)
[WARN]  SPEC-01 (en curso) aún sin prueba: DOM-T01 ... DOM-T08
[OK]    Alcance de archivos correcto (62 archivos revisados)
Tests:       1 todo, 15 passed, 16 total
[OK]    Pruebas unitarias en verde (modo --rapido: integración NO ejecutada)
[OK]    Entorno listo (verificación rápida). Para cerrar una feature corre 'bash init.sh' completo.
EXIT=0
```

### `bash init.sh` (completo)

```
[OK]    Alcance de archivos correcto (62 archivos revisados)
Tests:       1 todo, 15 passed, 16 total
 core                 |   19.04 |    16.66 |   18.18 |   16.94 |
  db.js               |       0 |      100 |       0 |       0 | 3-40
  depositoMapper.js   |       0 |        0 |       0 |       0 | 3-28
  errores.js          |       0 |        0 |       0 |       0 | 4-87
  logger.js           |     100 |      100 |     100 |     100 |
  manejadorErrores.js |       0 |        0 |       0 |       0 | 3-33
Jest: "./src/core/" coverage threshold for statements (80%) not met: 15.18%
[FAIL]  Hay pruebas rotas (¿está PostgreSQL arriba? 'docker compose up -d db')
EXIT=1
```

Causa única: cobertura de `src/core/` sin las pruebas DOM-T del tester (ninguna prueba falla).
