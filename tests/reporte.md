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
| PRY-T01 (`GET /health` sin token → 200 `{ "estado": "ok" }`) — convertido en prueba real con SPEC-06 (`crearApp`) | `tests/core/proyecto.test.js` | ✅ |

Pruebas extra (sin id, justificadas en SPEC-00 §2/§5 y PRY-R06/R10), mismo archivo, todas ✅:

- Obligatorias `JWT_PUBLIC_KEY`, `BILLETERA_URL`, `BILLETERA_TOKEN` ausentes → error con su nombre; vacía = ausente.
- Valores por defecto de §5 (`PORT` 3000, `LOG_LEVEL` info, `TRUST_PROXY` 1, `MANIFEST_PATH`, `JWT_*`, `IDEMPOTENCIA_DIAS` 7, `BILLETERA_TIMEOUT_MS` 5000) y sobrescritura explícita.
- `UIF_UMBRAL_*` opcionales: ausentes → `null`; presentes → string (nunca `Number`).
- `JWT_PUBLIC_KEY` con `\n` escritos → saltos de línea reales.
- Entero inválido (`PORT=abc`) → error con el nombre de la variable.
- `enmascararCuenta` sin guiones y con valor no string.
- Logger: con pino real y las opciones reales de `src/core/logger.js` (solo se redirige el destino), `req.headers.authorization` sale `[REDACTED]` y el token no aparece en la salida.

### Casos en `test.todo`

Ninguno. PRY-T01 (esperaba SPEC-06) **ya no es `test.todo`**: se convirtió en prueba real al probar
SPEC-06 (ver `## SPEC-06`) y sigue verde en la corrida de SPEC-07 (`bash init.sh` completo, 2026-11-02).

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
- La salida de arriba es la de la corrida original de SPEC-00 (`1 todo` = PRY-T01). **Estado vigente**
  (corrida de SPEC-08, 2026-11-02): PRY-T01..T03 son pruebas reales y verdes; SPEC-00 no tiene `test.todo`.
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

Ninguno (estado vigente, 2026-11-02). SEG-T06 era `test.todo` (esperaba SPEC-07) y **se convirtió en prueba
real** al probar SPEC-07:

| Caso | Archivo | Resultado |
|---|---|---|
| SEG-T06 `usr-cliente-1` deposita a `0011-0123-000002` → 403 `SIN_PERMISO`; billetera consultada pero sin acreditación; 0 filas; auditoría `ERROR_403` | `tests/integration/seguridad/seguridad.test.js` | ✅ |

Las cifras de `Tests:` de esta sección (`2 todo`) son de la corrida original de SPEC-03.

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

## SPEC-04

- **Agente:** tester · **Fecha:** 2026-10-30 · **Feature:** 4 (`auditoria`)
- **Ejecución:** `bash init.sh` completo → verde (8 suites, 105 passed, 5 todo). PostgreSQL real
  (`DATABASE_URL_TEST`); `limpiar()` en `beforeEach` (su `TRUNCATE` funciona pese al trigger, verificado en AUD-T05).
- **App de prueba:** SPEC-06 (`crearApp`) aún no existe → app Express mínima con el orden de PIP-R11:
  `correlationId → auditoria → /health → autenticar → express.json → rutas → manejadorErrores`.
  Las rutas son falsas pero con el mismo método y path que las auditadas (`POST /api/v1/depositos`,
  `GET /api/v1/depositos/:id`, `GET /api/v1/cuentas/:numero/depositos`). Las filas se leen con
  reintentos cortos (hasta 1 s), como pide §6.

### Casos cubiertos

| Caso | Archivo | Resultado |
|---|---|---|
| AUD-T03 POST sin token → 401; 1 fila `CREAR_DEPOSITO` `ERROR_401`, `usuario_id` y `deposito_id` nulos, `correlation_id` el de la petición | `tests/integration/auditoria/auditoria.test.js` | ✅ |
| AUD-T05 `UPDATE` y `DELETE` directos → ambos lanzan `auditoria_depositos es solo de inserción`; la fila sigue intacta; `TRUNCATE` sí limpia | idem | ✅ |
| AUD-T06 `insertar` forzado a rechazar (error con la cuenta en mensaje/detail) → respuesta 201 normal con su cuerpo y X-Correlation-Id; `logger.error` 1 vez con `{correlationId, accion}` y sin la cuenta completa ni `0011-0123`; 0 filas | idem | ✅ |
| AUD-T07 `GET /api/v1/depositos/{id}` → 1 fila `CONSULTAR_DEPOSITO`, `EXITO`, usuario del token | idem | ✅ |
| AUD-T08 `GET /health` → 0 filas (esperando el 1 s completo) | idem | ✅ |

Justificación de AUD-T06 y AUD-T07 con ruta falsa: lo que verifican (acción deducida de método+path,
respuesta intacta ante fallo del INSERT, log sin datos sensibles) depende solo del middleware, no del
controller. Ninguno de los dos exige un depósito real ni `deposito_id` lleno.

Pruebas extra (reglas sin caso numerado), mismo archivo, todas ✅:
- AUD-R07/R08: `canal` VENTANILLA y `monto` "0.01" válidos se guardan; con token → `usuario_id` y `EXITO`.
- AUD-R07: canal fuera de lista/minúsculas, monto numérico `10`, monto `"10.001"` y body array → `canal` y `monto` null.
- AUD-R08: JSON mal formado → fila `ERROR_400`.
- AUD-R02: `GET /cuentas/{numero}/depositos?pagina=1` → `LISTAR_DEPOSITOS`; rutas no listadas, 404 inexistentes, `DELETE /depositos/{id}` y `GET /depositos` → 0 filas; `deducirAccion` sin distinguir mayúsculas, con barra final y con query.
- AUD-R07: `extraerDelBody` con body `undefined`/`null`.

