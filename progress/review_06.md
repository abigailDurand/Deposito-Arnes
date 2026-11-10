# Review — SPEC-06 pipeline-y-cargador

**Veredicto:** APROBADO CON OBSERVACIONES

- **Revisor** · 2026-11-02 · `bash init.sh` completo con PostgreSQL real: verde (12 suites, 177 passed + 12 todo).

## Alcance (§2)

- [x] Código: `src/core/pipeline.js`, `src/core/cargador.js`, `src/app.js`, `src/server.js` — todos del §2.
- [x] Pruebas: `tests/core/pipeline.test.js`, `tests/core/cargador.test.js` (§2), `tests/core/fixtures/**`
  (permitido por SPEC-06 §6), `tests/integration/pipeline-y-cargador/app.test.js` (SPEC-00 §6).
- [x] `tests/core/proyecto.test.js`: solo PRY-T01 pasa de `test.todo` a prueba real (lo exigía SPEC-00 §6 4 / acceptance de la feature 0).
- [x] `.harness/alcance.js` OK (119 archivos), `specs-v2/` intacto.

## Reglas

- [x] PRY-R01..R03 — `src/core/` no tiene capas de feature; `app.js` solo monta middlewares y routers.
- [x] PRY-R04/R05 — `pipeline.js` y `cargador.js` no nombran ninguna feature (Grep de `registrar|consultar|historial|limites|conversion|alerta|uif` → 0 coincidencias). Solo tipos genéricos (`pipeline.js:8-12`, `cargador.js:9`). La única ruta a módulos es `src/modules/<id>` (`cargador.js:8,18`).
- [x] PRY-R06/R07 — no se maneja dinero; Grep `Number(`/`parseFloat` → 0 en los 4 archivos.
- [x] PRY-R08 — no hay SQL en los archivos de la spec.
- [x] PRY-R09 — `app.js:20` usa `config.trustProxy`; `server.js:21,24` usa `config.manifestPath` y `config.port`. Grep `http://` → 0.
- [x] PRY-R10 — `pipeline.js:59-62` (`datosDelError`) solo loguea `message` y `code`, no el error completo. Grep `console.log` → 0 (código y pruebas).
- [x] PRY-R11 — no aplica (sin `[POR ACORDAR]` en SPEC-06).
- [x] PRY-R12 — `specs-v2/` intacto (hash OK).
- [x] PIP-R01 — `pipeline.js:65-69`: bucle con `await`, sin `try`; el error sale intacto (PIP-T03 comprueba código, status y mensaje).
- [x] PIP-R02 — `pipeline.js:72-87`: cadena `actual = await ejecutar(actual, …)`; error → `ErrorApp('ERROR_INTERNO')` (500).
- [x] PIP-R03 — `pipeline.js:90-96`: solo transformadores con `persistir`, sin `try` → propaga.
- [x] PIP-R04 — `pipeline.js:99-113`: `try/catch` por post-proceso, `logger.error` con `depositoId`, nunca lanza.
- [x] PIP-R05 — `pipeline.js:116-125`: omite `null` (y `undefined`).
- [x] PIP-R06 — huecos vacíos: bucles sin iteraciones; transformadores devuelven el mismo `deposito`.
- [x] PIP-R07 — `pipeline.js:38-57`: `privado` por (contexto, id) en `WeakMap`; `logger.child({ correlationId, modulo: id })`. Ver observación 2.
- [x] PIP-R08 — `cargador.js:79-86`: filtro `estado === 'activo'` antes de `require`; `orden` del manifest; inserción estable (`pipeline.js:26-34`).
- [x] PIP-R09 — `cargador.js:17-30` (carpeta inexistente, distingue `MODULE_NOT_FOUND` interno) y `:46-51` (tipo distinto). `crearApp` llama a `cargar` antes de crear la app (`app.js:16`). Verificado en Docker: con el manifest real `server.js` sale con `logger.fatal` y exit code 1.
- [x] PIP-R10 — `cargador.js:89-95`: `registrarErrores` una vez por objeto `errores` (`WeakSet`), atiende la observación de review_01.
- [x] PIP-R11 — `app.js:19-36`, orden exacto: `trust proxy` (l.20) → `correlationId` (l.21) → `auditoria` (l.23) → `GET /health` (l.25) → `autenticar` (l.28) → `express.json({ limit: '100kb' })` (l.29) → routers en `/api/v1` (l.30-32) → 404 `RUTA_NO_ENCONTRADA` (l.33-35) → `manejadorErrores` (l.36).
- [x] PIP-R12 — `crearApp` no inicia tareas ni hace `listen`; `server.js:23` llama a `limpiarClaves.iniciar()` (prueba con `jest.spyOn` en `cargador.test.js:234`).
- [x] §5 — 404 con `{ codigo: 'RUTA_NO_ENCONTRADA', mensaje: 'La ruta no existe.', correlationId }` exacto (PIP-T10 lo compara con `toEqual`).

