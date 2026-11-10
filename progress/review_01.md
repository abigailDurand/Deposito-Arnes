# Review — SPEC-01 dominio (RETRABAJO Billetera USD)

> Retrabajo de la feature 1 (`retrabajo: true`), rama `inte_biUsd`. Sustituye a la revisión anterior.
> Alcance: `cuenta_destino VARCHAR(20)` → `VARCHAR(36)` en `db/00-core.sql` (spec v1.1).

**Veredicto:** APROBADO

## Alcance verificado

- `git diff HEAD -- db/00-core.sql`: una sola línea (`db/00-core.sql:5`, `cuenta_destino VARCHAR(36) NOT NULL`).
- `git diff HEAD -- src tests`: sin cambios. Solo se tocó un archivo del §2 de la spec.
- El bloque SQL de `specs-v2/01-dominio.md` y `db/00-core.sql` (sin comentarios) son idénticos (`diff`, exit 0).
- En la BD de pruebas `deposito_test` (recreada por el globalSetup): `information_schema.columns` → `depositos.cuenta_destino` `character_maximum_length = 36`.

## Reglas
- [x] DOM-R03 — `db/00-core.sql:5` `cuenta_destino` sigue sin FK; solo cambia la longitud.
- [x] DOM-R04 — `db/00-core.sql` sin columnas de features añadidas.
- [x] DOM-R05 — `monto_acreditar` / `moneda_acreditar` sin cambios.
- [x] DOM-R07, DOM-R08, DOM-R10 (las que pide §6 al revisor) — `src/core/middlewares/manejadorErrores.js`, `src/core/errores.js`, `src/core/depositoMapper.js` sin cambios respecto a la versión ya aprobada; DOM-T01..T07 siguen en verde.
- [x] DOM-R01, R02, R06, R09 — sin cambios en el retrabajo.
- [x] PRY-R01..R12 — sin `console.log`, `parseFloat` ni `Number(` en `src/core/`; ningún archivo de `specs-v2/` modificado.

## Casos de prueba
- [x] DOM-T01 … DOM-T08 (8/8 reales, sin cambios). La spec no añade casos nuevos ni deja pruebas obsoletas, así que se omite el tester, como indica AGENTS.md §5.

## Checkpoints
- C1: [x]  C2: [x]  C3: [x]  C4: [x]  C5: [x]

## Observaciones (no bloquean; no incumplen ninguna regla de spec)
1. La BD de desarrollo `deposito` (volumen docker ya existente) aún tiene `cuenta_destino` con `character_maximum_length = 20`, porque el init de postgres solo se aplica al crear el volumen. Para ejecutar en local con UUID de billetera USD hay que recrear el volumen (`docker compose down -v`) o aplicar un `ALTER TABLE`. Queda fuera del §2 y le toca al líder o al humano.
2. `src/modules/registrar-deposito/schema.js:7` sigue validando `cuentaDestino` con el formato `^\d{4}-\d{4}-\d{6}$`. Esto pertenece a SPEC-04/02 (no a SPEC-01): habrá que revisarlo en el retrabajo de la feature correspondiente si la spec de esa feature admite el UUID.

## Salida de `bash init.sh`
Se ejecutó completo, con PostgreSQL en docker (`chalenge-db-1` healthy). EXIT 0.
```
PASS integration tests/integration/... (6 suites de integración)
Test Suites: 23 passed, 23 total
Tests:       357 passed, 357 total
[OK]    Todas las pruebas en verde (unitarias + integración)
[OK]    Entorno listo. Puedes empezar a trabajar.
```
Avisos esperados por las features reabiertas: SPEC-02, 07, 08 y 09 tienen casos aún sin prueba (solo avisan).

Tras marcar la feature 1 como `done` (se mantiene `retrabajo: true`), se volvió a ejecutar `bash init.sh`: EXIT 0, `23 passed` suites y `357 passed` pruebas, alcance de archivos correcto y `[OK] Entorno listo.`

---

# Review — SPEC-01 dominio · Retrabajo v1.2, 2026-11-09

**Veredicto:** APROBADO

Spec `specs-v2/01-dominio.md` v1.1 → v1.2 (columna `titular_id`, DOM-R10 ampliada, DOM-R11, DOM-R12, DOM-T09).
Archivos modificados: `db/00-core.sql`, `src/core/depositoMapper.js` (solo comentario), `tests/unit/dominio/depositoMapper.test.js`, `tests/integration/dominio/transaccion.test.js`. No cambian `src/core/db.js`, `errores.js` ni `middlewares/manejadorErrores.js`.