### Casos en `test.todo`

Ninguno (estado vigente, 2026-11-02). AUD-T01, AUD-T02 y AUD-T04 eran `test.todo` (esperaban SPEC-07, y
AUD-T04 también SPEC-05) y **se convirtieron en pruebas reales** al probar SPEC-07:

| Caso | Archivo | Resultado |
|---|---|---|
| AUD-T01 depósito válido → 1 fila `CREAR_DEPOSITO` `EXITO` con `deposito_id` = id de la respuesta | `tests/integration/auditoria/auditoria.test.js` | ✅ |
| AUD-T02 monto `"-5"` → 422; 1 fila `ERROR_422`, `deposito_id` nulo, monto -5.00 | idem | ✅ |
| AUD-T04 3 POST con la misma clave → 3 filas con el mismo `deposito_id`, 1 depósito, 1 acreditación | idem | ✅ |

Las cifras de `Tests:` de esta sección (`5 todo`) son de la corrida original de SPEC-04.

### Pruebas fallidas

Ninguna.

### Cobertura (`src/core/` y `src/modules/`)

```
-------------------------|---------|----------|---------|---------|-------------------
File                     | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
-------------------------|---------|----------|---------|---------|-------------------
All files                |   99.47 |    92.91 |   97.67 |   99.43 |
 core/middlewares        |     100 |     92.1 |     100 |     100 |
  auditoria.js           |     100 |    88.88 |     100 |     100 | 55-65
 core/repositories       |     100 |      100 |     100 |     100 |
  auditoriaRepository.js |     100 |      100 |     100 |     100 |
-------------------------|---------|----------|---------|---------|-------------------
Tests:       5 todo, 105 passed, 110 total
```

- `src/core/`: 98,64 % stmts · 94,59 % branches (≥ 80 %). `src/modules/` aún sin código.
- Ramas no cubiertas de `auditoria.js` (55-65): los `?? null` de `req.ip`, `req.correlationId` y `err?.code` (siempre definidos en la app real).

## SPEC-05

- **Agente:** tester · **Fecha:** 2026-11-02 · **Feature:** 5 (`idempotencia`)
- **Ejecución:** `bash init.sh` completo → `EXIT=0`. PostgreSQL real (`deposito_test`), `--runInBand`.
  `[OK] SPEC-05: todos sus casos tienen prueba (todo: IDE-T02..T08, IDE-T10)` · alcance OK (96 archivos)
  · `Test Suites: 9 passed · Tests: 13 todo, 129 passed, 142 total`.
- **App de prueba:** SPEC-06/07 aún no existen → app Express mínima en el orden de SPEC-05 §6:
  `correlationId → autenticar → express.json → POST /api/v1/depositos [idempotencia → controller falso] → manejadorErrores`.
  El controller falso lo define cada prueba (status, cuerpo, `res.locals.depositoId`, `ErrorApp` 502,
  error no controlado 500, o espera bloqueada para simular "billetera lenta"). Un observador en `finish`
  captura `res.locals.depositoId` y `req.idempotencia`. Los depósitos referenciados (FK) se insertan
  en `depositos` con la cuenta `0011-0123-456789` (SPEC-02 §4); usuarios `usr-agente-1`/`usr-agente-2`.
- Archivo único (el que nombra el §2): `tests/integration/idempotencia/idempotencia.test.js`.

### Casos cubiertos

| Caso | Archivo | Resultado |
|---|---|---|
| IDE-T01 clave nueva → controller 1 vez, 201 sin `Idempotency-Replayed`; fila `TERMINADO`, `status_http` 201, `respuesta` = cuerpo, `deposito_id` = `res.locals.depositoId` | `tests/integration/idempotencia/idempotencia.test.js` | ✅ |
| IDE-T01 (variante) respuesta 422 → fila `TERMINADO` con 422 y `deposito_id` nulo | idem | ✅ |
| IDE-T09 sin header → 400 `{ codigo: IDEMPOTENCY_KEY_REQUERIDA, mensaje, correlationId }`; controller 0 veces; 0 filas | idem | ✅ |
| IDE-T09 clave de 7 caracteres → 400 `IDEMPOTENCY_KEY_REQUERIDA`; controller 0 veces; 0 filas | idem | ✅ |

Pruebas extra por regla (sin caso numerado; cubren con controller falso lo que SPEC-07 probará de punta a punta), mismo archivo, todas ✅:

