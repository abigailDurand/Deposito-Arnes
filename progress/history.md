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

## 2026-11-02 — Feature 8: consultar-deposito (SPEC-08)
- **Agentes:** leader → desarrolladorback → tester → revisor.
- **Cambios:** `src/modules/consultar-deposito/`, `tests/unit/consultar-deposito/`,
  `tests/integration/consultar-deposito/`; prueba `"10.100"` en `tests/unit/registrar-deposito/service.test.js`.
- **Verificación:** `bash init.sh` completo verde; 268 pruebas + 2 todo (CD-T07/T08 hasta SPEC-11); cobertura 99,6 %.
- **Veredicto:** APROBADO CON OBSERVACIONES (`progress/review_08.md`). Decisiones de impl_08 aceptadas sin escalar.
- **Arrastrar:**
  - SPEC-09..12: las suites de integración deben esperar a que la auditoría (escrita tras responder) termine
    antes del `TRUNCATE` de `limpiar()` (patrón en `consultar.test.js:116-124`); valorar helper compartido.
  - Estilo: líneas > 100 caracteres en `tests/integration/consultar-deposito/consultar.test.js`.
  - SPEC-11: convertir CD-T07/T08.
- **Cierre:** feature 8 `done`. Sesión pausada a petición del humano.

## Pendientes de decisión humana (acumulados al 2026-11-02)
1. Body > 100 kb → hoy 500 `ERROR_INTERNO` (DOM-R07). ¿400/413? (SPEC-06)
2. `"10.100"` → 422 `MONTO_INVALIDO`. ¿Confirmar o aceptar ceros finales? (SPEC-07)
3. Riesgo de doble acreditación si falla `PROCESANDO→COMPLETADO` tras acreditar. Documentar/cubrir en spec. (SPEC-07)

### 2026-11-02 — Decisión humana
- Pendiente 2 resuelto: **se aceptan los ceros finales** (`"10.100"` válido = 10.10; `"10.101"` inválido).
  Requiere que el humano actualice RD-R03 en `specs-v2/07-registrar-deposito.md`; después,
  desarrolladorback ajusta `src/modules/registrar-deposito/service.js` y tester cambia la prueba `"10.100"` → 422.
- Pendiente 3 resuelto: **se acepta como riesgo conocido** la doble acreditación si falla
  `PROCESANDO→COMPLETADO` tras acreditar (RD-R06 + IDE-R08), igual que IDE-R10. No se cambia código.
  Opcional: que el humano lo documente en la spec junto a IDE-R10.
- Pendiente 1 (body > 100 kb → 500) sigue abierto; sin cambio mientras no se decida.
- Pendiente 2 **corregido por el humano**: NO se aceptan ceros finales. Solo hasta 2 decimales
  (`"10.18"`, `"20.50"` válidos; `"10.100"` → 422 `MONTO_INVALIDO`). Es el comportamiento actual y
  la lectura literal de RD-R03: no se cambia spec, código ni pruebas. Anula la decisión anterior.

## 2026-11-02 — Feature 9: historial-depositos (SPEC-09)
- **Agentes:** leader → desarrolladorback → tester → revisor.
- **Inicio de sesión:** `init.sh` falló por contenedor `db` caído; `docker compose up -d db` lo resolvió.
- **Cambios:** `src/modules/historial-depositos/` (6 archivos), `tests/integration/historial-depositos/historial.test.js`.
- **Verificación:** `bash init.sh` completo verde; 299 pruebas + 2 todo (CD-T07/T08 hasta SPEC-11); cobertura módulo 98,68 % stmts.
- **Veredicto:** APROBADO CON OBSERVACIONES (`progress/review_09.md`). Decisiones de impl_09 aceptadas.
- **Arrastrar:**
  - `service.js:31` 403 defensivo para operador sin `id` (no pedido por spec, rama sin cubrir).
  - `service.js:12-15` `tieneRol` duplica `rolesDe` de `core/permisos.js` (no exportado; PRY-R05).
