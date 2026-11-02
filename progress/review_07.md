# Review — SPEC-07 registrar-deposito

- **Revisor** · 2026-11-02 · Feature 7 (`registrar-deposito`).

**Veredicto:** APROBADO CON OBSERVACIONES

## Alcance (§2)

- [x] Solo se crearon los 6 archivos de `src/modules/registrar-deposito/` y las 2 pruebas del §2.
  `git status` no muestra cambios en `src/core/`, `db/` ni infraestructura (PRY-R05). Las pruebas de
  `tests/integration/{seguridad,auditoria,idempotencia}` cambiaron solo para convertir los `test.todo`
  que esperaban SPEC-07 (permitido por SPEC-00 §6).

## Reglas

- [x] PRY-R01 — `routes.js:12-17` → `controller.js` → `service.js` → `repository.js` / `core/clients/billeteraClient`. Sin saltos.
- [x] PRY-R02 — `controller.js:8-20`: valida con el schema, llama al service, asigna `res.locals.depositoId`, responde 201. La bifurcación `registrar`/`reintentar` (`controller.js:12-15`) es la del diagrama §3 (`registrar(datos) o reintentar(depositoIdPrevio)`), no lógica de negocio.
- [x] PRY-R03 — `service.js` no tiene SQL ni HTTP; el SQL está solo en `repository.js`.
- [x] PRY-R04 / RD-R10 — `service.js:6-13` solo importa `../../core/*` y `./repository`. Grep de `limite|conversion|uif` en `src/modules/` → 0 resultados.
- [x] PRY-R05 — `src/core/` sin cambios (git). Grep de `registrar-deposito` en `src/core/` → 0.
- [x] PRY-R06 / RD-R03 — `service.js:18-23` `new Decimal(texto)` como primer paso de `registrar` (`service.js:74`); `repository.js:21,23` guarda `toFixed(2)`; `depositoDesdeFila` (`service.js:40,45`) vuelve a `Decimal`; `billeteraClient.acreditar` recibe `Decimal`. Grep de `Number(`, `parseFloat`, `parseInt` en `src/modules/` → 0.
- [x] PRY-R07 — `schema.js:9` `z.enum(['PEN','USD'])`; más de 2 decimales → 422 (`service.js:20-21`).
- [x] PRY-R08 — `repository.js:12-29, 34, 43-48`: todo con `$1..$9`. Los template strings de `repository.js:41,50` son mensajes de `Error`, no SQL.
- [x] PRY-R09 — sin URLs ni secretos en el módulo (grep `http://`, `https://` → 0).
- [x] PRY-R10 — el módulo no loguea; el logger de contexto es `logger.child({ correlationId })` (`service.js:31`). Sin `console.*`.
- [x] PRY-R11 — no aplica (no hay `[POR ACORDAR]` en SPEC-07).
- [x] PRY-R12 — `specs-v2/` intacto (hash OK en `init.sh`). Las 5 decisiones se reportaron en `impl_07.md` (ver abajo).
- [x] RD-R01 — `schema.js:6-12` `.strict()`; `controller.js:9-10` `safeParse` → `FORMATO_INVALIDO` 400.
- [x] RD-R02 — `schema.js:7-11`: regex de cuenta y monto exactos de la spec, enums, `referencia` `min(1).max(140).optional()`.
- [x] RD-R03 — ver PRY-R06. `"0"`, `"-1"`, `"10.001"` → 422 probados.
- [x] RD-R04 — `service.js:73-112` sigue el diagrama: monto → `consultarCuenta` (null/no ACTIVA → 422) → `verificarCanal` + `verificarTitular` → validadores → transformadores → `monedaAcreditar ≠ cuenta.moneda` → TX (`insertar` + `persistirTransformadores`) → PENDIENTE→PROCESANDO → `acreditar` → COMPLETADO + post-procesos | FALLIDO + 502 `{ depositoId }`. Nada se escribe antes de `db.enTransaccion` (`service.js:105`). Probado paso a paso en `tests/unit/registrar-deposito/service.test.js:197`.
- [x] RD-R05 — `service.js:84-95` con exactamente los campos de SPEC-06 §4 e `id = crypto.randomUUID()`; `contexto` en `service.js:26-34` (`privado` y logger por módulo los pone `pipeline.contextoDe`).
- [x] RD-R06 — `repository.js:39-53`: `UPDATE ... SET estado=$3, actualizado_en=now() WHERE id=$1 AND estado=$2`; 0 filas → `Error` (500); transiciones fuera de SPEC-01 rechazadas antes de consultar (`repository.js:4-8, 40-42`). Probado con BD real (`registrar.test.js:446`).
- [x] RD-R07 — `service.js:105-108`: `insertar` y `persistirTransformadores` dentro de `enTransaccion`; si lanza, no se llega a `acreditar`. Probado con rollback real (`registrar.test.js:430`: 0 filas, billetera sin llamar, 500).
- [x] RD-R08 — `service.js:115-131`: COMPLETADO → se devuelve; FALLIDO → `FALLIDO→PROCESANDO` y acredita `monto_acreditar`/`moneda_acreditar` sin `consultarCuenta` ni validadores/transformadores; post-procesos con `contexto.cuenta = null`; otro estado → 409 `SOLICITUD_EN_PROCESO`.
- [x] RD-R09 — `service.js:65,69`: `aJson(fila RETURNING *, deposito.extensiones)`; reintento con `pipeline.leerExtensiones` (`service.js:126`).
- [x] RD-R10 — ver PRY-R04.
- [x] Contrato §5 — `POST /api/v1/depositos`, 201 con el cuerpo exacto de §5 (`registrar.test.js:118-129`), errores 400/403/409/422/502 con sus códigos del catálogo.

