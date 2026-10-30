# Reporte de pruebas

## SPEC-00

- **Agente:** tester · **Fecha:** 2026-10-30 · **Feature:** 0 (`proyecto`)
- **Ejecución:** `bash init.sh` completo → `EXIT=0`. PostgreSQL arriba (`docker compose ps`);
  el proyecto `integration` aún no tiene pruebas (SPEC-00 no tiene casos de integración).

### Casos cubiertos

| Caso | Archivo | Resultado |
|---|---|---|
| PRY-T02 (`cargarConfig` sin `DATABASE_URL` → error con `DATABASE_URL`) | `tests/core/proyecto.test.js` | ✅ |
| PRY-T02 (`require('src/config')` sin `DATABASE_URL` en `process.env` → lanza, el servicio no arranca) | `tests/core/proyecto.test.js` | ✅ |
| PRY-T03 (`enmascararCuenta('0011-0123-456789')` → `'****-****-456789'`) | `tests/core/proyecto.test.js` | ✅ |

Pruebas extra (sin id, justificadas en SPEC-00 §2/§5 y PRY-R06/R10), mismo archivo, todas ✅:

- Obligatorias `JWT_PUBLIC_KEY`, `BILLETERA_URL`, `BILLETERA_TOKEN` ausentes → error con su nombre; vacía = ausente.
- Valores por defecto de §5 (`PORT` 3000, `LOG_LEVEL` info, `TRUST_PROXY` 1, `MANIFEST_PATH`, `JWT_*`, `IDEMPOTENCIA_DIAS` 7, `BILLETERA_TIMEOUT_MS` 5000) y sobrescritura explícita.
- `UIF_UMBRAL_*` opcionales: ausentes → `null`; presentes → string (nunca `Number`).
- `JWT_PUBLIC_KEY` con `\n` escritos → saltos de línea reales.
- Entero inválido (`PORT=abc`) → error con el nombre de la variable.
- `enmascararCuenta` sin guiones y con valor no string.
- Logger: con pino real y las opciones reales de `src/core/logger.js` (solo se redirige el destino), `req.headers.authorization` sale `[REDACTED]` y el token no aparece en la salida.

### Casos en `test.todo`

| Caso | Espera |
|---|---|
| PRY-T01 `GET /health` sin token → 200 `{ "estado": "ok" }` | SPEC-06 (`crearApp` y ruta `/health`) |

### Pruebas fallidas

Ninguna.

### Cobertura (`src/core/` y `src/modules/`)

```
-----------|---------|----------|---------|---------|-------------------
File       | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
-----------|---------|----------|---------|---------|-------------------
All files  |     100 |      100 |     100 |     100 |
 logger.js |     100 |      100 |     100 |     100 |
-----------|---------|----------|---------|---------|-------------------
Test Suites: 1 passed, 1 total
Tests:       1 todo, 15 passed, 16 total
```

- `src/core/`: 100 % (solo existe `logger.js`). Umbral 80 % aplicado y cumplido.
- `src/modules/`: sin código todavía (entra con SPEC-07).
- `src/config.js` queda fuera de `collectCoverageFrom` (por diseño de `jest.config.js`), pero todas sus ramas las ejercitan las pruebas anteriores.

## SPEC-01

- **Agente:** tester · **Fecha:** 2026-10-30 · **Feature:** 1 (`dominio`)
- **Ejecución:** `bash init.sh` completo → `EXIT=0` (PostgreSQL real, `deposito_test`).
  `[OK] SPEC-01: todos sus casos tienen prueba`. `Test Suites: 4 passed · Tests: 1 todo, 42 passed, 43 total`.

### Casos cubiertos