- **Cierre:** feature 9 `done`. Próximo: SPEC-10 (límites por canal).

## 2026-11-02 — Feature 10: limites-por-canal (SPEC-10)
- **Agentes:** leader → desarrolladorback → tester → revisor.
- **Cambios:** `db/10-limites-canal.sql`, `src/modules/limites-por-canal/{index,repository}.js`,
  `tests/unit/limites-por-canal/`, `tests/integration/limites-por-canal/`. `src/core/` intacto.
- **Verificación:** `bash init.sh` completo verde; 316 pruebas + 2 todo (CD-T07/T08 hasta SPEC-11).
- **Veredicto:** APROBADO CON OBSERVACIONES (`progress/review_10.md`).
- **Pendiente de decisión humana (no bloqueante):**
  - LC-T05 "billetera no llamada" choca con RD-R04 (consulta GET antes de validadores). Implementado como
    "sin acreditación" (0 POST, 1 GET). Aclarar redacción en la spec.
  - `db/10-limites-canal.sql`: límites de EJEMPLO `[POR ACORDAR]` (PRY-R11); definir valores reales.
- **Cierre:** feature 10 `done`. Próximo: SPEC-11 (conversión de moneda).

## 2026-11-02 — Feature 11: conversion-moneda (SPEC-11)
- **Agentes:** leader → desarrolladorback → tester → revisor.
- **Cambios:** `db/11-conversion-moneda.sql`, `src/modules/conversion-moneda/{index,service,repository}.js`,
  pruebas unitarias e integración de conversion-moneda; CD-T07/T08 convertidos a pruebas reales. `src/core/` intacto.
- **Verificación:** `bash init.sh` completo verde; 340 pruebas, 0 todo.
  Una ejecución del leader dio 1 fallo en idempotencia y fallos erráticos en otras suites por una ejecución
  concurrente sobre la BD de pruebas (`globalSetup` hace `DROP SCHEMA`); repetida sin concurrencia → verde.
- **Veredicto:** APROBADO CON OBSERVACIONES (`progress/review_11.md`).
- **Pendiente de decisión humana (no bloqueante):**
  - CM-R02: confirmar que "vigente" se mide con `now()` de PostgreSQL (reloj de la BD).
  - CM-R03/R10: tipos de cambio de EJEMPLO `[POR ACORDAR]` en `db/11-conversion-moneda.sql`; definir fuente real
    y si esas filas deben quedar en producción.
- **Arrastrar:** `conversion-moneda/index.js:40` asume `deposito.extensiones` siempre presente (garantizado hoy por SPEC-07).
- **Cierre:** feature 11 `done`. Próximo: SPEC-12 (alerta UIF).

## 2026-11-02 — Feature 12: alerta-uif (SPEC-12)
- **Agentes:** leader → desarrolladorback → tester → revisor.
- **Cambios:** `db/12-alerta-uif.sql`, `src/modules/alerta-uif/{index,repository}.js`, pruebas unitarias e
  integración de alerta-uif. `src/core/` intacto.
- **Verificación:** `bash init.sh` completo verde (leader, final): 355 pruebas, 0 todo; alcance OK (170 archivos).
- **Veredicto:** APROBADO CON OBSERVACIONES (`progress/review_12.md`).
- **Pendiente de decisión humana (no bloqueante):**
  - UIF-R04: qué hacer si `UIF_UMBRAL_*` no es numérico (hoy lanza y lo captura el pipeline). ¿Validar en `config.js`?
- **Arrastrar:**
  - Inestabilidad de la suite con ejecuciones concurrentes: `tests/setup/globalSetup.js` regenera
    `tests/.tmp/*.pem` y hace `DROP SCHEMA`; dos jest a la vez → 401 / fallos erráticos. Valorar aislar
    `tests/.tmp` y la BD por ejecución. Visto en SPEC-11 (leader) y SPEC-12 (revisor); sin concurrencia, verde.
  - Subagentes dejaron tareas en segundo plano (python/node colgados); pedirles siempre primer plano.
