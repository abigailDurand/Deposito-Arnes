# Review — SPEC-01 dominio

**Veredicto:** APROBADO CON OBSERVACIONES

- **Agente:** revisor · **Fecha:** 2026-10-30 · **Feature:** 1 (`dominio`)
- Insumos: `progress/impl_01.md`, `tests/reporte.md` § SPEC-01, archivos del §2 y sus pruebas.

## Reglas

Prioridad §6 (revisor): DOM-R07, DOM-R08, DOM-R10.

- [x] DOM-R07 — `src/core/middlewares/manejadorErrores.js:19-21` `ErrorApp` → status y mensaje del
  catálogo (`responder`, l.6-9, toma ambos de `catalogo[codigo]`); asigna `res.locals.depositoId`
  solo si viene. l.24-26 `entity.parse.failed` → 400 `FORMATO_INVALIDO`. l.29-30 resto →
  `logger.error({ err, correlationId })` + 500 `ERROR_INTERNO`. La respuesta solo lleva
  `{ codigo, mensaje, correlationId }`: nunca stack ni `err.message` (probado en DOM-T02,
  `errores.test.js:63-65`).
- [x] DOM-R08 — `src/core/errores.js:77-85` `manejar(fn)` hace `await fn(req, res, next)` y pasa el
  rechazo a `next(err)`. DOM-T07 comprueba 403 con timeout de 2 s (no se cuelga).
- [x] DOM-R10 — `src/core/depositoMapper.js:11-26`: camelCase, `monto` con
  `new Decimal(fila.monto).toFixed(2)` (string, nunca `Number`), `referencia ?? null`, fechas
  `toISOString()` (UTC). No incluye `usuario_id`, `monto_acreditar` ni `moneda_acreditar`
  (verificado con `toEqual` exacto en `depositoMapper.test.js:37-51` y con fila real de PostgreSQL
  en `transaccion.test.js:84-100`).
- [x] DOM-R01/R02 — el `CHECK` de `estado` limita los 4 estados; las transiciones las aplican
  SPEC-05/07 (el §2 de SPEC-01 no declara archivo de transiciones). Correcto no inventarlo.
- [x] DOM-R03 — `db/00-core.sql:5,13` `cuenta_destino` y `usuario_id` sin `REFERENCES`.
- [x] DOM-R04/R05 — `db/00-core.sql:3-16` solo columnas de §4; `*_acreditar` `NOT NULL` con `CHECK`.
- [x] DOM-R06 — `src/core/errores.js:39-52`: código fuera del catálogo lanza; `depositoId` opcional.
- [x] DOM-R09 — `src/core/errores.js:61-74`: código existente lanza; valida todo antes de agregar.
- [x] DDL §4 — `db/00-core.sql` (sin comentarios) es **idéntico** byte a byte al bloque SQL de §4
  (verificado con `diff`): tipos, `CHECK`, `DEFAULT now()` e índices
  `idx_depositos_cuenta` / `idx_depositos_usuario` con `creado_en DESC`.
- [x] Catálogo §5 — `src/core/errores.js:4-36`: 16/16 códigos con status y mensaje **exactos**
  (comparado programáticamente contra el texto de §5; 0 diferencias, sin códigos extra).
- [x] `enTransaccion` — `src/core/db.js:18-38`: BEGIN → `fn(tx)` → COMMIT; en error ROLLBACK y
  relanza el error original; `finally` libera siempre el cliente (`release(conexionRota)` descarta
  la conexión si el ROLLBACK falló). Probado en DOM-T08 y variantes.
- [x] PRY-R01..R05 — `src/core/` no nombra ninguna feature ni importa módulos; solo `config`,
  `logger`, `pg`, `decimal.js`.
- [x] PRY-R06/R07 — sin `Number(`, `parseFloat` ni aritmética sobre montos en `src/core/`.
  (`errores.js:56` usa `Number.isInteger` sobre el `status` HTTP, no dinero.)