## Arrastres hacia SPEC-06 (`progress/history.md`)

- [x] SPEC-03 → orden PIP-R11 (`correlationId` primero, `autenticar` después de `/health`): `app.js:21-28`; probado por PRY-T01 (sin token → 200 con `X-Correlation-Id`), PIP-T10 y `cargador.test.js:172` (sin token → 401 antes del 404).
- [x] SPEC-04 → `req.ip` con `X-Forwarded-For` y `trust proxy`: `tests/integration/pipeline-y-cargador/app.test.js` con PostgreSQL real: `X-Forwarded-For: 198.51.100.1, 203.0.113.7` → `ip = 203.0.113.7` en `auditoria_depositos`; sin cabecera → loopback; auditoría antes de `autenticar` (fila `ERROR_401`) y `express.json` antes del 404 (fila con `canal` y `monto`).
- [x] SPEC-00/02 → `docker compose up --build`: imágenes `deposito-service` y `billetera-mock` construidas. Con un manifest con features `inactivo` (montado desde fuera del repo, `MANIFEST_PATH`), `deposito-service` arranca junto a `db` y `billetera-mock`: `GET /health` → 200 `{"estado":"ok"}` con `X-Correlation-Id`; `/api/v1/x` sin token → 401 `TOKEN_REQUERIDO`; con un token falso → 401 `TOKEN_INVALIDO`. Con el manifest real sale con exit 1 (PIP-R09, correcto mientras `src/modules/` no exista). Ver observación 4.
- [x] SPEC-01 → `crearApp` varias veces no re-registra códigos (PIP-R10, arriba).

## Decisiones de `progress/impl_06.md`

- Validaciones extra de `cargar` (manifest sin `features`, id vacío/repetido, tipo desconocido, extensión sin `orden`, id exportado ≠ manifest, endpoint sin `router`, extensión sin `ejecutar`, validador con status ≠ 422): **aceptables**. Hacen cumplir el contrato de módulo de §4 y PIP-R09 («la app no arranca»); no agregan reglas de negocio y el manifest real las cumple todas.
- Id con separadores (`../core`) tratado como inexistente: **aceptable** (evita `require` fuera de `src/modules/`).
- Pipeline como singleton de proceso, reiniciado en cada `cargar`: **aceptable**; ver observación 3.
- Logs del pipeline sin el error completo (PRY-R10): **aceptable**.
- Ninguna decisión del implementador necesita escalarse. Se escala al humano solo la observación 1.

## Casos de prueba

- [x] PIP-T01 … PIP-T10 (10/10 reales; resultados concretos: orden de llamadas, identidad de objetos, cuerpo exacto del 404, flag de `require` con control positivo en PIP-T09).
- [x] PRY-T01 (SPEC-00) convertido de `test.todo` a prueba real.
- [x] Pruebas extra por regla PIP-R02, R03, R07, R08, R10, R11, R12 y contrato §4.
- `test.todo` de SPEC-06: ninguno. Los que quedan (SEG-T06, AUD-T01/T02/T04, IDE-T02..T08/T10) esperan SPEC-07.

## Checkpoints

- C1: [x] — arnés completo, 4 agentes, `bash init.sh` exit 0.
- C2: [x] — una sola feature `in_progress` (6) antes de este cierre; dependencias 1, 3, 4 en `done`; `progress/current.md` describe la sesión.
- C3: [x] — `specs-v2/` intacto; alcance OK (119 archivos); nada de specs `pending`; no aplica PRY-R05 a extensiones (aún no existen).
- C4: [x] — PRY-R01..R10 y PIP-R11 / "no nombran features" verificados arriba.
- C5: [x] — PIP-T01..T10 con prueba cuyo nombre empieza por su id; integración contra PostgreSQL real; cobertura `src/core/` 98,93 % stmts / 92,98 % branches (global 99,49 / 93,72); `tests/reporte.md` § SPEC-06 lista cubiertos, todo y fallidos.