- **Cierre:** feature 12 `done`. **Todas las features (0–12) en `done`.**

## Pendientes de decisión humana (acumulados al cierre del 2026-11-02)
1. Body > 100 kb → hoy 500 `ERROR_INTERNO` (DOM-R07). ¿400/413? (SPEC-06)
2. LC-T05 "billetera no llamada" vs RD-R04: aclarar redacción ("sin acreditación"). (SPEC-10)
3. Valores reales de `[POR ACORDAR]`: límites por canal (SPEC-10) y tipos de cambio y su fuente (SPEC-11).
4. CM-R02: confirmar "vigente" con `now()` de la BD. (SPEC-11)
5. UIF-R04: validación de umbrales no numéricos. (SPEC-12)
6. Commits de SPEC-09..12 pendientes (no se hicieron en esta sesión).

## 2026-11-02/03 — Retrabajo: integración con Billetera USD (rama `inte_biUsd`)
- **Origen:** el humano aprobó SPEC-02 v2.0 (billetera PEN propuesta + Billetera USD, contrato
  `docs/referencia/Billetera_USD_openapi.yaml` v1.1.0) y los cambios en 00, 01, 07, 08, 09. Nuevo estado
  `reabierta` + campo `retrabajo` en el arnés (AGENTS.md §5).
- **Ramas:** `main` se reseteó a `fba344d` (pre-USD) por orden del humano. El trabajo de un compañero
  (`codigo/`, fuera del alcance de init.sh, 28/374 pruebas rojas) quedó en la rama `Busti`; se usó como
  referencia descartando sus defectos (`armarContexto` sin logger/db, `montoValido` con `decimalPlaces()`,
  regex UUID con `/i`).
- **Features y commits:**
  | Spec | Agentes | Commit |
  |---|---|---|
  | 00 config `BILLETERA_USD_*` | dev → tester → revisor | `12f2b19`, `36fc622` |
  | 01 `cuenta_destino VARCHAR(36)` | dev → revisor | `a70dd04` |
  | 02 billeteras PEN/USD, enrutamiento, mock, INT-T08..T15 | dev → tester → revisor ✗ → tester → revisor | `fc01ac7` |
  | 03 solo pruebas (datos v2.0) | tester → revisor | `58d8e0a` |
  | 07 RD-R02/R08/R11, RD-T13..T18 | dev → tester → revisor | `c3af846` |
  | 08 CD-T10..T13 | tester → revisor | `e4f8fac` |
  | 09 HD-R01, HD-T09..T12 | dev → tester → revisor | `fc9430f` |
  | 11 solo pruebas; CM-R03 PEN→USD de `todo` a real | tester → revisor | `7539b67` |
  | 12 solo pruebas | tester → revisor | `cec77a2` |
- **Rechazo único:** SPEC-02 por un deadlock preexistente en `registrar.test.js` (auditoría `res.on('finish')`
  vs `TRUNCATE`); corregido esperando la auditoría antes de limpiar.
- **Verificación final:** `bash init.sh` (leader) 409/409, 0 todo; 13 features `done`; campo `retrabajo` retirado.
- **Pendientes de decisión humana (Billetera USD, `[POR ACORDAR]` de SPEC-02):**
  1. ¿`POST /api/v1/depositos/usd` deja el depósito `COMPLETADO` en la misma petición? (hoy otro estado → 502).
  2. Mapeo `metodo_origen` por canal (VENTANILLA/AGENTE → EFECTIVO, APP → TRANSFERENCIA).
  3. Billetera USD no expone estado: hoy toda billetera existente se trata como `ACTIVA`.
  4. Autenticación entre servicios (`BILLETERA_USD_TOKEN` opcional).
- **Arrastrar:** el mock `billetera-mock` con rutas USD no se probó levantado con docker (solo por lectura y nock).
  Un revisor borró `node_modules` al quitar un worktree con unión; se restauró con `npm ci`. No usar uniones.

