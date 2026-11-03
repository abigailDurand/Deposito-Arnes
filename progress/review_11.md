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
