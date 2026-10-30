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

## 2026-10-30 — Feature 1: dominio (SPEC-01)
- **Agentes:** leader → desarrolladorback → tester → revisor.
- **Cambios:** `src/core/{db,errores,depositoMapper}.js`, `src/core/middlewares/manejadorErrores.js`,
  `db/00-core.sql`, `tests/unit/dominio/*`, `tests/integration/dominio/transaccion.test.js`.
- **Verificación:** `bash init.sh` completo verde; 42 pruebas + 1 todo.
- **Veredicto:** APROBADO CON OBSERVACIONES (`progress/review_01.md`). Arrastrar:
  - SPEC-06: el catálogo de errores es global; `crearApp` llamado varias veces no debe re-registrar códigos.
  - SPEC-07/08: siempre pasar `extensiones` a `aJson`; SPEC-09: probar `aJson(fila)` sin extensiones.
  - Pendiente de SPEC-00: `--passWithNoTests` en `package.json` (ningún §2 posterior permite tocarlo).
- **Cierre:** feature 1 `done`. Próximo: SPEC-02 (integraciones).

## 2026-10-30 — Feature 2: integraciones (SPEC-02)
- **Agentes:** leader → desarrolladorback → tester → revisor.
- **Cambios:** `src/core/clients/billeteraClient.js`, `mocks/billetera/{server.js,Dockerfile}`,
  `tests/helpers/{billetera,tokens}.js`, `scripts/{generar-claves-dev,generar-token}.js`,
  `tests/unit/integraciones/billeteraClient.test.js`.
- **Verificación:** `bash init.sh` completo verde; 60 pruebas + 1 todo. Mock probado a mano con
  `docker compose` (200/404, 201 y 409 al repetir).
- **Veredicto:** APROBADO CON OBSERVACIONES (`progress/review_02.md`). Arrastrar:
  - SPEC-07: los helpers de nock no conocen las cuentas especiales 999999/888888; simular fallos con
    `acreditaFalla`/`acreditaLento` sobre cuentas normales.
  - Para el equipo: titular de las cuentas especiales del mock no definido en §4 (llevar a P1/P3).
  - SPEC-06: `deposito-service` en compose sigue sin poder arrancar hasta que exista `src/server.js`.
- **Cierre:** feature 2 `done`. Próximo: SPEC-03 (seguridad).

## 2026-10-30 — Feature 3: seguridad (SPEC-03)
- **Agentes:** leader → desarrolladorback → tester → revisor → tester (corrección).
- **Cambios:** `src/core/middlewares/{correlationId,auth}.js`, `src/core/permisos.js`,
  `tests/unit/seguridad/permisos.test.js`, `tests/integration/seguridad/seguridad.test.js`.
- **Verificación:** `bash init.sh` completo verde. SEG-T06 en `test.todo` (espera SPEC-07).
- **Veredicto:** APROBADO CON OBSERVACIONES (`progress/review_03.md`). Corregido tras review: pruebas de
  SEG-R06 (token sin `sub` / `roles` vacío). Arrastrar:
  - SPEC-06: `correlationId` primero y `autenticar` después de `GET /health` (PIP-R11).
  - SPEC-07/08/09: `requiereRol` en cada ruta; `verificarCanal` + `verificarTitular` tras consultar la cuenta.
  - SPEC-07: convertir SEG-T06 en prueba real.
- **Cierre:** feature 3 `done`. Próximo: SPEC-04 (auditoría).
