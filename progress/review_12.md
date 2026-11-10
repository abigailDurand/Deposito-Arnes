# Review — SPEC-12 alerta-uif (retrabajo)

**Veredicto:** APROBADO

Retrabajo solo de pruebas por SPEC-02 §4 v2.0 (los dólares van a billeteras USD `11111111-…` /
`22222222-…`; `0011-0123-000002` ya no es cuenta USD). Spec 12 sin cambios; sin desarrollador.
`git diff HEAD -- src db mocks` vacío.

## Reglas
- [x] PRY-R05 — `src/modules/alerta-uif/index.js` exporta `{ id, tipo: 'post-proceso', ejecutar }`; `src/core/` sin referencias a `alerta`/`uif` y sin cambios.
- [x] PRY-R06 / UIF-R03 — `index.js:25-28` usa `new Decimal(...)` y `monto.gte(umbral)`; sin `Number(`/`parseFloat`.
- [x] PRY-R04 — `repository.js:5-8` INSERT parametrizado `$1..$5`.
- [x] PRY-R09/R10 — sin `console.log` ni URLs en el módulo; `logger.error` sin el error completo.
- [x] UIF-R04 — umbral solo desde `config.uif` (`index.js:11-13`), `logger.warn` si falta; probado en UIF-T07 (unit).
- [x] UIF-R05 — sin `leerExtension`; UIF-T05 verifica claves exactas del GET, `extensiones: {}` y que ni 201 ni GET contienen `uif|umbral|PENDIENTE|estadoReporte`; UIF-R05 unit verifica que el depósito no se modifica; UIF-T04 verifica 201 COMPLETADO con INSERT fallido.
- [x] UIF-R07 — integración verifica que `auditoria_depositos` no contiene datos UIF.

## Casos de prueba
- [x] UIF-T01 … UIF-T06 reales en `tests/integration/alerta-uif/alerta.test.js` (líneas 117-221), aserciones concretas sobre filas de `alertas_uif`.
- [x] UIF-T07 real en `tests/unit/alerta-uif/alerta.test.js:52`.
- [x] Umbral USD con billetera USD: unit (`WALLET_USD`, INSERT con `['300.00','USD','300.00']`; 299.99 sin INSERT) e integración nueva (`alerta.test.js:260-312`): 300.00 USD VENTANILLA a `22222222-…` → 201 COMPLETADO, 1 GET + 1 POST a Billetera USD, 0 a billetera PEN, fila exacta `{300.00, USD, 300.00, PENDIENTE}`; 299.99 → 0 filas; Billetera USD 500 con 5000.00 → 502 `BILLETERA_NO_DISPONIBLE`, FALLIDO, 0 filas.
- [x] Pruebas obsoletas actualizadas: no queda `0011-0123-000002` en pruebas de SPEC-12; todos los depósitos USD unitarios (UIF-R02, R03 x2, R05, R06) usan `WALLET_USD`.
- [x] Limpieza de BD: `afterEach` llama `esperarAuditoria()` (conteo estable de `auditoria_depositos`) antes de que el `beforeEach` siguiente haga `limpiar()`.

## Checkpoints
- C1: [x]  C2: [x]  C3: [x]  C4: [x]  C5: [x]

## Cambios requeridos
Ninguno.

## Salida de `bash init.sh` (completo, PostgreSQL real)
```
Test Suites: 23 passed, 23 total
Tests:       409 passed, 409 total
[OK]    Todas las pruebas en verde (unitarias + integración)
[OK]    Entorno listo. Puedes empezar a trabajar.
```
Cobertura: All files > 80 %; `modules/alerta-uif` 100 % líneas, 80 % ramas.
Feature 12 marcada `done` (se conserva `retrabajo: true`); `bash init.sh` re-ejecutado tras el cambio.

---

## Retrabajo v1.3, 2026-11-09

# Review — SPEC-12 alerta-uif (retrabajo v1.2 → v1.3)

**Veredicto:** APROBADO

Cambio de spec: solo UIF-R01 («también tras un reintento exitoso **o una reconciliación (RD-R13),
una sola vez por depósito**»). Sin casos UIF-Tnn nuevos. §2, §3, §5 y UIF-R02..R08 sin cambios.

