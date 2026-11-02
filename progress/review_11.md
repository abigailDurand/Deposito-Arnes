# Review — SPEC-11 conversion-moneda

**Veredicto:** APROBADO CON OBSERVACIONES

**Revisor:** revisor · **Fecha:** 2026-11-02 · **Insumos:** `progress/impl_11.md`, `tests/reporte.md` (§SPEC-11 y §SPEC-08, CD-T07/T08).

## Alcance (§2)

- [x] Archivos nuevos: `src/modules/conversion-moneda/{index,service,repository}.js`, `db/11-conversion-moneda.sql`,
  `tests/unit/conversion-moneda/conversion.test.js`, `tests/integration/conversion-moneda/conversion.test.js`. Todo dentro del §2.
- [x] `tests/integration/consultar-deposito/consultar.test.js` modificado: es archivo del §2 de SPEC-08 (conversión de
  `test.todo` CD-T07/CD-T08 a pruebas reales, que esperaban SPEC-11). init.sh: alcance OK (162 archivos).
- [x] `git diff HEAD -- src/core` vacío; `grep conversion|tipos_cambio|tipoCambio src/core` sin resultados.

## Reglas del proyecto

- [x] PRY-R01/R03 — `index.js` orquesta, `service.js:9` solo calcula (sin SQL/HTTP), SQL solo en `repository.js`.
- [x] PRY-R02 — sin controller (no agrega rutas, §5).
- [x] PRY-R04 — `index.js:3-6` solo importa `decimal.js` y sus propios archivos; lee solo `tipos_cambio` y `conversiones_deposito` (propias).
- [x] PRY-R05 — `src/core/` intacto (ver arriba).
- [x] PRY-R06 — `service.js:6-13` usa `Decimal.clone({precision:40})`, `times`, `toDecimalPlaces(2, ROUND_HALF_UP).toFixed(2)`;
  `index.js:25` `montoAcreditar = new Decimal(...)`; `index.js:57-58` strings `toFixed(4)`/`toFixed(2)`. Grep `Number(`/`parseFloat` en el módulo: 0.
- [x] PRY-R07 — solo PEN/USD (CHECK en `db/11-conversion-moneda.sql:4-5`); montos a 2 decimales.
- [x] PRY-R08 — `repository.js:5-11,17-22,26-31` con `$1..$5`; grep `+ '` en el módulo: 0.
- [x] PRY-R09 — sin URLs ni secretos (grep `http://`: 0).
- [x] PRY-R10 — el módulo no loguea; grep `console.log`: 0.
- [x] PRY-R11 — `db/11-conversion-moneda.sql:18-21` copia literalmente las filas de EJEMPLO `[POR ACORDAR]` del §4 de la spec
  (no son valores inventados); CM-R10 cumplido con carga manual en tabla.
- [x] PRY-R12 — `specs-v2/` intacto (hash OK en init.sh).

## Reglas de la spec

- [x] CM-R01 — `index.js:13` devuelve el mismo `deposito`.
- [x] CM-R02 — `repository.js:7-9` `moneda_origen=$1 AND moneda_destino=$2 AND vigente_desde <= now() ORDER BY vigente_desde DESC LIMIT 1`.
- [x] CM-R03 — `index.js:16` busca solo origen→destino, nunca invierte; probado en integración (PEN→USD 0.26 y "no invierte").
- [x] CM-R04 (revisor §6) — `service.js:10-13`: producto exacto en Decimal de precisión 40 y un único redondeo HALF_UP a 2.
  Entrada vía `String(...)` (sin pasar por Number). CM-T06 `"37.59"`/`"3.76"` y `99999999.99 × 3.7555` sin pérdida.
- [x] CM-R05 — `index.js:22-35`: `montoAcreditar`, `monedaAcreditar`, extensión §5 y `contexto.privado.tipoCambioId`.
- [x] CM-R06 — `index.js:18` devuelve `deposito` sin lanzar; el 422 lo da SPEC-07 (CM-T03, CM-T05).
- [x] CM-R07 (revisor §6) — `index.js:39-48` → `repository.insertar(tx, ...)` y `repository.js:17` usa `tx.query`; la prueba
  unitaria comprueba que se usa la `tx` y no `contexto.db`. Sin extensión, `return`.
