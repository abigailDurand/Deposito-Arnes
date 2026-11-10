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

---

## Retrabajo v1.2, 2026-11-09

Spec `specs-v2/01-dominio.md` v1.1 → v1.2 (feature 1, `in_progress`, `retrabajo: true`).

### Archivos modificados (todos del §2)

- `db/00-core.sql` [MODIFICAR]: nueva columna `titular_id VARCHAR(100)` (nullable, sin FK), después de `usuario_id`, tal como el DDL del §4. Añadido un comentario DOM-R11.
- `src/core/depositoMapper.js` [MODIFICAR]: solo cambia el comentario DOM-R10, que ahora nombra `titular_id`. `aJson` ya construía el objeto con una lista explícita de campos, así que `titular_id` nunca se expone. No hizo falta cambiar el código.

No se tocaron `src/core/db.js`, `errores.js`, `manejadorErrores.js` ni ningún archivo de fuera del §2.

### Cómo llega el esquema a la BD

- Pruebas: `tests/setup/globalSetup.js` (D12) borra `public` y aplica `db/*.sql` en orden alfabético en cada corrida de integración. La BD de prueba tiene la columna sin hacer nada más.
- Docker: `docker-compose.yml` monta `./db` en `/docker-entrypoint-initdb.d`. Ese directorio solo se ejecuta cuando el volumen está vacío. **Un volumen de Postgres que ya exista no recibe la columna**: hay que recrearlo (`docker compose down -v`). No hay migraciones (fuera de alcance de SPEC-01).

### Reglas

- DOM-R10: `aJson` no expone `usuario_id`, `titular_id` ni `*_acreditar` (lista explícita de campos). Comprobado con `node -e`: una fila con `titular_id: 't'` produce un JSON sin esa clave.
- DOM-R11: la columna `titular_id VARCHAR(100)` es nullable y sin FK, en la tabla del core. Que se llene al registrar es de SPEC-07 (RD-R08, RD-R13) y no se implementa aquí.
- DOM-R12: no hay contradicción. El `CHECK` de `estado` sigue siendo `PENDIENTE|PROCESANDO|COMPLETADO|FALLIDO`, sin `VALIDADO`. En `src/core` y `db/` no hay ninguna referencia a `VALIDADO` ni lógica que limite cuánto puede durar `PROCESANDO`. El diagrama de estados (confirmación en diferido) lo implementa SPEC-07.
- DOM-R01..R09: sin cambios.

### Compatibilidad y pruebas que podrían quedar obsoletas

- Todos los `INSERT INTO depositos` (`src/modules/registrar-deposito/repository.js` y los de las pruebas de integración: consultar, historial, idempotencia, registrar, dominio/transaccion) usan una lista explícita de columnas. La columna nueva es nullable, así que quedan `NULL` sin romper nada.
- Ninguna prueba queda obsoleta en sentido estricto. Para el tester:
  - Falta **DOM-T09** (`aJson` con `titular_id` → no aparece), en `tests/unit/dominio/depositoMapper.test.js`. `init.sh` avisa: "SPEC-01 (en curso) aún sin prueba: DOM-T09".
  - La prueba de la forma exacta (`toEqual` en `depositoMapper.test.js:40`) sigue pasando. Si su fila de ejemplo recibe `titular_id`, cubre también DOM-T09.
  - `feature_list.json` dice en acceptance "DOM-T01 a DOM-T08 pasan"; debería decir T09 (lo actualiza el leader o el revisor, no yo).
- Para SPEC-07: `repository.js` todavía no guarda `titular_id`, así que todo depósito nuevo queda con `NULL`. Es lo esperado hasta su retrabajo.

### Verificación

- `node -e "require('./src/core/depositoMapper')"`: carga bien, y `aJson` con `titular_id` no lo expone.
- `bash init.sh --rapido`: verde. Unit: 12 suites, 210 pasan, 1 todo. WARN: SPEC-01 sin prueba DOM-T09, más los avisos de las otras reabiertas (02, 07, 08, 11).
- `bash init.sh` completo (con PostgreSQL): verde. 23 suites, **418 pasan, 1 todo** (419). El esquema con la columna nueva se aplicó sin errores en globalSetup.