## 2026-11-06/09 — Retrabajo: Billetera USD v1.2.0 (rama `inte_biUsd`)
- **Origen:** contrato `docs/referencia/Billetera_USD_openapi_v1.2.0.yaml` (OAuth, `Wallet.estado`, 202 VALIDADO, 422 de
  negocio, `canal`). Propuesta `docs/propuesta-billetera-usd-v1.2.md`; D1, D2, D3 aprobadas; Q2, Q3, Q13 (`POST
  /depositos/usd` abona la billetera) y Q14 (cuenta USD = billetera del cliente, sin `cuenta_destino_id`) resueltas por
  el humano. El humano promovió `docs/specs-propuestas/` a `specs-v2/` y regeneró el hash.
- **Corrección de spec en curso:** contradicción RD-T22 vs INT-R05/RD-R13 (replay FALLIDO en la reconciliación).
  Decisión humana: nuevo resultado `RECHAZADO` (02 v2.2, 07 v2.2). En la misma edición: transición Q7 = sin
  `BILLETERA_USD_TOKEN_URL`; un 401 descarta el token OAuth guardado, un 403 no.
- **Features (todas dev → tester → revisor salvo indicación):**
  | Spec | Versión | Veredicto | Notas |
  |---|---|---|---|
  | 00 | 1.3 | APROBADO | OAuth USD y `RECONCILIACION_*` en config |
  | 01 | 1.2 | APROBADO | `titular_id`, DOM-T09 |
  | 02 | 2.1 → 2.2 | APROBADO (2 pasadas) | OAuth, estados, `ACREDITADO/PENDIENTE/RECHAZADO`, mock v1.2.0, INT-T15..T19 |
  | 06 | 1.2 | APROBADO | `server.js` arranca `reconciliacion.iniciar()` |
  | 07 | 2.2 | APROBADO CON OBS. | 202, 422 `CUENTA_INACTIVA`, reconciliación RD-R13, RD-T19..T24 |
  | 08 | 1.3 | APROBADO | sin cambios de código; CD-T14, CD-T15 |
  | 11 | 1.2 | APROBADO | D1: sin conversión hacia USD; CM-T09 |
  | 12 | 1.3 | APROBADO | sin dev (UIF-R01 lo cumple el pipeline); pruebas con reconciliación |
- **Incidencias de orden:** el leader adelantó 07 antes que 06 y `.harness/validar-features.js` lo rechazó (una
  `in_progress` exige dependencias `done`; `reabierta` solo vale para dependientes ya `done`). Por decisión del humano
  se hizo 06 primero; el tester de 07 se adelantó porque la cobertura de ramas (75 %) no dejaba cerrar 06. Ajustes
  transitorios en `registrar-deposito/service.js` y pruebas de 07/11 durante 02, ya sustituidos.
- **Verificación final:** `bash init.sh` (leader) 494/494, 0 todo; 13 features `done`; campo `retrabajo` retirado.
  Sin commits en esta sesión (cambios de `specs-v2/`, código y pruebas sin commitear en `inte_biUsd`).
- **Pendientes de decisión humana / arrastrar:**
  1. ~~Deadlock intermitente en `TRUNCATE` de `limpiar()`.~~ **Resuelto 2026-11-09** (ver abajo).
  2. RD-R13: lote fijo 50 (¿variable en SPEC-00?) y `FOR UPDATE` durante HTTP (ocupa conexión; bloquea INSERT de
     auditoría con FK). Alternativa `FOR NO KEY UPDATE SKIP LOCKED` (cambio de RD-R13).
  3. La reconciliación arranca aunque `registrar-deposito` esté inactivo en el manifest (PIP-R12 lo exige así).
  4. Billetera USD debe implementar Q13 (abono en `/depositos/usd`) y corregir la descripción de `cliente_id`; Q7,
     Q8, Q9 (URL de tokens), Q10, Q11, Q12 siguen abiertas.
  5. ~~Volumen Postgres de docker existente.~~ Recreado el 2026-11-09 (compose local; kind no).
  6. `src/server.js` ignora `SIGTERM` (pod muere a los 30 s en kind) y no tiene prueba directa.
  7. `tests/helpers/tokens.js`: añadir `usr-bloqueada`/`usr-cerrada` o un `token(usuario, { roles })`.
  8. Commits del retrabajo pendientes.

