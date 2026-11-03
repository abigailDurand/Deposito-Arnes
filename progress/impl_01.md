# impl_01 — SPEC-01 dominio (RETRABAJO: integración Billetera USD)

> Retrabajo de la feature 1 (`retrabajo: true`). Sustituye al informe anterior de SPEC-01.
> Alcance: actualización de `cuenta_destino` a `VARCHAR(36)` en `db/00-core.sql` (SPEC-01 §2 y §4).

## Archivos modificados (todos en SPEC-01 §2)

- `db/00-core.sql` — `cuenta_destino VARCHAR(36) NOT NULL` (línea 5). Permite almacenar identificadores de cuenta tanto en formato estándar bancario (ej. `0011-0123-456789`) como formato UUID de 36 caracteres para cuentas de Billetera USD (ej. `22222222-2222-2222-2222-222222222222`).

No requirió cambios en `src/core/db.js`, `src/core/errores.js`, `src/core/middlewares/manejadorErrores.js`, ni `src/core/depositoMapper.js` (ya acepta strings arbitrarios para `cuenta_destino`).

## Reglas

- **DOM-R01 / DOM-R02**: transiciones permitidas y reintentos con misma Idempotency-Key.
- **DOM-R03**: `cuenta_destino` ampliada a `VARCHAR(36)` sin FK; `usuario_id` sin FK.
- **DOM-R04**: `depositos` no contiene columnas de features.
- **DOM-R05**: `monto_acreditar` y `moneda_acreditar` intactos en core.
- **DOM-R06 / DOM-R07**: manejo unificado de errores y respuestas de error.
- **DOM-R08**: captura de async con `manejar(fn)`.
- **DOM-R09**: catálogo extensible con `registrarErrores`.
- **DOM-R10**: `aJson` mapea `cuenta_destino` a camelCase `cuentaDestino` sin truncar.
- **PRY-R06**: dinero con Decimal.js.
- **PRY-R12**: `specs-v2/` intacto sin modificaciones.

## Salida de verificación

- `node .harness/specs.js verificar`: [OK] specs-v2/ intacto (15 archivos).
- `node .harness/validar-features.js`: [OK] feature_list.json válido.
- `node .harness/alcance.js`: [OK] Alcance de archivos correcto.
- `npm run test:unit`: 12 suites pasadas, 172 pruebas pasadas.
