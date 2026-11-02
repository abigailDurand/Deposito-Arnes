# Review — SPEC-12 alerta-uif

**Veredicto:** APROBADO CON OBSERVACIONES

**Revisor** · 2026-11-02 · Insumos: `progress/impl_12.md`, `tests/reporte.md` §SPEC-12.

## Alcance (§2)

- [x] Solo archivos del §2: `src/modules/alerta-uif/index.js`, `src/modules/alerta-uif/repository.js`,
      `db/12-alerta-uif.sql`, `tests/unit/alerta-uif/alerta.test.js`,
      `tests/integration/alerta-uif/alerta.test.js`. `src/config.js` sin cambios (`git diff HEAD -- src/config.js` vacío;
      `uif.umbralPEN/umbralUSD` ya existían en SPEC-00). init.sh: "Alcance de archivos correcto".
- [x] `db/12-alerta-uif.sql` es literal al bloque SQL del §4 (UUID PK, `deposito_id` UNIQUE FK, NUMERIC(15,2), CHECK de `estado_reporte`).

## Reglas de proyecto
- [x] PRY-R01..R03 — módulo `index.js` → `repository.js`; el repositorio solo hace SQL.
- [x] PRY-R04 — `index.js` solo depende de `../../config` y de su propio `repository`; no importa otros módulos.
- [x] PRY-R05 — `git status`/`git diff HEAD -- src/core` vacíos: `src/core/` intacto. Sin referencias a `alerta-uif`/`uif` en `src/core/` (grep).
- [x] PRY-R06/R07 — `index.js:25-28` `new Decimal(deposito.monto).gte(new Decimal(umbralTexto))`; `index.js:34,36` `toFixed(2)` como string. Grep sin `Number(` ni `parseFloat` en el módulo.
- [x] PRY-R08 — `repository.js:6-9` INSERT parametrizado `$1..$5`, `'PENDIENTE'` es literal fijo, no interpolado.
- [x] PRY-R09 — umbrales solo vía `src/config.js:49-51`; ningún `process.env` ni URL en el módulo (grep `http://` vacío).
- [x] PRY-R10 — `index.js:21` warn con `{ depositoId, moneda }`; `index.js:40-43` error con `{ depositoId, error: err.message, codigoError: err.code }`, sin `detail` de pg ni cuenta. Sin `console.log`.
- [x] PRY-R11 — umbral real [POR ACORDAR]: ningún valor en código ni BD; `.env.example:31-33` vacío con nota; pruebas usan 1000.00 / 300.00 de `tests/setup/env.js`.
- [x] PRY-R12 — `specs-v2/` intacto (hash OK en init.sh).

## Reglas de la spec
- [x] UIF-R01 — `registrar-deposito/service.js:65-67` llama `ejecutarPostProcesos` tras `cambiarEstado(...,'COMPLETADO')`, también en el reintento. Probado (integración "UIF-R01 reintento exitoso" y UIF-T03 FALLIDO → 0 filas).
- [x] UIF-R02 — `index.js:18,25` usa `deposito.monto`/`deposito.moneda`, nunca `montoAcreditar`. Probado (unit "UIF-R02", 100.00 USD → 375.00 PEN sin alerta).
- [x] UIF-R03 (§6 revisor) — `gte` de Decimal (`index.js:28`); `id = crypto.randomUUID()` (`index.js:32`); PENDIENTE y umbral usado. Límites probados: 1000.00 PEN (T01, BD real) y 300.00 USD igual al umbral → INSERT; 999.99 / 299.99 → nada.
- [x] UIF-R04 (§6 revisor) — `index.js:11-13` lee `config.uif['umbral'+moneda]` en cada llamada; `null` → `logger.warn` + return (`index.js:20-23`). Probado en UIF-T07 con `jest.mock` de config.
- [x] UIF-R05 (§6 revisor) — `index.js:47` exporta `{ id, tipo: 'post-proceso', ejecutar }` sin `leerExtension`; no muta `deposito` ni devuelve valor. Probado: unit "UIF-R05 no modifica el depósito", contrato SPEC-06, UIF-T05 (GET y 201 sin rastro de UIF, `extensiones: {}`).
- [x] UIF-R06 — `try/catch` en `index.js:30-44`, no relanza, `depositoId` en el log. Probado con error real de PostgreSQL (UIF-T04, CHAR(3)) y en unit.
- [x] UIF-R07 — nada se escribe en auditoría; prueba de integración "UIF-R07".
- [x] UIF-R08 — no se implementa fraccionamiento ni pantalla.