- IDE-R01: `claveValida` con 8 y 100 (válidas), 7, 101, vacía, `undefined`, número (inválidas); por HTTP 101 → 400, 8 y 100 → 201.
- IDE-R03: `calcularHash` = SHA-256 de `"POST /api/v1/depositos?x=1 {…}"` con llaves ordenadas recursivamente y arrays en orden; body `undefined`; `hash_solicitud` en BD igual al esperado.
- IDE-R07 (≈ IDE-T02 sin billetera): repetición con llaves en otro orden → mismo status y cuerpo, `Idempotency-Replayed: true`, `X-Correlation-Id` de la petición actual, `res.locals.depositoId` asignado, controller 1 vez; respuesta guardada sin `deposito_id` → no asigna `res.locals.depositoId`; sin middleware correlationId → sin `X-Correlation-Id`.
- IDE-R05 (≈ IDE-T03/T04): monto distinto → 409 `IDEMPOTENCY_KEY_REUTILIZADA` con el cuerpo de §5; clave `EN_PROCESO` (controller bloqueado, 2.º POST a los 100 ms) → 409 `SOLICITUD_EN_PROCESO` con el cuerpo exacto de §5; con `EN_PROCESO` y hash distinto gana `REUTILIZADA`; la fila desaparece entre el INSERT en conflicto y el SELECT → 409 `SOLICITUD_EN_PROCESO`.
- IDE-R04 (≈ IDE-T05): 5 POST simultáneos → controller 1 vez, 1×201 y 4×409 `SOLICITUD_EN_PROCESO`, 1 fila.
- IDE-R02 (≈ IDE-T10): `usr-agente-1` y `usr-agente-2` con la misma clave → ambos procesados, 2 filas `TERMINADO`.
- IDE-R08 (≈ IDE-T06/T08): 500 → clave borrada y el reintento se procesa como nuevo (sin `req.idempotencia`); 502 sin `depositoId` → clave borrada; 502 con `depositoId` → `REINTENTABLE` con ese `deposito_id`; guardado que falla (FK con id inexistente, y `terminar` rechazado sin `code`) → 201 igual, `logger.error` 1 vez con `{ correlationId, status, codigoError }` y sin cuenta ni clave; la fila queda `EN_PROCESO`.
- IDE-R06: reintento de `REINTENTABLE` → `req.idempotencia = { depositoIdPrevio }`, 201 y fila `TERMINADO` con el mismo `deposito_id`; la 3.ª petición se repite; reintento en curso + otro → 409; carrera real en PostgreSQL (otra petición pasa la fila a `EN_PROCESO` entre el SELECT y el UPDATE) → UPDATE de 0 filas → 409 `SOLICITUD_EN_PROCESO`.
- IDE-R09: `borrarAntiguas(pool, config.idempotenciaDias)` (7) borra las 3 claves de más de 7 días en `EN_PROCESO`, `TERMINADO` y `REINTENTABLE`, conserva las de 6 y 0 días y devuelve 3; `limpiarClaves.iniciar()` programa `setInterval` de 3 600 000 ms con `unref()`, la tarea borra y loguea `{ borradas: 3 }`; si `borrarAntiguas` falla → `logger.error({ codigoError })` (con y sin `code`) y la tarea no rechaza.

Nota: los `jest.spyOn` sobre `idempotenciaRepository` envuelven la llamada real (provocan la carrera con
SQL real sobre PostgreSQL) o fuerzan un rechazo para la rama de fallo del guardado/limpieza; PostgreSQL
no se mockea. `setInterval` se espía solo para no esperar 1 h.

### Casos en `test.todo`

Ninguno (estado vigente, 2026-11-02). IDE-T02..T08 e IDE-T10 eran `test.todo` (esperaban SPEC-07) y **se
convirtieron en pruebas reales** con la ruta real y billetera en nock al probar SPEC-07, todas ✅ en
`tests/integration/idempotencia/idempotencia.test.js`:

| Caso | Resultado |
|---|---|
| IDE-T02 repetir → mismo status y cuerpo, `Idempotency-Replayed: true`, billetera 1 vez | ✅ |
| IDE-T03 misma clave, monto distinto → 409 `IDEMPOTENCY_KEY_REUTILIZADA` | ✅ |
| IDE-T04 billetera tarda 2 s → segundo POST 409 `SOLICITUD_EN_PROCESO` | ✅ |
| IDE-T05 5 POST simultáneos → 1 depósito, 1 acreditación | ✅ |
| IDE-T06 billetera 500 al acreditar, reintento → mismo `id` y mismo `depositoId` a billetera | ✅ |
| IDE-T07 timeout, reintento con billetera 409 → 201 COMPLETADO | ✅ |
| IDE-T08 billetera 500 al consultar, reintento → se procesa como nuevo | ✅ |
| IDE-T10 dos agentes, misma clave → ambos procesados | ✅ |

AUD-T04 (auditoría), que esperaba SPEC-05 y SPEC-07, también es prueba real desde SPEC-07. Las cifras de
`Tests:` de esta sección (`13 todo`) son de la corrida original de SPEC-05.

### Pruebas fallidas

Ninguna.

### Cobertura (`src/core/` y `src/modules/`)

```
----------------------------|---------|----------|---------|---------|-------------------
File                        | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
----------------------------|---------|----------|---------|---------|-------------------
All files                   |   99.64 |    94.38 |   98.38 |   99.61 |
 core/middlewares           |     100 |    94.87 |     100 |     100 |
  idempotencia.js           |     100 |      100 |     100 |     100 |
 core/repositories          |     100 |     87.5 |     100 |     100 |
  idempotenciaRepository.js |     100 |     87.5 |     100 |     100 | 41
 core/tareas                |     100 |      100 |     100 |     100 |
  limpiarClaves.js          |     100 |      100 |     100 |     100 |
----------------------------|---------|----------|---------|---------|-------------------
Test Suites: 9 passed, 9 total
Tests:       13 todo, 129 passed, 142 total
```

- `src/core/`: de ~67 % a 99,64 % stmts · 94,38 % branches (≥ 80 %). `src/modules/` aún sin código.
- Rama no cubierta de `idempotenciaRepository.js:41`: `respuesta ?? null` / `depositoId ?? null` en `terminar` cuando llegan `undefined` (el middleware ya pasa `null`).

