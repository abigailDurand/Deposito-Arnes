# Sesión actual

> Este archivo se vacía al cerrar cada sesión y se mueve a `history.md`.
> Mientras trabajas, **mantenlo actualizado en tiempo real**, no al final.

- **Feature en curso:** Ninguna (SPEC-01 finalizada; siguiente: 2 — integraciones) · rama `inte_biUsd`
- **Inicio:** 2026-11-03
- **Agente:** leader

## Plan

Retrabajo por la integración con Billetera USD (specs aprobadas por el humano; propuesta en
`docs/propuesta-billetera-usd.md`). Estado nuevo `reabierta` (AGENTS.md §5). Orden y subagentes:

| Spec | Qué cambia | Subagentes | Estado |
|---|---|---|---|
| 00 | `BILLETERA_USD_URL` / `BILLETERA_USD_TOKEN` (config, .env.example, compose, tests/setup/env.js) | dev → tester → revisor | **done** |
| 01 | `cuenta_destino VARCHAR(36)` (db/00-core.sql) | dev → revisor | **done** |
| 02 | Billetera PEN + USD, enrutamiento, mock, helpers; INT-T08..T15; pruebas `000002` obsoletas | dev → tester → revisor | **reabierta** (siguiente) |
| 03 | Solo pruebas: `000002` deja de ser USD (permisos.test.js, SEG-T06) | tester → revisor | **reabierta** |
| 07 | RD-R02 dos formatos, acreditar con usuarioId/canal, RD-R11; RD-T13..T18 | dev → tester → revisor | **reabierta** |
| 08 | CD-T10..T13 | dev → tester → revisor | **reabierta** |
| 09 | HD-R01 dos formatos; HD-T09..T12; HD-T02 usa `22222222-…` | dev → tester → revisor | **reabierta** |
| 11 | Solo pruebas: `000002` USD → billetera `22222222-…` | tester → revisor | **reabierta** |
| 12 | Solo pruebas: `000002` USD → billetera `22222222-…` | tester → revisor | **reabierta** |

## Bitácora

- Harness: estado `reabierta` + campo `retrabajo` (`.harness/validar-features.js`, AGENTS.md, leader.md).
- `Billetera_USD_openapi.yaml` movido a `docs/referencia/`.
- Features 1,2,3,7,8,9,11,12 → `reabierta`; feature 0 → `in_progress`. `init.sh` verde (355).
- SPEC-00 dev, tester y review completados. Veredicto: APROBADO (ver `progress/review_00.md`). Feature 0 marcada como done.
- Reanudación por orden del humano (2026-11-03).
- SPEC-01 pasada a `in_progress`.
- Desarrolladorback completó actualización de `cuenta_destino VARCHAR(36)` en `db/00-core.sql`. Informe generado en `progress/impl_01.md`.
- Revisor completó revisión de SPEC-01. Veredicto: APROBADO (`progress/review_01.md`).
- Feature 1 marcada como `done` en `feature_list.json`.

## Bloqueos

_Ninguno._

## Próximo paso

Iniciar retrabajo de SPEC-02 (`specs-v2/02-integraciones.md`) con desarrolladorback → tester → revisor.