## Contrato §5
- [x] Sin rutas nuevas ni cambios de respuesta (UIF-T05 compara el conjunto exacto de claves del GET).

## Casos de prueba
- [x] UIF-T01 … UIF-T06 (integración, PostgreSQL real + nock) y UIF-T07 (unit con `jest.mock` de config): 7/7 reales, con aserciones concretas (filas exactas en `alertas_uif`, status, códigos, argumentos del logger). Sin `test.todo`.
- [x] Pruebas extra por regla R01, R02, R03, R05, R06, R07.

## Checkpoints
- C1: [x]  C2: [x] (una sola `in_progress`: la 12; dependencias 6 y 7 `done`)  C3: [x] (`src/core/` intacto)  C4: [x]  C5: [x] (activa en T01, inactiva en T06 con manifest a medida; cobertura `modules/alerta-uif` 100 % líneas / 80 % ramas, global ≥ 80 %)

## Observaciones (no incumplen reglas de spec)
1. **Inestabilidad de la suite completa (no atribuible a SPEC-12).** Las dos primeras ejecuciones de `bash init.sh` de esta revisión terminaron ROJAS: 28 fallos, todos en `tests/integration/historial-depositos/historial.test.js` (SPEC-09) a partir de HD-T04, con `401` (`ERROR_401`, `usuario_id: null`) en lugar de 200/403. La suite sola en banda pasa (31/31), `npm test` pasa (355/355) y la tercera ejecución de `bash init.sh` terminó verde (exit 0). Patrón compatible con que otro proceso jest concurrente ejecute `tests/setup/globalSetup.js:13-20`, que regenera `tests/.tmp/privada.pem`/`publica.pem` (y hace `DROP SCHEMA`) a mitad de la ejecución. El historial de SPEC-12 tiene `alerta-uif` inactiva y el 401 es de autenticación, así que no viene de este módulo. Recomendación al líder: asegurarse de que no queden procesos de prueba en segundo plano (impl_12 menciona la tarea `ba7elmj8l` sin terminar) y valorar aislar `tests/.tmp` por ejecución.
2. **Posible ambigüedad de spec para el humano (UIF-R04):** la spec no define qué pasa si `UIF_UMBRAL_*` tiene un valor no numérico. Hoy `new Decimal(...)` lanza (`index.js:26`) y lo captura el pipeline (PIP-R04) con `logger.error` + `depositoId`: no afecta al depósito, pero tampoco valida al arrancar. Decidir si `config.js` (SPEC-00) debería validarlo.
3. `index.js:12` usa `config.uif?.` defensivo; las ramas no cubiertas (80 % de ramas en `index.js`) son solo esas. Aceptable.

## Salida de `bash init.sh`

Ejecución 1 y 2 (rojas, ver observación 1):
```
Test Suites: 1 failed, 22 passed, 23 total
Tests:       28 failed, 327 passed, 355 total
[FAIL]  Hay pruebas rotas
```
Ejecución 3 (completa, en primer plano, PostgreSQL real), exit 0:
```
[OK]    specs-v2/ intacto (15 archivos)
[OK]    feature_list.json válido (13 features: pending=0 in_progress=1 done=12 blocked=0)
[OK]    SPEC-12: todos sus casos tienen prueba
[OK]    Alcance de archivos correcto (169 archivos revisados)
Test Suites: 23 passed, 23 total
Tests:       355 passed, 355 total
[OK]    Todas las pruebas en verde (unitarias + integración)
[OK]    Entorno listo. Puedes empezar a trabajar.
```

Tras marcar la feature 12 `done`:
- Ejecución 4: roja, 11 fallos en `tests/integration/auditoria/auditoria.test.js` (SPEC-04), todos `401`.
  `tests/.tmp/privada.pem`/`publica.pem` tenían mtime 17:30:21, unos 3 s antes de que terminara
  esa ejecución (que empezó hacia las 17:28:30): otro proceso volvió a ejecutar `globalSetup` a mitad
  de la ejecución. El scratchpad compartido también tiene `init.log` / `init2.log` que no son de esta
  revisión. Esto confirma la observación 1 (interferencia externa, no SPEC-12).
- Ejecución 5 (17:30:42 → 17:31:57; claves escritas solo a las 17:30:45 por su propio globalSetup), exit 0:
```
[OK]    feature_list.json válido (13 features: pending=0 in_progress=0 done=13 blocked=0)
Tests:       355 passed, 355 total
[OK]    Entorno listo. Puedes empezar a trabajar.
```
