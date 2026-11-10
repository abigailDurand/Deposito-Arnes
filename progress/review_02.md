# Review — SPEC-02 integraciones (RETRABAJO Billetera USD, spec v2.0)

**Veredicto:** APROBADO

**Revisor:** revisor · **Fecha:** 2026-11-03 (2ª revisión) · **Feature:** 2 (`integraciones`, `retrabajo: true`) · rama `inte_biUsd`
Sustituye al review anterior (2026-10-30, APROBADO CON OBSERVACIONES sobre la spec v1).

## Segunda revisión (2026-11-03)

El único cambio requerido de la 1ª revisión (deadlock en `registrar.test.js`) está corregido:

- `tests/integration/registrar-deposito/registrar.test.js:95-107` — `esperarAuditoria()` espera (pausas de 25 ms,
  tope 100 iteraciones) a que el pool de la app (`src/core/db`, `:8`, el mismo que usa `auditoria.js` en
  `res.on('finish')`) quede sin clientes en uso ni en espera (`waitingCount === 0 && totalCount === idleCount`) **y**
  a que `count(*)` de `auditoria_depositos` sea estable en 2 comprobaciones seguidas. `afterEach` (`:109`) es `async`
  y la espera antes de que el `beforeEach` siguiente haga el `TRUNCATE`. Condición basada en estado real del pool, no
  en un `sleep` fijo: correcto y determinista en la práctica.
- Ajuste coherente con SPEC-02 v2.0 §4 en la misma suite: `CUENTA_USD` → `CUENTA_AJENA` (`0011-0123-000002` es PEN de
  `usr-cliente-2`); la prueba `verificarTitular` (`:427-447`) ahora espera `moneda: 'PEN'`. No se tocó `src/` ni helpers.
- Verificación: `bash init.sh` completo 3 veces (1 en la exploración + 2 seguidas) → verde, `23 passed`, `1 todo,
  379 passed, 380 total`; la suite sola `npx jest tests/integration/registrar-deposito --runInBand` 3/3 en verde
  (22/22), sin `deadlock`.
- Observación (no bloquea, ninguna regla de spec): si se agota el tope de 100 iteraciones la función retorna sin
  fallar; y otras suites auditadas sin espera podrían sufrir el mismo choque. Solución general sugerida por el tester
  (esperar en `tests/helpers/db.js` `limpiar()`): queda para el líder.

El resto de la 1ª revisión se mantiene sin cambios.

## 1ª revisión (histórico)

**Motivo único del rechazo (1ª revisión, ya resuelto):** `bash init.sh` completo con PostgreSQL termina **rojo** en 3 de 3 corridas
(regla dura: no se aprueba con init.sh rojo). El código y las pruebas de SPEC-02 cumplen la spec; lo que falla
es una prueba de SPEC-07 por un deadlock de la BD (ver "Cambios requeridos"). No es un defecto de
`billeteraClient.js`: el mismo fallo se reproduce 3/3 con el árbol de `HEAD` (a70dd04, sin este retrabajo).

## Reglas