### Arrastres de `progress/history.md`

- [x] `res.locals.depositoId` solo con fila existente — `controller.js:18` solo tras volver el service (fila COMPLETADA); en el 502 lo pone `manejadorErrores` desde `ErrorApp('BILLETERA_NO_DISPONIBLE', { depositoId })` (`service.js:63`), que solo se lanza tras el INSERT; el 409 del reintento (`service.js:120`) lleva un id leído de la BD. Los errores previos a la TX no llevan `depositoId` (AUD-T02 lo verifica: `deposito_id` nulo).
- [x] Mismo objeto `contexto` (PIP-R07) — `service.js:97` se crea una vez y se pasa a `ejecutarValidadores` (99), `ejecutarTransformadores` (100), `persistirTransformadores` (107) y `ejecutarPostProcesos` (67). Probado en `service.test.js:209`.
- [x] `requiereRol('CLIENTE','AGENTE','CAJERO')` antes de `idempotencia` — `routes.js:14-15`.
- [x] `verificarCanal` + `verificarTitular` justo tras consultar la cuenta — `service.js:80-81`. SEG-T06 real (403, sin acreditación, 0 filas, auditoría `ERROR_403`).
- [x] `test.todo` convertidos en pruebas reales: SEG-T06 (`seguridad.test.js:231`), AUD-T01/T02/T04 (`auditoria.test.js:115,137,158`), IDE-T02..T08 y IDE-T10 (`idempotencia.test.js:213-377`). `grep test.todo tests/` → solo menciones en `reporte.md`, ninguna prueba.

## Decisiones de `impl_07.md`

1. **`"10.100"` → 422 (decimales contados sobre el string).** Aceptable: es la lectura literal de RD-R03 ("con más de 2 decimales") y del catálogo `MONTO_INVALIDO`. Es coherente con AUD-R07, que con `\.\d{1,2}` tampoco considera válido `"10.100"` (lo audita con `monto` nulo), y con §6 del front ("monto con 2 decimales"). Es además la opción conservadora: rechazar no puede producir un depósito incorrecto. Aun así, la spec no lo dice explícitamente y la alternativa (`decimalPlaces()` → aceptar `"10.100"`) también es defendible, así que **se escala al humano para confirmarlo** (observación 1). No bloquea.
2. **`leerExtensiones` antes de `FALLIDO→PROCESANDO`.** Aceptable. RD-R08/R09 no fijan el orden y esta opción evita acreditar con la clave borrada (doble acreditación). Probado (`service.test.js:328`).
3. **El controller elige `registrar`/`reintentar` según `req.idempotencia?.depositoIdPrevio`.** Aceptable: es la flecha `Ctrl->>Svc` del diagrama §3 y el campo que define IDE-R06.
4. **Un error de `acreditar` que no es `ErrorApp` se relanza (500).** Aceptable: `billeteraClient.llamar` (`src/core/clients/billeteraClient.js:40-47`) convierte toda excepción de axios en `ErrorApp`, así que la rama es inalcanzable con el client real. Ver observación 3.
5. **`reintentar` con id inexistente → `Error` (500).** Aceptable: la FK `claves_idempotencia.deposito_id → depositos(id)` lo hace imposible.

## Casos de prueba

- [x] RD-T01 … RD-T12 (12/12 reales). Integración con PostgreSQL real + nock en `tests/integration/registrar-deposito/registrar.test.js`; unitarias en `tests/unit/registrar-deposito/service.test.js`. Todas comprueban resultados concretos (status, código, cuerpo exacto, filas en BD, cuerpo recibido por billetera, estado de la clave).
- [x] Arrastres: SEG-T06, AUD-T01, AUD-T02, AUD-T04, IDE-T02..T08, IDE-T10 reales.
- [x] Feature ACTIVA/INACTIVA con manifest a medida (`registrar.test.js`: inactiva → 404 `RUTA_NO_ENCONTRADA`).
- Nota: RD-T08 e IDE-T07 no miden el tiempo real (nock adelanta el `timeout` del socket); verifican el 502 y el FALLIDO. Aceptable y documentado en `tests/reporte.md`.

