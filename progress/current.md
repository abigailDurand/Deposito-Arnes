# Sesión actual

> Este archivo se vacía al cerrar cada sesión y se mueve a `history.md`.
> Mientras trabajas, **mantenlo actualizado en tiempo real**, no al final.

- **Feature en curso:** 0 — proyecto (retrabajo Billetera USD) · rama `inte_biUsd`
- **Inicio:** 2026-11-02
- **Agente:** leader

## Plan

Retrabajo por la integración con Billetera USD (specs aprobadas por el humano; propuesta en
`docs/propuesta-billetera-usd.md`). Estado nuevo `reabierta` (AGENTS.md §5). Orden y subagentes:

| Spec | Qué cambia | Subagentes |
|---|---|---|
| 00 | `BILLETERA_USD_URL` / `BILLETERA_USD_TOKEN` (config, .env.example, compose, tests/setup/env.js) | dev → tester → revisor |
| 01 | `cuenta_destino VARCHAR(36)` (db/00-core.sql) | dev → revisor |
| 02 | Billetera PEN + USD, enrutamiento, mock, helpers; INT-T08..T15; pruebas `000002` obsoletas | dev → tester → revisor |
| 03 | Solo pruebas: `000002` deja de ser USD (permisos.test.js, SEG-T06) | tester → revisor |
| 07 | RD-R02 dos formatos, acreditar con usuarioId/canal, RD-R11; RD-T13..T18 | dev → tester → revisor |
| 08 | CD-T10..T13 | dev → tester → revisor |
| 09 | HD-R01 dos formatos; HD-T09..T12; HD-T02 usa `22222222-…` | dev → tester → revisor |
| 11 | Solo pruebas: `000002` USD → billetera `22222222-…` | tester → revisor |
| 12 | Solo pruebas: `000002` USD → billetera `22222222-…` | tester → revisor |

## Bitácora

- Harness: estado `reabierta` + campo `retrabajo` (`.harness/validar-features.js`, AGENTS.md, leader.md).
- `Billetera_USD_openapi.yaml` movido a `docs/referencia/`.
- Features 1,2,3,7,8,9,11,12 → `reabierta`; feature 0 → `in_progress`. `init.sh` verde (355).

- SPEC-00 dev (desarrolladorback): config/.env.example/compose/env.js con `BILLETERA_USD_*`.
  `tests/core/proyecto.test.js` queda obsoleto (`envBase()` sin `BILLETERA_USD_URL`, 5 fallos):
  SPEC-00 necesita **tester** antes del revisor. `init.sh` no ejecutado por orden del humano
  (otro agente lo correrá). Detalle en `progress/impl_00.md`.

- SPEC-00 dev: `done -> progress/impl_00.md`. Rompe 5 pruebas de `tests/core/proyecto.test.js` (envBase sin `BILLETERA_USD_URL`) → se añade tester.

- SPEC-00 tester: `done -> tests/reporte.md` (proyecto.test.js actualizado; init.sh 357/357).

- SPEC-00 revisor: APROBADO (`progress/review_00.md`), feature 0 → `done`. El revisor fue cortado por límite de uso mientras corría init.sh; el leader lo repitió: verde 357/357 (antes hubo que levantar `db`).

## Bloqueos

_Ninguno._

- 2026-11-03: `main` reseteado a `fba344d` (pre-USD); el trabajo del compañero quedó en la rama
  `Busti` (`ff09c58`, carpeta `codigo/`, fuera del alcance de init.sh: 28/374 pruebas fallan).
  Decisión del humano: seguir en `inte_biUsd` usando `Busti:codigo/` como **referencia**.
  Problemas conocidos de `Busti:codigo/` que NO deben portarse: `armarContexto` sin `logger`/`db`
  (rompe SPEC-10/11/12), `montoValido` con `decimalPlaces()` (acepta "10.100"), regex UUID con `/i`
  en `billeteraClient.js` (mayúsculas), pruebas USD con `cuentaDestino` PEN (CD-T10, RD-T13, RD-T18),
  INT-T12 (1 sola llamada), pruebas con `0011-0123-000002` como USD.
- SPEC-01 → `in_progress` (dev porta `VARCHAR(36)` desde `Busti` → revisor con init.sh completo).

## Próximo paso

SPEC-01 (dev → revisor). Luego SPEC-02 con `Busti:codigo/` como referencia.

- SPEC-01 dev (retrabajo): `db/00-core.sql` `cuenta_destino VARCHAR(36)` (igual a `Busti`, verificado contra la spec). `init.sh` completo verde 357/357; columna = 36 en `deposito_test`. Detalle en `progress/impl_01.md`. Siguiente: revisor.

- SPEC-01 revisor: APROBADO (`progress/review_01.md`), feature 1 → `done`. Leader: init.sh 357/357.
- SPEC-02 → `in_progress` (dev con `Busti:codigo/` como referencia → tester → revisor).

- Feature en curso: 2 — integraciones (retrabajo, desarrolladorback) · inicio 2026-11-03
  - Plan: (1) `billeteraClient.js` con enrutamiento INT-R10 (UUID minúsculas sin `/i`) y USD INT-R04..R07;
    (2) mock con rutas PEN + USD (INT-R09, datos §4: `000002` PEN, billeteras `1111…`/`2222…`/`9999…`/`8888…`);
    (3) helpers nock PEN + USD de §2; (4) `node -e require` + `init.sh`; (5) `progress/impl_02.md`.
