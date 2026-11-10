# Review — SPEC-11 conversion-moneda (retrabajo)

**Veredicto:** APROBADO

**Revisor:** revisor · **Fecha:** 2026-11-03 · **Rama:** `inte_biUsd` · **Tipo:** retrabajo solo de
pruebas (AGENTS.md §5 "Reabrir features"), motivado por SPEC-02 §4 v2.0. Spec 11 sin cambios; sin
desarrollador. Sustituye a la revisión del 2026-11-02.

## Alcance verificado
- `git status -- src/ db/ mocks/` vacío: `src/` (incluido `src/core/`) no cambió → PRY-R05 intacto.
- Diff limitado a `tests/integration/conversion-moneda/conversion.test.js`,
  `tests/unit/conversion-moneda/conversion.test.js` y `tests/reporte.md` (archivos de §2).

## Reglas
- [x] PRY-R05 — conversión sigue como transformador en `src/modules/conversion-moneda/`; `src/core/` sin tocar.
- [x] CM-R03 PEN→USD — `tests/integration/conversion-moneda/conversion.test.js:268` es prueba real
  (antes `test.todo`): con filas USD→PEN 3.75 y PEN→USD 0.26 cargadas, `150.00` PEN a la billetera
  `11111111-…` (titular `usr-cliente-1`, SPEC-02 §4 v2.0 línea 81) → 201, extensión
  `{ USD, "0.2600", "39.00" }`, Billetera USD recibe `monto "39.00"`, `moneda "USD"`,
  `Idempotency-Key = id`; billetera PEN 0 peticiones; fila de conversión con `tipo_cambio_id …0002`.
- [x] CM-R03 no invierte — línea ~320: solo fila USD→PEN y PEN a la billetera USD → 422, nada guardado.
- [x] CM-R09 — prueba nueva PEN→USD con Billetera USD 500 → 502, depósito FALLIDO `39.00 USD`, fila de
  conversión se queda.
- [x] CM-R05 (unit) — `tests/unit/conversion-moneda/conversion.test.js:110` usa `cuentaDestino`
  `11111111-…`, comprueba SELECT `['PEN','USD']` y `39.00` USD.
- [x] CM-R04 / CM-R07 (§6 revisor) — `src/` sin cambios respecto a la revisión aprobada anterior;
  sus pruebas unitarias (HALF_UP, `tx` recibida) siguen verdes.
- [x] Datos obsoletos — ninguna referencia a `0011-0123-000002` como USD ni a `22222222-…` en las
  pruebas de SPEC-11; `contexto(db,'USD')` ya no reutiliza `0011-0123-456789` con moneda USD.

## Casos de prueba
- [x] CM-T01 … CM-T08 (8/8 reales, aserciones concretas sobre status, cuerpo, peticiones a billetera
  y filas en `depositos` / `conversiones_deposito`). CM-T01..T05, T07, T08 siguen con la cuenta PEN
  `0011-0123-456789` y `usr-cliente-1` como pide §6; CM-T07 añade variante PEN→USD (billetera USD).
- [x] 0 `test.todo` en SPEC-11.

## Limpieza de BD
- [x] `afterEach` llama a `esperarAuditoria()` (conteo de `auditoria_depositos` estable) antes del
  `TRUNCATE` de `limpiar()` en `beforeEach`; `limpiar()` vacía `tipos_cambio` y cada prueba carga los suyos.

## Checkpoints
- C1: [x]  C2: [x]  C3: [x]  C4: [x]  C5: [x]

## Cambios requeridos
Ninguno.

## Salida de `bash init.sh`
Ejecutado completo con PostgreSQL real → `EXIT=0`.
```
Test Suites: 23 passed, 23 total
Tests:       406 passed, 406 total
[OK]    Todas las pruebas en verde (unitarias + integración)
[OK]    Entorno listo. Puedes empezar a trabajar.
```
Cobertura `modules/conversion-moneda` 100 % en las cuatro métricas.

---

# Retrabajo v1.2, 2026-11-09

**Veredicto:** APROBADO

**Revisor:** revisor · **Fecha:** 2026-11-09 · **Rama:** `inte_biUsd` · spec v1.1 → v1.2 (D1: sin
conversión hacia cuentas USD; CM-R11; CM-T09; seed sin PEN→USD).

## Alcance verificado
- Cambios de código de esta feature: `src/modules/conversion-moneda/index.js` (+3 líneas, corte CM-R11)
  y `db/11-conversion-moneda.sql` (seed solo USD→PEN). Ambos en el §2.
- `service.js` y `repository.js` de conversion-moneda sin cambios (mtime 2026-11-02).
- `src/core/` sin tocar en este retrabajo (PRY-R05): las diferencias contra HEAD en
  `src/core/clients/billeteraClient.js` y `src/core/depositoMapper.js` son de los retrabajos de
  SPEC-02/01 (mtime 19:10 y 20:33, antes de la revisión de SPEC-07 a las 21:30); `index.js` y el SQL
  de SPEC-11 son de las 21:44.