- [x] PRY-R01..R03 (capas) — `billeteraClient.js` vive en `src/core/clients/`, sin nombres de features; ningún módulo de `src/modules/` conoce rutas ni URLs de billetera (grep `wallets|depositos/usd|billeteraUsd` en `src/`: solo `config.js` y el cliente).
- [x] PRY-R06 — montos con `new Decimal(monto).toFixed(2)` (`billeteraClient.js:97`, `:131`); sin `Number(`/`parseFloat` en cliente, mock ni helpers.
- [x] PRY-R09 — URLs: `config.billetera.url` / `config.billeteraUsd.url` solo en `billeteraClient.js:14,20`; literales `http://` solo en `.env.example` y `docker-compose.yml` (SPEC-00). Sin `console.log`.
- [x] PRY-R10 — logs con `enmascararCuenta(cuenta)`; `consultarCuentaUsd` (`:105-118`) no loguea ni devuelve `balance`/`nombre`; token nunca logueado.
- [x] PRY-R12 — `specs-v2/` intacto (init.sh: 15 archivos).
- [x] INT-R01 — solo HTTP vía axios.
- [x] INT-R02 — PEN: `Authorization: Bearer BILLETERA_TOKEN` + `X-Correlation-Id` (`cabecerasPen`, `:43-48`); USD: `X-Correlation-Id` siempre y `Authorization` solo si `config.billeteraUsd.token` (`cabecerasUsd`, `:50-54`).
- [x] INT-R03 — ambas instancias con `timeout: config.billetera.timeoutMs` (`:15`, `:21`).
- [x] INT-R04 — `GET /api/v1/billetera/wallets/{id}`; 200 → `{ numero: id, estado: 'ACTIVA', moneda, titularId: user_id }` (`:117`); 404 → `null`; otro → `BILLETERA_NO_DISPONIBLE`.
- [x] INT-R05 — `Idempotency-Key: depositoId` (`:126`); 409 → `logger.error` + `BILLETERA_NO_DISPONIBLE` (`:136-144`); 201/200 solo con `estado === 'COMPLETADO'` (`:147`); resto → error.
- [x] INT-R06 — `llamar()` (`:65-71`) hace una sola petición; sin `axios-retry` ni bucles. Body USD armado solo con datos del depósito (replay idéntico).
- [x] INT-R07 — body exacto `cliente_id, cuenta_destino_id, monto, moneda: 'USD', metodo_origen, referencia_externa` (`:127-134`); tabla `METODO_ORIGEN` (`:32-36`) VENTANILLA/AGENTE → EFECTIVO, APP → TRANSFERENCIA; sin `concepto`.
- [x] INT-R08 — no se llama a usuario-service.
- [x] INT-R09 — mock: PEN `Set` de `depositoId` → 409 (`server.js:96-99`); USD `Map` clave → body canónico: mismo body → 200 replay, otro → 409 `IDEMPOTENCY_CONFLICT`, nuevo → 201 `COMPLETADO` (`:129-155`).
- [x] INT-R10 — `RE_UUID` sin `/i` (`billeteraClient.js:30`), solo minúsculas; el enrutamiento vive solo en el cliente (`:157-165`), API pública sin cambios.
- [x] INT-R11 / INT-R12 — PEN sin cambios de conducta: 200/404/otro; créditos 200/201/409 → resuelve, body `{ depositoId, monto, moneda, concepto: 'DEPOSITO' }`.
- [x] Datos §4 — `0011-0123-000002` ACTIVA **PEN** `usr-cliente-2` en mock (`server.js:17`) y helpers (`billetera.js:12`); billeteras `1111…`/`2222…` con sus titulares; especiales `9999…` (500) y `8888…` (6 s) en el mock. Ningún dato inventado.
- [x] Defectos conocidos de `Busti:codigo/` no arrastrados — regex UUID con `/i` (Busti `billeteraClient.js:25`) corregido; INT-T12 sí verifica 1 sola llamada; ninguna prueba usa `000002` como USD; no se portó `registrar-deposito/service.js` ni `armarContexto`/`montoValido`.

## Casos de prueba

- [x] INT-T01 … INT-T15 (15/15 reales) en `tests/unit/integraciones/billeteraClient.test.js`, con aserciones concretas: `toEqual` exactos de la cuenta y del body, cabeceras por valor, `isDone()`/interceptor de reintento sin usar y conteo `recibidas === 1` (INT-T05/T12), espía de `logger.error` con `{ correlationId, status: 409 }` (INT-T11), espías en todos los niveles sin `350.75`/`Cliente Uno` (INT-T08), comodines en la otra billetera sin usar (INT-T14), cliente aislado con `BILLETERA_USD_TOKEN` (INT-T15).
- [x] Pruebas obsoletas que fallaban con `000002` como USD: actualizadas (`registrar.test.js` verificarTitular → `CUENTA_AJENA` PEN) o pasadas a `test.todo` justificado (`conversion.test.js` CM-R03 PEN→USD, espera el retrabajo de SPEC-07). Las obsoletas en verde de SPEC-03/08/09/11/12 quedan para su retrabajo (no bloquean, según el líder).

## Checkpoints

- C1: [x]  C2: [x]  C3: [x]  C4: [x] (2ª revisión: `bash init.sh` verde; en la 1ª estaba rojo por el deadlock)  C5: [x]

## Cambios requeridos

Ninguno (2ª revisión). El de la 1ª revisión, ya resuelto:


1. `tests/integration/registrar-deposito/registrar.test.js:86-96` (`beforeEach`/`afterEach`) — C4 / regla dura "init.sh verde" — la prueba `requiereRol + verificarCanal: AGENTE con canal APP → 403 SIN_PERMISO` (`:397`) falla siempre en `limpiar()` (`tests/helpers/db.js:17`, `TRUNCATE … CASCADE`) con `error: deadlock detected`: el INSERT de auditoría que la prueba anterior (`RD-R02 referencia de 140 caracteres…`, `:385`) dispara en `res.on('finish')` (`src/core/middlewares/auditoria.js:74-76`) choca con el TRUNCATE. Debe quedar determinista: esperar a la auditoría en `afterEach` como ya hace `tests/integration/conversion-moneda/conversion.test.js:81-102` (`esperarAuditoria()`), o resolverlo en `tests/helpers/db.js`. Corresponde al **tester** (el archivo ya está en el alcance de este retrabajo). El reporte del tester lo califica de "intermitente" (2/4); en esta revisión falló 3/3 con `init.sh` y 3/3 con la suite sola (`npx jest tests/integration/registrar-deposito --runInBand`), y 3/3 también en un worktree de `HEAD` → preexistente, no causado por SPEC-02.