## SPEC-06

- **Tester** · 2026-11-02 · `bash init.sh` completo con PostgreSQL real: **verde** (12 suites, 177 passed + 12 todo).
- **Módulos falsos:** `tests/core/fixtures/` (validadores, transformadores, post-procesos, endpoint, módulo de tipo
  equivocado y estado compartido `registro.js`). `fixtures/modulos.js` los registra con
  `jest.doMock(src/modules/<id>, ..., { virtual: true })`, que es la ruta que `cargar` pasa a `require`.
  Ninguna prueba usa las features reales; los manifests son objetos.

### Casos cubiertos

| Caso | Archivo |
|---|---|
| PIP-T01 manifest sin extensiones → los 4 huecos no hacen nada (también `features: []`) | `tests/core/pipeline.test.js` |
| PIP-T02 validadores orden 20 y 10 → corre primero el 10 | `tests/core/pipeline.test.js` |
| PIP-T03 validador lanza → el siguiente no corre; el `ErrorApp` llega intacto (mismo código, status, mensaje) | `tests/core/pipeline.test.js` |
| PIP-T04 dos transformadores → el segundo recibe el objeto devuelto por el primero | `tests/core/pipeline.test.js` |
| PIP-T05 post-proceso lanza → no se propaga; `logger.error` (logger.child `{ correlationId, modulo }`) con `depositoId`; el siguiente corre | `tests/core/pipeline.test.js` |
| PIP-T06 `leerExtensiones` con `null` → la clave no aparece | `tests/core/pipeline.test.js` |
| PIP-T07 feature activa inexistente → `cargar` lanza; `crearApp` también (la app no arranca) | `tests/core/cargador.test.js` |
| PIP-T08 tipo distinto al del manifest → `cargar` lanza; el pipeline anterior no queda a medias | `tests/core/cargador.test.js` |
| PIP-T09 feature `inactivo` → la fábrica del módulo no se ejecuta (y control: la misma activa sí) | `tests/core/cargador.test.js` |
| PIP-T10 ruta inexistente con token → 404 `RUTA_NO_ENCONTRADA` con el cuerpo exacto de §5 | `tests/core/cargador.test.js` |
| PRY-T01 (SPEC-00) `GET /health` sin token → 200 `{ "estado": "ok" }` — **deja de ser `test.todo`** | `tests/core/proyecto.test.js` |

Pruebas adicionales por regla:

- PIP-R02: transformador lanza → `ErrorApp('ERROR_INTERNO')` 500, el siguiente no corre, `logger.error` con
  `{ depositoId, error, codigoError }` (sin el objeto de error completo).
- PIP-R03: `persistir` recibe el mismo `deposito` y `tx`, solo en transformadores que lo tienen; si lanza se propaga.
- PIP-R07: `privado` distinto por id e idéntico entre `ejecutar` y `persistir`; el contexto del service no se
  modifica; el módulo recibe `usuario`, `cuenta`, `correlationId`, `db` y `logger.child({ correlationId, modulo })`.
- PIP-R08: a igual `orden`, gana la posición del manifest; `cargar` devuelve los routers de endpoints activos.
- PIP-R10: errores del módulo registrados en el catálogo; `cargar` dos veces con el mismo módulo no lanza.
- Contrato §4: validador con error ≠ 422, manifest sin `features`, feature sin id, tipo desconocido, extensión
  sin `orden`, id repetido, id `../core`, id exportado distinto, endpoint sin `router`, extensión sin `ejecutar`
  → `cargar` lanza; un `MODULE_NOT_FOUND` interno del módulo se relanza tal cual.
- PIP-R11 (unit): sin token → 401 antes del 404; router montado en `/api/v1` con `req.usuario`; el mismo endpoint
  inactivo → 404; `express.json` montado (body parseado; JSON roto → 400 `FORMATO_INVALIDO`); `trust proxy` =
  `config.trustProxy`.
- PIP-R12: `crearApp` no llama a `limpiarClaves.iniciar()`.

### `test.todo` anteriores revisados (arrastres para SPEC-06)

- **PRY-T01** → convertido en prueba real (arriba). La sección `## SPEC-00` de este reporte aún lo lista como
  `todo`; no se edita por ser de otra spec.
- **SPEC-04 → SPEC-06: `req.ip` con `X-Forwarded-For` y `trust proxy`; orden PIP-R11** → nuevas pruebas de
  integración con PostgreSQL real en `tests/integration/pipeline-y-cargador/app.test.js`, sobre `crearApp`:
  - `TRUST_PROXY=1` y `X-Forwarded-For: 198.51.100.1, 203.0.113.7` → fila de auditoría con `ip = 203.0.113.7`
    (último salto), `ERROR_401`, `correlation_id` de la petición.
  - Sin `X-Forwarded-For` → `ip` de la conexión (loopback).
  - Con token y sin endpoints → 404 y fila con `usuario_id`, `canal`, `monto` (auditoria antes de autenticar y
    `express.json` antes del 404).
  - `GET /health` y rutas no auditadas → 0 filas.
- **SPEC-03 → SPEC-06: `correlationId` primero y `autenticar` después de `/health`** → cubierto por PRY-T01
  (con `X-Correlation-Id`), PIP-T10 y la prueba de 401 antes del 404.
- Siguen en `todo` (esperan SPEC-07): SEG-T06; AUD-T01, AUD-T02, AUD-T04; IDE-T02..T08, IDE-T10.