| Caso | Archivo | Resultado |
|---|---|---|
| DOM-T01 `ErrorApp('MONTO_INVALIDO')` → 422 `{ codigo, mensaje, correlationId: 'abc-123' }` | `tests/unit/dominio/errores.test.js` | ✅ |
| DOM-T02 error desconocido → 500 `ERROR_INTERNO`, sin mensaje ni stack en el cuerpo; `logger.error` con `err` y `correlationId` | `tests/unit/dominio/errores.test.js` | ✅ |
| DOM-T03 `POST` con `{malo` → 400 `FORMATO_INVALIDO` | `tests/unit/dominio/errores.test.js` | ✅ |
| DOM-T04 `BILLETERA_NO_DISPONIBLE` con `depositoId: 'x'` → 502 y `res.locals.depositoId === 'x'` (+ sin `depositoId` no se asigna) | `tests/unit/dominio/errores.test.js` | ✅ |
| DOM-T05 `registrarErrores` con código del core ya existente → lanza, catálogo intacto (+ mismo código nuevo dos veces → la segunda lanza) | `tests/unit/dominio/errores.test.js` | ✅ |
| DOM-T06 `aJson` con monto `150` sin referencia → `"150.00"`, `referencia: null` (+ referencia `null` en BD) | `tests/unit/dominio/depositoMapper.test.js` | ✅ |
| DOM-T07 controller `async` que lanza envuelto en `manejar` → 403 sin colgarse (timeout 2 s) (+ sin error responde normal) | `tests/unit/dominio/errores.test.js` | ✅ |
| DOM-T08 `enTransaccion` que inserta 2 filas y lanza → rechaza con el mismo error y `count(*) = '0'` | `tests/integration/dominio/transaccion.test.js` | ✅ |
| DOM-T08 (variantes) sin error → COMMIT y devuelve el resultado; error de BD (`CHECK monto > 0`) → rollback; ROLLBACK que falla → relanza el original, loguea y el pool sigue usable | `tests/integration/dominio/transaccion.test.js` | ✅ |

Pruebas extra (sin id de caso, justificadas por reglas de SPEC-01), todas ✅:

- DOM-R06: `ErrorApp` toma status/mensaje del catálogo; código fuera del catálogo lanza.
- §5: los 16 códigos del catálogo del core con su status.
- DOM-R07: sin `req.correlationId` la clave sale como `null`; con `res.headersSent` delega en `next(err)`.
- DOM-R09: código nuevo registrado → `manejadorErrores` lo responde; definición inválida → lanza sin dejar el catálogo a medias.
- DOM-R10: fila completa → objeto exacto de §5 (camelCase, sin `usuario_id` ni `*_acreditar`); montos `"0.01"`, `"10.5"`→`"10.50"`; fechas con offset → ISO UTC; `extensiones` tal cual; fila real de PostgreSQL por `aJson` (integración).

Nota de ubicación: DOM-T08 necesita PostgreSQL real, por eso va en `tests/integration/dominio/` (SPEC-00 §6) además de los dos archivos del §2. `correlationId` lo asigna un middleware del propio test (SPEC-03 aún no existe). Datos: solo SPEC-02 §4 (`0011-0123-456789`, `usr-agente-1`).

### Casos en `test.todo`

Ninguno de SPEC-01. (Sigue PRY-T01 de SPEC-00, espera SPEC-06.)

### Pruebas fallidas

Ninguna.

### Cobertura (`src/core/` y `src/modules/`)

```
----------------------|---------|----------|---------|---------|-------------------
File                  | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
----------------------|---------|----------|---------|---------|-------------------
All files             |   98.73 |    94.44 |    92.3 |   98.63 |
 core                 |   98.41 |    91.66 |    90.9 |    98.3 |
  db.js               |   94.73 |      100 |      50 |   94.73 | 14
  depositoMapper.js   |     100 |    83.33 |     100 |     100 | 24
  errores.js          |     100 |    92.85 |     100 |     100 | 62
  logger.js           |     100 |      100 |     100 |     100 |
 core/middlewares     |     100 |      100 |     100 |     100 |
  manejadorErrores.js |     100 |      100 |     100 |     100 |
----------------------|---------|----------|---------|---------|-------------------
```