Una vez estable y con `bash init.sh` verde, el resto de esta revisión se mantiene: no hace falta cambiar código de SPEC-02.

## Observaciones (no bloquean)

- `progress/impl_02.md` declara que el mock no se probó levantado (permiso denegado). Revisado por lectura; probar a mano con `docker compose up billetera-mock`.
- Ninguna prueba fija la conducta de un UUID en mayúsculas (va a PEN). Coherente con INT-R10 y con lo pedido; si se quiere blindar, añadir un caso.
- Incidente del revisor: al quitar un worktree temporal de diagnóstico (en el scratchpad) se borró por la unión `node_modules`; se restauró con `npm ci` desde `package-lock.json` (319 paquetes) y `git status` quedó idéntico. La última corrida de `init.sh` fue después de la restauración.

## Salida de `bash init.sh`

### 2ª revisión (corridas 1 y 2, exit 0 ambas)

```
[OK]    specs-v2/ intacto (15 archivos)
[OK]    feature_list.json válido (13 features: pending=0 in_progress=1 done=6 blocked=0 reabierta=6)
[OK]    SPEC-02: todos sus casos tienen prueba
[WARN]  SPEC-07 (reabierta) aún sin prueba: RD-T13, RD-T14, RD-T15, RD-T16, RD-T17, RD-T18
[WARN]  SPEC-08 (reabierta) aún sin prueba: CD-T10, CD-T11, CD-T12, CD-T13
[WARN]  SPEC-09 (reabierta) aún sin prueba: HD-T09, HD-T10, HD-T11, HD-T12
[OK]    Alcance de archivos correcto (178 archivos revisados)
Test Suites: 23 passed, 23 total
Tests:       1 todo, 379 passed, 380 total
[OK]    Todas las pruebas en verde (unitarias + integración)
[OK]    Entorno listo. Puedes empezar a trabajar.
```

### 1ª revisión (rojo)

```
[OK]    specs-v2/ intacto (15 archivos)
[OK]    feature_list.json válido (13 features: pending=0 in_progress=1 done=6 blocked=0 reabierta=6)
[OK]    SPEC-02: todos sus casos tienen prueba
[WARN]  SPEC-07 (reabierta) aún sin prueba: RD-T13, RD-T14, RD-T15, RD-T16, RD-T17, RD-T18
[WARN]  SPEC-08 (reabierta) aún sin prueba: CD-T10, CD-T11, CD-T12, CD-T13
[WARN]  SPEC-09 (reabierta) aún sin prueba: HD-T09, HD-T10, HD-T11, HD-T12
[OK]    Alcance de archivos correcto (178 archivos revisados)
  ● SPEC-07 registrar-deposito: reglas › requiereRol + verificarCanal: AGENTE con canal APP → 403 SIN_PERMISO; 0 filas; sin acreditación
    error: deadlock detected   (tests/helpers/db.js:17 ← registrar.test.js:87)
Test Suites: 1 failed, 22 passed, 23 total
Tests:       1 failed, 1 todo, 378 passed, 380 total
[FAIL]  Hay pruebas rotas
[FAIL]  Entorno NO está listo.
```

Feature 2 marcada `done` en `feature_list.json` (se conserva `retrabajo: true`); `bash init.sh` re-ejecutado tras el cambio (ver abajo).

### Confirmación tras marcar `done` (corrida única, exit 0)

```
[OK]    feature_list.json válido (13 features: pending=0 in_progress=0 done=7 blocked=0 reabierta=6)
Test Suites: 23 passed, 23 total
Tests:       1 todo, 379 passed, 380 total
[OK]    Todas las pruebas en verde (unitarias + integración)
[OK]    Entorno listo. Puedes empezar a trabajar.
```

Nota del revisor: antes de esta corrida, por error de manejo de tareas en segundo plano, se lanzaron 3 `init.sh`
**a la vez** contra la misma BD de prueba; esas corridas solapadas fallaron con `deadlock detected` en varias suites
(TRUNCATE concurrente entre procesos). No son válidas ni reflejan el código: `init.sh` nunca debe ejecutarse en
paralelo. La corrida única posterior, arriba, es verde.

---

# Retrabajo v2.1, 2026-11-09 — SPEC-02 integraciones (v2.0 → v2.1, Billetera USD v1.2.0)

**Veredicto:** APROBADO CON OBSERVACIONES

Revisado contra `git diff specs-v2/02-integraciones.md`, `docs/referencia/Billetera_USD_openapi_v1.2.0.yaml`,
`progress/impl_02.md` (Retrabajo v2.1), `tests/reporte.md` (SPEC-02), PRY-R01..R12 y `CHECKPOINTS.md`.

