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

## 2026-10-30 — Feature 0: proyecto (SPEC-00)
- **Agentes:** leader → desarrolladorback → tester → revisor (lanzados como general-purpose con la
  definición de `.claude/agents/`, porque los agentes se crearon a mitad de sesión).
- **Cambios:** `package.json` (+lock), `Dockerfile`, `docker-compose.yml`, `.env.example`, `.gitignore`,
  `src/config.js`, `src/core/logger.js`, `jest.config.js`, `tests/setup/{globalSetup,env}.js`,
  `tests/helpers/db.js`, `tests/core/proyecto.test.js`, `tests/reporte.md`.
- **Verificación:** `bash init.sh` completo verde con PostgreSQL real; 15 pruebas verdes + 1 todo
  (PRY-T01, espera SPEC-06); cobertura `src/core/` 100 %. D12 verificado (BD de pruebas recreada desde cero).
- **Veredicto:** APROBADO CON OBSERVACIONES (`progress/review_00.md`). Arrastrar:
  - SPEC-02 y SPEC-06: su revisor debe correr `docker compose up --build` y comprobar los 3 servicios
    + `GET /health` (criterio de SPEC-00 hoy inalcanzable: el mock y `server.js` no existen aún).
  - SPEC-01: al llegar las primeras pruebas de integración, quitar `--passWithNoTests` de `test:integration`.
- **Cierre:** feature 0 `done`. Próximo: SPEC-01 (dominio).
