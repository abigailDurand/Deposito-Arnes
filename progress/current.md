# Sesión actual

> Este archivo se vacía al cerrar cada sesión y se mueve a `history.md`.
> Mientras trabajas, **mantenlo actualizado en tiempo real**, no al final.

- **Feature en curso:** _ninguna_
- **Inicio:** _—_
- **Agente:** _—_

## Plan

_Describe en 3-5 bullets qué vas a hacer antes de tocar código._

## Bitácora

_Anota aquí cada paso significativo: archivos creados, decisiones, bloqueos._

- 2026-11-09 · tester (mantenimiento) · Deadlock de `limpiar()`: causa = INSERT de auditoría post-`finish` (FK a
  `depositos`) vs `TRUNCATE` con orden madre→hija inestable de `pg_tables`. Corregido solo en `tests/helpers/db.js`
  (orden hijas-primero + espera acotada a pool/`pg_stat_activity` ociosos). Repro 15/400 → 0/900; `init.sh` 6/6 verde
  (494/494). Detalle en `progress/deadlock_truncate.md`.

## Bloqueos

_Si algo de una spec es ambiguo o falta: spec, sección, regla y la duda exacta. Nunca supongas._

## Próximo paso

Retrabajo Billetera USD v1.2 cerrado (13 features `done`). Ver pendientes al final de `progress/history.md`.