## Reglas

- [x] INT-R01 — `src/core/clients/billeteraClient.js` solo usa axios; sin acceso a BD.
- [x] INT-R02 — PEN: `cabecerasPen` (l. 139-144) con `Bearer BILLETERA_TOKEN` + `X-Correlation-Id`. USD: `cabecerasUsd` (l. 146-151) con `X-Correlation-Id` siempre y `Bearer <token OAuth>` cuando hay token.
- [x] INT-R03 — `timeout: config.billetera.timeoutMs` en `httpPen`, `httpUsd` y en la petición de token (l. 101).
- [x] INT-R04 — `ESTADOS_BILLETERA_USD` (l. 38-42) mapea ACTIVE/BLOCKED/CLOSED; desconocido o `user_id` ausente/vacío → `BILLETERA_NO_DISPONIBLE` (l. 210-214); 404 → `null`; `balance` y `nombre` no se devuelven ni se loguean (el log de fallo solo lleva `estadoBilletera` y el booleano `conTitular`). Ver el punto 3 sobre la "transición (Q7)".
- [x] INT-R05 — `resultadoUsd` (l. 226-256): 201/200 + COMPLETADO + `movimiento_saldo_id` no nulo → ACREDITADO; 202/200 + VALIDADO/PENDIENTE → PENDIENTE; 200 FALLIDO → `BILLETERA_NO_DISPONIBLE` (cae en la rama por defecto); 422 con uno de los 4 códigos → `CUENTA_INACTIVA`; 409 y 401/403 → `logger.error` + `BILLETERA_NO_DISPONIBLE`; el resto (429, 5xx, timeout, combinaciones raras) → `BILLETERA_NO_DISPONIBLE`. Firma `acreditar({ depositoId, cuenta, monto, moneda, titularId, canal }, correlationId)`.
- [x] INT-R06 (§6 revisor) — una sola `http.request` por `acreditar` (`llamar`, l. 77-83), sin bucles ni reintentos; `Idempotency-Key = depositoId`; el body se arma solo con los datos del depósito (l. 268-275), así que el reenvío es idéntico. Un fallo de token no se cachea (`finally`, l. 131-133).
- [x] INT-R07 — body `{ cliente_id: titularId, monto: Decimal.toFixed(2), moneda: 'USD', canal, metodo_origen, referencia_externa }`, sin `cuenta_destino_id` ni `concepto`; `METODO_ORIGEN` cumple `x-channel-method-policy`.
- [x] INT-R09 — `mocks/billetera/server.js`: valida el body (campos de `CrearDepositoRequest`, sin campos extra, `monto`, `moneda`, canal y política de canal), `Idempotency-Key` UUID v4, replay 200 / conflicto 409, 201 COMPLETADO con `movimiento_saldo_id`, especiales de §4 por `cliente_id`, nunca cambia `balance`.
- [x] INT-R10 (§6 revisor) — el enrutamiento solo está en `billeteraClient.js` (`esBilleteraUsd`, l. 62-64; `consultarCuenta`/`acreditar`, l. 281-289).
- [x] INT-R12 — 200/201/409 → `{ estado: 'ACREDITADO' }` (l. 182).
- [x] INT-R13 — sin `tokenUrl` → `null` y sin `Authorization` (l. 128); caché en memoria con margen de 60 s (`MARGEN_TOKEN_MS`, l. 53, 87-89); las peticiones simultáneas comparten `solicitudTokenUsd`; scopes exactos (l. 52); fallo o token inválido → `BILLETERA_NO_DISPONIBLE` sin llamar a la billetera.
- [x] INT-R14 — solo `RUTA_DEPOSITOS_USD` (l. 28); ninguna llamada a `/wallets/{id}/depositos` (grep).
- [x] PRY-R01..R05 — el cliente vive en `src/core/clients/`; `src/core/` no nombra features.
- [x] PRY-R06/R07 — montos con `new Decimal(monto).toFixed(2)` (l. 180, 270). Grep de `Number(` y `parseFloat` en `src/`, `mocks/` y `tests/helpers/`: 0 resultados (`Number.isInteger` solo valida `expires_in`, que no es dinero).
- [x] PRY-R08 — no aplica (no hay SQL en §2).
- [x] PRY-R09 (§6 revisor) — grep de `http://` en `src/` y `mocks/` sin contar `src/config.js`: 0 resultados. Rutas `billetera/wallets` y `depositos/usd` solo aparecen en `billeteraClient.js`. Las credenciales se leen solo de `config.billeteraUsd.{tokenUrl,clientId,clientSecret}`. `BILLETERA_USD_TOKEN` ya no se lee en ningún sitio.
- [x] **PRY-R10 (punto 2)** — el secreto viaja solo en `auth` de axios (l. 103); el error de axios nunca se loguea entero, solo `err.code || err.message` (l. 81, 112); el log de fallo de token solo lleva `motivo` + `status`/`error`; `logErrorUsd` y `noDisponible` no reciben cabeceras ni el token. Las pruebas INT-T17 (secreto y Basic en base64 ausentes de los logs; token ausente en el camino de éxito, 500 y 409) e INT-T19 (log de error del 403 sin el token) lo verifican. Cuentas enmascaradas con `enmascararCuenta`. Sin `console.log` en `src/`, `mocks/` ni `tests/helpers/`.
- [x] PRY-R11 — Q9 (URL de tokens) sigue configurable y vacía en `.env.example`; mock en `/oauth2/token`. Las credenciales del mock (`MOCK_CLIENT_ID` / `MOCK_CLIENT_SECRET` con valor por defecto) solo valen contra el mock: aceptable.
- [x] PRY-R12 — `specs-v2/` intacto (`[OK] specs-v2/ intacto (15 archivos)`). Ver el punto 3.
- [x] §2 — archivos tocados de SPEC-02: `billeteraClient.js`, `mocks/billetera/server.js`, `tests/helpers/billetera.js`, `tests/unit/integraciones/billeteraClient.test.js`. Los cambios fuera de §2 se valoran en el punto 4.