- `src/core/`: ≥ 90 % en todas las métricas (umbral 80 % cumplido, sin cambios en `jest.config.js`).
- Sin cubrir: `db.js:14` (listener `pool.on('error')` de conexión inactiva), `depositoMapper.js:24` (rama `aJson(fila)` sin `extensiones`, decisión del desarrollador ligada a HD-R08; se probará con SPEC-08), `errores.js:62` (rama `errores` nulo en `registrarErrores`).
- `src/modules/`: sin código todavía.

## SPEC-02

- **Agente:** tester · **Fecha:** 2026-10-30 · **Feature:** 2 (`integraciones`)
- **Ejecución:** `bash init.sh` completo → `EXIT=0` (PostgreSQL real arriba).
  `[OK] SPEC-02: todos sus casos tienen prueba`. `Test Suites: 5 passed · Tests: 1 todo, 60 passed, 61 total`.
- Ningún caso de SPEC-02 necesita PostgreSQL: todo es unitario con nock (`nock.disableNetConnect()`,
  `nock.cleanAll()` + `nock.abortPendingRequests()` en cada prueba) usando los helpers de
  `tests/helpers/billetera.js`. El mock Express (`mocks/billetera/`) es para pruebas manuales: sin pruebas automáticas.
- **Timeouts sin esperar 5 s:** el cliente se carga en `jest.isolateModules` con
  `BILLETERA_TIMEOUT_MS=100` solo en el `process.env` de esa carga (se restaura enseguida); nock
  responde con demora de 1000 ms. Se comprueba que el error llega antes de la demora. No se tocó `config.js` ni `tests/setup/`.

### Casos cubiertos (`tests/unit/integraciones/billeteraClient.test.js`)

| Caso | Resultado |
|---|---|
| INT-T01 `consultarCuenta` 200 → `{ numero, estado, moneda, titularId }` exacto de §4 (+ cuentas `000003` BLOQUEADA y `000002` USD) | ✅ |
| INT-T02 404 → `null` | ✅ |
| INT-T03 500 → `ErrorApp` `BILLETERA_NO_DISPONIBLE` (502) | ✅ |
| INT-T03 timeout → `BILLETERA_NO_DISPONIBLE` | ✅ |
| INT-T04 `acreditar` 201 → resuelve `undefined` | ✅ |
| INT-T04 `acreditar` 409 → resuelve `undefined` | ✅ |
| INT-T05 400 y 500 → `BILLETERA_NO_DISPONIBLE`; `scope.peticiones` = 1 y un segundo interceptor idéntico queda sin usar (sin reintento) | ✅ |
| INT-T05 timeout → `BILLETERA_NO_DISPONIBLE`; 1 sola petición (evento `request` de nock) y el interceptor de reintento sin usar | ✅ |
| INT-T06 consultar y acreditar llevan `Authorization: Bearer token-de-prueba` y `X-Correlation-Id` (+ también en respuestas 404 y 500) | ✅ |
| INT-T07 `monto: Decimal(150)` → body `{ depositoId, monto: "150.00", moneda: "PEN", concepto: "DEPOSITO" }` | ✅ |

Pruebas extra (justificadas por reglas de SPEC-02), todas ✅:

- INT-R04: consulta con 400 → error; 200 con cuerpo no objeto → error; error de red (`ECONNREFUSED`) → error.
- INT-R05: `acreditar` con 200 → resuelve.
- INT-R07: montos límite `"0.01"` → `"0.01"` y `Decimal("10.5")` → `"10.50"` (cuenta USD de §4); `concepto` siempre `DEPOSITO`.

### Casos en `test.todo`

Ninguno de SPEC-02. (Sigue PRY-T01 de SPEC-00, espera SPEC-06.) No había `test.todo` previos que esperaran SPEC-02.

### Pruebas fallidas

Ninguna.

### Cobertura (`src/core/` y `src/modules/`)