- [x] CM-R08 — `index.js:52-60` mapea a `{monedaCuenta, tipoCambio "x.xxxx", montoAcreditado "x.xx"}` o `null`; GET probado (CM-R08 integración, CD-T07).
- [x] CM-R09 — CM-T08: billetera 500 → FALLIDO y la fila de `conversiones_deposito` sigue.
- [x] CM-R10 — tabla con carga manual; filas de ejemplo marcadas `[POR ACORDAR]`.
- [x] §4 SQL — `db/11-conversion-moneda.sql` idéntico al DDL de la spec (tablas, CHECK, FK, índice).
- [x] §5 — sin rutas nuevas; bloque `extensiones["conversion-moneda"]` en POST (CM-T01) y GET (CD-T07, CM-R08); ausente
  sin conversión (CM-T02) y con la feature inactiva (CD-T08); billetera recibe `"375.00"` PEN.

## Casos de prueba

- [x] CM-T01 … CM-T08 (8/8 reales, 0 `test.todo`). Integración contra PostgreSQL real + nock; aserciones concretas
  (status, cuerpo, peticiones a billetera, filas en `depositos` y `conversiones_deposito`).
- [x] CM-T07 carga un tipo USD→PEN con la feature inactiva, así el 422 se debe a la inactividad (bien diseñado).
- [x] CD-T07 / CD-T08 (SPEC-08) convertidos a pruebas reales y verdes.
- [x] Pruebas extra por regla CM-R01..R08, R10.

## Checkpoints

- C1: [x]  C2: [x]  C3: [x]  C4: [x]  C5: [x]
  - C3: `src/core/` sin cambios (PRY-R05).
  - C5: extensión probada ACTIVA e INACTIVA con manifest a medida; cobertura `modules/conversion-moneda` 100 %, total 99.54 %.

## Observaciones (no incumplen reglas; para el humano)

1. **Ambigüedad de spec, CM-R02 (`now()`)**: no se precisa si "vigente" se mide con el reloj de la BD o de la app. La
   implementación usa `now()` de PostgreSQL (`repository.js:7`), que es lo que dice literalmente la spec. Conviene confirmarlo.
2. **Ambigüedad de spec, CM-R03 / CM-R10**: los valores de ejemplo (USD→PEN 3.7500 compra, PEN→USD 0.2600 venta) son
   `[POR ACORDAR]` y viven en `db/11-conversion-moneda.sql`, que también se aplica fuera de pruebas. Definir la fuente real
   y si esas filas deben quedarse en un despliegue productivo.
3. `index.js:40` asume que `deposito.extensiones` siempre existe (lo garantiza `registrar-deposito/service.js:94`); correcto
   con el contrato actual de SPEC-06/07, solo se anota como dependencia implícita.

## Cambios requeridos

Ninguno.

## Salida de `bash init.sh`

Completo, en primer plano, con PostgreSQL real:

```
[OK]    specs-v2/ intacto (15 archivos)
[OK]    feature_list.json válido (13 features: pending=1 in_progress=1 done=11 blocked=0)
[OK]    SPEC-11: todos sus casos tienen prueba
[OK]    Alcance de archivos correcto (162 archivos revisados)
PASS integration tests/integration/conversion-moneda/conversion.test.js
Test Suites: 21 passed, 21 total
Tests:       340 passed, 340 total
[OK]    Todas las pruebas en verde (unitarias + integración)
[OK]    Entorno listo. Puedes empezar a trabajar.
EXIT=0
```

### Re-ejecución tras marcar `done`

```
[OK]    feature_list.json válido (13 features: pending=1 in_progress=0 done=12 blocked=0)
[OK]    SPEC-11: todos sus casos tienen prueba
[OK]    Alcance de archivos correcto (163 archivos revisados)
Test Suites: 21 passed, 21 total
Tests:       340 passed, 340 total
EXIT=0
```