## Reglas
- [x] DOM-R10: `src/core/depositoMapper.js:11-25` construye el objeto con una lista explícita de campos, así que `usuario_id`, `titular_id` y `*_acreditar` nunca salen. El comentario de la l. 9 ya nombra `titular_id`. `monto` usa `new Decimal(...).toFixed(2)` (PRY-R06).
- [x] DOM-R11: `db/00-core.sql:15` añade `titular_id VARCHAR(100)`, que admite NULL y no es FK. El DDL coincide línea a línea con el bloque SQL de la spec §4; solo se suman los comentarios de cabecera, l. 1-3. El integration test `transaccion.test.js:102` lo comprueba en `information_schema`. Guardar el valor al registrar es de SPEC-07 (RD-R08/R13) y queda fuera de esta feature.
- [x] DOM-R12: el `CHECK` de `estado` en `db/00-core.sql:13` sigue siendo `PENDIENTE|PROCESANDO|COMPLETADO|FALLIDO`. Grep de `VALIDADO` en `src/core` y `db/`: 0 resultados. No hay lógica que limite cuánto dura `PROCESANDO`.
- [x] DOM-R07 / DOM-R08 (pedidas en §6 "revisor"): sin cambios en este retrabajo (los archivos no se modificaron). Siguen cubiertas por DOM-T01..T04 y DOM-T07, en verde.
- [x] DOM-R01..R06, R09: sin cambios.
- [x] PRY-R01..R12: en `src/core` no hay `Number(`, `parseFloat` ni `console.log` (grep vacío). No se añadió SQL de producción. Las pruebas usan SQL parametrizado (`$1..$3`). No hay secretos. `specs-v2/` está intacto (hash OK en `init.sh`). Los archivos tocados están dentro del §2 o ya estaban declarados (`init.sh`: alcance correcto, 189 archivos).

## Casos de prueba
- [x] DOM-T01 … DOM-T09 (9/9 reales). DOM-T09 está en `tests/unit/dominio/depositoMapper.test.js:55`: comprueba que no aparecen las claves `titular_id` ni `titularId` ni el valor en el JSON, y que la forma es la exacta de §5 (`toEqual`).
- [x] Pruebas extra de DOM-R11 contra PostgreSQL real (`transaccion.test.js:102`, `:123`): columna `character varying(100)`, admite NULL, sin FK; INSERT sin la columna da `NULL`; con ella se guarda, y `aJson` sobre la fila real no la expone.
- [x] No queda ninguna prueba obsoleta. Lo comprobé: la columna nueva admite NULL, todos los `INSERT INTO depositos` usan lista explícita de columnas y el `CHECK` de estado no cambia, así que las pruebas previas siguen siendo válidas. Las 421 pasan.
- [x] Ningún `test.todo` de SPEC-01. El único del repo es INT-T15, de SPEC-02.

## Checkpoints
- C1: [x]  C2: [x] (una sola `in_progress`; tras el cierre, ninguna)  C3: [x]  C4: [x]  C5: [x]

## Observaciones (no bloquean y no incumplen ninguna regla de spec)
1. Un volumen de Postgres de desarrollo que ya exista no recibe la columna `titular_id`, porque `docker-entrypoint-initdb.d` solo corre con el volumen vacío. Hay que recrearlo (`docker compose down -v`). Lo resuelve el líder o el humano, como en la observación 1 anterior.
2. Hasta el retrabajo de SPEC-07, `src/modules/registrar-deposito/repository.js` no guarda `titular_id`, así que los depósitos nuevos quedan con `NULL`. Es lo esperado.

## Salida de `bash init.sh`
Corrida completa con PostgreSQL real. EXIT 0.
```
[OK]    specs-v2/ intacto (15 archivos)
[OK]    SPEC-01: todos sus casos tienen prueba
[OK]    Alcance de archivos correcto (189 archivos revisados)
Test Suites: 23 passed, 23 total
Tests:       1 todo, 421 passed, 422 total
[OK]    Todas las pruebas en verde (unitarias + integración)
[OK]    Entorno listo. Puedes empezar a trabajar.
```
Hay `[WARN]` solo en las features reabiertas SPEC-02, 07, 08 y 11 (casos todavía sin prueba). Se esperaban y no afectan a SPEC-01.

Después de marcar la feature 1 como `done` (con `retrabajo: true`), volví a ejecutar `bash init.sh`: EXIT 0, `in_progress=0 done=7`, 23 suites y 421 pruebas pasan, 1 todo. `[OK] Entorno listo.`
