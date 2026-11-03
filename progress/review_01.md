# Review — SPEC-01 dominio (RETRABAJO: integración Billetera USD)

> Retrabajo de la feature 1 (`retrabajo: true`). Sustituye a la revisión anterior de SPEC-01.
> Alcance revisado: `cuenta_destino VARCHAR(36)` en `db/00-core.sql` según SPEC-01 §2 y §4.

**Veredicto:** APROBADO

## Reglas
- [x] §4 / DOM-R03 — `db/00-core.sql:5` actualiza `cuenta_destino VARCHAR(36) NOT NULL` permitiendo cuentas estándar bancarias y UUIDs de 36 caracteres de Billetera USD sin FK.
- [x] DOM-R01..DOM-R02 — `estado` con check y transiciones contempladas en el dominio.
- [x] DOM-R04 — `depositos` no contiene columnas de features.
- [x] DOM-R05 — `monto_acreditar` y `moneda_acreditar` presentes y consistentes.
- [x] DOM-R06..DOM-R09 — `ErrorApp`, `manejadorErrores`, `manejar` y `registrarErrores` intactos y conformes.
- [x] DOM-R10 — `src/core/depositoMapper.js` mantiene mapeo a camelCase y `cuentaDestino` íntegro.
- [x] PRY-R01..R12 — Sin secretos en el código, sin `Number(`/`parseFloat`, sin construcción insegura de SQL. `specs-v2/` intacto.

## Casos de prueba
- [x] DOM-T01 … DOM-T08 (8/8 reales, todos pasando).

## Checkpoints
- C1: [x]  C2: [x]  C3: [x]  C4: [x]  C5: [x]

## Salida de verificación
- `node .harness/specs.js verificar`: [OK] specs-v2/ intacto (15 archivos).
- `node .harness/validar-features.js`: [OK] feature_list.json válido.
- `node .harness/alcance.js`: [OK] Alcance de archivos correcto.
- `npm run test:unit`: 12 suites pasadas, 172 pruebas pasadas.
