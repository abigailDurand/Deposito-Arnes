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