## Observaciones (no incumplen reglas de spec)

1. **Para el humano.** `src/core/middlewares/manejadorErrores.js:24-30` + `src/app.js:29` — un body > 100 kb (`entity.too.large`) responde 500 `ERROR_INTERNO`. Es lo que DOM-R07 dicta literalmente («cualquier otro error → 500»), pero un 500 para un error del cliente es discutible y 413 no está en el catálogo de SPEC-01. La prueba `cargador.test.js:217` solo exige status ≥ 400. Decidir si se agrega a la spec (p. ej. 400 `FORMATO_INVALIDO` o un 413 nuevo); no se toca sin cambio de spec.
2. **Arrastre a SPEC-07.** `src/core/pipeline.js:38-48` (PIP-R07): el `privado` se asocia a la identidad del objeto `contexto`. El service de registro debe pasar **el mismo objeto `contexto`** a `ejecutarTransformadores` y a `persistirTransformadores`; si crea uno nuevo, `persistir` recibe un `privado` vacío.
3. **Arrastre a SPEC-07..12.** `src/core/pipeline.js:14` es un singleton de proceso: la última llamada a `crearApp`/`cargar` define los huecos activos. Cada prueba ACTIVA/INACTIVA debe armar su app con su manifest dentro del propio test (o `beforeEach`), nunca reutilizar una app creada antes con otro manifest.
4. **Arrastre a SPEC-12 (cierre).** Criterio de SPEC-00 «`docker compose up` levanta el servicio» solo se cumple con el manifest real cuando existan los 6 módulos; quien cierre la última feature debe repetir `docker compose up --build` con `specs-v2/manifest.yaml`. Además, `docker-compose.yml` necesita un `.env` con `JWT_PUBLIC_KEY` y `BILLETERA_TOKEN` (no existe en el repo; correcto por PRY-R09).
5. `tests/reporte.md` § SPEC-00 sigue listando PRY-T01 como `todo` (el tester no la editó por ser de otra spec). Actualizarla en la próxima pasada del tester sobre SPEC-00 o al cerrar.

## Cambios requeridos

Ninguno.

## Salida de `bash init.sh`

```
[OK]    specs-v2/ intacto (15 archivos)
[OK]    feature_list.json válido (13 features: pending=6 in_progress=1 done=6 blocked=0)
[OK]    SPEC-06: todos sus casos tienen prueba
[OK]    Alcance de archivos correcto (119 archivos revisados)
PASS integration tests/integration/pipeline-y-cargador/app.test.js
PASS unit tests/core/cargador.test.js
PASS unit tests/core/pipeline.test.js
  cargador.js               |     100 |      100 |     100 |     100 |
  pipeline.js               |   98.18 |    78.57 |     100 |     100 | 54-80,106-120
All files                   |   99.49 |    93.72 |   98.76 |   99.72 |
Test Suites: 12 passed, 12 total
Tests:       12 todo, 177 passed, 189 total
[OK]    Todas las pruebas en verde (unitarias + integración)
[OK]    Entorno listo. Puedes empezar a trabajar.
```

---

## Retrabajo v1.2, 2026-11-09

**Veredicto:** APROBADO

Alcance: solo lo de SPEC-06 v1.2 (PIP-R12 y §4). El código de `src/modules/registrar-deposito/` (incluido
`reconciliacion.js`) es de SPEC-07 y no se aprueba ni se rechaza aquí.

### Reglas
- [x] PIP-R12 — `src/server.js:12` importa `./modules/registrar-deposito/reconciliacion`; `src/server.js:22-26` llama a
  `crearApp` → `limpiarClaves.iniciar()` → `reconciliacion.iniciar()` → `listen(PORT)`, el orden del texto de §2.
  `src/app.js` no cambió desde `016a2cc` y no inicia tareas; `tests/core/cargador.test.js:234-244` lo comprueba para
  las dos tareas (espía `limpiarClaves.iniciar` y `reconciliacion.iniciar`).
