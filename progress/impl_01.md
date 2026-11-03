# impl_01 — SPEC-01 Dominio (RETRABAJO Billetera USD)

> Retrabajo de la feature 1 (`retrabajo: true`), rama `inte_biUsd`. Sustituye al informe anterior.
> Único cambio de la spec: `cuenta_destino VARCHAR(36)` (antes `VARCHAR(20)`) para admitir el
> UUID de la billetera USD.

## Archivos modificados

- `db/00-core.sql` [MODIFICAR] — `cuenta_destino VARCHAR(20)` → `VARCHAR(36)`. Ningún otro cambio.

No se tocaron `src/`, pruebas ni otros `db/*.sql` (las demás `VARCHAR(20)` son `canal`, `estado`, etc., que la spec mantiene).

## Referencia `Busti`

`git diff HEAD Busti -- db/00-core.sql` (Busti = `ff09c58`) muestra exactamente esa única línea;
coincide con el DDL de `specs-v2/01-dominio.md` §DDL. No se trajo nada más de `Busti`.

## Reglas

- DOM-R03 · `cuenta_destino` sigue sin FK (solo cambia la longitud).
- DOM-R04 · la tabla sigue sin columnas de features.
- DOM-R01, R02, R05–R10 · sin cambios (no afectados por el retrabajo; código en `src/core/` intacto).
- DDL · ahora idéntico al bloque SQL de la spec (verificado línea a línea).

## Verificación

- `bash init.sh` (completo, PostgreSQL en docker `chalenge-db-1` healthy): **EXIT 0**.
  - `Test Suites: 23 passed, 23 total` · `Tests: 357 passed, 357 total`
  - `[OK] Todas las pruebas en verde (unitarias + integración)` · `[OK] Entorno listo.`
- En la BD de pruebas (`globalSetup` recrea el esquema desde `db/*.sql`):
  `information_schema.columns` → `depositos.cuenta_destino` `character_maximum_length = 36`.

## Decisiones

- Sin casos `DOM-Tnn` nuevos → no se requiere tester (AGENTS.md §5). Pasa directo al revisor.
- BD de desarrollo (`deposito`) con volumen previo: si se creó con `VARCHAR(20)`, habrá que recrear
  el volumen (`docker compose down -v`) para que el init de postgres aplique el nuevo DDL. No se hizo
  aquí (no es parte del §2 ni lo pidió el líder).