## Punto 3 — Decisión INT-R04 "transición (Q7)" = sin `BILLETERA_USD_TOKEN_URL`

`billeteraClient.js:190-193`. **Veredicto: lectura razonable, no es una suposición que viole PRY-R12.** Pero queda **pendiente de que lo confirme un humano**.

- La propia spec ata "transición (Q7)" a la ausencia de `BILLETERA_USD_TOKEN_URL` en dos sitios: INT-R13 ("Sin `BILLETERA_USD_TOKEN_URL` no se envía `Authorization` (transición, Q7)") y SPEC-00 §5 ("opcional mientras dure la transición, Q7"). Es la única señal de transición que existe en las specs. Q7 (`docs/propuesta-billetera-usd-v1.2.md:233`) trata del periodo en que conviven v1.1 y v1.2.0, y `estado` y OAuth llegan en esa misma v1.2.0. Usar la misma señal no introduce ningún valor nuevo ni ningún comportamiento que la spec no prevea.
- Riesgo residual: si Billetera USD despliega `Wallet.estado` antes de exigir OAuth (o al revés), los dos ejes se separan. Con la decisión actual, el fallo sería seguro: con OAuth y sin `estado` → `BILLETERA_NO_DISPONIBLE`, que es la regla por defecto de INT-R04.
- **Para el humano:** confirmar que "transición (Q7)" = "sin `BILLETERA_USD_TOKEN_URL`", o fijar otra señal en la spec. El cambio es de una línea.

## Punto 4 — Cambios fuera de §2 (transitorios, autorizados por el leader)

- [x] `src/modules/registrar-deposito/service.js` — diff de 9 líneas: `titularId` en `depositoDesdeFila` (l. 45, `fila.titular_id ?? null`) y en el depósito nuevo (l. 99); `titularId` en lugar de `usuarioId` en `acreditar`; `PENDIENTE` → `throw ErrorApp('BILLETERA_NO_DISPONIBLE')`, que mantiene el camino FALLIDO de hoy. **No** implementa RD-R12/R13 (ni PENDIENTE ni reconciliación) y **no** guarda `titular_id` (el repository no se tocó). Es mínimo y está documentado en `progress/impl_02.md`, con un comentario en el código que lo marca como transitorio.
- [x] `tests/unit/registrar-deposito/service.test.js` (RD-T11, T12, R03/R05, R08, T13, T18), `tests/integration/registrar-deposito/registrar.test.js` (RD-T13, RD-T18, `billeteraFallaExiste`) y `tests/integration/conversion-moneda/conversion.test.js` (CM-R03): solo adaptan la firma y el body al contrato v2.1. No hay casos nuevos (RD-T19..T24 y CM-T09 siguen sin prueba, como corresponde).
- [x] `test.todo` de RD-T18 (`registrar.test.js`, tras RD-T18): está justificado (el reintento USD envía `cliente_id: null` porque `titular_id` aún no se guarda, que es el hueco conocido). El resto de RD-T18 sigue siendo una prueba real. **Hay que volver a convertirlo en prueba real en el retrabajo de SPEC-07.** No veo excesos.

## Punto 5 — Deadlock intermitente de `TRUNCATE`

En esta revisión, `bash init.sh` salió verde en las dos corridas, sin deadlock. Queda anotado como riesgo conocido de `tests/helpers/db.js:17` (lo vio el tester en IDE-T07, un archivo que este cambio no toca). No lo causa este retrabajo y no bloquea.

## Casos de prueba