- [x] §4 `deposito.titularId` — `src/core/pipeline.js` no construye el depósito, lo pasa tal cual; sin cambios
  necesarios. `tests/core/pipeline.test.js` (`nuevoDeposito()`) ya incluye `titularId`.
- [x] §4 contexto de reconciliación — `src/core/pipeline.js:51-57` (`contextoDe`) hace `...contexto` y solo añade
  `logger`/`privado`, así que `usuario = { id, roles: [] }` y `cuenta = null` llegan intactos a los módulos.
- [x] PIP-R01..R11 — `pipeline.js`, `cargador.js` y `app.js` sin cambios (`git diff HEAD` vacío; último commit
  `016a2cc`). Siguen valiendo las verificaciones de la revisión anterior.
- [x] PRY-R05 — `src/core/` no cambió en este retrabajo. Grep de nombres de feature
  (`registrar-deposito|consultar-deposito|historial|conversion|alerta-uif|reconciliacion|comision`) en `src/core/`:
  0 coincidencias. Los cambios pendientes en `src/core/clients/billeteraClient.js` y `src/core/depositoMapper.js` son
  de SPEC-02/SPEC-01 (ya revisados en `review_02.md` / `review_01.md`), no de este retrabajo.
- [x] PRY-R04 — la referencia a un módulo está en `src/server.js` (punto de entrada, declarado en §2 de SPEC-06),
  no en `src/core/` ni en otro módulo.
- [x] PRY-R06/R08/R09/R10 — `src/server.js` no maneja dinero, SQL, secretos ni URLs; grep de `Number(`,
  `parseFloat`, `console.log`, `http://` en `server.js`, `app.js`, `pipeline.js`, `cargador.js`: 0 coincidencias.
- [x] PRY-R12 — `specs-v2/` intacto (hash OK).

### Decisión del dev: `reconciliacion.iniciar()` incondicional
**Correcta según la spec, no es una suposición.** §2 y PIP-R12 dicen sin condición que `server.js` llama a
`reconciliacion.iniciar()`; PIP-R08 restringe solo lo que `cargar(manifest)` hace `require`, no a `server.js`.
Añadir una condición sobre el manifest sí habría sido inventar comportamiento.
Observación para el humano (no bloquea, no incumple regla): con `registrar-deposito` `inactivo`, el proceso sigue
cargando `registrar-deposito/service.js` y la reconciliación sigue cerrando depósitos `PROCESANDO` contra la
billetera aunque no se puedan crear nuevos. Si eso no se desea, debe decirlo la spec (06 PIP-R12 o 07 RD-R13).

### Casos de prueba
- [x] PIP-T01..PIP-T10 (10/10 reales, sin cambios; `init.sh`: "SPEC-06: todos sus casos tienen prueba").
- [x] PIP-R12 (parte `crearApp`): `tests/core/cargador.test.js:234`, aserciones concretas `not.toHaveBeenCalled()`.
- Observación: `src/server.js` no tiene prueba directa (la spec no define un PIP-Tnn para él). Revisado a mano,
  `src/server.js:21-30`. No es un caso `XX-Tnn` exigido.

### Checkpoints
- C1: [x]  C2: [x] (1 `in_progress`; `current.md` describe la sesión)  C3: [x]  C4: [x]  C5: [x]
  (cobertura `src/core/` y `src/modules/` ≥ 80 %; `pipeline.js` 100 % stmts / 82.14 % branches;
  `modules/registrar-deposito` 100 % / 93.75 %; integración contra PostgreSQL real).

### Cambios requeridos
Ninguno.

### Salida de `bash init.sh` (completo, PostgreSQL real)
```
[OK]    specs-v2/ intacto (15 archivos)
[OK]    feature_list.json válido (13 features: pending=0 in_progress=1 done=8 blocked=0 reabierta=4)
[OK]    SPEC-06: todos sus casos tienen prueba
[OK]    SPEC-07: todos sus casos tienen prueba
[WARN]  SPEC-08 (reabierta) aún sin prueba: CD-T14, CD-T15
[WARN]  SPEC-11 (reabierta) aún sin prueba: CM-T09
[OK]    Alcance de archivos correcto (190 archivos revisados)
Test Suites: 23 passed, 23 total
Tests:       1 todo, 484 passed, 485 total
[OK]    Todas las pruebas en verde (unitarias + integración)
[OK]    Entorno listo. Puedes empezar a trabajar.
```