### Casos en `test.todo`

Ninguno de SPEC-06.

### Pruebas fallidas

Ninguna.

**Observación (no es caso de la spec, no hay prueba roja):** un body de más de 100 kb (`express.json` con
`limit: '100kb'`) responde **500 `ERROR_INTERNO`**: `src/core/middlewares/manejadorErrores.js:24-30` solo traduce
`entity.parse.failed`; el `entity.too.large` de body-parser cae en el error no controlado. SPEC-01/06 no definen
qué código usar (413 no está en el catálogo), así que la prueba solo exige que el body no llegue al router
(status ≥ 400). Decisión para el humano/leader.

### Cobertura (`src/core/` y `src/modules/`)

```
----------------------------|---------|----------|---------|---------|-------------------
File                        | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
----------------------------|---------|----------|---------|---------|-------------------
All files                   |   99.49 |    93.72 |   98.76 |   99.72 |
 core                       |   98.93 |    92.98 |   97.14 |   99.42 |
  cargador.js               |     100 |      100 |     100 |     100 |
  pipeline.js               |   98.18 |    78.57 |     100 |     100 | 54-80,106-120
----------------------------|---------|----------|---------|---------|-------------------
Test Suites: 12 passed, 12 total
Tests:       12 todo, 177 passed, 189 total
```

- `src/core/`: de 71,13 % stmts / 65,88 % branches (sin pruebas de SPEC-06) a **99,49 % stmts · 93,72 % branches**
  (≥ 80 %). `cargador.js` 100 %; `pipeline.js` 98 % stmts / 100 % líneas. `src/modules/` aún sin código.
- Ramas no cubiertas de `pipeline.js`: los `?? null` defensivos (`correlationId`, `actual?.id`, `deposito?.id`,
  `err?.message`) y el `catch` de `ejecutarPostProcesos` cuando falla el propio `contextoDe` (línea 106).

## SPEC-07

- **Tester** · 2026-11-02 · Feature 7 (`registrar-deposito`).
- **Ejecución:** `bash init.sh` completo con PostgreSQL real (`deposito_test`) → **`EXIT=0`**.
  `[OK] SPEC-07: todos sus casos tienen prueba` · alcance OK (129 archivos) ·
  `Test Suites: 14 passed, 14 total` · `Tests: 234 passed, 234 total` (**0 `todo`**).
- Integración: `crearApp({ manifest })` armada **dentro de cada prueba** (el pipeline es un singleton), manifest a
  medida con `registrar-deposito` activo y `limites-por-canal`, `conversion-moneda`, `alerta-uif` **inactivas**
  (SPEC-07 §6). Billetera siempre con los helpers de nock de SPEC-02 (`nock.disableNetConnect()`, solo
  `127.0.0.1` permitido para Supertest). Datos solo de SPEC-02 §4. `limpiar()` en `beforeEach`.
- Unitarias: el service con todas sus dependencias espiadas (`billeteraClient`, `permisos`, `pipeline`,
  `db.enTransaccion`, `repository`); el repository con un `db` simulado.

### Casos cubiertos

| Caso | Archivo(s) |
|---|---|
| RD-T01 `usr-agente-1` `"150.00"` PEN AGENTE → 201 COMPLETADO (cuerpo exacto de §5, `extensiones: {}`); 1 fila; billetera recibió `{ depositoId, monto: "150.00", moneda, concepto }` 1 vez; clave `TERMINADO` | `tests/integration/registrar-deposito/registrar.test.js` |
| RD-T02 `"0"`, `"-1"`, `"10.001"` → 422 `MONTO_INVALIDO`; 0 filas; billetera no llamada | integración + `tests/unit/registrar-deposito/service.test.js` |
| RD-T03 `"0.01"` → 201; billetera recibe `"0.01"` | integración + unitaria |
| RD-T04 sin `cuentaDestino` / monto número `150` / `"x": 1` → 400 `FORMATO_INVALIDO`; 0 filas; billetera no llamada | integración |
| RD-T05 billetera 404 al consultar → 422 `CUENTA_NO_ENCONTRADA` | integración + unitaria |
| RD-T06 `0011-0123-000003` BLOQUEADA → 422 `CUENTA_INACTIVA` | integración + unitaria |
| RD-T07 billetera 500 al acreditar → 502; depósito FALLIDO; clave `REINTENTABLE` con el `deposito_id` | integración + unitaria (`ErrorApp` con `depositoId`) |
| RD-T08 billetera tarda 6 s al acreditar → 502; depósito FALLIDO | integración |
| RD-T09 billetera 500 al consultar → 502; 0 filas; sin acreditación; la clave se borra | integración + unitaria |
| RD-T10 `"100.00"` USD a cuenta PEN → 422 `MONEDA_NO_SOPORTADA`; 0 filas | integración + unitaria |
| RD-T11 spy de `cambiarEstado` → `(pool, id, PENDIENTE, PROCESANDO)` y luego `(pool, id, PROCESANDO, COMPLETADO)` | integración (BD real) + unitaria |
| RD-T12 `reintentar` de un FALLIDO con billetera OK → mismo `id`, COMPLETADO, sin `consultarCuenta`, sin validadores/transformadores | integración (BD real, `service.reintentar`) + unitaria |

Pruebas adicionales por regla (todas ✅):

- **Feature activa/inactiva:** `registrar-deposito` `inactivo` en el manifest → 404 `RUTA_NO_ENCONTRADA`, billetera
  no llamada (integración); activa → todos los casos anteriores.