```
----------------------|---------|----------|---------|---------|-------------------
File                  | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
----------------------|---------|----------|---------|---------|-------------------
All files             |   99.05 |       94 |      95 |   98.97 |
 core                 |   98.41 |    91.66 |    90.9 |    98.3 |
  db.js               |   94.73 |      100 |      50 |   94.73 | 14
  depositoMapper.js   |     100 |    83.33 |     100 |     100 | 24
  errores.js          |     100 |    92.85 |     100 |     100 | 62
  logger.js           |     100 |      100 |     100 |     100 |
 core/clients         |     100 |    92.85 |     100 |     100 |
  billeteraClient.js  |     100 |    92.85 |     100 |     100 | 45
 core/middlewares     |     100 |      100 |     100 |     100 |
  manejadorErrores.js |     100 |      100 |     100 |     100 |
----------------------|---------|----------|---------|---------|-------------------
```

- `src/core/`: ≥ 90 % en todas las métricas (umbral 80 % cumplido). `billeteraClient.js` pasa de 0 % a 100 % líneas.
- Sin cubrir en `billeteraClient.js:45`: rama `err.message` cuando un error de axios no trae `code` (solo afecta al detalle del log).
- `src/modules/`: sin código todavía.

## SPEC-03

- **Agente:** tester · **Fecha:** 2026-10-30 · **Feature:** 3 (`seguridad`)
- **Ejecución:** `bash init.sh` completo → `EXIT=0` (PostgreSQL real arriba).
  `[OK] SPEC-03: todos sus casos tienen prueba (todo: SEG-T06)`. `Test Suites: 7 passed · Tests: 2 todo, 87 passed, 89 total`.
- T01–T05, T08–T10 montan los middlewares reales en una app Express mínima dentro del test
  (`correlationId → GET /health → autenticar → rutas → manejadorErrores`, orden de PIP-R11) y se
  prueban con Supertest. Tokens con `tests/helpers/tokens.js` (otra clave RSA generada en el test,
  `alg: none`, `aud` distinto, `exp` pasado). La integración no necesita filas, pero respeta
  `limpiar()` en `beforeEach`.
- **SEG-T09 sin vaciar el log:** se usa pino real con las opciones reales de `src/core/logger.js`
  (en `jest.isolateModules` con `LOG_LEVEL=info` solo durante la carga; únicamente se redirige el
  destino a un `Writable`). Se cargan `correlationId`, `auth` y `manejadorErrores` en ese mismo
  registro, así toda la salida JSON de la petición (log de petición + `logger.error` del 500) queda capturada.

### Casos cubiertos

| Caso | Archivo | Resultado |
|---|---|---|
| SEG-T01 sin `Authorization` → 401 `TOKEN_REQUERIDO` (+ `Basic …`, `Bearer ` vacío, token sin `Bearer`) | `tests/integration/seguridad/seguridad.test.js` | ✅ |
| SEG-T02 `exp` en el pasado → 401 `TOKEN_EXPIRADO` | `tests/integration/seguridad/seguridad.test.js` | ✅ |
| SEG-T03 firmado con otra clave → 401 `TOKEN_INVALIDO` | `tests/integration/seguridad/seguridad.test.js` | ✅ |
| SEG-T04 `alg: none` → 401 `TOKEN_INVALIDO` | `tests/integration/seguridad/seguridad.test.js` | ✅ |
| SEG-T05 `aud` distinto → 401 `TOKEN_INVALIDO` | `tests/integration/seguridad/seguridad.test.js` | ✅ |
| SEG-T07 `verificarCanal` CLIENTE + VENTANILLA → lanza `ErrorApp` `SIN_PERMISO` (403) | `tests/unit/seguridad/permisos.test.js` | ✅ |
| SEG-T08 sin `X-Correlation-Id` → UUID no vacío (distinto por petición); con `abc` → `abc`; también en header y cuerpo de un 401 | `tests/integration/seguridad/seguridad.test.js` | ✅ |
| SEG-T09 500 forzado en `POST /cuentas/0011-0123-456789/depositos` → la salida del log no contiene el JWT, ni su firma, ni `0011-0123-456789` / `0011-0123`; el registro trae `status: 500`, `duracionMs` entero ≥ 0, `usuarioId`, `metodo`, ruta enmascarada | `tests/integration/seguridad/seguridad.test.js` | ✅ |
| SEG-T10 `requiereRol('AGENTE')` con token CLIENTE → 403 `{ codigo: SIN_PERMISO, mensaje, correlationId }` | `tests/integration/seguridad/seguridad.test.js` | ✅ |

