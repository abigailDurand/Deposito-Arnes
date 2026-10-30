# Bitácora histórica (append-only)

> Cada vez que se cierra una sesión, su resumen se añade aquí.
> No edites entradas anteriores. Solo añades al final.

---

## 2026-10-30 — Bootstrap del arnés
- **Agente:** Claude (configuración inicial, sin código de aplicación).
- **Base:** arnés de `betta-tech/ejemplo-harness-subagentes` adaptado a Node.js; specs copiadas
  de `TheLuisP23/DAPN-MICROSERVICIO-DEPOSITO` (`specs-v2/`, versión 1.1).
- **Cambios:** `CLAUDE.md`, `AGENTS.md`, `CHECKPOINTS.md`, `init.sh`, `feature_list.json`
  (SPEC-00 a SPEC-12, todas `pending`), `docs/`, `.claude/agents/` (leader, desarrolladorback,
  tester, revisor), `.claude/hooks/`, `.harness/` (verificación de specs, estado, alcance y casos).
- **Resultado:** `bash init.sh` verde. Próximo: SPEC-00 (proyecto).

## 2026-10-30 — Huecos de specs resueltos (cambio humano autorizado)
- **Agente:** Claude, con aprobación explícita de la persona responsable del proyecto (PRY-R12: cambio de specs por persona).
- **Cambios:** `specs-v2/00-proyecto.md` 1.1 → 1.2 (BD de pruebas, `tests/core/proyecto.test.js`,
  umbrales UIF en `env.js`, Dockerfile copia el manifest); `specs-v2/12-alerta-uif.md` 1.1 → 1.2
  (UIF-T07 con `jest.mock` de `config`); `specs-v2/README.md` con decisiones D12–D15.
- **Arnés:** `.harness/specs.sha256` regenerado; `docs/verification.md` actualizado.
- **Resultado:** `bash init.sh` verde. Pendiente: llevar estos cambios al repo DAPN-MICROSERVICIO-DEPOSITO.