`tests/unit/integraciones/billeteraClient.test.js`, todos reales y con aserciones concretas (`toEqual` exacto, conteo de peticiones de nock, códigos de error, contenido de los logs):

- [x] INT-T08 — ACTIVE/BLOCKED/CLOSED → ACTIVA/BLOQUEADA/CERRADA; estado desconocido → `BILLETERA_NO_DISPONIBLE`; sin balance ni nombre, tampoco en los logs.
- [x] INT-T10 — 201/200 COMPLETADO → `{ estado: 'ACREDITADO' }`; Idempotency-Key; sin `movimiento_saldo_id` (null o ausente) → `BILLETERA_NO_DISPONIBLE`.
- [x] INT-T11 — 409 + `logger.error`; 202/200 VALIDADO y 200 PENDIENTE → PENDIENTE; 200 FALLIDO → `BILLETERA_NO_DISPONIBLE`.
- [x] INT-T13 — body exacto de §5, los 3 canales, sin `cuenta_destino_id` ni `concepto`, y `usuarioId` no llega al body.
- [x] INT-T15 — sin `TOKEN_URL` no hay `Authorization`; con OAuth lleva el Bearer, más el grant y los scopes; PEN no recibe el token OAuth.
- [x] INT-T16 — 2 llamadas seguidas y 3 simultáneas → 1 petición de token; con `Date.now` simulado, a 61 s se reutiliza y a 59 s se renueva.
- [x] INT-T17 — 401, 500, timeout, error de red y 200 sin `access_token` → `BILLETERA_NO_DISPONIBLE`, sin llamar a la billetera; el secreto y el token no aparecen en los logs.
- [x] INT-T18 — los 4 códigos 422 → `CUENTA_INACTIVA`, con 1 sola llamada.
- [x] INT-T19 — 401 y 403 → `BILLETERA_NO_DISPONIBLE` + `logger.error` con status (`test.each`, l. 723); con OAuth, el log del 403 no lleva el token (l. 991).
- [x] INT-T01..T07, T09, T12, T14 — siguen en verde y están adaptados al resultado `{ estado: 'ACREDITADO' }`.
- `init.sh`: `[OK] SPEC-02: todos sus casos tienen prueba`.

## Observaciones (no incumplen reglas de spec)

1. `billeteraClient.js:191` — decisión Q7 (ver punto 3): **pendiente de confirmación humana**. Además, la rama "con `TOKEN_URL` y `estado` ausente → `BILLETERA_NO_DISPONIBLE`" no tiene prueba (el tester no la cubrió a propósito, `tests/reporte.md`). Si el humano confirma la lectura, conviene añadir esa prueba.
2. `mocks/billetera/server.js` (`RECHAZOS_USD`) — `usr-bloqueada` y `usr-cerrada` responden 422 `WALLET_BLOCKED`/`WALLET_CLOSED` al acreditar. §4 no los lista entre los especiales, pero así se comporta la referencia (`docs/specs-propuestas/mock-billetera-usd/server.js`) y es coherente con el contrato. Es aceptable.
3. Un 401/403 de la billetera no invalida el token cacheado (`impl_02.md`, Decisiones). La spec no lo pide; se señala por si el humano quiere añadirlo.
4. Hueco conocido hasta el retrabajo de SPEC-07: los reintentos USD (RD-R08) envían `cliente_id: null` porque `titular_id` aún no se guarda (`service.js:45`). Tiene `test.todo` en RD-T18.

## Checkpoints

- C1: [x] arnés completo; `bash init.sh` con exit 0.
- C2: [x] 1 sola feature `in_progress` (la 2) antes de cerrar; sus dependencias (0 y 1) están `done`.
- C3: [x] `specs-v2/` intacto; alcance correcto (189 archivos); ninguna extensión modificó `src/core/`.
- C4: [x] PRY-R01..R10 y las reglas que §6 manda verificar (INT-R06, INT-R10, URLs solo en `billeteraClient.js`/`config.js`/`.env.example`).
- C5: [x] todos los INT-Tnn tienen prueba real; nock con `disableNetConnect`; la integración corre contra PostgreSQL real; cobertura total 99.6 % stmts / 94.97 % branch (`core/clients` 100 % stmts); `tests/reporte.md` lista los casos cubiertos, los `test.todo` y los fallos.

## Salida de `bash init.sh` (completo, con PostgreSQL)

Corrida 1 (antes de marcar `done`): `EXIT=0`, sin deadlock.
```
[OK]    specs-v2/ intacto (15 archivos)
[OK]    feature_list.json válido (13 features: pending=0 in_progress=1 done=7 blocked=0 reabierta=5)
[OK]    SPEC-02: todos sus casos tienen prueba
[WARN]  SPEC-07 (reabierta) aún sin prueba: RD-T19, RD-T20, RD-T21, RD-T22, RD-T23, RD-T24
[WARN]  SPEC-08 (reabierta) aún sin prueba: CD-T14, CD-T15
[WARN]  SPEC-11 (reabierta) aún sin prueba: CM-T09
[OK]    Alcance de archivos correcto (189 archivos revisados)
Test Suites: 23 passed, 23 total
Tests:       1 todo, 447 passed, 448 total
All files    |    99.6 |    94.97 |   99.28 |   99.85 |
[OK]    Todas las pruebas en verde (unitarias + integración)
[OK]    Entorno listo. Puedes empezar a trabajar.
```