- **RD-R01/R02:** cuenta mal formada, `"150,00"`, 14 dígitos enteros, `EUR`, `WEB`, referencia vacía / de 141 /
  no string, body arreglo → 400; referencia de 140 y `"1234567890123.45"` → 201.
- **RD-R03/R05:** `deposito` con id UUID v4, `monto`/`montoAcreditar` `Decimal`, `referencia ?? null`,
  `extensiones: {}`; `contexto` con `usuario`, `cuenta`, `correlationId`, `logger`, `db = pool`; el **mismo** objeto
  `contexto` llega a validadores, transformadores, `persistirTransformadores` y post-procesos (PIP-R07).
- **RD-R04:** orden exacto del diagrama registrado paso a paso (consulta → canal → titular → validadores →
  transformadores → BEGIN → insertar → persistir → COMMIT → PENDIENTE→PROCESANDO → acreditar → COMPLETADO →
  post-procesos); `insertar` y `persistir` reciben el `tx`.
- **RD-R06:** con BD real, `cambiarEstado` desde un estado que no es el actual → lanza y la fila no cambia;
  transiciones fuera de SPEC-01 → lanzan sin consulta; `actualizado_en` se actualiza; `buscarPorId` inexistente → `null`.
- **RD-R07:** `persistirTransformadores` falla después del INSERT → 500 `ERROR_INTERNO`, **0 filas** (rollback real),
  billetera no llamada, la clave se borra. Unitaria: el INSERT falla → ni `acreditar` ni `cambiarEstado`.
- **RD-R08:** reintento de COMPLETADO → se devuelve sin billetera; de PENDIENTE/PROCESANDO → 409
  `SOLICITUD_EN_PROCESO` con `depositoId`, estado intacto; de FALLIDO → acredita `monto_acreditar` /
  `moneda_acreditar` guardados (p. ej. `149.50`), post-procesos con `contexto.cuenta = null`; si vuelve a fallar →
  FALLIDO y 502 con `depositoId`; si `leerExtensiones` falla → no cambia de estado ni acredita; id inexistente → `Error` (500).
- **RD-R09:** un transformador que agrega `extensiones` y cambia `montoAcreditar`/`monedaAcreditar` → se acredita lo
  transformado, se guarda el monto original y la respuesta trae las `extensiones`; en el reintento,
  `extensiones = leerExtensiones`.
- **SEG-R10/R11 sobre la ruta real:** AGENTE con canal APP → 403 sin filas ni acreditación; `usr-cliente-1` por APP a
  su cuenta → 201; `usr-cajero-1` por VENTANILLA a `0011-0123-000002` (USD) → 201.
- `acreditar` que lanza algo que no es `ErrorApp` → se relanza tal cual, no pasa a FALLIDO (decisión 4 de impl_07).
- `index.js` cumple el contrato de endpoint de SPEC-06 §4.

### `test.todo` anteriores revisados (desbloqueados por SPEC-07) → todos son pruebas reales

| Caso | Archivo |
|---|---|
| SEG-T06 `usr-cliente-1` deposita a `0011-0123-000002` (USD, ACTIVA) → 403 `SIN_PERMISO`; billetera consultada pero sin acreditación; 0 filas; auditoría `ERROR_403`. Control: a su propia cuenta → 201 | `tests/integration/seguridad/seguridad.test.js` |
| AUD-T01 depósito válido → 1 fila `CREAR_DEPOSITO`, `EXITO`, `deposito_id` = id de la respuesta, `correlation_id` = header de la respuesta, canal y monto | `tests/integration/auditoria/auditoria.test.js` |
| AUD-T02 monto `"-5"` → 422; 1 fila `ERROR_422`, `deposito_id` nulo, `monto` `-5.00`; billetera no consultada | `tests/integration/auditoria/auditoria.test.js` |
| AUD-T04 3 POST iguales con la misma clave → 3×201 (2 con `Idempotency-Replayed`), 3 filas `CREAR_DEPOSITO` con el mismo `deposito_id`, 1 depósito, 1 acreditación | `tests/integration/auditoria/auditoria.test.js` |
| IDE-T02 repetir → mismo status y cuerpo, `Idempotency-Replayed: true`, `X-Correlation-Id` de la petición actual, billetera 1 vez | `tests/integration/idempotencia/idempotencia.test.js` |
| IDE-T03 misma clave, monto distinto → 409 `IDEMPOTENCY_KEY_REUTILIZADA` (cuerpo exacto); 1 depósito | idem |
| IDE-T04 billetera tarda 2 s; segundo POST a los 100 ms → 409 `SOLICITUD_EN_PROCESO`; el primero termina 201 | idem |
| IDE-T05 5 POST simultáneos → exactamente 1 respuesta original 201, el resto 201 repetida o 409 `SOLICITUD_EN_PROCESO`; 1 depósito, 1 consulta, 1 acreditación | idem |
| IDE-T06 billetera 500 al acreditar → 502 (FALLIDO, clave `REINTENTABLE`); reintento OK → 201 con el **mismo** id; billetera recibió el mismo `depositoId` las dos veces; 1 sola consulta de cuenta | idem |
| IDE-T07 timeout al acreditar → 502; reintento con billetera 409 → 201 COMPLETADO, mismo id | idem |
| IDE-T08 billetera 500 al consultar → 502, sin filas y clave borrada; reintento → se procesa como nuevo (201 sin `Idempotency-Replayed`) | idem |
| IDE-T10 `usr-agente-1` y `usr-agente-2` con la misma clave → ambos 201, ids distintos, 2 acreditaciones, 2 claves | idem |