- [x] PRY-R08 — `db.js` solo ejecuta `BEGIN`/`COMMIT`/`ROLLBACK` literales; las pruebas usan
  `$1..$8`. Sin concatenación SQL.
- [x] PRY-R09 — sin `process.env` ni URLs en los archivos del §2; la conexión sale de
  `config.databaseUrl`.
- [x] PRY-R10 — los logs (`db.js:14,32`, `manejadorErrores.js:29`) llevan `err`/`correlationId`;
  sin tokens ni cuentas. Sin `console.log`.
- [x] PRY-R11/R12 — nada `[POR ACORDAR]` en esta spec; `specs-v2/` intacto.
- [x] Alcance — todos los archivos están en el §2 de SPEC-01, salvo
  `tests/integration/dominio/transaccion.test.js`, permitido por SPEC-00 §6 (DOM-T08 requiere BD).

## Casos de prueba

- [x] DOM-T01 … DOM-T08 (8/8 reales, con aserciones concretas: `toEqual` del cuerpo completo,
  status, `res.locals`, `count(*) = '0'`). Sin `.skip`/`.only`. DOM-T08 contra PostgreSQL real.

## Checkpoints

- C1: [x]  C2: [x]  C3: [x]  C4: [x]  C5: [x] (cobertura `src/core/` 98.41 % stmts / 91.66 % branch)

## Observaciones (no incumplen reglas de spec)

1. `src/core/depositoMapper.js:24` — la rama `aJson(fila)` sin `extensiones` (omite la clave,
   decisión ligada a HD-R08) no tiene prueba. Debe cubrirse al implementar SPEC-09 (historial);
   §5 muestra `extensiones: {}` como forma general, así que el revisor de SPEC-07/08 debe
   confirmar que esas features siempre pasan el segundo argumento.
2. `docs/conventions.md` (máx. 100 caracteres por línea): exceden
   `tests/unit/dominio/errores.test.js:32,91,98,128,238,242`,
   `tests/unit/dominio/depositoMapper.test.js:37`,
   `tests/integration/dominio/transaccion.test.js:9,58,67` y `db/00-core.sql:1,12`
   (l.12 es copia literal de §4, aceptable). Convención, no regla de spec.
3. Riesgo anotado en `impl_01.md` para SPEC-06: el catálogo es global; `crearApp` llamado varias
   veces en el mismo proceso no debe re-registrar los mismos códigos (DOM-R09 lanzaría).

## Cambios requeridos

Ninguno.

## Salida de `bash init.sh`

```
── 3. Specs, estado y alcance ──────────────────────────
[OK]    specs-v2/ intacto (15 archivos)
[OK]    feature_list.json válido (13 features: pending=11 in_progress=1 done=1 blocked=0)
[OK]    SPEC-00: todos sus casos tienen prueba (todo: PRY-T01)
[OK]    SPEC-01: todos sus casos tienen prueba
[OK]    Alcance de archivos correcto (66 archivos revisados)
── 4. Ejecutando pruebas ───────────────────────────────
PASS integration tests/integration/dominio/transaccion.test.js
PASS unit tests/unit/dominio/errores.test.js
PASS unit tests/unit/dominio/depositoMapper.test.js
PASS unit tests/core/proyecto.test.js
 core                 |   98.41 |    91.66 |    90.9 |    98.3 |
 core/middlewares     |     100 |      100 |     100 |     100 |
Test Suites: 4 passed, 4 total
Tests:       1 todo, 42 passed, 43 total
[OK]    Todas las pruebas en verde (unitarias + integración)
[OK]    Entorno listo. Puedes empezar a trabajar.
EXIT=0
```

### Tras marcar la feature 1 como `done`

```
[OK]    feature_list.json válido (13 features: pending=11 in_progress=0 done=2 blocked=0)
[OK]    SPEC-01: todos sus casos tienen prueba
[OK]    Alcance de archivos correcto (67 archivos revisados)
Tests:       1 todo, 42 passed, 43 total
[OK]    Todas las pruebas en verde (unitarias + integración)
EXIT=0
```
