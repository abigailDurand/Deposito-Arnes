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