## Checkpoints

- C1: [x] arnés completo, 4 agentes, `bash init.sh` EXIT=0.
- C2: [x] una sola feature `in_progress` (7) con dependencias 1..6 `done`; `progress/current.md` describe la sesión activa.
- C3: [x] `specs-v2/` intacto; alcance OK (129 archivos); ningún archivo de specs `pending`; `src/core/` sin cambios.
- C4: [x] PRY-R01..R04, R06/R07, R08, R09/R10 y RD-R03, RD-R04, RD-R06, RD-R10 verificados arriba.
- C5: [x] todos los `XX-Tnn` de SPEC-00..07 con prueba (`init.sh`); integración con PostgreSQL real y nock; feature probada ACTIVA e INACTIVA; cobertura `src/modules/` 100 % y `src/core/` 98,93 % stmts / 92,98 % branches; `tests/reporte.md` § SPEC-07 lista cubiertos, todo (ninguno) y fallidos (ninguno).

## Observaciones (no incumplen reglas de spec)

1. **Para el humano — decisión 1.** `src/modules/registrar-deposito/service.js:20` rechaza `"10.100"` con 422 `MONTO_INVALIDO` (cuenta decimales del string). Confirmar que es la interpretación deseada de RD-R03 / PRY-R07; si se prefiere aceptar ceros finales, requiere aclarar la spec. Además, la decisión no tiene prueba: agregar en una próxima pasada del tester un caso `"10.100"` → 422 en `tests/unit/registrar-deposito/service.test.js` para fijar el comportamiento.
2. **Para el humano — riesgo operativo (fuera de spec).** Si `acreditar` tiene éxito pero `cambiarEstado(PROCESANDO→COMPLETADO)` (`service.js:65`) lanza (BD caída), sale 500, IDE-R08 borra la clave y el depósito queda en PROCESANDO; un reintento del cliente con la misma clave crea un depósito nuevo con otro `depositoId` y billetera acreditaría dos veces. RD-R06 exige justamente el 500, así que no es un incumplimiento; es análogo al riesgo conocido IDE-R10 y conviene documentarlo en la spec.
3. `service.js:61` — rama defensiva inalcanzable con el client actual (decisión 4); si alguna vez se alcanzara, el depósito quedaría en PROCESANDO. Sin cambio requerido.
4. `service.js:120` — el 409 `SOLICITUD_EN_PROCESO` del reintento sale con status < 500 y IDE-R08 lo guarda como `TERMINADO`, de modo que esa clave respondería 409 para siempre. Solo pasa si una clave `REINTENTABLE` apunta a un depósito que no está FALLIDO, cosa que el flujo actual no produce. Sin cambio requerido.
5. `tests/reporte.md` § SPEC-03/04/05 aún listan SEG-T06, AUD-T01/T02/T04 e IDE-T02..T10 como `todo`; la tabla vigente es la de § SPEC-07. Conviene que el tester las actualice al cerrar.

## Cambios requeridos

Ninguno.

## Salida de `bash init.sh` (completo, PostgreSQL arriba)

```
[OK]    specs-v2/ intacto (15 archivos)
[OK]    feature_list.json válido (13 features: pending=5 in_progress=1 done=7 blocked=0)
[OK]    SPEC-00 … SPEC-07: todos sus casos tienen prueba
[OK]    Alcance de archivos correcto (129 archivos revisados)
PASS integration tests/integration/idempotencia/idempotencia.test.js
PASS integration tests/integration/registrar-deposito/registrar.test.js
PASS integration tests/integration/auditoria/auditoria.test.js
PASS integration tests/integration/seguridad/seguridad.test.js
PASS integration tests/integration/pipeline-y-cargador/app.test.js
PASS integration tests/integration/dominio/transaccion.test.js
All files                   |   99.59 |    94.53 |   98.91 |   99.77 |
 modules/registrar-deposito |     100 |      100 |     100 |     100 |
Test Suites: 14 passed, 14 total
Tests:       234 passed, 234 total
[OK]    Todas las pruebas en verde (unitarias + integración)
[OK]    Entorno listo. Puedes empezar a trabajar.
EXIT=0
```

### Tras marcar la feature 7 como `done`

```
[OK]    feature_list.json válido (13 features: pending=5 in_progress=0 done=8 blocked=0)
Test Suites: 14 passed, 14 total
Tests:       234 passed, 234 total
[OK]    Entorno listo. Puedes empezar a trabajar.
EXIT=0
```