Corrida 2 (después de marcar `done`): `EXIT=1`. Solo falló `IDE-T08` (`tests/integration/idempotencia/idempotencia.test.js:96`, en `limpiar()`), con `error: deadlock detected` en el `TRUNCATE ... CASCADE` de `tests/helpers/db.js:17`. Es el deadlock intermitente conocido (punto 5), en un archivo que este retrabajo no toca. `Tests: 1 failed, 1 todo, 446 passed, 448 total`.

Corrida 3 (repetición): `EXIT=0`.
```
[OK]    feature_list.json válido (13 features: pending=0 in_progress=0 done=8 blocked=0 reabierta=5)
[OK]    SPEC-02: todos sus casos tienen prueba
Test Suites: 23 passed, 23 total
Tests:       1 todo, 447 passed, 448 total
[OK]    Todas las pruebas en verde (unitarias + integración)
[OK]    Entorno listo. Puedes empezar a trabajar.
```

Feature 2 marcada `done` en `feature_list.json` (se mantiene `retrabajo: true`).

---

# Retrabajo v2.2, 2026-11-09 — SPEC-02 integraciones (v2.1 → v2.2)

**Veredicto:** APROBADO

Revisado contra `git diff --no-index --word-diff docs/specs-propuestas/02-integraciones.md specs-v2/02-integraciones.md`
(INT-R04, INT-R05, INT-R13, INT-T11, INT-T19), `progress/impl_02.md` (Retrabajo v2.2) y `tests/reporte.md`
(SPEC-02, Retrabajo v2.2).

## Reglas

- [x] INT-R04 — `src/core/clients/billeteraClient.js:200-203` (`estadoBilleteraUsd`): `estado` ausente/null → `ACTIVA` solo si `config.billeteraUsd.tokenUrl` está vacío; con él → `undefined` → `BILLETERA_NO_DISPONIBLE` (l. 221-225). Coincide literalmente con v2.2 ("sin `BILLETERA_USD_TOKEN_URL`; con ella → `BILLETERA_NO_DISPONIBLE`").
- [x] INT-R05 — `resultadoUsd`, l. 248-254: 200 + `FALLIDO` → `{ estado: 'RECHAZADO' }` (constante l. 58), con `logger.warn` cuyo detalle es solo `status`, `depositoId`, `estado`, `code` y la cuenta enmascarada. `FALLIDO` con otro status sigue en `BILLETERA_NO_DISPONIBLE` (l. 273), porque la spec solo define el 200 replay. El resto de las ramas no cambió.
- [x] INT-R06 (§6 revisor) — `acreditarUsd` (l. 278-297) hace una sola `llamar`. `descartarTokenUsdSi401` (l. 131-133) solo pone `tokenUsd = null`, **sin reintentar** la llamada. Esa llamada lanza `BILLETERA_NO_DISPONIBLE` por la rama 401/403 (l. 267-271).
- [x] INT-R13 — 401 descarta el token guardado en `acreditarUsd` (l. 295) y en `consultarCuentaUsd` (l. 214). La regla dice "un 401 de Billetera USD" sin acotarlo, así que aplicarlo a las dos operaciones es correcto. La guarda `tokenUsd.valor === tokenEnviado` evita borrar un token que otra petición ya renovó. Un 403 no descarta el token. Sin `tokenUrl`, `token` es `null` y el descarte no hace nada.
- [x] INT-R10 / PRY-R09 (§6 revisor) — grep de `billetera/wallets|depositos/usd` en `src/`: solo `billeteraClient.js`. Grep de `http://` en `src/` y `mocks/` sin contar `src/config.js`: 0.
- [x] **PRY-R10** — `cabecerasUsd` (l. 156-161) devuelve el token solo al llamador para compararlo y nunca lo pasa a un logger. `descartarTokenUsdSi401` no loguea. El nuevo `warn` de `RECHAZADO` no lleva cabeceras. El secreto solo está en `auth` de axios (l. 105), y los errores de axios se loguean solo como `err.code || err.message` (l. 83, 114). Las pruebas INT-T19 nuevas comprueban que ni el token (1.º y 2.º) ni `CLIENT_SECRET` aparecen en ningún nivel de log.
- [x] PRY-R06/R07 — grep de `Number(`, `parseFloat` y `console.log` en `src/`, `mocks/` y `tests/helpers/`: 0 (solo `Number.isInteger` para `expires_in`).
- [x] PRY-R12 — `[OK] specs-v2/ intacto (15 archivos)`.