- `src/modules/registrar-deposito/service.js` sin tocar (mtime 20:48, anterior a este retrabajo).

## Reglas
- [x] CM-R11: `index.js:16`. `if (monedaCuenta === 'USD') return deposito;` va después de CM-R01
  (`index.js:13`) y antes de `repository.buscarVigente` (`index.js:19`): no consulta `tipos_cambio`,
  no lanza y no usa `/fx` (Grep `/fx` en el módulo: 0 coincidencias).
- [x] El 422 sale de SPEC-07: `registrar-deposito/service.js:129`
  (`deposito.monedaAcreditar !== cuenta.moneda` → `MONEDA_NO_SOPORTADA`; `monedaAcreditar` empieza en
  `datos.moneda`, línea 120). No hizo falta modificarlo.
- [x] CM-R01: USD→USD sigue cortando en `index.js:13`, antes de CM-R11.
- [x] CM-R02/R03/R06: sin cambios; en la práctica solo se consulta USD→PEN.
- [x] CM-R04 (§6 revisor): `service.js` con `Decimal.clone({precision:40})`, `ROUND_HALF_UP`, `toFixed(2)`. Sin cambios.
- [x] CM-R07 (§6 revisor): `persistir` usa la `tx` recibida (`index.js:44`); sin extensión no inserta
  (`index.js:43`); la prueba unitaria nueva lo comprueba también tras el corte de CM-R11.
- [x] CM-R10 / PRY-R11: el seed se queda como ejemplo `[POR ACORDAR]`, igual a §4 v1.2 línea por línea.
- [x] PRY-R01..R04: el módulo solo importa `decimal.js`, `./repository` y `./service`.
- [x] PRY-R06/R07: `new Decimal(...)`; Grep de `Number(` y `parseFloat` en el módulo: 0.
- [x] PRY-R08: `repository.js` usa `$1..$5`; Grep de `+ '` en SQL: 0.
- [x] PRY-R09/R10: no hay `console.log`, `http://` ni secretos en el módulo.
- [x] PRY-R12: hash de `specs-v2/` validado por `init.sh`.

## Casos de prueba
- [x] CM-T09: `tests/integration/conversion-moneda/conversion.test.js:262`. PostgreSQL real con fila
  PEN→USD cargada y feature activa → 422 `MONEDA_NO_SOPORTADA`, correlation id, 1 consulta a
  Billetera USD, 0 créditos USD/PEN, 0 filas en `depositos` y `conversiones_deposito`, y `buscarVigente`
  no se llama (`jest.spyOn` sin mock; `jest.restoreAllMocks()` en `afterEach`, línea 106). La prueba de
  control USD→PEN comprueba que el espía funciona (1 llamada con `['USD','PEN']`).
- [x] Prueba unitaria de CM-R11 (`tests/unit/conversion-moneda/conversion.test.js:110`): mismo objeto,
  `db.query` no se llama, `privado` vacío. También `persistir` sin insert (U:126) y CM-R01 USD→USD (U:138).
- [x] Pruebas eliminadas con razón: `CM-R05 PEN→USD 39.00` (unit) y `CM-R03 PEN→USD 0.26` (integración)
  probaban justo la conversión que D1/CM-R11 prohíben. `CM-R09` se reescribió con USD→PEN 375.00 y
  ahora también comprueba el detalle del FALLIDO con la extensión, así que no se pierde cobertura de CM-R09.
- [x] CM-T01..CM-T08 siguen reales y en verde.
- [x] RD-T14 (SPEC-07, `done`): `tests/integration/registrar-deposito/registrar.test.js:626`. Antes era
  `test.todo` y ahora es prueba real con feature activa y PEN→USD cargado → 422, 0 créditos, 0 depósitos,
  0 conversiones. Cumple RD-T14 v2.2 («también con `conversion-moneda` activa (D1)»). Se acepta.
- [x] 0 `test.todo` en el repo.

## Checkpoints
- C1: [x]  C2: [x] (solo la 11 en `in_progress`; dependencias 6 y 7 en `done`)  C3: [x] (hash OK,
  `src/core/` sin tocar en este retrabajo)  C4: [x]  C5: [x] (cobertura de `modules/conversion-moneda`
  100 % en todas las métricas; extensión probada activa e inactiva)

## Cambios requeridos
Ninguno.

## Salida de `bash init.sh`
Completo con PostgreSQL real, dos veces (antes y después de marcar `done`), sin deadlock:
```
Test Suites: 23 passed, 23 total
Tests:       492 passed, 492 total
[OK]    Todas las pruebas en verde (unitarias + integración)
[OK]    Entorno listo. Puedes empezar a trabajar.
```
