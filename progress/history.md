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

## 2026-10-30 — Feature 4: auditoria (SPEC-04)
- **Agentes:** leader → desarrolladorback → tester → revisor.
- **Cambios:** `src/core/middlewares/auditoria.js`, `src/core/repositories/auditoriaRepository.js`,
  `db/04-auditoria.sql`, `tests/integration/auditoria/auditoria.test.js`.
- **Verificación:** `bash init.sh` completo verde; 105 pruebas + 5 todo. Reales: AUD-T03, T05, T06, T07, T08.
- **Veredicto:** APROBADO CON OBSERVACIONES (`progress/review_04.md`). Arrastrar:
  - SPEC-07: convertir AUD-T01 (con `deposito_id` real), AUD-T02 (`monto` -5.00, ERROR_422) y AUD-T04.
  - SPEC-06: prueba de `req.ip` con `X-Forwarded-For` y `trust proxy`; orden de montaje PIP-R11.
  - SPEC-05/07: `res.locals.depositoId` siempre debe ser un id existente (si no, el INSERT falla y solo se loguea).
- **Cierre:** feature 4 `done`. Próximo: SPEC-05 (idempotencia).

## 2026-11-02 — Feature 5: idempotencia (SPEC-05)
- **Agentes:** leader → desarrolladorback → tester → revisor.
- **Cambios:** `db/05-idempotencia.sql`, `src/core/repositories/idempotenciaRepository.js`,
  `src/core/middlewares/idempotencia.js`, `src/core/tareas/limpiarClaves.js`,
  `tests/integration/idempotencia/idempotencia.test.js`.
- **Verificación:** `bash init.sh` completo verde; 129 pruebas + 13 todo; cobertura `src/core/` 99,6 %.
  Reales: IDE-T01, IDE-T09 (+17 pruebas por regla IDE-R01..R09).
- **Veredicto:** APROBADO CON OBSERVACIONES (`progress/review_05.md`).
- **Decisiones no cubiertas por la spec (informadas al humano, no bloqueantes):**
  - Conflicto en el INSERT y fila ausente al leerla → 409 `SOLICITUD_EN_PROCESO`.
  - `deposito_id` tiene FK a `depositos`: si `res.locals.depositoId` no existe, el guardado falla,
    se loguea y la clave queda `EN_PROCESO` hasta la limpieza.
- **Arrastrar:**
  - SPEC-07: asignar `res.locals.depositoId` solo cuando la fila del depósito exista.
  - SPEC-07: convertir IDE-T02..T08 e IDE-T10 en pruebas reales con nock; AUD-T04 sigue en todo.
- **Cierre:** feature 5 `done`. Próximo: SPEC-06 (pipeline y cargador).

## 2026-11-02 — Feature 6: pipeline-y-cargador (SPEC-06)
- **Agentes:** leader → desarrolladorback → tester → revisor.
- **Cambios:** `src/app.js`, `src/server.js`, `src/core/pipeline.js`, `src/core/cargador.js`,
  `tests/core/pipeline.test.js`, `tests/core/cargador.test.js`, `tests/core/fixtures/`,
  `tests/integration/pipeline-y-cargador/`, `tests/core/proyecto.test.js` (PRY-T01 real).
- **Verificación:** `bash init.sh` completo verde; 177 pruebas + 12 todo; cobertura global 99,49 %.
  PIP-T01..T10 reales; PRY-T01 deja de ser todo; `req.ip` con `X-Forwarded-For` probado.
- **Veredicto:** APROBADO CON OBSERVACIONES (`progress/review_06.md`).
- **Pendiente de decisión humana (no bloqueante):** body > 100 kb responde 500 `ERROR_INTERNO`
  (DOM-R07 literal); ¿agregar a la spec un 400/413? No se toca sin cambio de spec.
- **Arrastrar:**
  - SPEC-07: pasar el MISMO objeto `contexto` a `ejecutarTransformadores` y `persistirTransformadores` (PIP-R07).
  - SPEC-07..12: el pipeline es singleton de proceso; cada prueba arma su app con su manifest dentro del test.
  - SPEC-12 (cierre): repetir `docker compose up --build` con `specs-v2/manifest.yaml`; requiere `.env`
    con `JWT_PUBLIC_KEY` y `BILLETERA_TOKEN`.
  - `tests/reporte.md` § SPEC-00 aún lista PRY-T01 como todo; actualizar al cerrar.
- **Cierre:** feature 6 `done`. Próximo: SPEC-07 (registrar depósito).

## 2026-11-02 — Feature 7: registrar-deposito (SPEC-07)
- **Agentes:** leader → desarrolladorback → tester → revisor.
- **Cambios:** `src/modules/registrar-deposito/` y sus pruebas (ver `progress/impl_07.md`).
- **Verificación:** `bash init.sh` completo verde; 234 pruebas, 0 todo; cobertura global 99,6 %.
  RD-T01..T12 reales; SEG-T06, AUD-T01/T02/T04, IDE-T02..T08/T10 convertidos a pruebas reales.
- **Veredicto:** APROBADO CON OBSERVACIONES (`progress/review_07.md`).
- **Pendiente de decisión humana (no bloqueante):**
  - `"10.100"` → 422 `MONTO_INVALIDO` (decimales contados sobre el string). Confirmar interpretación de RD-R03.
  - Riesgo operativo: si `acreditar` OK pero falla `PROCESANDO→COMPLETADO` (BD caída) → 500, la clave se
    borra (IDE-R08) y un reintento acreditaría dos veces. Cumple RD-R06; análogo a IDE-R10. Documentar en la spec.
- **Arrastrar:**
  - tester: prueba `"10.100"` → 422 en `tests/unit/registrar-deposito/service.test.js`.
  - tester: actualizar `tests/reporte.md` § SPEC-00/03/04/05 (todo ya convertidos).
- **Cierre:** feature 7 `done`. Próximo: SPEC-08 (consultar depósito).