## Observaciones de v2.1

- **Obs. 1 (Q7) — resuelta.** La spec v2.2 fija "transición (Q7)" = sin `BILLETERA_USD_TOKEN_URL`, que es la lectura que ya hacía el código. Ya no es una decisión del implementador. La rama "con `TOKEN_URL` y `estado` ausente" ahora tiene prueba: `tests/unit/integraciones/billeteraClient.test.js:440`, con control positivo en el mismo cliente.
- **Obs. 3 (401/403 y token cacheado) — resuelta.** INT-R13 v2.2 lo exige (401 descarta, 403 no). Está implementado (l. 131-133, 214, 295) y probado (INT-T19, l. 1024, 1058, 1081).
- Obs. 2 (especiales del mock) y Obs. 4 (`cliente_id: null` en reintentos, `test.todo` de RD-T18) no cambian. Siguen pendientes del retrabajo de SPEC-07.

## Cambio fuera de §2 (transitorio, SPEC-07)

- [x] `src/modules/registrar-deposito/service.js:55-56, 65-67` — solo se añade `|| resultado?.estado === 'RECHAZADO'` a la condición transitoria que ya existía, y se actualiza el comentario. Lleva al mismo camino `PROCESANDO → FALLIDO` + 502 con `depositoId`. No implementa RD-R08/R13. Es mínimo, está comentado como transitorio y está documentado en `progress/impl_02.md`. Se acepta, y SPEC-07 v2.2 debe reemplazarlo. Ninguna prueba de `service.test.js` cubre aún `RECHAZADO`: queda para SPEC-07.

## Casos de prueba

- [x] INT-T11 (l. 587) — 200 `FALLIDO` → `toEqual({ estado: 'RECHAZADO' })`, 1 sola petición, `Idempotency-Key` = `depositoId`, y un segundo interceptor con 0 peticiones (sin reintento).
- [x] INT-T19 (l. 743, 1010, 1024, 1058, 1081) — 401/403 → `BILLETERA_NO_DISPONIBLE` + `logger.error` con `status`. Tras un 401 en `acreditar`: 0 reintentos, y la siguiente llamada pide un 2.º token y lo envía como Bearer. Tras un 403: se reutiliza el 1.er token y no hay 2.ª petición de token. `consultarCuenta` sigue el mismo patrón. Las aserciones son concretas (conteo de peticiones, cabecera `authorization` exacta).
- [x] INT-R04 v2.2 (l. 440) — con OAuth y sin `estado` → `BILLETERA_NO_DISPONIBLE`.
- [x] `init.sh`: `[OK] SPEC-02: todos sus casos tienen prueba`.

## Checkpoints

- C1: [x]  C2: [x] (solo la feature 2 `in_progress`; 0 y 1 `done`)  C3: [x] (specs intactas, alcance correcto: 189 archivos)  C4: [x]  C5: [x] (integración contra PostgreSQL real, cobertura 99.61 % stmts / 95.1 % branch)

## Salida de `bash init.sh` (completo, con PostgreSQL)

Corrida 1 (antes de marcar `done`): `EXIT=0`, sin deadlock.
```
[OK]    specs-v2/ intacto (15 archivos)
[OK]    feature_list.json válido (13 features: pending=0 in_progress=1 done=7 blocked=0 reabierta=5)
[OK]    SPEC-02: todos sus casos tienen prueba
[WARN]  SPEC-07 (reabierta) aún sin prueba: RD-T19, RD-T20, RD-T21, RD-T22, RD-T23, RD-T24
[WARN]  SPEC-08 (reabierta) aún sin prueba: CD-T14, CD-T15
[WARN]  SPEC-11 (reabierta) aún sin prueba: CM-T09
[OK]    Alcance de archivos correcto (189 archivos revisados)
Test Suites: 23 passed, 23 total
Tests:       1 todo, 451 passed, 452 total
All files    |   99.61 |     95.1 |   99.28 |   99.71 |
[OK]    Todas las pruebas en verde (unitarias + integración)
[OK]    Entorno listo. Puedes empezar a trabajar.
```

Corrida 2 (después de marcar `done`): `EXIT=0`, sin deadlock.
```
[OK]    feature_list.json válido (13 features: pending=0 in_progress=0 done=8 blocked=0 reabierta=5)
Test Suites: 23 passed, 23 total
Tests:       1 todo, 451 passed, 452 total
[OK]    Todas las pruebas en verde (unitarias + integración)
[OK]    Entorno listo. Puedes empezar a trabajar.
```

Feature 2 marcada `done` en `feature_list.json` (se mantiene `retrabajo: true`).