Las secciones `## SPEC-03`, `## SPEC-04` y `## SPEC-05` aún listan esos casos como `todo`; no se editan por ser
de otras specs (esta tabla es la referencia vigente). PRY-T01 se actualizó en `## SPEC-00` a pedido del leader.

### Casos en `test.todo`

Ninguno. No queda ningún `test.todo` en `tests/` (`grep -rn "test.todo" tests` → 0).

### Pruebas fallidas

Ninguna.

**Observación (no es fallo del código):** en RD-T08 e IDE-T07, nock no espera los 6 s reales: cuando la demora
del interceptor supera el timeout del socket (`BILLETERA_TIMEOUT_MS` = 5000), nock emite el `timeout` de inmediato.
Por eso esas pruebas comprueban el resultado (502 `BILLETERA_NO_DISPONIBLE`, depósito FALLIDO, reintento) y no el
tiempo de pared. IDE-T04 (2 s < timeout) sí espera la demora real (≥ 1,9 s).

### Cobertura (`src/core/` y `src/modules/`)

```
----------------------------|---------|----------|---------|---------|-------------------
File                        | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
----------------------------|---------|----------|---------|---------|-------------------
All files                   |   99.59 |    94.53 |   98.91 |   99.77 |
 core                       |   98.93 |    92.98 |   97.14 |   99.42 |
 core/clients               |     100 |    92.85 |     100 |     100 |
 core/middlewares           |     100 |    94.87 |     100 |     100 |
 core/repositories          |     100 |     87.5 |     100 |     100 |
 core/tareas                |     100 |      100 |     100 |     100 |
 modules/registrar-deposito |     100 |      100 |     100 |     100 |
  controller.js             |     100 |      100 |     100 |     100 |
  index.js                  |     100 |      100 |     100 |     100 |
  repository.js             |     100 |      100 |     100 |     100 |
  routes.js                 |     100 |      100 |     100 |     100 |
  schema.js                 |     100 |      100 |     100 |     100 |
  service.js                |     100 |      100 |     100 |     100 |
----------------------------|---------|----------|---------|---------|-------------------
Test Suites: 14 passed, 14 total
Tests:       234 passed, 234 total
```

- `src/modules/`: de **0 %** (sin pruebas; el umbral fallaba según `progress/impl_07.md`) a **100 %** en stmts,
  branches, funcs y lines (≥ 80 %).
- `src/core/`: 99,59 % stmts · 94,53 % branches (≥ 80 %).

## SPEC-08

- **Tester** · 2026-11-02 · Feature 8 (`consultar-deposito`).
- **Ejecución:** `bash init.sh` completo con PostgreSQL real (`deposito_test`) → **`EXIT=0`**.
  `[OK] SPEC-08: todos sus casos tienen prueba (todo: CD-T07, CD-T08)` · alcance OK (138 archivos) ·
  `Test Suites: 16 passed, 16 total` · `Tests: 2 todo, 268 passed, 270 total`.
- Integración: `crearApp({ manifest })` armada **dentro de cada prueba** (pipeline singleton). Manifest a medida
  con `registrar-deposito` y `consultar-deposito` activos y `limites-por-canal`, `conversion-moneda`, `alerta-uif`
  inactivas. Depósitos insertados directo en `depositos` (SPEC-08 §6) con cuentas y usuarios de SPEC-02 §4.
  Billetera con los helpers de nock (`nock.disableNetConnect()`). `limpiar()` en `beforeEach`.
- Para probar CD-R07 sin SPEC-11 se usa el transformador falso de `tests/core/fixtures/` (`fx-transformador-a`,
  con `leerExtension`), registrado con `registrarFixtures(jest)` como en SPEC-06.
- `afterEach` espera a que el conteo de `auditoria_depositos` se estabilice: la auditoría escribe tras responder y
  su INSERT coincidía con el `TRUNCATE` de `limpiar()` de la prueba siguiente → `deadlock detected` (visto en la
  primera corrida; es un problema de la prueba, no del código).

### Casos cubiertos

| Caso | Archivo |
|---|---|
| CD-T01 `usr-cliente-1` consulta un depósito a `0011-0123-456789` → 200 con el cuerpo completo de §5 (`extensiones: {}`); billetera consultada 1 vez con el `X-Correlation-Id` | `tests/integration/consultar-deposito/consultar.test.js` |
| CD-T02 UUID inexistente → 404 `DEPOSITO_NO_ENCONTRADO` con el mensaje de §5; billetera no llamada | idem |
| CD-T03 id `abc` → 400 `FORMATO_INVALIDO`; `buscarPorId` no llamado | idem |
| CD-T04 `usr-cliente-2` consulta un depósito a `0011-0123-456789` → 404 `DEPOSITO_NO_ENCONTRADO` | idem |
| CD-T05 `usr-agente-2` consulta un depósito de `usr-agente-1` → 404; billetera no llamada | idem |
| CD-T06 `usr-agente-1` consulta su propio depósito → 200 cuerpo completo; billetera no llamada | idem |
| CD-T09 `usr-cliente-1` y billetera 500 → 502 `BILLETERA_NO_DISPONIBLE` | idem |

Pruebas adicionales por regla (todas ✅):