### Omisión de `desarrolladorback`: correcta
- UIF-R01 describe cuándo **el pipeline** llama al módulo, no comportamiento del módulo:
  `src/modules/alerta-uif/index.js:17` (`ejecutar`) no decide nada sobre el estado ni sobre
  cuántas veces se le llama. Ningún archivo del §2 de SPEC-12 necesita cambiar.
- La garantía «una sola vez» la da SPEC-07 (ya `done`):
  `src/modules/registrar-deposito/service.js:174-176` cambia `PROCESANDO → COMPLETADO` dentro de
  la tx con `FOR UPDATE SKIP LOCKED` (`service.js:218-219`), y solo quien hizo esa transición llama
  a `cerrarReconciliado` → `pipeline.ejecutarPostProcesos` (`service.js:199-213`, `229-234`);
  los resultados FALLIDO/PENDIENTE no ejecutan post-procesos. RD-T22/RD-T23
  (`tests/integration/registrar-deposito/registrar.test.js:928`, `995`) lo prueban con BD real.
- Defensa adicional en BD: `db/12-alerta-uif.sql:4` `deposito_id ... UNIQUE`.
- `git diff HEAD -- src/modules/alerta-uif db/12-alerta-uif.sql tests/unit/alerta-uif` vacío;
  no hay sección nueva en `progress/impl_12.md`, coherente con no tocar código.

### Reglas
- [x] UIF-R01 (v1.3) — cubierto por el pipeline de SPEC-07 (ver arriba) y por las pruebas nuevas.
- [x] UIF-R03 — `index.js:25-28` `new Decimal(...)` y `monto.gte(umbral)`; sin cambios.
- [x] UIF-R04 — umbral solo de `config.uif` (`index.js:11-13`), `logger.warn` si falta; sin cambios.
- [x] UIF-R05 — sin `leerExtension`; `ejecutar` no modifica `deposito` ni devuelve nada.
- [x] PRY-R05 — `src/core/` sin referencias a `uif`/`alerta` (Grep vacío).
- [x] PRY-R06/R08/R09/R10 — Grep de `Number(`, `parseFloat`, `console.log`, `http://` en
      `src/modules/alerta-uif` vacío; INSERT parametrizado `$1..$5` (`repository.js:5-8`).
- [x] PRY-R12 — `specs-v2/` intacto según `init.sh`.

### Casos de prueba
- [x] UIF-T01 … UIF-T07 siguen reales (7/7), sin `test.todo`.
- [x] Nuevas (`tests/integration/alerta-uif/alerta.test.js:319-400`), BD real + nock:
  - `UIF-R01 PROCESANDO → reconciliación COMPLETADO` (l. 346): 202 PROCESANDO y 0 alertas antes;
    `reconciliar()` → `{1,0,0}`; fila exacta `{deposito_id, 5000.00, USD, 300.00, PENDIENTE}`;
    2.ª `reconciliar()` → `{0,0,0}`, 0 peticiones a Billetera USD, mismas filas; replay del POST →
    mismo `id`, 0 peticiones, mismas filas.
  - `UIF-R01 PROCESANDO → reconciliación FALLIDO` (l. 387): `{0,1,0}`, FALLIDO, 0 alertas.
  Aserciones concretas sobre filas y conteos, no solo «no lanza».
- [x] Concurrencia de dos ciclos: no se repite aquí; la cubre RD-T23 de SPEC-07 y el UNIQUE.

### Checkpoints
- C1: [x]  C2: [x]  C3: [x]  C4: [x]  C5: [x]

### Cambios requeridos
Ninguno.

### Salida de `bash init.sh` (completo, PostgreSQL real, una pasada, sin deadlock)
```
[OK]    specs-v2/ intacto (15 archivos)
[OK]    feature_list.json válido (13 features: pending=0 in_progress=1 done=12 blocked=0 reabierta=0)
[OK]    SPEC-12: todos sus casos tienen prueba
[OK]    Alcance de archivos correcto (190 archivos revisados)
Test Suites: 23 passed, 23 total
Tests:       494 passed, 494 total
[OK]    Todas las pruebas en verde (unitarias + integración)
[OK]    Entorno listo. Puedes empezar a trabajar.
EXIT=0
```
Feature 12 marcada `done` (se conserva `retrabajo: true`); `bash init.sh` re-ejecutado tras el cambio.
