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