- **Feature activa/inactiva:** `consultar-deposito` `inactivo` → 404 `RUTA_NO_ENCONTRADA`, ni BD ni billetera.
- **CD-R01:** `123`, UUID con un carácter de más, caracteres no hex → 400.
- **CD-R02:** cliente titular ve un depósito registrado por `usr-cajero-1`; `usr-cajero-1` ve el suyo sin billetera y
  `usr-agente-1` no lo ve; `usr-cliente-2` ve un depósito a su cuenta USD `0011-0123-000002`. Unitaria: un CLIENTE cuyo
  id coincide con `usuario_id` no entra por la 1ª condición (requiere rol AGENTE/CAJERO).
- **CD-R03:** usuario sin roles o sin usuario → 404 sin billetera (unitaria).
- **CD-R04:** billetera 404 (`null`) → 404 `DEPOSITO_NO_ENCONTRADO` (integración y unitaria).
- **CD-R05:** el 404 "sin permiso" tiene el mismo cuerpo que el 404 "no existe"; nunca `SIN_PERMISO`.
- **CD-R06:** billetera sin responder a tiempo → 502; el `ErrorApp` de billetera se propaga tal cual (unitaria).
- **CD-R07:** PENDIENTE/PROCESANDO/FALLIDO se devuelven con su estado; extensión falsa **activa** con datos → aparece
  en `extensiones` y `leerExtension` recibe el id; **inactiva** → `extensiones: {}` sin tocar el módulo; activa sin
  datos (`null`) → sin su clave; sin permiso → `leerExtensiones` no se llama; unitaria: respuesta =
  `aJson(fila, leerExtensiones(id, contexto))`.
- **§2 repository solo SELECT:** `buscarPorId` devuelve la fila o `null`; la fila no cambia tras consultar.
- **AUD-R06 (arrastre SPEC-04/05):** 200 → fila `CONSULTAR_DEPOSITO` `EXITO` con `deposito_id`; 404 por falta de
  permiso → `ERROR_404` con `deposito_id` nulo (no se revela el id).
- `index.js` cumple el contrato de endpoint de SPEC-06 §4.

### Decisiones de `progress/impl_08.md` (todas ✅)

| Decisión | Pruebas | Archivo |
|---|---|---|
| 1. `contexto.cuenta = null` si el operador que lo registró consulta (sin billetera); con CLIENTE titular = la cuenta devuelta por billetera. También se comprueban `usuario`, `correlationId`, `db = pool` y `logger` | 2 | `tests/integration/consultar-deposito/consultar.test.js` |
| 2. Varios roles: AGENTE+CLIENTE que lo registró → 200 sin billetera; CAJERO+CLIENTE titular que no lo registró → consulta billetera y 200; AGENTE+CLIENTE ni registrador ni titular → 404 tras consultar billetera | 3 | `tests/unit/consultar-deposito/service.test.js` (usuarios de SPEC-02 §4 con un rol extra, mismo precedente que SEG-R13) |

### Arrastres de SPEC-07 cerrados

- `"10.100"` → 422 `MONTO_INVALIDO`, sin billetera ni transacción: `RD-R03 monto "10.100" …` en
  `tests/unit/registrar-deposito/service.test.js` ✅.
- `## SPEC-00`, `## SPEC-03`, `## SPEC-04` y `## SPEC-05` actualizadas: ya no listan como `todo` PRY-T01, SEG-T06,
  AUD-T01/T02/T04, IDE-T02..T08 ni IDE-T10 (todas pruebas reales desde SPEC-06/07).

### Casos en `test.todo`

| Caso | Espera | Motivo |
|---|---|---|
| CD-T07 fila en `conversiones_deposito` con conversion-moneda activa → `extensiones.conversion-moneda` | SPEC-11 | No existen la tabla ni el módulo `conversion-moneda` |
| CD-T08 mismo depósito con conversion-moneda inactiva → sin esa clave | SPEC-11 | idem |

No había `test.todo` anteriores que esperaran SPEC-08.

### Pruebas fallidas

Ninguna.

### Cobertura (`src/core/` y `src/modules/`)

```
----------------------------|---------|----------|---------|---------|-------------------
File                        | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
----------------------------|---------|----------|---------|---------|-------------------
All files                   |   99.62 |    94.83 |   98.98 |   99.79 |
 core                       |   98.93 |    92.98 |   97.14 |   99.42 |
 core/clients               |     100 |    92.85 |     100 |     100 |
 core/middlewares           |     100 |    94.87 |     100 |     100 |
 core/repositories          |     100 |     87.5 |     100 |     100 |
 core/tareas                |     100 |      100 |     100 |     100 |
 modules/consultar-deposito |     100 |      100 |     100 |     100 |
  controller.js             |     100 |      100 |     100 |     100 |
  index.js                  |     100 |      100 |     100 |     100 |
  repository.js             |     100 |      100 |     100 |     100 |
  routes.js                 |     100 |      100 |     100 |     100 |
  service.js                |     100 |      100 |     100 |     100 |
 modules/registrar-deposito |     100 |      100 |     100 |     100 |
----------------------------|---------|----------|---------|---------|-------------------
Test Suites: 16 passed, 16 total
Tests:       2 todo, 268 passed, 270 total
```

- `src/modules/`: de **65,51 %** (`consultar-deposito` al 0 %, umbral en rojo según `progress/impl_08.md`) a **100 %**
  en stmts, branches, funcs y lines (≥ 80 %).
- `src/core/`: 99,62 % stmts · 94,83 % branches (≥ 80 %).