Pruebas extra (justificadas por SEG-R01/R03/R06/R08/R09–R13), todas ✅:

- SEG-R06 token mal formado → `TOKEN_INVALIDO`; SEG-R08 token válido → `req.usuario = { id, roles }`; `/health` responde sin token.
- SEG-R09 rol permitido pasa, lista de varios roles; sin `req.usuario` → `SIN_PERMISO`; `requiereRol()` sin roles lanza.
- SEG-R01 id de exactamente 100 caracteres se respeta; 101 caracteres, espacio, `;`, `.` → UUID nuevo.
- SEG-R03 petición cortada en `autenticar` (401) → registro con `usuarioId: null`, sin el token.
- SEG-R10 tabla completa rol × canal, canal/rol desconocido (`toString`), sin roles/usuario; SEG-R13 varios roles.
- SEG-R11 CLIENTE propio/ajeno/`null`; AGENTE y CAJERO a cualquier cuenta. SEG-R12 `esTitular` siempre booleano.

### Casos en `test.todo`

| Caso | Espera |
|---|---|
| SEG-T06 `usr-cliente-1` deposita a `0011-0123-000002` → 403; billetera no recibe acreditación | SPEC-07 (ruta `POST` de depósito) |

No había `test.todo` previos que esperaran SPEC-03 (PRY-T01 sigue esperando SPEC-06).

### Pruebas fallidas

Ninguna.

### Cobertura (`src/core/` y `src/modules/`)

```
----------------------|---------|----------|---------|---------|-------------------
File                  | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
----------------------|---------|----------|---------|---------|-------------------
All files             |   98.75 |     93.4 |   97.14 |   99.31 |
 core                 |   98.64 |    94.59 |   93.75 |   98.55 |
  db.js               |   94.73 |      100 |      50 |   94.73 | 14
  depositoMapper.js   |     100 |    83.33 |     100 |     100 | 24
  errores.js          |     100 |    92.85 |     100 |     100 | 62
  logger.js           |     100 |      100 |     100 |     100 |
  permisos.js         |     100 |      100 |     100 |     100 |
 core/clients         |     100 |    92.85 |     100 |     100 |
  billeteraClient.js  |     100 |    92.85 |     100 |     100 | 45
 core/middlewares     |   98.33 |     92.5 |     100 |     100 |
  auth.js             |   96.42 |    94.73 |     100 |     100 | 43
  correlationId.js    |     100 |    77.77 |     100 |     100 | 18
  manejadorErrores.js |     100 |      100 |     100 |     100 |
----------------------|---------|----------|---------|---------|-------------------
```

- `src/core/`: todas las métricas ≥ 93 % (umbral 80 % cumplido; antes 65 % por falta de estas pruebas).
- Sin cubrir: `auth.js:43` (rama de `payloadValido` para un token firmado sin `sub` o con `roles: []`; el helper solo firma usuarios de SPEC-02 §4) y `correlationId.js:18` (fallback `req.url`/`''` de `rutaParaLog`, inalcanzable en Express).
- `src/modules/`: sin código todavía.
- **Correcciones tras review** (`progress/review_03.md`, obs. 1): añadido `describe('SEG-R06 payload firmado correctamente pero incompleto')` en `tests/integration/seguridad/seguridad.test.js` — tokens RS256 firmados con `jsonwebtoken` y `tests/.tmp/privada.pem` (iss/aud/exp válidos): control con `sub`+`roles` → 200; sin `sub`, `sub: ''`, `roles: []`, sin `roles`, `roles` no arreglo → 401 `TOKEN_INVALIDO`. `bash init.sh` → `EXIT=0`, `Tests: 2 todo, 93 passed, 95 total`; `auth.js` pasa a 100 % (stmts/branch), `src/core/` All files 99.37 % stmts / 94.5 % branch. Ya no queda sin cubrir `auth.js:43`.
