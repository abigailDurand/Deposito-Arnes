# CHECKPOINTS — Evaluación del estado final

> En sistemas multi-agente no se evalúa el camino, se evalúa el destino.
> Checkpoints objetivos que un juez (humano o IA) usa para decidir si el proyecto está sano.
> Los marcados con ⚙ los verifica `init.sh` automáticamente.

## C1 — El arnés está completo

- [ ] ⚙ Existen `AGENTS.md`, `CLAUDE.md`, `init.sh`, `feature_list.json`, `progress/current.md`,
      `progress/history.md`, `docs/architecture.md`, `docs/conventions.md`, `docs/verification.md`.
- [ ] ⚙ Existen los 4 agentes en `.claude/agents/`.
- [ ] ⚙ `bash init.sh` termina con exit code 0.

## C2 — El estado es coherente

- [ ] ⚙ Como mucho una feature en `in_progress`.
- [ ] ⚙ Ninguna feature `done` / `in_progress` tiene dependencias sin `done`.
- [ ] `progress/current.md` está vacío o describe la sesión activa.

## C3 — El alcance se respeta

- [ ] ⚙ `specs-v2/` está intacto (hash igual a `.harness/specs.sha256`).
- [ ] ⚙ Todo archivo del proyecto está declarado en el §2 de alguna spec.
- [ ] ⚙ Ningún archivo pertenece a una spec que sigue en `pending`.
- [ ] Las features de extensión (SPEC-10 a 12) no modificaron `src/core/` (PRY-R05).

## C4 — El código respeta la arquitectura (lo verifica el revisor)

- [ ] PRY-R01 a PRY-R04: capas `routes → controller → service → repository/client`; módulos
      solo dependen de `src/core/`.
- [ ] PRY-R06/R07: dinero con `Decimal`, string `"150.00"` en JSON, nunca `Number`.
- [ ] PRY-R08: todo SQL parametrizado.
- [ ] PRY-R09/R10: secretos solo en `config.js`; logs sin tokens ni cuentas completas.
- [ ] Las reglas `XX-Rnn` que la spec pide verificar en su §6 "revisor".

## C5 — La verificación es real

- [ ] ⚙ Cada caso `XX-Tnn` de una feature `done` tiene una prueba cuyo nombre empieza por su id.
- [ ] Las pruebas de integración usan PostgreSQL real y nock (no mocks de BD).
- [ ] Cada extensión se prueba ACTIVA e INACTIVA con un manifest a medida.
- [ ] Cobertura ≥ 80 % en `src/core/` y `src/modules/`.
- [ ] `tests/reporte.md` lista casos cubiertos, sin prueba (`test.todo`) y fallidos.

## C6 — La sesión se cerró bien

- [ ] Sin archivos temporales ni `console.log` de debug.
- [ ] `progress/history.md` tiene una entrada por la última sesión.
- [ ] La última feature trabajada está en su estado correcto.

---

**Cómo usar este archivo:** el `revisor` recorre cada checkbox, marca `[x]` o `[ ]` en su
`progress/review_<id>.md` y rechaza el cierre si queda alguno vacío en C1–C5.
