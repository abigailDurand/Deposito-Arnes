# Review — SPEC-03 seguridad (RETRABAJO Billetera USD)

**Veredicto:** APROBADO

Revisor · 2026-11-03 · Feature 3 (`seguridad`) · **Retrabajo** (`retrabajo: true`), rama `inte_biUsd`.
Retrabajo solo de pruebas (sin desarrolladorback): `specs-v2/03-seguridad.md` no cambió; cambiaron los
datos de prueba de SPEC-02 §4 (v2.0). `git status` confirma que `src/` no tiene cambios. Sustituye a la
review original del 2026-10-30.

Archivos revisados (`git diff -- tests/`): `tests/unit/seguridad/permisos.test.js`,
`tests/integration/seguridad/seguridad.test.js`, `tests/reporte.md` (sección `## SPEC-03`).

## Pruebas obsoletas actualizadas (AGENTS.md §5)
- [x] `permisos.test.js:17-31` — **eliminada** `CUENTA_USD` (`0011-0123-000002` con `moneda: 'USD'`, contradecía
  SPEC-02 §4 v2.0). Sustituida por `CUENTA_PEN_2` (PEN, `usr-cliente-2`) y `BILLETERA_USD_1`/`BILLETERA_USD_2`
  con los UUID de §4 y la forma de INT-R04 (`numero` = UUID, `estado: 'ACTIVA'`, `titularId` = `user_id`).
  Ninguna referencia residual a `CUENTA_USD` (grep).
- [x] `seguridad.test.js:261` — SEG-T06 enviaba `moneda: 'USD'` a una cuenta ahora PEN (el 403 podía depender
  del orden titular/moneda); ahora `moneda: 'PEN'`, de modo que el único motivo del rechazo es el titular.
- [x] `seguridad.test.js:306-321` — nuevo control `usr-cliente-2` (titular real según §4) → 201 y una
  acreditación PEN; demuestra que la cuenta/datos son válidos y que el 403 de T06 se debe solo a SEG-R11.

## Reglas
- [x] SEG-R11 — `permisos.test.js:88-108`: CLIENTE propio (PEN y USD) pasa; ajeno (PEN y USD) e inexistente →
  `SIN_PERMISO`; AGENTE/CAJERO a las cuatro cuentas de §4 pasan.
- [x] SEG-R12 — `permisos.test.js:111-121`: `esTitular` true/false con PEN y billeteras USD, AGENTE → false.
- [x] SEG-R01..R10, R13 — pruebas sin cambios respecto a la versión aprobada; siguen en verde.
- [x] PRY-R12 — `specs-v2/` intacto (init.sh: 15 archivos).
- [x] Datos de prueba — solo identificadores de SPEC-02 §4 (`0011-0123-456789`, `0011-0123-000002`,
  `11111111-…`, `22222222-…`, usuarios `usr-*`). No se inventan datos.
- [x] Sin cambios en `src/` (no aplica revisión de PRY-R01..R11 sobre código nuevo).

## Limpieza de BD / deadlocks
- [x] `seguridad.test.js:223-244` — `afterEach` del bloque SEG-T06 llama a `esperarAuditoria()`: espera a que el
  pool de la app (`src/core/db`) quede ocioso y el conteo de `auditoria_depositos` sea estable (2 lecturas
  iguales) antes del `TRUNCATE` del `beforeEach(limpiar)` siguiente. Mismo patrón que el resto de suites de
  integración (`alerta.test.js`, `consultar.test.js`, `historial.test.js`, …). Ejecuté las suites de seguridad
  3 veces seguidas más la corrida completa: 0 deadlocks, 36/36 cada vez.

## Casos de prueba
- [x] SEG-T01..T05, T08, T09, T10 — integración, aserciones concretas de status/código/cuerpo/log (sin cambios).
- [x] SEG-T06 — integración real (crearApp + PostgreSQL + nock): 403 con cuerpo exacto `{codigo, mensaje,
  correlationId}`, consulta 1, acreditaciones 0, 0 filas en `depositos`, auditoría `ERROR_403` de `usr-cliente-1`;
  controles 201 para `usr-cliente-1` → `456789` y `usr-cliente-2` → `000002`.
- [x] SEG-T07 — unitaria, `ErrorApp` `SIN_PERMISO` 403.
- 10/10 reales, 0 `test.todo` de SPEC-03.

## Checkpoints
- C1: [x]  C2: [x]  C3: [x]  C4: [x]  C5: [x]

## Observaciones (no bloqueantes)
- Ninguna que incumpla regla. La cobertura de SEG-T06 vía endpoint con billetera USD queda pendiente del
  retrabajo de SPEC-07 (RD-R02 dos formatos); no es un caso de SPEC-03 y la regla de titular sobre USD está
  cubierta en la unitaria.

## Salida de `bash init.sh`
```
[OK]    specs-v2/ intacto (15 archivos)
[OK]    feature_list.json válido (13 features: pending=0 in_progress=1 done=7 blocked=0 reabierta=5)
[OK]    SPEC-03: todos sus casos tienen prueba
[WARN]  SPEC-07/08/09 (reabierta) aún sin prueba: RD-T13..T18, CD-T10..T13, HD-T09..T12
[OK]    Alcance de archivos correcto (178 archivos revisados)
Test Suites: 23 passed, 23 total
Tests:       1 todo, 380 passed, 381 total
[OK]    Todas las pruebas en verde (unitarias + integración)
[OK]    Entorno listo. EXIT=0
```
