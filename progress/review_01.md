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