## 2026-11-09 — Mantenimiento: deadlock intermitente en `limpiar()` (`TRUNCATE`)
- **Agente:** tester (sin feature reabierta). Informe: `progress/deadlock_truncate.md`.
- **Causa:** INSERT de auditoría en vuelo (AUD-R03, `res.on('finish')`) que valida su FK contra `depositos` mientras el
  `TRUNCATE` de la prueba siguiente bloqueaba `depositos` antes que `auditoria_depositos` (orden de `pg_tables` sin
  `ORDER BY`, variable entre corridas). Reproducido con una prueba temporal (13/200 iteraciones); `src/` sin defecto.
- **Cambio:** solo `tests/helpers/db.js`: `TRUNCATE` en orden hijas-primero (topológico por FKs) y espera acotada
  (5 s) a que no quede trabajo vivo en el pool ni en `pg_stat_activity`.
- **Verificación:** 0/600 iteraciones con deadlock; 6/6 `init.sh` completos en verde (tester) + 1 (leader), 494/494.
- **Recordatorio:** no correr dos `init.sh` a la vez contra la misma BD.
- Docker compose recreado (`down -v` + `up -d --build`): `depositos.titular_id` presente; pendiente 5 resuelto en local.

## 2026-11-10 — SPEC-13 ci-cd (rama `ci-cd`)
- **Origen:** PR #2 fusionado en `main`. El humano decide: este repo solo prueba, publica en GHCR y avisa al integrador
  (`abigailDurand/Deposito-integrador-`), que despliega en Kubernetes. Propuesta `docs/specs-propuestas/13-ci-cd.md`
  promovida por el humano; feature 13 añadida (depende de 0, 5, 6, 7).
- **Agentes:** desarrolladorback → tester → revisor APROBADO (`progress/impl_13.md`, `tests/reporte.md`, `progress/review_13.md`).
- **Archivos:** `.github/workflows/ci.yml` (verificar / publicar en `ghcr.io/abigaildurand/deposito-service` / avisar por
  `repository_dispatch`), `scripts/migrar.js` + `npm run migrar`, `db/*.sql` idempotentes, apagado limpio en
  `src/server.js` + `detener()` de reconciliación y `limpiarClaves`, `APAGADO_TIMEOUT_MS`, `Dockerfile` con `scripts/` y `db/`.
- **Pruebas:** CI-T01..T07; `bash init.sh` 507/507, 0 todo. `actionlint` sin errores; actions fijadas por SHA (verificadas).
- **Pendientes:** secreto `ORQUESTADOR_TOKEN` (fine-grained PAT, Contents R/W en el integrador); el integrador debe
  montar en el Job de migración el mismo ConfigMap/Secret que el Deployment; `imagePullSecret` si el paquete GHCR es
  privado; `.env` local sin `BILLETERA_USD_URL`. Obs. no bloqueante: la imagen incluye todo `scripts/`.

## 2026-11-12 — Aviso al integrador funcionando
- `ORQUESTADOR_TOKEN` corregido por el humano (antes HTTP 403 por permisos). Run 42903146041 verde; el integrador
  fijó `services-config/deposito-service/version.env` = `8c5bba6` (run 43131884197).
- Decisión del humano: este servicio (PEN+USD) se queda como `deposito-service`; `depositos-pen/` y `depositos-usd/`
  son de otro equipo y no se tocan. README del integrador: PR abigailDurand/Deposito-integrador-#1.
- Pendiente: el integrador aún no despliega (compose y `kubernetes/` vacíos).
