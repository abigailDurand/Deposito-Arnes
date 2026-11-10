# Reporte de pruebas

## SPEC-00

- **Agente:** tester · **Fecha:** 2026-11-09 · **Feature:** 0 (`proyecto`) · **RETRABAJO v1.3** (`retrabajo: true`; solo §5, variables de entorno; ver `progress/impl_00.md`, "Retrabajo v1.3")
- **Ejecución:** `bash init.sh` completo (PostgreSQL arriba) → `Test Suites: 23 passed, 23 total` · `Tests: 1 todo, 418 passed, 419 total` ·
  `[OK] SPEC-00: todos sus casos tienen prueba` · "Entorno listo". Avisos `[WARN]` solo de las features reabiertas (SPEC-01/02/07/08/11), esperados.

### Retrabajo v1.3: pruebas obsoletas actualizadas

`BILLETERA_USD_TOKEN` desaparece de §5 (la sustituyen `BILLETERA_USD_TOKEN_URL` / `CLIENT_ID` / `CLIENT_SECRET`, INT-R13) y entran las `RECONCILIACION_*` (RD-R13).
Antes de este cambio `init.sh --rapido` daba 3 fallos unitarios, todos por la clave eliminada `billeteraUsd.token`.

1. `tests/core/proyecto.test.js`: **eliminada** la prueba "BILLETERA_USD_TOKEN opcional ... (INT-R02)" (esperaba `{ url, token }`). Era el único fallo del archivo;
   el resto (obligatorias, defaults, `UIF_UMBRAL_*`, logger) seguía válido y no se tocó. En su lugar, pruebas nuevas:
   - `BILLETERA_USD_TOKEN_URL` ausente o vacía → `billeteraUsd` = `{ url, tokenUrl: null, clientId: null, clientSecret: null }`; con CLIENT_ID/SECRET sueltos (sin TOKEN_URL) se ignoran → `null` y no hay error.
   - `TOKEN_URL` sin CLIENT_ID ni CLIENT_SECRET → `Faltan variables de entorno obligatorias: BILLETERA_USD_CLIENT_ID, BILLETERA_USD_CLIENT_SECRET`.
   - `TOKEN_URL` con solo una de las dos ausente (o vacía) → error con ese nombre (`test.each`, 2 casos).
   - Las tres presentes → sus valores.
   - `BILLETERA_USD_TOKEN` ya no se lee: no aparece la clave `token` ni su valor en la config.
   - `RECONCILIACION_*` ausentes → `{ intervaloMs: 30000, antiguedadMs: 10000, alertaMs: 3600000 }`; explícitas → enteros; `'1h'` en cada una → error con su nombre (`test.each`, 3 casos).
2. `tests/unit/integraciones/billeteraClient.test.js` (INT-T15, **de SPEC-02**), ajuste mínimo sin reescribir el caso:
   - Prueba "sin BILLETERA_USD_TOKEN" (~l. 549-561): solo cambia `expect(config.billeteraUsd.token).toBeNull()` → `expect(config.billeteraUsd.tokenUrl).toBeNull()`
     (y el nombre dice `BILLETERA_USD_TOKEN_URL`). El resto de aserciones (sin `Authorization`, `X-Correlation-Id`) sigue igual y pasa.
   - Prueba "con BILLETERA_USD_TOKEN → Bearer token-usd-de-prueba" (~l. 563): **obsoleta** (la variable ya no existe y `src/core/clients/billeteraClient.js:52`
     lee `config.billeteraUsd.token`, ahora `undefined`, así que nunca envía `Authorization` a USD). Convertida en
     `test.todo('INT-T15 Billetera USD con BILLETERA_USD_TOKEN_URL → lleva Authorization Bearer con token OAuth (espera SPEC-02)')`.
   - **Pendiente para SPEC-02:** rehacer INT-T15 con OAuth (INT-R13) e INT-T16..T19 cuando desarrolladorback implemente el cliente OAuth.

### Casos cubiertos

| Caso | Archivo | Resultado |
|---|---|---|
| PRY-T01 (`GET /health` sin token → 200 `{ "estado": "ok" }`) | `tests/core/proyecto.test.js` | ✅ |
| PRY-T02 (`cargarConfig` sin `DATABASE_URL` → error con `DATABASE_URL`; `require` sin la variable → no arranca) | `tests/core/proyecto.test.js` | ✅ |
| PRY-T03 (`enmascararCuenta('0011-0123-456789')` → `'****-****-456789'`) | `tests/core/proyecto.test.js` | ✅ |

Pruebas extra de §5 (sin id) en `tests/core/proyecto.test.js`, todas ✅: obligatorias ausentes/vacías, defaults y sobrescritura, OAuth USD y
`RECONCILIACION_*` (arriba), `UIF_UMBRAL_*`, `JWT_PUBLIC_KEY` con `
`, entero inválido, logger.

### Casos en `test.todo`

- Ninguno de SPEC-00.
- 1 de SPEC-02 (INT-T15 con token OAuth), en `tests/unit/integraciones/billeteraClient.test.js`; espera el retrabajo de SPEC-02.

### Pruebas fallidas

Ninguna en la corrida final.

Observación (no atribuible a este retrabajo, que solo toca pruebas unitarias): en 2 de 5 corridas completas (`init.sh` / `npm test`) fallaron
pruebas de integración por `error: deadlock detected` en `TRUNCATE` de `limpiar()` (`tests/helpers/db.js:17`), primero en
`tests/integration/idempotencia/idempotencia.test.js` (IDE-T04, billetera que tarda 2 s) y luego en cascada. Sin otros clientes en la BD.
`--selectProjects integration --runInBand` pasó 2/2 y las 3 últimas corridas completas pasaron. Parece una petición/transacción
de una prueba anterior que sigue viva cuando empieza el `TRUNCATE` (intermitente). Conviene que el líder lo vigile (SPEC-05/SPEC-02).

### Cobertura (`src/core/` y `src/modules/`)

All files 99.58 % stmts / 94.84 % branch / 99.23 % funcs / 99.84 % lines; `core` 99.46 % stmts; todos los `modules/*` ≥ 98.7 % stmts. Supera el 80 %.
`src/core/clients/billeteraClient.js` queda con ramas sin cubrir en l. 52-69 y 145 (incluida la del token USD en l. 52, inalcanzable hasta SPEC-02); líneas 100 %.
`src/config.js` queda fuera de `collectCoverageFrom` (así lo define `jest.config.js`); las pruebas nuevas recorren todas sus ramas de v1.3.

## SPEC-01

- **Agente:** tester · **Fecha:** 2026-11-09 · **Feature:** 1 (`dominio`) · **Retrabajo v1.2** (spec 1.1 → 1.2: `titular_id`, DOM-R10 ampliada, DOM-R11, DOM-R12, DOM-T09).
- **Ejecución:** `bash init.sh` completo → `EXIT=0` (PostgreSQL real, `deposito_test`, esquema aplicado por `globalSetup` con la columna nueva).
  `[OK] SPEC-01: todos sus casos tienen prueba`. `Test Suites: 23 passed · Tests: 1 todo, 421 passed, 422 total`.
  Los `[WARN]` que siguen son de otras features reabiertas (SPEC-02 INT-T16..T19, SPEC-07 RD-T19..T24, SPEC-08 CD-T14/T15, SPEC-11 CM-T09), no de SPEC-01.

### Casos cubiertos

| Caso | Archivo | Resultado |
|---|---|---|
| DOM-T01 `ErrorApp('MONTO_INVALIDO')` → 422 `{ codigo, mensaje, correlationId: 'abc-123' }` | `tests/unit/dominio/errores.test.js` | ✅ |
| DOM-T02 error desconocido → 500 `ERROR_INTERNO`, sin mensaje ni stack en el cuerpo; `logger.error` con `err` y `correlationId` | `tests/unit/dominio/errores.test.js` | ✅ |
| DOM-T03 `POST` con `{malo` → 400 `FORMATO_INVALIDO` | `tests/unit/dominio/errores.test.js` | ✅ |
| DOM-T04 `BILLETERA_NO_DISPONIBLE` con `depositoId: 'x'` → 502 y `res.locals.depositoId === 'x'` (+ sin `depositoId` no se asigna) | `tests/unit/dominio/errores.test.js` | ✅ |
| DOM-T05 `registrarErrores` con código del core ya existente → lanza, catálogo intacto (+ mismo código nuevo dos veces → la segunda lanza) | `tests/unit/dominio/errores.test.js` | ✅ |
| DOM-T06 `aJson` con monto `150` sin referencia → `"150.00"`, `referencia: null` (+ referencia `null` en BD) | `tests/unit/dominio/depositoMapper.test.js` | ✅ |
| DOM-T07 controller `async` que lanza envuelto en `manejar` → 403 sin colgarse (timeout 2 s) (+ sin error responde normal) | `tests/unit/dominio/errores.test.js` | ✅ |
| DOM-T08 `enTransaccion` que inserta 2 filas y lanza → rechaza con el mismo error y `count(*) = '0'` | `tests/integration/dominio/transaccion.test.js` | ✅ |
| DOM-T08 (variantes) sin error → COMMIT y devuelve el resultado; error de BD (`CHECK monto > 0`) → rollback; ROLLBACK que falla → relanza el original, loguea y el pool sigue usable | `tests/integration/dominio/transaccion.test.js` | ✅ |
| **DOM-T09** (nuevo v1.2) `aJson` con `titular_id: 'usr-cliente-1'` → sin clave `titular_id` ni `titularId`, el valor no aparece en el JSON y la forma sigue siendo la exacta de §5 | `tests/unit/dominio/depositoMapper.test.js:55` | ✅ |

Pruebas extra (sin id de caso, con el nombre de la regla, como las DOM-R existentes), todas ✅:

- DOM-R06: `ErrorApp` toma status/mensaje del catálogo; código fuera del catálogo lanza.
- §5: los 16 códigos del catálogo del core con su status.
- DOM-R07: sin `req.correlationId` la clave sale como `null`; con `res.headersSent` delega en `next(err)`.
- DOM-R09: código nuevo registrado → `manejadorErrores` lo responde; definición inválida → lanza sin dejar el catálogo a medias.
- DOM-R10: fila completa → objeto exacto de §5 (camelCase, sin `usuario_id` ni `*_acreditar`); montos `"0.01"`, `"10.5"`→`"10.50"`; fechas con offset → ISO UTC; `extensiones` tal cual; fila real de PostgreSQL por `aJson` (integración).
- **DOM-R11** (nuevo v1.2, integración, `tests/integration/dominio/transaccion.test.js:102` y `:123`):
  - `information_schema.columns`: `depositos.titular_id` existe, `character varying(100)`, `is_nullable = 'YES'`; no hay ninguna `FOREIGN KEY` sobre esa columna.
  - `INSERT` sin `titular_id` (lista de columnas antigua) → `NULL`; `INSERT` con `titular_id = 'usr-cliente-1'` (billetera USD `11111111-…`, SPEC-02 §4) → se guarda; esa fila real por `aJson` no expone el titular.

### Pruebas obsoletas por v1.2

Ninguna. Revisadas las de `tests/unit/dominio/` y `tests/integration/dominio/`: la columna nueva es nullable y todos los `INSERT` usan lista explícita de columnas; DOM-R12 no cambia el `CHECK` de `estado` (sigue sin `VALIDADO`), así que DOM-T08 (`CHECK`) y la prueba de fila real siguen siendo válidas. DOM-R12 (permanencia en `PROCESANDO`, confirmación diferida) no tiene caso en SPEC-01; su comportamiento es de SPEC-07 (RD-R12).

### Casos en `test.todo`

Ninguno de SPEC-01. (El único `test.todo` del repo es INT-T15, de SPEC-02, que espera su retrabajo.)

### Pruebas fallidas

Ninguna.

### Cobertura (`src/core/` y `src/modules/`)

```
-----------------------------|---------|----------|---------|---------|-------------------
File                         | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
-----------------------------|---------|----------|---------|---------|-------------------
All files                    |   99.58 |    94.84 |   99.23 |   99.84 |
 core                        |   99.46 |    94.73 |   97.14 |   99.42 |
  db.js                      |   94.73 |      100 |      50 |   94.73 | 14
  depositoMapper.js          |     100 |      100 |     100 |     100 |
  errores.js                 |     100 |    92.85 |     100 |     100 | 62
  logger.js                  |     100 |      100 |     100 |     100 |
 core/clients                |    98.3 |    92.68 |     100 |     100 |
 core/middlewares            |     100 |    94.87 |     100 |     100 |
  manejadorErrores.js        |     100 |      100 |     100 |     100 |
 core/repositories           |     100 |     87.5 |     100 |     100 |
 core/tareas                 |     100 |      100 |     100 |     100 |
 modules/alerta-uif          |     100 |       80 |     100 |     100 |
 modules/consultar-deposito  |     100 |      100 |     100 |     100 |
 modules/conversion-moneda   |     100 |      100 |     100 |     100 |
 modules/historial-depositos |    98.7 |     91.3 |     100 |     100 |
 modules/limites-por-canal   |     100 |      100 |     100 |     100 |
 modules/registrar-deposito  |     100 |      100 |     100 |     100 |
-----------------------------|---------|----------|---------|---------|-------------------
```

- Umbral 80 % cumplido en todas las métricas, sin tocar `jest.config.js`.
- Sin cubrir en archivos de SPEC-01: `db.js:14` (listener `pool.on('error')` de conexión inactiva), `errores.js:62` (rama `errores` nulo en `registrarErrores`).

### Notas para el leader

- `feature_list.json` (feature 1, acceptance) todavía dice "DOM-T01 a DOM-T08 pasan"; con v1.2 debería decir DOM-T09 (lo anota también el dev en `progress/impl_01.md`).
- Que `titular_id` se llene al registrar es de SPEC-07 (RD-R08, RD-R13); hasta su retrabajo los depósitos nuevos quedan con `NULL`. No se prueba aquí.

## SPEC-02

- **Agente:** tester · **Fecha:** 2026-11-09 · **Feature:** 2 (`integraciones`) · **Retrabajo v2.1** (spec v2.0 → v2.1, Billetera USD v1.2.0: `Wallet.estado`, OAuth client credentials, `acreditar` con resultado `ACREDITADO`/`PENDIENTE`, body sin `cuenta_destino_id`), rama `inte_biUsd`.
- **Ejecución:** `bash init.sh` completo con PostgreSQL, 3 corridas:
  - Corrida 1: `EXIT=1` por el deadlock intermitente de `TRUNCATE` (`tests/helpers/db.js:17`), en `tests/integration/idempotencia/idempotencia.test.js` (IDE-T07). Ese archivo no se tocó en este retrabajo (ver "Pruebas fallidas").
  - Corridas 2 y 3: `EXIT=0`, `Test Suites: 23 passed · Tests: 1 todo, 447 passed, 448 total`, `[OK] SPEC-02: todos sus casos tienen prueba`, `[OK] Entorno listo`.
  - Los únicos `[WARN]` son de features reabiertas (SPEC-07 RD-T19..T24, SPEC-08 CD-T14/T15, SPEC-11 CM-T09).
- Todo SPEC-02 es unitario con nock (`nock.disableNetConnect()`; `cleanAll` + `abortPendingRequests` + `jest.restoreAllMocks()` en cada prueba), con los helpers de `tests/helpers/billetera.js` (sin cambios por mi parte).
- **OAuth sin tocar `config.js` ni `tests/setup/`:** `cargarConfig`/`clienteCon` cargan el cliente en `jest.isolateModules` con las variables de la prueba (`BILLETERA_USD_TOKEN_URL=http://auth-usd.test/oauth2/token`, `CLIENT_ID`, `CLIENT_SECRET`) y restauran el entorno. Así cada carga tiene su caché de token limpia. También devuelven el `logger` de ese registro para espiarlo.
- **Expiración (INT-T16):** se espía `Date.now` (lo usa el cliente), no se usan timers falsos, para que nock y axios no se cuelguen.

### Pruebas obsoletas por v2.1 (actualizadas)

Todas en `tests/unit/integraciones/billeteraClient.test.js`:
- `INT-T04` (201 y 409) e `INT-R12` (200): antes "resuelve sin valor"; ahora `toEqual({ estado: 'ACREDITADO' })`.
- `INT-T10` (201 y 200 replay): antes `toBeUndefined()`; ahora `{ estado: 'ACREDITADO' }`.
- `INT-T11 201 estado PENDIENTE → BILLETERA_NO_DISPONIBLE`: **eliminada** porque el caso ya no existe en v2.1. La sustituyen los casos 202/200 `VALIDADO` → `PENDIENTE` y 200 `FALLIDO`.
- `INT-T13` (body exacto y los 3 canales): `datosCreditoUsd` pasa `titularId` en lugar de `usuarioId`. Se espera `cliente_id = titularId` y `canal`, sin `cuenta_destino_id`.
- `INT-T15` con token: el `test.todo` pasa a ser una prueba real con OAuth.

### Casos cubiertos

Archivo: `tests/unit/integraciones/billeteraClient.test.js` (66 pruebas, todas ✅).

| Caso | Qué comprueba | Resultado |
|---|---|---|
| INT-T01..T07 | Billetera PEN (sin cambios de v2.1, salvo el resultado `{ estado: 'ACREDITADO' }` de INT-T04 / INT-R12) | ✅ |
| INT-T08 | `ACTIVE` → `ACTIVA` (11111111 y 22222222, `toEqual` exacto, sin `balance` ni `nombre`) · `BLOCKED` → `BLOQUEADA` (33333333, `usr-bloqueada`) · `CLOSED` → `CERRADA` (44444444, `usr-cerrada`) · estado desconocido (`SUSPENDED`, y también `ACTIVA` en español) → `BILLETERA_NO_DISPONIBLE` · ni balance ni nombre en los logs, tampoco en el log de fallo | ✅ |
| INT-T09 | 404 → `null`; 500 y timeout → `BILLETERA_NO_DISPONIBLE` | ✅ |
| INT-T10 | 201 y 200 (replay) `COMPLETADO` con `movimiento_saldo_id` → `{ estado: 'ACREDITADO' }`; `Idempotency-Key = depositoId`; replay con el mismo body · `COMPLETADO` sin `movimiento_saldo_id` (201 null, 201 ausente, 200 null) → `BILLETERA_NO_DISPONIBLE` | ✅ |
| INT-T11 | 409 → `BILLETERA_NO_DISPONIBLE` + `logger.error` (status 409) · 202 `VALIDADO` → `{ estado: 'PENDIENTE' }` · 200 `VALIDADO` y 200 `PENDIENTE` → `PENDIENTE` · 200 `FALLIDO` → `BILLETERA_NO_DISPONIBLE` | ✅ |
| INT-T12 | 400, 500 y timeout → `BILLETERA_NO_DISPONIBLE`; 1 sola llamada (un segundo interceptor idéntico no se consume) | ✅ |
| INT-T13 | Body exacto del ejemplo de §5: `{ cliente_id: 'usr-cliente-1', monto: '150.00', moneda: 'USD', canal: 'AGENTE', metodo_origen: 'EFECTIVO', referencia_externa }`, sin `concepto` ni `cuenta_destino_id` · VENTANILLA/AGENTE/APP → EFECTIVO/EFECTIVO/TRANSFERENCIA con `canal` y `cliente_id = titularId` (`toEqual` exacto) · `Decimal('10.5')` → `"10.50"` · un `usuarioId` en los datos no llega al body | ✅ |
| INT-T14 | PEN → solo billetera PEN; UUID → solo Billetera USD | ✅ |
| INT-T15 | Sin `BILLETERA_USD_TOKEN_URL` → sin `Authorization`, con `X-Correlation-Id` · **con OAuth:** consulta y crédito llevan `Bearer <access_token>` y `X-Correlation-Id`; petición de token con `grant_type=client_credentials`, los 2 scopes y las credenciales (Basic o body) · con OAuth, la PEN sigue con `Bearer token-de-prueba` · 404/500 USD llevan `X-Correlation-Id` | ✅ |
| INT-T16 | Consulta y crédito seguidos → 1 petición de token (la 2.ª no se consume) · 3 consultas simultáneas → 1 petición · token de 3600 s: a 61 s de expirar se reutiliza; a 59 s se pide otro y se usa el nuevo | ✅ |
| INT-T17 | Token 401 → `BILLETERA_NO_DISPONIBLE` sin llamar a la billetera; en los logs no aparecen ni el secreto ni el Basic en base64 · token 500, timeout, error de red y 200 sin `access_token` → `BILLETERA_NO_DISPONIBLE` sin `POST` a la billetera · camino con token válido más fallo 500 y 409: hay logs, pero sin token ni secreto | ✅ |
| INT-T18 | 422 `WALLET_BLOCKED`, `WALLET_CLOSED`, `CUSTOMER_BLOCKED`, `USD_ACCOUNT_NOT_ENABLED` → `CUENTA_INACTIVA` (422); 1 sola llamada | ✅ |
| INT-T19 | 401 y 403 → `BILLETERA_NO_DISPONIBLE` + `logger.error` con status · con OAuth y 403: el log de error no lleva el token | ✅ |

Pruebas extra (sin id de caso, con el nombre de la regla), todas ✅:
- INT-R04: 200 sin `user_id` (ausente o `null`) → `BILLETERA_NO_DISPONIBLE` · 400, cuerpo no objeto y error de red → `BILLETERA_NO_DISPONIBLE` · transición (sin `BILLETERA_USD_TOKEN_URL`): `estado` ausente → `ACTIVA`.
- INT-R05: 429 y 503 → `BILLETERA_NO_DISPONIBLE` sin reintento · otra respuesta (201 `VALIDADO`, 202 `COMPLETADO`, 422 con otro `code`) → `BILLETERA_NO_DISPONIBLE` · error de red.
- **INT-R14:** un interceptor sobre `POST /wallets/{id}/depositos` (cualquier id) nunca se consume en 3 acreditaciones (201, replay 200, 202 sobre 11111111 y 22222222). Todas van a `POST /api/v1/depositos/usd`.
- INT-R11/INT-R12: sin cambios.

**No cubierto a propósito:** INT-R04 "`estado` ausente **con** `BILLETERA_USD_TOKEN_URL` → `BILLETERA_NO_DISPONIBLE`". La spec no dice cómo se detecta la "transición (Q7)": es una decisión del desarrollador (`progress/impl_02.md`, Decisiones) que debe confirmar el revisor. Solo pruebo el lado que la spec ata explícitamente a Q7 (sin `TOKEN_URL`, INT-R13).

### Ajustes mínimos en pruebas de otras features (contrato v2.1)

Solo se cambió lo necesario para el contrato nuevo. No se añadió ningún caso RD-T19..T24 ni CM-T09.

**SPEC-07, `tests/unit/registrar-deposito/service.test.js`:**
1. `RD-T11`: el crédito espera `titularId: 'usr-cliente-1'` (titular de `CUENTA_PEN`) en lugar de `usuarioId: 'usr-agente-1'`.
2. `RD-T12`: se quita `usuarioId` del `toMatchObject`. Se añade `not.toHaveProperty('usuarioId')`.
3. `RD-R03/R05`: la lista de claves del depósito incluye `titularId` (SPEC-06 §4 v2), y `toMatchObject` añade `titularId: 'usr-cliente-1'`.
4. `RD-R08` (reintentar FALLIDO): la fila simulada lleva `titular_id: 'usr-cliente-1'` (columna de SPEC-01 v1.2). Se espera `credito.titularId === 'usr-cliente-1'` y sin `usuarioId`, en lugar de `credito.usuarioId === 'usr-cajero-1'`.
5. `RD-T13`: el nombre dice `titularId`; las claves del crédito son `[canal, cuenta, depositoId, moneda, monto, titularId]`, con `titularId: 'usr-cliente-1'`.
6. `RD-T18`: `toMatchObject({ usuarioId: ... })` → `toMatchObject({ canal, moneda })` + `not.toHaveProperty('usuarioId')`. La igualdad completa entre crédito original y reintento se mantiene: pasa porque el mock de `consultarCuenta` de ese bloque da `titularId: null` para 99999999.

**SPEC-07, `tests/integration/registrar-deposito/registrar.test.js`:**
7. `billeteraFallaExiste()` ya no usa su nock propio (`user_id: null` y sin `estado`, que INT-R04 rechaza). Ahora delega en `billetera.billeteraUsdExiste('99999999-…')` (ACTIVE, `usr-falla`, §4 v2.1).
8. `RD-T13`: body esperado `{ cliente_id: 'usr-cliente-1', monto, moneda, canal: 'AGENTE', metodo_origen, referencia_externa }`, sin `cuenta_destino_id`.
9. `RD-T18`: el body original esperado es `{ cliente_id: 'usr-falla', ..., canal: 'AGENTE' }`, sin `cuenta_destino_id`. **La aserción `reintento.body toEqual original.body` se sacó a un `test.todo`** (ver abajo). El resto de RD-T18 sigue como prueba real ✅: 502 FALLIDO, reintento → 201 COMPLETADO con el mismo id, clave TERMINADO, sin nueva consulta, misma `Idempotency-Key`.

**SPEC-11, `tests/integration/conversion-moneda/conversion.test.js`:**
10. `CM-R03 PEN → USD`: el body ya no espera `cuenta_destino_id` (`not.toHaveProperty`) y espera `canal: 'APP'`.

### Casos en `test.todo`

- `RD-T18 reintento USD → body idéntico al original a Billetera USD (cliente_id = titular guardado)` (`tests/integration/registrar-deposito/registrar.test.js`, después de RD-T18). **Espera el retrabajo de SPEC-07.** Hoy `titular_id` no se guarda (RD-R05), así que el reintento arma el body con `cliente_id: null` y el original lleva `'usr-falla'`. Es el "hueco conocido" que el desarrollador documentó en `progress/impl_02.md`. La causa está en `src/modules/registrar-deposito/service.js:45` (`titularId: fila.titular_id ?? null`) junto con el `INSERT` del repositorio, que no escribe `titular_id`. Al cerrar SPEC-07 hay que convertir este `todo` en prueba otra vez.
- El `test.todo` anterior de INT-T15 (con token OAuth) ya es una prueba real.

### Pruebas fallidas

Ninguna atribuible al código en las corridas 2 y 3.

Corrida 1: `IDE-T07` (`tests/integration/idempotencia/idempotencia.test.js:96`, en `limpiar()`) falló con `error: deadlock detected` en el `TRUNCATE ... CASCADE` de `tests/helpers/db.js:17`. Es el mismo deadlock intermitente ya anotado en SPEC-00. Pasó al repetir, en 2 de 2 corridas. Parece que una petición o transacción de la prueba anterior (billetera lenta / timeout) sigue viva cuando empieza el `TRUNCATE`. Conviene que el líder lo vigile; no lo arreglo porque es un helper de `tests/`.

### Cobertura (`src/core/` y `src/modules/`)

- All files: 99.6 % stmts / 94.97 % branch / 99.28 % funcs / 99.85 % lines.
- `core`: 99.46 % stmts. `core/clients`: 100 % stmts / 95.4 % branch.
- Todos los `modules/*`: ≥ 98.7 % stmts.
- Supera el 80 % exigido.
- `src/core/clients/billeteraClient.js`: 100 % líneas y funciones. Solo quedan sin cubrir las ramas de `err.code || err.message` (l. 81, 112) y `res.data && typeof ... : {}` (l. 115, 227), que son fallbacks defensivos.

### Retrabajo v2.2 (2026-11-09)

Cambios de spec probados: INT-R04, INT-R05, INT-R13, INT-T11 e INT-T19. Solo cambió
`tests/unit/integraciones/billeteraClient.test.js`. No toqué `src/`, `mocks/`, helpers ni `specs-v2/`.

**Prueba obsoleta actualizada:**
- `INT-T11 acreditar con 200 (replay) FALLIDO`: antes esperaba `BILLETERA_NO_DISPONIBLE`. Ahora espera que
  resuelva `{ estado: 'RECHAZADO' }` con 1 sola petición (`Idempotency-Key` = `depositoId`). Un segundo
  interceptor idéntico no recibe nada, así que no hay reintento (INT-R06).

**Pruebas nuevas:**
- `INT-T19 acreditar con 401`: lanza `BILLETERA_NO_DISPONIBLE` y escribe 1 log `error` con `status: 401`.
  Hace 1 sola petición, con el primer token, y no pide otro token en esa llamada. La siguiente `acreditar`
  pide un token nuevo (2.ª petición de token) y lo envía como Bearer, y resuelve `ACREDITADO`.
- `INT-T19 acreditar con 403`: lanza `BILLETERA_NO_DISPONIBLE`. La siguiente `acreditar` reutiliza el primer
  token, sin una 2.ª petición de token.
- `INT-T19 consultarCuenta con 401 y luego 403`: el 401 descarta el token y la consulta siguiente usa uno
  nuevo. El 403 no lo descarta: la tercera consulta reutiliza el segundo token y no hay 3.ª petición de token.
- En las tres pruebas, ni los tokens ni el secreto aparecen en ningún nivel de log (PRY-R10).
- `INT-R04 con BILLETERA_USD_TOKEN_URL (fuera de la transición Q7)`: una billetera sin `estado` da
  `BILLETERA_NO_DISPONIBLE`. Como control, con el mismo cliente y el `estado` presente devuelve `ACTIVA`. La
  prueba que ya existía para la transición (sin `BILLETERA_USD_TOKEN_URL`, sin `estado` → `ACTIVA`) sigue
  igual. Con esto queda cubierto el hueco que dejé abierto en v2.1.

**`bash init.sh` completo (con PostgreSQL), 1 corrida:** exit 0, 23/23 suites, 451 pruebas en verde y 1
`todo` (el `RD-T18` de arriba, que espera el retrabajo de SPEC-07). `billeteraClient.test.js` tiene 70/70 en
verde. Hay avisos, que son esperables porque esas features están reabiertas: SPEC-07 RD-T19..T24, SPEC-08
CD-T14/T15 y SPEC-11 CM-T09 aún no tienen prueba. Esta vez no apareció el deadlock de `TRUNCATE`.

**Pruebas fallidas:** ninguna.

**Cobertura:** All files 99.61 % stmts / 95.1 % branch / 99.28 % funcs / 99.71 % lines. `core/clients` está
en 100 % stmts / 95.83 % branch. `billeteraClient.js` tiene 100 % de líneas; las ramas sin cubrir están en
las l. 83, 114-117 y 238 y son fallbacks defensivos. Todo supera el mínimo del 80 %.

**Pendiente para SPEC-07:** hay un ajuste transitorio en `src/modules/registrar-deposito/service.js:65-67`
(`RECHAZADO` → `BILLETERA_NO_DISPONIBLE`). Ninguna prueba de `service.test.js` cubre todavía `acreditar` →
`RECHAZADO`, y eso queda para el retrabajo de SPEC-07 (RD-R08/R13 v2.2), como indica `progress/impl_02.md`.

## SPEC-03

- **Agente:** tester · **Fecha:** 2026-11-03 · **Feature:** 3 (`seguridad`) · **Retrabajo** Billetera USD, rama `inte_biUsd`.
- La spec 03 no cambió; se actualizaron las pruebas que usaban datos obsoletos de SPEC-02 §4 (v2.0):
  `0011-0123-000002` es ahora ACTIVA **PEN** (titular `usr-cliente-2`) y las billeteras USD son
  `11111111-1111-4111-8111-111111111111` (`usr-cliente-1`) y `22222222-2222-4222-8222-222222222222` (`usr-cliente-2`).
- **Ejecución:** `bash init.sh` completo (PostgreSQL real) → `Test Suites: 23 passed, 23 total` ·
  `Tests: 1 todo, 380 passed, 381 total` · `[OK] Todas las pruebas en verde`.
- T01–T05 y T07–T10 montan los middlewares reales en una app Express mínima (`correlationId → GET /health →
  autenticar → rutas → manejadorErrores`, orden de PIP-R11). SEG-T09 usa pino real (opciones de
  `src/core/logger.js`) con el destino redirigido a un `Writable`. SEG-T06 usa `crearApp` real, PostgreSQL
  real y billetera con nock (helpers de SPEC-02).

### Cambios del retrabajo

- `tests/unit/seguridad/permisos.test.js`: **eliminada** `CUENTA_USD` (`0011-0123-000002` con `moneda: 'USD'`).
  Sustituida por `CUENTA_PEN_2` (`0011-0123-000002`, PEN, `usr-cliente-2`) y `BILLETERA_USD_1` / `BILLETERA_USD_2`
  con la forma que devuelve `consultarCuenta` para USD (INT-R04: `numero` = UUID, `estado: 'ACTIVA'`, `moneda: 'USD'`,
  `titularId` = `user_id`). `verificarTitular` (SEG-R11) y `esTitular` (SEG-R12) se prueban ahora con cuenta PEN
  propia/ajena **y** billetera USD propia/ajena; AGENTE y CAJERO a las cuatro.
- `tests/integration/seguridad/seguridad.test.js` (SEG-T06): el depósito a `0011-0123-000002` se envía con
  `moneda: 'PEN'` (antes `'USD'`; con la cuenta ya PEN el 403 dependía del orden titular/moneda en el service).
  Nuevo control: `usr-cliente-2` (titular) a `0011-0123-000002` → 201 y una acreditación PEN, que demuestra que el
  403 se debe solo al titular. `afterEach` del bloque SEG-T06 espera la auditoría (`esperarAuditoria`, mismo patrón
  que `registrar.test.js`) antes del `TRUNCATE` del siguiente `limpiar()`, para evitar deadlocks.
- SEG-T06 vía endpoint con billetera USD (`22222222-…`) **no** se añade: no es un caso de SPEC-03 y
  `registrar-deposito/schema.js:7` aún solo acepta el formato PEN (RD-R02 de dos formatos es el retrabajo de SPEC-07).
  La regla de titular sobre billetera USD queda cubierta en la unitaria.

### Casos cubiertos

| Caso | Archivo | Resultado |
|---|---|---|
| SEG-T01 sin `Authorization` → 401 `TOKEN_REQUERIDO` (+ `Basic …`, `Bearer ` vacío, sin `Bearer`) | `tests/integration/seguridad/seguridad.test.js` | ✅ |
| SEG-T02 `exp` en el pasado → 401 `TOKEN_EXPIRADO` | `tests/integration/seguridad/seguridad.test.js` | ✅ |
| SEG-T03 firmado con otra clave → 401 `TOKEN_INVALIDO` | `tests/integration/seguridad/seguridad.test.js` | ✅ |
| SEG-T04 `alg: none` → 401 `TOKEN_INVALIDO` | `tests/integration/seguridad/seguridad.test.js` | ✅ |
| SEG-T05 `aud` distinto → 401 `TOKEN_INVALIDO` | `tests/integration/seguridad/seguridad.test.js` | ✅ |
| SEG-T06 `usr-cliente-1` deposita (APP, PEN) a `0011-0123-000002` → 403 `SIN_PERMISO`; billetera consultada 1 vez, 0 acreditaciones; 0 filas en `depositos`; auditoría `ERROR_403`. Controles: `usr-cliente-1` a su cuenta y `usr-cliente-2` a `000002` → 201 con 1 acreditación | `tests/integration/seguridad/seguridad.test.js` | ✅ |
| SEG-T07 `verificarCanal` CLIENTE + VENTANILLA → `ErrorApp` `SIN_PERMISO` (403) | `tests/unit/seguridad/permisos.test.js` | ✅ |
| SEG-T08 sin `X-Correlation-Id` → UUID (distinto por petición); con `abc` → `abc`; también en header y cuerpo de un 401 | `tests/integration/seguridad/seguridad.test.js` | ✅ |
| SEG-T09 500 forzado → el log no contiene el JWT, su firma ni la cuenta completa; sí `status: 500` y `duracionMs` | `tests/integration/seguridad/seguridad.test.js` | ✅ |
| SEG-T10 `requiereRol('AGENTE')` con token CLIENTE → 403 `{ codigo: SIN_PERMISO, mensaje, correlationId }` | `tests/integration/seguridad/seguridad.test.js` | ✅ |

Pruebas extra (SEG-R01/R03/R06/R08–R13), todas ✅: token mal formado y payload firmado sin `sub`/`sub` vacío/
`roles` vacío, ausente o no arreglo → `TOKEN_INVALIDO`; `req.usuario`; `/health` sin token; `requiereRol` con varios
roles, sin `req.usuario`, sin roles al construir; correlation id de 100/101 caracteres y caracteres inválidos; log de
petición cortada en `autenticar`; tabla rol × canal completa y congelada; varios roles; `verificarTitular`/`esTitular`
con cuentas PEN y billeteras USD de §4.

### Casos en `test.todo`

Ninguno de SPEC-03. (El único `todo` de la suite completa no es de esta spec.)

### Pruebas fallidas

Ninguna.

### Cobertura (`src/core/` y `src/modules/`), corrida completa de `init.sh`

```
File                         | % Stmts | % Branch | % Funcs | % Lines
All files                    |   99.72 |     95.1 |   99.23 |   99.84
 core                        |   99.46 |    94.73 |   97.14 |   99.42
  permisos.js                |     100 |      100 |     100 |     100
 core/clients                |     100 |    95.12 |     100 |     100
 core/middlewares            |     100 |    94.87 |     100 |     100
  auth.js                    |     100 |      100 |     100 |     100
  correlationId.js           |     100 |    77.77 |     100 |     100
 modules/registrar-deposito  |     100 |      100 |     100 |     100
```

- Todo `src/core/` y `src/modules/` ≥ 80 % (umbral cumplido). `correlationId.js:18` (rama de fallback de
  `rutaParaLog`) sigue sin cubrir: inalcanzable en Express; el archivo está al 100 % en líneas.

## SPEC-04

- **Agente:** tester · **Fecha:** 2026-10-30 · **Feature:** 4 (`auditoria`)
- **Ejecución:** `bash init.sh` completo → verde (8 suites, 105 passed, 5 todo). PostgreSQL real
  (`DATABASE_URL_TEST`); `limpiar()` en `beforeEach` (su `TRUNCATE` funciona pese al trigger, verificado en AUD-T05).
- **App de prueba:** SPEC-06 (`crearApp`) aún no existe → app Express mínima con el orden de PIP-R11:
  `correlationId → auditoria → /health → autenticar → express.json → rutas → manejadorErrores`.
  Las rutas son falsas pero con el mismo método y path que las auditadas (`POST /api/v1/depositos`,
  `GET /api/v1/depositos/:id`, `GET /api/v1/cuentas/:numero/depositos`). Las filas se leen con
  reintentos cortos (hasta 1 s), como pide §6.

### Casos cubiertos

| Caso | Archivo | Resultado |
|---|---|---|
| AUD-T03 POST sin token → 401; 1 fila `CREAR_DEPOSITO` `ERROR_401`, `usuario_id` y `deposito_id` nulos, `correlation_id` el de la petición | `tests/integration/auditoria/auditoria.test.js` | ✅ |
| AUD-T05 `UPDATE` y `DELETE` directos → ambos lanzan `auditoria_depositos es solo de inserción`; la fila sigue intacta; `TRUNCATE` sí limpia | idem | ✅ |
| AUD-T06 `insertar` forzado a rechazar (error con la cuenta en mensaje/detail) → respuesta 201 normal con su cuerpo y X-Correlation-Id; `logger.error` 1 vez con `{correlationId, accion}` y sin la cuenta completa ni `0011-0123`; 0 filas | idem | ✅ |
| AUD-T07 `GET /api/v1/depositos/{id}` → 1 fila `CONSULTAR_DEPOSITO`, `EXITO`, usuario del token | idem | ✅ |
| AUD-T08 `GET /health` → 0 filas (esperando el 1 s completo) | idem | ✅ |

Justificación de AUD-T06 y AUD-T07 con ruta falsa: lo que verifican (acción deducida de método+path,
respuesta intacta ante fallo del INSERT, log sin datos sensibles) depende solo del middleware, no del
controller. Ninguno de los dos exige un depósito real ni `deposito_id` lleno.

Pruebas extra (reglas sin caso numerado), mismo archivo, todas ✅:
- AUD-R07/R08: `canal` VENTANILLA y `monto` "0.01" válidos se guardan; con token → `usuario_id` y `EXITO`.
- AUD-R07: canal fuera de lista/minúsculas, monto numérico `10`, monto `"10.001"` y body array → `canal` y `monto` null.
- AUD-R08: JSON mal formado → fila `ERROR_400`.
- AUD-R02: `GET /cuentas/{numero}/depositos?pagina=1` → `LISTAR_DEPOSITOS`; rutas no listadas, 404 inexistentes, `DELETE /depositos/{id}` y `GET /depositos` → 0 filas; `deducirAccion` sin distinguir mayúsculas, con barra final y con query.
- AUD-R07: `extraerDelBody` con body `undefined`/`null`.

### Casos en `test.todo`

Ninguno (estado vigente, 2026-11-02). AUD-T01, AUD-T02 y AUD-T04 eran `test.todo` (esperaban SPEC-07, y
AUD-T04 también SPEC-05) y **se convirtieron en pruebas reales** al probar SPEC-07:

| Caso | Archivo | Resultado |
|---|---|---|
| AUD-T01 depósito válido → 1 fila `CREAR_DEPOSITO` `EXITO` con `deposito_id` = id de la respuesta | `tests/integration/auditoria/auditoria.test.js` | ✅ |
| AUD-T02 monto `"-5"` → 422; 1 fila `ERROR_422`, `deposito_id` nulo, monto -5.00 | idem | ✅ |
| AUD-T04 3 POST con la misma clave → 3 filas con el mismo `deposito_id`, 1 depósito, 1 acreditación | idem | ✅ |

Las cifras de `Tests:` de esta sección (`5 todo`) son de la corrida original de SPEC-04.

### Pruebas fallidas

Ninguna.

### Cobertura (`src/core/` y `src/modules/`)

```
-------------------------|---------|----------|---------|---------|-------------------
File                     | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
-------------------------|---------|----------|---------|---------|-------------------
All files                |   99.47 |    92.91 |   97.67 |   99.43 |
 core/middlewares        |     100 |     92.1 |     100 |     100 |
  auditoria.js           |     100 |    88.88 |     100 |     100 | 55-65
 core/repositories       |     100 |      100 |     100 |     100 |
  auditoriaRepository.js |     100 |      100 |     100 |     100 |
-------------------------|---------|----------|---------|---------|-------------------
Tests:       5 todo, 105 passed, 110 total
```

- `src/core/`: 98,64 % stmts · 94,59 % branches (≥ 80 %). `src/modules/` aún sin código.
- Ramas no cubiertas de `auditoria.js` (55-65): los `?? null` de `req.ip`, `req.correlationId` y `err?.code` (siempre definidos en la app real).

## SPEC-05

- **Agente:** tester · **Fecha:** 2026-11-02 · **Feature:** 5 (`idempotencia`)
- **Ejecución:** `bash init.sh` completo → `EXIT=0`. PostgreSQL real (`deposito_test`), `--runInBand`.
  `[OK] SPEC-05: todos sus casos tienen prueba (todo: IDE-T02..T08, IDE-T10)` · alcance OK (96 archivos)
  · `Test Suites: 9 passed · Tests: 13 todo, 129 passed, 142 total`.
- **App de prueba:** SPEC-06/07 aún no existen → app Express mínima en el orden de SPEC-05 §6:
  `correlationId → autenticar → express.json → POST /api/v1/depositos [idempotencia → controller falso] → manejadorErrores`.
  El controller falso lo define cada prueba (status, cuerpo, `res.locals.depositoId`, `ErrorApp` 502,
  error no controlado 500, o espera bloqueada para simular "billetera lenta"). Un observador en `finish`
  captura `res.locals.depositoId` y `req.idempotencia`. Los depósitos referenciados (FK) se insertan
  en `depositos` con la cuenta `0011-0123-456789` (SPEC-02 §4); usuarios `usr-agente-1`/`usr-agente-2`.
- Archivo único (el que nombra el §2): `tests/integration/idempotencia/idempotencia.test.js`.

### Casos cubiertos

| Caso | Archivo | Resultado |
|---|---|---|
| IDE-T01 clave nueva → controller 1 vez, 201 sin `Idempotency-Replayed`; fila `TERMINADO`, `status_http` 201, `respuesta` = cuerpo, `deposito_id` = `res.locals.depositoId` | `tests/integration/idempotencia/idempotencia.test.js` | ✅ |
| IDE-T01 (variante) respuesta 422 → fila `TERMINADO` con 422 y `deposito_id` nulo | idem | ✅ |
| IDE-T09 sin header → 400 `{ codigo: IDEMPOTENCY_KEY_REQUERIDA, mensaje, correlationId }`; controller 0 veces; 0 filas | idem | ✅ |
| IDE-T09 clave de 7 caracteres → 400 `IDEMPOTENCY_KEY_REQUERIDA`; controller 0 veces; 0 filas | idem | ✅ |

Pruebas extra por regla (sin caso numerado; cubren con controller falso lo que SPEC-07 probará de punta a punta), mismo archivo, todas ✅:

- IDE-R01: `claveValida` con 8 y 100 (válidas), 7, 101, vacía, `undefined`, número (inválidas); por HTTP 101 → 400, 8 y 100 → 201.
- IDE-R03: `calcularHash` = SHA-256 de `"POST /api/v1/depositos?x=1 {…}"` con llaves ordenadas recursivamente y arrays en orden; body `undefined`; `hash_solicitud` en BD igual al esperado.
- IDE-R07 (≈ IDE-T02 sin billetera): repetición con llaves en otro orden → mismo status y cuerpo, `Idempotency-Replayed: true`, `X-Correlation-Id` de la petición actual, `res.locals.depositoId` asignado, controller 1 vez; respuesta guardada sin `deposito_id` → no asigna `res.locals.depositoId`; sin middleware correlationId → sin `X-Correlation-Id`.
- IDE-R05 (≈ IDE-T03/T04): monto distinto → 409 `IDEMPOTENCY_KEY_REUTILIZADA` con el cuerpo de §5; clave `EN_PROCESO` (controller bloqueado, 2.º POST a los 100 ms) → 409 `SOLICITUD_EN_PROCESO` con el cuerpo exacto de §5; con `EN_PROCESO` y hash distinto gana `REUTILIZADA`; la fila desaparece entre el INSERT en conflicto y el SELECT → 409 `SOLICITUD_EN_PROCESO`.
- IDE-R04 (≈ IDE-T05): 5 POST simultáneos → controller 1 vez, 1×201 y 4×409 `SOLICITUD_EN_PROCESO`, 1 fila.
- IDE-R02 (≈ IDE-T10): `usr-agente-1` y `usr-agente-2` con la misma clave → ambos procesados, 2 filas `TERMINADO`.
- IDE-R08 (≈ IDE-T06/T08): 500 → clave borrada y el reintento se procesa como nuevo (sin `req.idempotencia`); 502 sin `depositoId` → clave borrada; 502 con `depositoId` → `REINTENTABLE` con ese `deposito_id`; guardado que falla (FK con id inexistente, y `terminar` rechazado sin `code`) → 201 igual, `logger.error` 1 vez con `{ correlationId, status, codigoError }` y sin cuenta ni clave; la fila queda `EN_PROCESO`.
- IDE-R06: reintento de `REINTENTABLE` → `req.idempotencia = { depositoIdPrevio }`, 201 y fila `TERMINADO` con el mismo `deposito_id`; la 3.ª petición se repite; reintento en curso + otro → 409; carrera real en PostgreSQL (otra petición pasa la fila a `EN_PROCESO` entre el SELECT y el UPDATE) → UPDATE de 0 filas → 409 `SOLICITUD_EN_PROCESO`.
- IDE-R09: `borrarAntiguas(pool, config.idempotenciaDias)` (7) borra las 3 claves de más de 7 días en `EN_PROCESO`, `TERMINADO` y `REINTENTABLE`, conserva las de 6 y 0 días y devuelve 3; `limpiarClaves.iniciar()` programa `setInterval` de 3 600 000 ms con `unref()`, la tarea borra y loguea `{ borradas: 3 }`; si `borrarAntiguas` falla → `logger.error({ codigoError })` (con y sin `code`) y la tarea no rechaza.

Nota: los `jest.spyOn` sobre `idempotenciaRepository` envuelven la llamada real (provocan la carrera con
SQL real sobre PostgreSQL) o fuerzan un rechazo para la rama de fallo del guardado/limpieza; PostgreSQL
no se mockea. `setInterval` se espía solo para no esperar 1 h.

### Casos en `test.todo`

Ninguno (estado vigente, 2026-11-02). IDE-T02..T08 e IDE-T10 eran `test.todo` (esperaban SPEC-07) y **se
convirtieron en pruebas reales** con la ruta real y billetera en nock al probar SPEC-07, todas ✅ en
`tests/integration/idempotencia/idempotencia.test.js`:

| Caso | Resultado |
|---|---|
| IDE-T02 repetir → mismo status y cuerpo, `Idempotency-Replayed: true`, billetera 1 vez | ✅ |
| IDE-T03 misma clave, monto distinto → 409 `IDEMPOTENCY_KEY_REUTILIZADA` | ✅ |
| IDE-T04 billetera tarda 2 s → segundo POST 409 `SOLICITUD_EN_PROCESO` | ✅ |
| IDE-T05 5 POST simultáneos → 1 depósito, 1 acreditación | ✅ |
| IDE-T06 billetera 500 al acreditar, reintento → mismo `id` y mismo `depositoId` a billetera | ✅ |
| IDE-T07 timeout, reintento con billetera 409 → 201 COMPLETADO | ✅ |
| IDE-T08 billetera 500 al consultar, reintento → se procesa como nuevo | ✅ |
| IDE-T10 dos agentes, misma clave → ambos procesados | ✅ |

AUD-T04 (auditoría), que esperaba SPEC-05 y SPEC-07, también es prueba real desde SPEC-07. Las cifras de
`Tests:` de esta sección (`13 todo`) son de la corrida original de SPEC-05.

### Pruebas fallidas

Ninguna.

### Cobertura (`src/core/` y `src/modules/`)

```
----------------------------|---------|----------|---------|---------|-------------------
File                        | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
----------------------------|---------|----------|---------|---------|-------------------
All files                   |   99.64 |    94.38 |   98.38 |   99.61 |
 core/middlewares           |     100 |    94.87 |     100 |     100 |
  idempotencia.js           |     100 |      100 |     100 |     100 |
 core/repositories          |     100 |     87.5 |     100 |     100 |
  idempotenciaRepository.js |     100 |     87.5 |     100 |     100 | 41
 core/tareas                |     100 |      100 |     100 |     100 |
  limpiarClaves.js          |     100 |      100 |     100 |     100 |
----------------------------|---------|----------|---------|---------|-------------------
Test Suites: 9 passed, 9 total
Tests:       13 todo, 129 passed, 142 total
```

- `src/core/`: de ~67 % a 99,64 % stmts · 94,38 % branches (≥ 80 %). `src/modules/` aún sin código.
- Rama no cubierta de `idempotenciaRepository.js:41`: `respuesta ?? null` / `depositoId ?? null` en `terminar` cuando llegan `undefined` (el middleware ya pasa `null`).

## SPEC-06

- **Tester** · 2026-11-02 · `bash init.sh` completo con PostgreSQL real: **verde** (12 suites, 177 passed + 12 todo).
- **Módulos falsos:** `tests/core/fixtures/` (validadores, transformadores, post-procesos, endpoint, módulo de tipo
  equivocado y estado compartido `registro.js`). `fixtures/modulos.js` los registra con
  `jest.doMock(src/modules/<id>, ..., { virtual: true })`, que es la ruta que `cargar` pasa a `require`.
  Ninguna prueba usa las features reales; los manifests son objetos.

### Casos cubiertos

| Caso | Archivo |
|---|---|
| PIP-T01 manifest sin extensiones → los 4 huecos no hacen nada (también `features: []`) | `tests/core/pipeline.test.js` |
| PIP-T02 validadores orden 20 y 10 → corre primero el 10 | `tests/core/pipeline.test.js` |
| PIP-T03 validador lanza → el siguiente no corre; el `ErrorApp` llega intacto (mismo código, status, mensaje) | `tests/core/pipeline.test.js` |
| PIP-T04 dos transformadores → el segundo recibe el objeto devuelto por el primero | `tests/core/pipeline.test.js` |
| PIP-T05 post-proceso lanza → no se propaga; `logger.error` (logger.child `{ correlationId, modulo }`) con `depositoId`; el siguiente corre | `tests/core/pipeline.test.js` |
| PIP-T06 `leerExtensiones` con `null` → la clave no aparece | `tests/core/pipeline.test.js` |
| PIP-T07 feature activa inexistente → `cargar` lanza; `crearApp` también (la app no arranca) | `tests/core/cargador.test.js` |
| PIP-T08 tipo distinto al del manifest → `cargar` lanza; el pipeline anterior no queda a medias | `tests/core/cargador.test.js` |
| PIP-T09 feature `inactivo` → la fábrica del módulo no se ejecuta (y control: la misma activa sí) | `tests/core/cargador.test.js` |
| PIP-T10 ruta inexistente con token → 404 `RUTA_NO_ENCONTRADA` con el cuerpo exacto de §5 | `tests/core/cargador.test.js` |
| PRY-T01 (SPEC-00) `GET /health` sin token → 200 `{ "estado": "ok" }` — **deja de ser `test.todo`** | `tests/core/proyecto.test.js` |

Pruebas adicionales por regla:

- PIP-R02: transformador lanza → `ErrorApp('ERROR_INTERNO')` 500, el siguiente no corre, `logger.error` con
  `{ depositoId, error, codigoError }` (sin el objeto de error completo).
- PIP-R03: `persistir` recibe el mismo `deposito` y `tx`, solo en transformadores que lo tienen; si lanza se propaga.
- PIP-R07: `privado` distinto por id e idéntico entre `ejecutar` y `persistir`; el contexto del service no se
  modifica; el módulo recibe `usuario`, `cuenta`, `correlationId`, `db` y `logger.child({ correlationId, modulo })`.
- PIP-R08: a igual `orden`, gana la posición del manifest; `cargar` devuelve los routers de endpoints activos.
- PIP-R10: errores del módulo registrados en el catálogo; `cargar` dos veces con el mismo módulo no lanza.
- Contrato §4: validador con error ≠ 422, manifest sin `features`, feature sin id, tipo desconocido, extensión
  sin `orden`, id repetido, id `../core`, id exportado distinto, endpoint sin `router`, extensión sin `ejecutar`
  → `cargar` lanza; un `MODULE_NOT_FOUND` interno del módulo se relanza tal cual.
- PIP-R11 (unit): sin token → 401 antes del 404; router montado en `/api/v1` con `req.usuario`; el mismo endpoint
  inactivo → 404; `express.json` montado (body parseado; JSON roto → 400 `FORMATO_INVALIDO`); `trust proxy` =
  `config.trustProxy`.
- PIP-R12: `crearApp` no llama a `limpiarClaves.iniciar()`.

### `test.todo` anteriores revisados (arrastres para SPEC-06)

- **PRY-T01** → convertido en prueba real (arriba). La sección `## SPEC-00` de este reporte aún lo lista como
  `todo`; no se edita por ser de otra spec.
- **SPEC-04 → SPEC-06: `req.ip` con `X-Forwarded-For` y `trust proxy`; orden PIP-R11** → nuevas pruebas de
  integración con PostgreSQL real en `tests/integration/pipeline-y-cargador/app.test.js`, sobre `crearApp`:
  - `TRUST_PROXY=1` y `X-Forwarded-For: 198.51.100.1, 203.0.113.7` → fila de auditoría con `ip = 203.0.113.7`
    (último salto), `ERROR_401`, `correlation_id` de la petición.
  - Sin `X-Forwarded-For` → `ip` de la conexión (loopback).
  - Con token y sin endpoints → 404 y fila con `usuario_id`, `canal`, `monto` (auditoria antes de autenticar y
    `express.json` antes del 404).
  - `GET /health` y rutas no auditadas → 0 filas.
- **SPEC-03 → SPEC-06: `correlationId` primero y `autenticar` después de `/health`** → cubierto por PRY-T01
  (con `X-Correlation-Id`), PIP-T10 y la prueba de 401 antes del 404.
- Siguen en `todo` (esperan SPEC-07): SEG-T06; AUD-T01, AUD-T02, AUD-T04; IDE-T02..T08, IDE-T10.

### Casos en `test.todo`

Ninguno de SPEC-06.

### Pruebas fallidas

Ninguna.

**Observación (no es caso de la spec, no hay prueba roja):** un body de más de 100 kb (`express.json` con
`limit: '100kb'`) responde **500 `ERROR_INTERNO`**: `src/core/middlewares/manejadorErrores.js:24-30` solo traduce
`entity.parse.failed`; el `entity.too.large` de body-parser cae en el error no controlado. SPEC-01/06 no definen
qué código usar (413 no está en el catálogo), así que la prueba solo exige que el body no llegue al router
(status ≥ 400). Decisión para el humano/leader.

### Cobertura (`src/core/` y `src/modules/`)

```
----------------------------|---------|----------|---------|---------|-------------------
File                        | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
----------------------------|---------|----------|---------|---------|-------------------
All files                   |   99.49 |    93.72 |   98.76 |   99.72 |
 core                       |   98.93 |    92.98 |   97.14 |   99.42 |
  cargador.js               |     100 |      100 |     100 |     100 |
  pipeline.js               |   98.18 |    78.57 |     100 |     100 | 54-80,106-120
----------------------------|---------|----------|---------|---------|-------------------
Test Suites: 12 passed, 12 total
Tests:       12 todo, 177 passed, 189 total
```

- `src/core/`: de 71,13 % stmts / 65,88 % branches (sin pruebas de SPEC-06) a **99,49 % stmts · 93,72 % branches**
  (≥ 80 %). `cargador.js` 100 %; `pipeline.js` 98 % stmts / 100 % líneas. `src/modules/` aún sin código.
- Ramas no cubiertas de `pipeline.js`: los `?? null` defensivos (`correlationId`, `actual?.id`, `deposito?.id`,
  `err?.message`) y el `catch` de `ejecutarPostProcesos` cuando falla el propio `contextoDe` (línea 106).

### Retrabajo v1.2 (2026-11-09)

- **Tester** · 2026-11-09 · Spec v1.1 → v1.2: PIP-R12 (`server.js` llama también a `reconciliacion.iniciar()`)
  y §4 (`deposito.titularId`; contexto de reconciliación `usuario = { id, roles: [] }`, `cuenta = null`).
  No añade casos PIP-Tnn. No toqué `src/`, `specs-v2/` ni helpers/setup de `tests/`.

**1. PIP-R12**
- `tests/core/cargador.test.js`: la prueba `PIP-R12 crearApp no inicia la tarea de limpieza` pasa a llamarse
  `PIP-R12 crearApp no inicia tareas (ni limpieza de claves ni reconciliación)`. Ahora espía también
  `reconciliacion.iniciar` (`src/modules/registrar-deposito/reconciliacion.js`) y comprueba que `crearApp` no lo llama. ✅
- **Sin prueba de `src/server.js`.** No hay ninguna en `tests/`. Las pruebas de `limpiarClaves.iniciar()`
  (`tests/integration/idempotencia/idempotencia.test.js`) prueban la tarea, no el punto de entrada. `server.js` hace
  `listen` y lee el manifest al hacer `require`. Para probarlo habría que mockear `app.listen`, `fs` y las dos tareas, y
  eso no sigue el estilo actual. Por eso no la invento (indicación del líder). Revisé a mano `src/server.js:21-26`:
  llama a `crearApp` → `limpiarClaves.iniciar()` → `reconciliacion.iniciar()` → `listen`, como pide PIP-R12.

**2. Pruebas de SPEC-06 obsoletas por el §4 nuevo:** ninguna.
- El pipeline pasa el depósito y el contexto tal cual, así que ninguna prueba de `tests/core/` dependía de la
  ausencia de `titularId` ni de que `cuenta` no fuera nula.
- Único ajuste de fidelidad: `nuevoDeposito()` de `tests/core/pipeline.test.js` incluye
  `titularId: 'usr-cliente-1'` (campo del §4 v1.2, dato de SPEC-02 §4). Ninguna aserción cambia.
- El contexto con `cuenta = null` en post-procesos ya lo cubren las pruebas de SPEC-07 (`RD-R08`, reintento).
  Con la reconciliación lo cubrirán RD-T22..T24.

**3. Ajustes mínimos en `tests/unit/registrar-deposito/service.test.js` (SPEC-07, contrato actual)**
1. `prepararDependencias()` (l. 55): el mock por defecto de `billeteraClient.acreditar` resuelve
   `{ estado: 'ACREDITADO' }` en vez de `undefined` (SPEC-02 v2.2: `acreditar` siempre resuelve `{ estado }`).
   Esto arregla 10 pruebas: RD-T03, RD-T11, RD-T12, RD-T13, RD-T18, RD-R03 (sin referencia), RD-R03/R05, RD-R04,
   RD-R08 (FALLIDO) y RD-R09.
2. `insertar guarda montos…` (l. 389/393): la entrada lleva `titularId: 'usr-cliente-1'` y se esperan **10**
   parámetros. El último es `'usr-cliente-1'` (`titular_id`, DOM-R11 / RD-R05).
3. Título de RD-R08 (l. 313): `…/usuario_id/canal guardados` → `…/titular_id/canal guardados`. La aserción
   ya comprobaba `titularId`.
- No escribí RD-T19..T24, no convertí el `test.todo` de RD-T18 ni cambié la billetera de RD-T18. Eso queda para el
  tester de SPEC-07.

**Ejecución `bash init.sh` completo (PostgreSQL real), 1 corrida, sin deadlock de `TRUNCATE`:**
- Pruebas: **23 suites passed, 451 passed, 1 todo (RD-T18 body idéntico), 0 fallidas.**
- Avisos (features reabiertas): SPEC-07 sin RD-T19..T24; SPEC-08 sin CD-T14, CD-T15; SPEC-11 sin CM-T09.
- **`init.sh` termina en FAIL por cobertura:** `Jest: "./src/modules/" coverage threshold for branches (80%) not met: 75%`.
  - La causa es el código nuevo de SPEC-07 que todavía no tiene pruebas:
    `src/modules/registrar-deposito/reconciliacion.js` (28.57 % stmts, 0 % branches, l. 12-37) y
    `service.js` l. 165-241 (`reconciliar`), además de `repository.js` l. 60-70 (`tomarParaReconciliar`).
  - `modules/registrar-deposito`: 65.08 % stmts / 58.75 % branches.
  - No es un fallo de una prueba ni de SPEC-06. No bajo el umbral, y no puedo escribir RD-T22..T24, que son las que
    lo cubren (fuera de este encargo).
  - Debería quedar verde cuando el tester de SPEC-07 cubra la reconciliación.
- Cobertura `src/core/`: 99.46 % stmts / 94.73 % branches. `cargador.js` 100 %; `pipeline.js` 100 % stmts / 82.14 % branches.
  Total: 92.8 % stmts / 88.86 % branches. Los demás `modules/*` ≥ 98.7 % stmts.

## SPEC-07

- **Tester** · 2026-11-03 · Feature 7 (`registrar-deposito`) · **retrabajo Billetera USD (spec v2.0)**, rama `inte_biUsd`.
- **Ejecución:** `bash init.sh` completo con PostgreSQL real (`deposito_test`) → **`EXIT=0`**.
  `[OK] SPEC-07: todos sus casos tienen prueba` · alcance OK (178 archivos) ·
  `Test Suites: 23 passed, 23 total` · `Tests: 1 todo, 392 passed, 393 total`.
- Integración: `crearApp({ manifest })` dentro de cada prueba; `registrar-deposito` activo y `limites-por-canal`,
  `conversion-moneda`, `alerta-uif` **inactivas** (SPEC-07 §6). Billeteras PEN y USD con los helpers nock de
  SPEC-02 (`tests/helpers/billetera.js`). Datos solo de SPEC-02 §4. `limpiar()` en `beforeEach`; en `afterEach`
  (y entre las dos peticiones de RD-T18) se espera a la auditoría antes de limpiar (`esperarAuditoria`).
- Unitarias: el service con todas sus dependencias espiadas; el repository con un `db` simulado.

### Retrabajo v2.0: casos nuevos (Billetera USD)

| Caso | Archivo(s) |
|---|---|
| RD-T13 `usr-agente-1` `"150.00"` USD AGENTE a `11111111-…` → 201 COMPLETADO (cuerpo §5); 1 fila con `cuenta_destino` UUID; Billetera USD recibió 1 POST con `Idempotency-Key` = `id`, `X-Correlation-Id`, body exacto `{ cliente_id: "usr-agente-1", cuenta_destino_id, monto: "150.00", moneda: "USD", metodo_origen: "EFECTIVO", referencia_externa: id }`; billetera PEN no llamada | `tests/integration/registrar-deposito/registrar.test.js` + `tests/unit/registrar-deposito/service.test.js` (`acreditar` recibe `{ depositoId, cuenta, monto Decimal, moneda, usuarioId, canal }`) |
| RD-T14 `"100.00"` PEN a `11111111-…` con `conversion-moneda` inactiva → 422 `MONEDA_NO_SOPORTADA`; 0 filas; sin acreditación | integración + unitaria |
| RD-T15 UUID incompleto (3 variantes) o con mayúsculas (2 variantes) → 400 `FORMATO_INVALIDO`; billetera no llamada; 0 filas | integración + unitaria (schema; UUID en minúsculas y cuenta PEN siguen válidos) |
| RD-T16 Billetera USD 404 al consultar → 422 `CUENTA_NO_ENCONTRADA`; 0 filas; sin acreditación | integración + unitaria |
| RD-T17 Billetera USD 409 al acreditar → 502 `BILLETERA_NO_DISPONIBLE`; depósito FALLIDO; clave `REINTENTABLE` | integración + unitaria |
| RD-T18 `99999999-…` 500 al acreditar → 502 FALLIDO (clave `REINTENTABLE`); reintento HTTP con la **misma** `Idempotency-Key` y billetera OK (200 replay) → 201, mismo `id`, COMPLETADO, 1 fila, clave `TERMINADO`; sin nueva consulta; la 2.ª petición a Billetera USD lleva la **misma** `Idempotency-Key` y un body `toEqual` al de la 1.ª | integración + unitaria (el reintento, hecho por otro usuario, pasa a `acreditar` exactamente los mismos datos: `usuarioId`/`canal` salen de la fila, RD-R08) |

Nota RD-T18: el helper `billeteraUsdExiste` solo conoce `11111111-…` y `22222222-…` (no se puede editar), así que la
consulta de `99999999-…` se intercepta con nock dentro de la prueba con los datos de SPEC-02 §4 / mock
(USD, sin titular). Billetera sigue simulada solo con nock.

### Retrabajo v2.0: pruebas existentes actualizadas (obsoletas por RD-R02 / `acreditar` / RD-R08)

- `tests/unit/registrar-deposito/service.test.js`:
  - RD-T11 y RD-T12: ahora comprueban que `acreditar` recibe `usuarioId: "usr-agente-1"` y `canal: "AGENTE"`.
  - `RD-R08 reintentar FALLIDO …`: la fila guardada tiene `usuario_id: usr-cajero-1`, `canal: VENTANILLA` y se
    comprueba que `acreditar` recibe esos (no los del JWT del que reintenta).
  - `schema e index`: añade que un UUID en minúsculas es válido (RD-R02 v2.0).
- `tests/integration/registrar-deposito/registrar.test.js`: RD-T01..T12 siguen válidas sin cambios (PEN; el body
  PEN de INT-R12 no lleva `usuarioId`/`canal`). Se añadió `require('../../../src/config')` para el nock de RD-T18.
- No se tocó el `test.todo` `CM-R03 PEN → USD …` de `tests/integration/conversion-moneda/conversion.test.js`: es de
  SPEC-11 y lo desbloquea este retrabajo (el schema ya acepta UUID), pero se convierte en el retrabajo de SPEC-11.

### Casos cubiertos (v1, vigentes)
| Caso | Archivo(s) |
|---|---|
| RD-T01 `usr-agente-1` `"150.00"` PEN AGENTE → 201 COMPLETADO (cuerpo exacto de §5, `extensiones: {}`); 1 fila; billetera recibió `{ depositoId, monto: "150.00", moneda, concepto }` 1 vez; clave `TERMINADO` | `tests/integration/registrar-deposito/registrar.test.js` |
| RD-T02 `"0"`, `"-1"`, `"10.001"` → 422 `MONTO_INVALIDO`; 0 filas; billetera no llamada | integración + `tests/unit/registrar-deposito/service.test.js` |
| RD-T03 `"0.01"` → 201; billetera recibe `"0.01"` | integración + unitaria |
| RD-T04 sin `cuentaDestino` / monto número `150` / `"x": 1` → 400 `FORMATO_INVALIDO`; 0 filas; billetera no llamada | integración |
| RD-T05 billetera 404 al consultar → 422 `CUENTA_NO_ENCONTRADA` | integración + unitaria |
| RD-T06 `0011-0123-000003` BLOQUEADA → 422 `CUENTA_INACTIVA` | integración + unitaria |
| RD-T07 billetera 500 al acreditar → 502; depósito FALLIDO; clave `REINTENTABLE` con el `deposito_id` | integración + unitaria (`ErrorApp` con `depositoId`) |
| RD-T08 billetera tarda 6 s al acreditar → 502; depósito FALLIDO | integración |
| RD-T09 billetera 500 al consultar → 502; 0 filas; sin acreditación; la clave se borra | integración + unitaria |
| RD-T10 `"100.00"` USD a cuenta PEN → 422 `MONEDA_NO_SOPORTADA`; 0 filas | integración + unitaria |
| RD-T11 spy de `cambiarEstado` → `(pool, id, PENDIENTE, PROCESANDO)` y luego `(pool, id, PROCESANDO, COMPLETADO)` | integración (BD real) + unitaria |
| RD-T12 `reintentar` de un FALLIDO con billetera OK → mismo `id`, COMPLETADO, sin `consultarCuenta`, sin validadores/transformadores | integración (BD real, `service.reintentar`) + unitaria |

Pruebas adicionales por regla (todas ✅):

- **Feature activa/inactiva:** `registrar-deposito` `inactivo` en el manifest → 404 `RUTA_NO_ENCONTRADA`, billetera
  no llamada (integración); activa → todos los casos anteriores.
- **RD-R01/R02:** cuenta mal formada, `"150,00"`, 14 dígitos enteros, `EUR`, `WEB`, referencia vacía / de 141 /
  no string, body arreglo → 400; referencia de 140 y `"1234567890123.45"` → 201.
- **RD-R03/R05:** `deposito` con id UUID v4, `monto`/`montoAcreditar` `Decimal`, `referencia ?? null`,
  `extensiones: {}`; `contexto` con `usuario`, `cuenta`, `correlationId`, `logger`, `db = pool`; el **mismo** objeto
  `contexto` llega a validadores, transformadores, `persistirTransformadores` y post-procesos (PIP-R07).
- **RD-R04:** orden exacto del diagrama registrado paso a paso (consulta → canal → titular → validadores →
  transformadores → BEGIN → insertar → persistir → COMMIT → PENDIENTE→PROCESANDO → acreditar → COMPLETADO →
  post-procesos); `insertar` y `persistir` reciben el `tx`.
- **RD-R06:** con BD real, `cambiarEstado` desde un estado que no es el actual → lanza y la fila no cambia;
  transiciones fuera de SPEC-01 → lanzan sin consulta; `actualizado_en` se actualiza; `buscarPorId` inexistente → `null`.
- **RD-R07:** `persistirTransformadores` falla después del INSERT → 500 `ERROR_INTERNO`, **0 filas** (rollback real),
  billetera no llamada, la clave se borra. Unitaria: el INSERT falla → ni `acreditar` ni `cambiarEstado`.
- **RD-R08:** reintento de COMPLETADO → se devuelve sin billetera; de PENDIENTE/PROCESANDO → 409
  `SOLICITUD_EN_PROCESO` con `depositoId`, estado intacto; de FALLIDO → acredita `monto_acreditar` /
  `moneda_acreditar` guardados (p. ej. `149.50`), post-procesos con `contexto.cuenta = null`; si vuelve a fallar →
  FALLIDO y 502 con `depositoId`; si `leerExtensiones` falla → no cambia de estado ni acredita; id inexistente → `Error` (500).
- **RD-R09:** un transformador que agrega `extensiones` y cambia `montoAcreditar`/`monedaAcreditar` → se acredita lo
  transformado, se guarda el monto original y la respuesta trae las `extensiones`; en el reintento,
  `extensiones = leerExtensiones`.
- **SEG-R10/R11 sobre la ruta real:** AGENTE con canal APP → 403 sin filas ni acreditación; `usr-cliente-1` por APP a
  su cuenta → 201; `usr-cajero-1` por VENTANILLA a `0011-0123-000002` (PEN de `usr-cliente-2`) → 201.
- `acreditar` que lanza algo que no es `ErrorApp` → se relanza tal cual, no pasa a FALLIDO (decisión 4 de impl_07).
- `index.js` cumple el contrato de endpoint de SPEC-06 §4.

### `test.todo` anteriores revisados (desbloqueados por SPEC-07) → todos son pruebas reales

| Caso | Archivo |
|---|---|
| SEG-T06 `usr-cliente-1` deposita a `0011-0123-000002` (USD, ACTIVA) → 403 `SIN_PERMISO`; billetera consultada pero sin acreditación; 0 filas; auditoría `ERROR_403`. Control: a su propia cuenta → 201 | `tests/integration/seguridad/seguridad.test.js` |
| AUD-T01 depósito válido → 1 fila `CREAR_DEPOSITO`, `EXITO`, `deposito_id` = id de la respuesta, `correlation_id` = header de la respuesta, canal y monto | `tests/integration/auditoria/auditoria.test.js` |
| AUD-T02 monto `"-5"` → 422; 1 fila `ERROR_422`, `deposito_id` nulo, `monto` `-5.00`; billetera no consultada | `tests/integration/auditoria/auditoria.test.js` |
| AUD-T04 3 POST iguales con la misma clave → 3×201 (2 con `Idempotency-Replayed`), 3 filas `CREAR_DEPOSITO` con el mismo `deposito_id`, 1 depósito, 1 acreditación | `tests/integration/auditoria/auditoria.test.js` |
| IDE-T02 repetir → mismo status y cuerpo, `Idempotency-Replayed: true`, `X-Correlation-Id` de la petición actual, billetera 1 vez | `tests/integration/idempotencia/idempotencia.test.js` |
| IDE-T03 misma clave, monto distinto → 409 `IDEMPOTENCY_KEY_REUTILIZADA` (cuerpo exacto); 1 depósito | idem |
| IDE-T04 billetera tarda 2 s; segundo POST a los 100 ms → 409 `SOLICITUD_EN_PROCESO`; el primero termina 201 | idem |
| IDE-T05 5 POST simultáneos → exactamente 1 respuesta original 201, el resto 201 repetida o 409 `SOLICITUD_EN_PROCESO`; 1 depósito, 1 consulta, 1 acreditación | idem |
| IDE-T06 billetera 500 al acreditar → 502 (FALLIDO, clave `REINTENTABLE`); reintento OK → 201 con el **mismo** id; billetera recibió el mismo `depositoId` las dos veces; 1 sola consulta de cuenta | idem |
| IDE-T07 timeout al acreditar → 502; reintento con billetera 409 → 201 COMPLETADO, mismo id | idem |
| IDE-T08 billetera 500 al consultar → 502, sin filas y clave borrada; reintento → se procesa como nuevo (201 sin `Idempotency-Replayed`) | idem |
| IDE-T10 `usr-agente-1` y `usr-agente-2` con la misma clave → ambos 201, ids distintos, 2 acreditaciones, 2 claves | idem |

Las secciones `## SPEC-03`, `## SPEC-04` y `## SPEC-05` aún listan esos casos como `todo`; no se editan por ser
de otras specs (esta tabla es la referencia vigente). PRY-T01 se actualizó en `## SPEC-00` a pedido del leader.

### Casos en `test.todo`

Ninguno de SPEC-07. En `tests/` queda 1 `test.todo`, de SPEC-11: `CM-R03 PEN → USD a billetera 22222222-…`
(`tests/integration/conversion-moneda/conversion.test.js:265`); esperaba este retrabajo de SPEC-07 y queda para el
retrabajo de SPEC-11 (no se toca aquí, por instrucción del leader).

### Pruebas fallidas

Ninguna.

**Observación (no es fallo del código):** en RD-T08 e IDE-T07 nock emite el `timeout` del socket de inmediato
cuando la demora supera `BILLETERA_TIMEOUT_MS`; esas pruebas comprueban el resultado (502, FALLIDO), no el tiempo.

### Cobertura (`src/core/` y `src/modules/`)

```
File                         | % Stmts | % Branch | % Funcs | % Lines
All files                    |   99.72 |     95.1 |   99.23 |   99.84
 core                        |   99.46 |    94.73 |   97.14 |   99.42
 core/clients                |     100 |    95.12 |     100 |     100
 modules/registrar-deposito  |     100 |      100 |     100 |     100
  schema.js                  |     100 |      100 |     100 |     100
  service.js                 |     100 |      100 |     100 |     100
Test Suites: 23 passed, 23 total
Tests:       1 todo, 392 passed, 393 total
```

Umbral 80 % cumplido en `src/core/` y `src/modules/`.

### Retrabajo v2.2 (2026-11-09)

- **Tester** · 2026-11-09 · Spec v2.0 → v2.2 (`acreditar` con resultado `ACREDITADO`/`PENDIENTE`/`RECHAZADO`,
  RD-R11 en ambas billeteras, 202 de RD-R12, reconciliación de RD-R13, `titular_id` guardado). Código del
  desarrolladorback: `progress/impl_07.md` › "Retrabajo v2.2". No toqué `src/`, `specs-v2/`, `db/`, `mocks/`,
  `scripts/` ni helpers/setup de `tests/`. Solo edité los dos archivos del §2:
  `tests/unit/registrar-deposito/service.test.js` (U) y `tests/integration/registrar-deposito/registrar.test.js` (I).
- Integración: PostgreSQL real; billeteras con los helpers nock de SPEC-02; extensiones inactivas salvo
  RD-T14 (`conversion-moneda` activa). La reconciliación se ejecuta con `reconciliacion.reconciliar()` (un ciclo),
  siempre con `await` antes de que termine la prueba, así ningún `FOR UPDATE SKIP LOCKED` sigue abierto cuando
  `limpiar()` hace el `TRUNCATE`. Antes de reconciliar un depósito creado por HTTP se espera a la auditoría
  (`esperarAuditoria`): el INSERT de auditoría (FK a `depositos`) bloquea la fila y `SKIP LOCKED` la saltaría.
  Las filas viejas se preparan con `actualizado_en = now() - interval` (`insertarUsd` / `envejecer`, en el propio
  archivo de prueba), más antiguas que `RECONCILIACION_ANTIGUEDAD_MS` (10 s por defecto).

**1. Pruebas obsoletas por v2.2 (revisión de los ajustes del tester de SPEC-06)**
- Los 3 ajustes mínimos de `service.test.js` son correctos y se quedan: el mock de `acreditar` resuelve
  `{ estado: 'ACREDITADO' }`, `insertar` recibe 10 parámetros (el último es `titular_id`), y el título de RD-R08
  dice `titular_id`.
- RD-T18 (U e I) pasa de `99999999-…`/500 a `cccccccc-cccc-4ccc-8ccc-cccccccccccc`/`usr-falla-una-vez`/503. La
  2.ª petición la atiende `acreditaUsdOk()` (201): el mock responde "503 la primera vez y luego OK".
- Se eliminó el helper local `billeteraFallaExiste` (`99999999-…`). También se eliminó el
  `test.todo('RD-T18 … body idéntico …')`, que ahora es una aserción real.
- `depositos()` (I) lee también `titular_id`. El `manifest()` acepta `conversion`.

**2. Casos (id → archivo:línea)**

| Caso | Prueba |
|---|---|
| RD-T13 201 COMPLETADO; Billetera USD recibió `Idempotency-Key` = id y el body exacto `{ cliente_id: "usr-cliente-1", monto: "150.00", moneda: "USD", canal: "AGENTE", metodo_origen: "EFECTIVO", referencia_externa: id }` (**sin** `cuenta_destino_id`); la fila guarda `titular_id: "usr-cliente-1"` y `usuario_id: "usr-agente-1"` | I:554 · U:545 (`insertar` recibe `titularId` y `usuarioId`) |
| RD-T14 PEN a `11111111-…`, `conversion-moneda` **inactiva** → 422 `MONEDA_NO_SOPORTADA`, 0 filas, sin acreditación | I:600 · U (bloque RD-T13..T18) |
| RD-T14 con `conversion-moneda` **activa** y sin tipo PEN→USD → 422, 0 filas, sin acreditación | I:613 |
| RD-T14 con `conversion-moneda` activa **y tipo PEN→USD cargado** (D1) | **`test.todo`** I:626, ver abajo |
| RD-T18 503 → 502 FALLIDO (clave `REINTENTABLE`, fila con `titular_id: "usr-falla-una-vez"`); reintento HTTP con la misma clave → 201, mismo id, COMPLETADO, clave `TERMINADO`; sin 2.ª consulta; misma `Idempotency-Key`, mismo `cliente_id` y body `toEqual` al original | I:682 · U:491 |
| RD-T19 `33333333-…` (BLOCKED) y `44444444-…` (CLOSED) → 422 `CUENTA_INACTIVA`; 0 filas; sin acreditación | I:745 · U:552 |
| RD-T20 `55555555-…` (`WALLET_BLOCKED`), `66666666-…` (`CUSTOMER_BLOCKED`), `77777777-…` (`USD_ACCOUNT_NOT_ENABLED`) → 422 `CUENTA_INACTIVA`; cada depósito FALLIDO con su `titular_id`; `cliente_id` correcto | I:766 · U:567 (`PROCESANDO→FALLIDO` y `depositoId`) |
| RD-T21 202 VALIDADO → 202 con el cuerpo de SPEC-01 y `estado: "PROCESANDO"`; fila PROCESANDO; `ejecutarPostProcesos` no llamado; clave `TERMINADO` con `status_http` 202; repetir la clave → 202, `Idempotency-Replayed: true`, mismo cuerpo, billetera no llamada otra vez | I:813 · U:580 |
| RD-T22 replay `COMPLETADO` → COMPLETADO; post-procesos **una vez** con `contexto.cuenta = null` y `usuario = { id: "usr-agente-1", roles: [] }`; un 2.º ciclo no lo toma (sin acreditación ni post-proceso extra); body y clave idénticos al POST original (`aaaaaaaa-…`/`usr-pendiente`) | I:911 · U:668 (post-procesos después del COMMIT) |
| RD-T22 replay `FALLIDO` (`RECHAZADO`) → FALLIDO, sin post-procesos, body idéntico (`bbbbbbbb-…`/`usr-pendiente-falla`) | I:938 · U:696 (también `CUENTA_INACTIVA` → FALLIDO) |
| RD-T22 replay `VALIDADO` → sigue en PROCESANDO, `actualizado_en` intacto, body idéntico; el siguiente ciclo (COMPLETADO) lo cierra | I:954 · U:713 (también `BILLETERA_NO_DISPONIBLE` → sigue) |
| RD-T23 dos `reconciliar()` simultáneos sobre el mismo depósito → uno toma 1 fila y el otro 0; resúmenes `completados` [0, 1]; 1 acreditación; 1 post-proceso; COMPLETADO. El solape es determinista: la 1.ª retiene la fila bloqueada hasta que la 2.ª termina su `SELECT … FOR UPDATE SKIP LOCKED`. Si faltara `SKIP LOCKED`, la prueba fallaría por el tope de 3 s | I:978 |
| RD-T24 PEN en PROCESANDO de hace 2 h → no se toma; un USD reciente tampoco; solo el USD antiguo se acredita; billetera PEN no llamada; `actualizado_en` de los no tomados intacto | I:1018 · U:768 (SQL de `tomarParaReconciliar`: filtro UUID, antigüedad, `LIMIT`, `FOR UPDATE SKIP LOCKED`) |

**3. Reglas sin id**

| Regla | Prueba |
|---|---|
| RD-R08 `acreditar` → `RECHAZADO` en `registrar` → `PROCESANDO→FALLIDO`, 502 `BILLETERA_NO_DISPONIBLE` con `depositoId` | U:596 |
| RD-R08 reintento de un USD FALLIDO con replay `FALLIDO` → 502 con `depositoId`, sigue FALLIDO, sin post-procesos, body con `cliente_id` = `titular_id` guardado | I:858 · U:608 |
| RD-R11 `acreditar` lanza `CUENTA_INACTIVA` → FALLIDO + 422 con `depositoId`; la clave queda `TERMINADO` (422, `deposito_id`) y repetirla devuelve el mismo 422 (`Idempotency-Replayed`) sin consultar ni acreditar | I:786 · U:567 · U:619 (en el reintento) |
| RD-R12 reintento con `PENDIENTE` → PROCESANDO con las extensiones leídas, sin post-procesos | U:629 |
| RD-R13 `CUENTA_INACTIVA` (422 `WALLET_BLOCKED`) → FALLIDO; `BILLETERA_NO_DISPONIBLE` (503) → sigue en PROCESANDO; orden `ORDER BY actualizado_en` | I:1046 · U:696/713 |
| RD-R13 más de `RECONCILIACION_ALERTA_MS` en PROCESANDO → `logger.error` con `depositoId` y `enProcesandoMs`; uno reciente no alerta | I:1064 · U:727 |
| RD-R13 error que no es `ErrorApp` en `acreditar` → se registra, sigue en PROCESANDO y el lote continúa; un post-proceso que falla se registra y no deshace COMPLETADO; lote vacío → resumen en cero | U:738 · U:751 · U:762 |
| RD-R13 `reconciliacion.iniciar()`: `setInterval` cada `RECONCILIACION_INTERVALO_MS` con `unref()` (`hasRef() === false`), idempotente, `detener()` lo limpia (`jest.getTimerCount() === 0`); un ciclo que falla → `logger.error` con `error`/`codigoError` y los siguientes siguen; no se solapa consigo mismo; `reconciliacion.reconciliar === service.reconciliar`. Con temporizadores falsos de Jest y `detener()` en `afterEach`: no deja handles abiertos | U:796 · U:815 · U:830 · U:847 |

#### Casos en `test.todo` (Retrabajo v2.2)

- `RD-T14 … con conversion-moneda ACTIVA y tipo PEN→USD cargado → 422 (D1); espera el retrabajo de SPEC-11 (CM-T09)`
  (I:626). SPEC-11 está `reabierta` y su código actual (`src/modules/conversion-moneda/service.js:13-26`) convierte
  PEN→USD si hay tipo cargado. Lo confirma la prueba vigente `CM-R03 PEN → USD … Billetera USD recibe "39.00" USD` de
  `tests/integration/conversion-moneda/conversion.test.js:268`, que también contradice CM-T09/D1 y debe revisar el
  tester de SPEC-11. La parte de RD-T14 que depende solo de SPEC-07 (inactiva, y activa sin tipo) es prueba real.
- No hay otros `test.todo` en `tests/` que esperaran SPEC-07.

#### Pruebas fallidas (Retrabajo v2.2)

Ninguna.

#### Ejecución y cobertura (Retrabajo v2.2)

`bash init.sh` completo con PostgreSQL real (`chalenge-db-1`), **2 corridas seguidas, ambas `EXIT=0`, sin deadlock de
`TRUNCATE`:**
- `[OK] SPEC-07: todos sus casos tienen prueba` · alcance OK (190 archivos) ·
  `feature_list.json válido (in_progress=1 reabierta=4)`. No apareció ningún FAIL del chequeo de estado de features.
- Avisos que no son de SPEC-07: `SPEC-08 (reabierta) aún sin prueba: CD-T14, CD-T15` y
  `SPEC-11 (reabierta) aún sin prueba: CM-T09`.
- `Test Suites: 23 passed, 23 total` · `Tests: 1 todo, 484 passed, 485 total` (antes 451 + 1 todo).

```
File                         | % Stmts | % Branch | % Funcs | % Lines | Uncovered
All files                    |   99.76 |    94.63 |   99.32 |   99.87 |
 core                        |   99.46 |    94.73 |   97.14 |   99.42 |
 modules/registrar-deposito  |     100 |    93.75 |     100 |     100 |
  controller.js              |     100 |      100 |     100 |     100 |
  reconciliacion.js          |     100 |       80 |     100 |     100 | 18
  repository.js              |     100 |       90 |     100 |     100 | 29
  service.js                 |     100 |    96.29 |     100 |     100 | 170,208
```

- Agregado (calculado sobre `coverage/coverage-final.json`): `src/core/` 99.79 % stmts / 94.96 % ramas;
  **`src/modules/` 99.73 % stmts / 93.92 % ramas** (antes 75 % de ramas). Umbral 80 % cumplido; el bloqueo de cobertura
  que impedía cerrar SPEC-06 queda resuelto.
- Ramas sin cubrir, todas defensivas: `reconciliacion.js:18` y `service.js:170,208` son el `?? String(err)` /
  `?.code ?? null` de errores sin `message`; `repository.js:29` es el `titularId ?? null`, ya que toda cuenta de
  SPEC-02 §4 tiene titular.

## SPEC-08

- **Tester** · 2026-11-03 · Feature 8 (`consultar-deposito`) · **retrabajo** spec v1.2 (Billetera USD), rama
  `inte_biUsd`. Sin desarrolladorback: la spec solo añade CD-T10..CD-T13; el enrutamiento PEN/USD lo hace
  `src/core/clients/billeteraClient.js` (SPEC-02, INT-R10: UUID en minúsculas → Billetera USD).
- **Ejecución:** `bash init.sh` completo con PostgreSQL real (`deposito_test`) → **`EXIT=0`**.
  `[OK] SPEC-08: todos sus casos tienen prueba` · alcance OK (178 archivos) · `Test Suites: 23 passed, 23 total` ·
  `Tests: 1 todo, 396 passed, 397 total` (el único `todo` no es de SPEC-08; SPEC-09 reabierta avisa HD-T09..T12).
- Integración: `crearApp({ manifest })` dentro de cada prueba; manifest a medida con `registrar-deposito` y
  `consultar-deposito` activos y `limites-por-canal`, `conversion-moneda` (salvo CD-T07), `alerta-uif` inactivas.
  Depósitos insertados directo en `depositos` (SPEC-08 §6) con usuarios, cuentas PEN y billeteras USD de SPEC-02 §4.
  Billetera PEN y USD con los helpers de nock de `tests/helpers/billetera.js` (`nock.disableNetConnect()`).
  `limpiar()` en `beforeEach`; `afterEach` espera a que se estabilice `auditoria_depositos` antes de la siguiente
  limpieza (evita el deadlock INSERT de auditoría vs `TRUNCATE`).
- CD-T10..CD-T13 añaden una "trampa" `nock(config.billetera.url).get(/.*/)` para comprobar que **no** se llama a la
  billetera PEN (`isDone() === false`); el host USD (`BILLETERA_USD_URL`) es distinto del PEN.

### Pruebas actualizadas por el retrabajo (datos v2.0 de SPEC-02 §4)

| Antes | Ahora |
|---|---|
| `CUENTA_USD = '0011-0123-000002'` (hoy es una cuenta **PEN** de `usr-cliente-2`) | Eliminada. Constantes `BILLETERA_USD_1 = '11111111-1111-4111-8111-111111111111'` (titular `usr-cliente-1`) y `BILLETERA_USD_2 = '22222222-2222-4222-8222-222222222222'` (titular `usr-cliente-2`) |
| `CD-R02 usr-cliente-2 ve un depósito a su cuenta USD 0011-0123-000002` con `billetera.cuentaActiva` (PEN) | `CD-R02 usr-cliente-2 ve un depósito a su billetera USD 22222222-2222-4222-8222-222222222222` con `billetera.billeteraUsdExiste`; además comprueba 1 petición a Billetera USD |

`tests/unit/consultar-deposito/service.test.js` no usaba datos obsoletos (solo `0011-0123-456789` PEN): sin cambios.
No se tocaron pruebas de otras specs.

### Casos cubiertos

| Caso | Archivo |
|---|---|
| CD-T01 `usr-cliente-1` consulta un depósito a `0011-0123-456789` → 200 con el cuerpo completo de §5 (`extensiones: {}`); billetera consultada 1 vez con el `X-Correlation-Id` | `tests/integration/consultar-deposito/consultar.test.js` |
| CD-T02 UUID inexistente → 404 `DEPOSITO_NO_ENCONTRADO` con el mensaje de §5; billetera no llamada | idem |
| CD-T03 id `abc` → 400 `FORMATO_INVALIDO`; `buscarPorId` no llamado | idem |
| CD-T04 `usr-cliente-2` consulta un depósito a `0011-0123-456789` → 404 `DEPOSITO_NO_ENCONTRADO` | idem |
| CD-T05 `usr-agente-2` consulta un depósito de `usr-agente-1` → 404; billetera no llamada | idem |
| CD-T06 `usr-agente-1` consulta su propio depósito → 200 cuerpo completo; billetera no llamada | idem |
| CD-T07 depósito `100.00` USD → `0011-0123-456789` con fila en `conversiones_deposito`, conversion-moneda **activa** → `extensiones.conversion-moneda` = `{ monedaCuenta: "PEN", tipoCambio: "3.7500", montoAcreditado: "375.00" }` | idem |
| CD-T08 el mismo depósito con conversion-moneda **inactiva** → `extensiones: {}`; la fila de `conversiones_deposito` sigue ahí | idem |
| CD-T09 `usr-cliente-1` y billetera 500 → 502 `BILLETERA_NO_DISPONIBLE` | idem |
| CD-T10 `usr-cliente-1` consulta un depósito a `11111111-1111-4111-8111-111111111111` → 200 con cuerpo completo (`cuentaDestino` = UUID, `moneda` USD); 1 `GET /api/v1/billetera/wallets/{id}` a Billetera USD con el `X-Correlation-Id`; la billetera PEN **no** se llama | idem |
| CD-T11 `usr-cliente-2` consulta un depósito a `11111111-…` (titular `usr-cliente-1`) → 404 `DEPOSITO_NO_ENCONTRADO` con el mensaje de §5; 1 llamada USD, 0 PEN | idem |
| CD-T12 Billetera USD 404 (`ApiError NOT_FOUND`) al verificar titular → 404 `DEPOSITO_NO_ENCONTRADO` (CD-R04); 0 PEN | idem |
| CD-T13 Billetera USD 500 al verificar titular → 502 `BILLETERA_NO_DISPONIBLE`; 0 PEN | idem |

Pruebas adicionales por regla (todas en verde):

- **Feature activa/inactiva:** `consultar-deposito` `inactivo` → 404 `RUTA_NO_ENCONTRADA`, ni BD ni billetera.
- **CD-R01:** `123`, UUID con un carácter de más, caracteres no hex → 400.
- **CD-R02:** cliente titular ve un depósito registrado por `usr-cajero-1`; `usr-cajero-1` ve el suyo sin billetera y
  `usr-agente-1` no lo ve; `usr-cliente-2` ve un depósito a su billetera USD `22222222-…`. Unitaria: un CLIENTE cuyo
  id coincide con `usuario_id` no entra por la 1ª condición.
- **CD-R03:** usuario sin roles o sin usuario → 404 sin billetera (unitaria).
- **CD-R04:** billetera 404 (`null`) → 404 (PEN en integración y unitaria; USD en CD-T12).
- **CD-R05:** el 404 "sin permiso" tiene el mismo cuerpo que el 404 "no existe"; nunca `SIN_PERMISO`.
- **CD-R06:** billetera sin responder a tiempo → 502; el `ErrorApp` se propaga tal cual (unitaria); USD 500 en CD-T13.
- **CD-R07:** estados PENDIENTE/PROCESANDO/FALLIDO tal cual; extensión falsa activa/inactiva/sin datos; sin permiso
  no lee extensiones; unitaria: respuesta = `aJson(fila, leerExtensiones(id, contexto))`.
- **§2 repository solo SELECT:** `buscarPorId` devuelve la fila o `null`; la fila no cambia tras consultar.
- **AUD-R06:** 200 → `CONSULTAR_DEPOSITO` `EXITO` con `deposito_id`; 404 sin permiso → `ERROR_404` sin `deposito_id`.
- `index.js` cumple el contrato de endpoint de SPEC-06 §4.

### Decisiones de `progress/impl_08.md` (todas en verde)

| Decisión | Pruebas | Archivo |
|---|---|---|
| 1. `contexto.cuenta = null` si el operador que lo registró consulta; con CLIENTE titular = la cuenta devuelta por billetera | 2 | `tests/integration/consultar-deposito/consultar.test.js` |
| 2. Varios roles (AGENTE+CLIENTE, CAJERO+CLIENTE) | 3 | `tests/unit/consultar-deposito/service.test.js` |

### Casos en `test.todo`

Ninguno de SPEC-08. No había `test.todo` que esperaran SPEC-08.

### Pruebas fallidas

Ninguna. CD-T10..CD-T13 pasan sin cambios en `src/` (el `consultarCuenta` de SPEC-02 enruta por UUID).
Nota sobre la referencia `Busti:codigo/tests/unit/consultar-deposito/service.test.js`: allí CD-T10..T13 son
unitarias con `consultarCuenta` mockeado, así que no pueden comprobar la ruta HTTP llamada que exige CD-T10; aquí los
cuatro casos son de integración con nock y billeteras USD de SPEC-02 §4.

### Cobertura (`src/core/` y `src/modules/`)

```
-----------------------------|---------|----------|---------|---------|
File                         | % Stmts | % Branch | % Funcs | % Lines |
-----------------------------|---------|----------|---------|---------|
All files                    |   99.72 |     95.1 |   99.23 |   99.84 |
 core                        |   99.46 |    94.73 |   97.14 |   99.42 |
 core/clients                |     100 |    95.12 |     100 |     100 |
 core/middlewares            |     100 |    94.87 |     100 |     100 |
 core/repositories           |     100 |     87.5 |     100 |     100 |
 modules/consultar-deposito  |     100 |      100 |     100 |     100 |
-----------------------------|---------|----------|---------|---------|
Test Suites: 23 passed, 23 total
Tests:       1 todo, 396 passed, 397 total
```

Todo por encima del 80 %.

### Retrabajo v1.3

- **Tester** · 2026-11-09 · spec v1.2 → v1.3 (CD-R08, CD-R09; CD-T14, CD-T15; CD-T13 precisa `usr-cliente-1`).
  Sin cambios en `src/` (ver `progress/impl_08.md`, "Retrabajo v1.3"). Solo se tocó
  `tests/integration/consultar-deposito/consultar.test.js`.
- **Ejecución:** `bash init.sh` completo con PostgreSQL real → **`EXIT=0`**. `[OK] SPEC-08: todos sus casos tienen
  prueba` · alcance OK (190 archivos) · `Test Suites: 23 passed, 23 total` · `Tests: 1 todo, 489 passed, 490 total`
  (el `todo` no es de SPEC-08). Único aviso: `SPEC-11 (reabierta) aún sin prueba: CM-T09` (feature reabierta). No
  apareció el deadlock de `TRUNCATE`.

| Caso | Prueba | Archivo |
|---|---|---|
| CD-T13 | Ahora pasa `usuario: 'usr-cliente-1'` explícito (antes ya era ese usuario, por defecto de `get`); nombre actualizado al enunciado v1.3 | `tests/integration/consultar-deposito/consultar.test.js` |
| CD-T14 | Depósito `PROCESANDO` a `11111111-…` → 200 con `estado: "PROCESANDO"` tanto para el titular `usr-cliente-1` (1 GET a Billetera USD) como para el operador `usr-agente-1`. Interceptores `acreditaUsdOk` y `acreditaUsdReplay` (`POST /api/v1/depositos/usd`) preparados y **no consumidos** (`isDone() === false`, 0 peticiones) con `nock.disableNetConnect()`; trampa PEN sin llamar; la fila de `depositos` no cambia | idem |
| CD-T15 | Titular `usr-bloqueada` de `33333333-…` (`BLOCKED`) consulta su depósito → 200 con cuerpo completo; 1 GET USD; `contexto.cuenta.estado = 'BLOQUEADA'` | idem |
| CD-R09 (CLOSED) | Misma prueba (`test.each`) con `usr-cerrada` / `44444444-…` (`CLOSED`) → 200; `contexto.cuenta.estado = 'CERRADA'` | idem |
| CD-T15 control | `usr-cliente-1` (no titular) sobre el depósito a `33333333-…` → 404 `DEPOSITO_NO_ENCONTRADO` (el 200 sale de la titularidad y no de otro camino) | idem |
| CD-R09 (PEN) | `usr-cliente-1`, titular de la cuenta PEN `BLOQUEADA` `0011-0123-000003` → 200 | idem |

- **Token de `usr-bloqueada` / `usr-cerrada`:** `tests/helpers/tokens.js` solo conoce los 5 usuarios de la lista
  "Usuarios" de SPEC-02 §4, y no lo puedo editar. Estos titulares sí son datos de §4 (billeteras USD), así que el
  token se firma en la propia prueba con la misma clave de `tests/.tmp/privada.pem` (precedente SEG-R06 en
  `tests/integration/seguridad/seguridad.test.js`) y con rol `CLIENTE`. Es el único rol que verifica titular
  (CD-R03), y §4 no les asigna otro rol.
- **Pruebas obsoletas:** ninguna. Ninguna prueba de SPEC-08 esperaba un rechazo por estado de billetera ni una
  llamada a billetera para actualizar el estado. Coincide con lo que dice el dev en `progress/impl_08.md`.
- **Casos en `test.todo`:** ninguno de SPEC-08.
- **Pruebas fallidas:** ninguna.

Cobertura (`init.sh` completo):

```
All files                    |   99.76 |    94.63 |   99.32 |   99.87 |
 core                        |   99.46 |    94.73 |   97.14 |   99.42 |
 core/clients                |     100 |    95.83 |     100 |     100 |
 core/middlewares            |     100 |    94.87 |     100 |     100 |
 core/repositories           |     100 |     87.5 |     100 |     100 |
 core/tareas                 |     100 |      100 |     100 |     100 |
 modules/consultar-deposito  |     100 |      100 |     100 |     100 |
 modules/registrar-deposito  |     100 |    93.75 |     100 |     100 |
```

Todo está por encima del 80 %.

## SPEC-09

- **Tester** · 2026-11-03 · Feature 9 (`historial-depositos`) · **retrabajo spec v1.2** (Billetera
  USD), rama `inte_biUsd`.
- **Ejecución:** `bash init.sh` completo con PostgreSQL real (`deposito_test`) → **`EXIT=0`**.
  `[OK] SPEC-09: todos sus casos tienen prueba` · alcance OK (178 archivos) ·
  `Test Suites: 23 passed, 23 total` · `Tests: 1 todo, 402 passed, 403 total`.
- Integración: `crearApp({ manifest })` dentro de cada prueba con manifest a medida
  (`registrar-deposito`, `consultar-deposito` e `historial-depositos` activos; `limites-por-canal`,
  `conversion-moneda`, `alerta-uif` inactivas). Depósitos insertados directo en `depositos`
  (SPEC-09 §6) con cuentas, billeteras USD y usuarios de SPEC-02 §4. Billetera PEN y USD con los
  helpers de nock (`nock.disableNetConnect()`). `limpiar()` en `beforeEach`; `afterEach` espera a
  que el conteo de `auditoria_depositos` se estabilice antes del `TRUNCATE` siguiente.
- Para probar que una billetera **no** se llamó se registra en el archivo de prueba un espía
  `persist()` sobre cualquier GET a `config.billetera.url` (PEN) o `config.billeteraUsd.url` (USD);
  no se tocaron los helpers.

### Cambios del retrabajo (actualizado/eliminado, no solo añadido)

- Eliminada la constante `CUENTA_USD = '0011-0123-000002'`: según SPEC-02 §4 v2.0 esa cuenta es
  **PEN** de `usr-cliente-2`. Sustituida por `CUENTA_2` (PEN) y `WALLET_USD` / `WALLET_USD_2`
  (`11111111-…`, `22222222-…`).
- **HD-T02** reescrita: `usr-cliente-2` pide su billetera USD `22222222-2222-4222-8222-222222222222`
  (helper `billeteraUsdExiste`) sin depósitos (hay depósitos en otras cuentas) →
  `{ datos: [], pagina: 1, tamano: 20, total: 0 }`, Billetera USD consultada 1 vez.
- **HD-R04 (cajero)**: el depósito "de otra cuenta" pasa de `0011-0123-000002`/USD a
  `11111111-…`/USD.
- **HD-R05 (cliente ve los de cualquier operador)**: ahora en `0011-0123-000002` como cuenta PEN
  (moneda PEN), con `cuentaActiva`.
- Referencia `Busti`: su HD-T11 usa `WALLET_USD.toUpperCase()`, pero `11111111-…` solo tiene
  dígitos y en mayúsculas es idéntico (UUID válido → billetera llamada → 502). Era un error de la
  prueba, no del código. Aquí se usa el UUID del ejemplo de SPEC-02 §4 en mayúsculas
  (`3FA85F64-5717-4562-B3FC-2C963F66AFA6`) y uno con una sola letra hex en mayúscula.

### Casos cubiertos

Todos en `tests/integration/historial-depositos/historial.test.js`.

| Caso | Qué comprueba |
|---|---|
| HD-T01 | `usr-cliente-1`, 3 depósitos → 200 con el cuerpo exacto de §5, más reciente primero, sin `extensiones`; billetera PEN consultada 1 vez con el `X-Correlation-Id` |
| HD-T02 | `usr-cliente-2`, `22222222-2222-4222-8222-222222222222` sin depósitos → `datos: []`, `total: 0`; Billetera USD consultada 1 vez |
| HD-T03 | 25 depósitos, `pagina=2&tamano=20` → los 5 más antiguos, `total 25` |
| HD-T04 | `estado=FALLIDO` → solo los 3 FALLIDOS, `total 3` |
| HD-T05 | `desde` = `creado_en` exacto → incluido |
| HD-T06 | `usr-cliente-2` pide `0011-0123-456789` → 403 `SIN_PERMISO` con el mensaje de §5; `repository.listar` no llamado |
| HD-T07 | `tamano=500`, `pagina=0`, `desde > hasta` → 400 `FORMATO_INVALIDO`; ni billetera ni BD |
| HD-T08 | `usr-agente-1` → solo los suyos; billetera sin peticiones |
| HD-T09 | `usr-cliente-1`, `11111111-…` con 2 depósitos (y uno en otra cuenta) → 200 con los 2 (`moneda USD`, `cuentaDestino` UUID), sin `extensiones`; Billetera USD consultada 1 vez con el `X-Correlation-Id`; billetera PEN **0** peticiones |
| HD-T10 | `usr-cliente-2` pide `11111111-…` → 403 `SIN_PERMISO` con el mensaje de §5; USD consultada, PEN no; `repository.listar` no llamado |
| HD-T11 | `3FA85F64-…` (mayúsculas), `…11111111111A`, `11111111-1111-4111-8111`, último grupo de 11, UUID sin guiones → 400 `FORMATO_INVALIDO` cada uno; ni Billetera USD ni PEN ni `repository.listar` |
| HD-T12 | Billetera USD 500 al verificar titular → 502 `BILLETERA_NO_DISPONIBLE`; PEN no llamada; `repository.listar` no llamado |

Pruebas adicionales por regla (todas ✅):

- **Feature activa/inactiva:** `historial-depositos` `inactivo` → 404 `RUTA_NO_ENCONTRADA`, ni BD ni billetera.
- **HD-R01:** números PEN con un dígito de menos/más, con letra, `abc` → 400 sin billetera ni BD.
- **HD-R02:** valores por defecto; límites `tamano=1|100`; inválidos → 400; `desde = hasta` válido.
- **HD-R03:** `hasta` inclusivo; rango inclusivo en ambos extremos.
- **HD-R04:** cajero solo ve los suyos de esa cuenta; operador sin propios → lista vacía;
  `usr-agente-1` en billetera USD → solo los suyos, ni Billetera USD ni PEN llamadas.
- **HD-R05:** cliente ve los de su cuenta de cualquier operador; billetera PEN 404 → 403; Billetera
  USD 404 → 403; PEN 500 y timeout → 502; cuenta propia BLOQUEADA → 200.
- **HD-R06:** empate → `id DESC`; `LIMIT`/`OFFSET` como parámetros.
- **HD-R07:** `total` coherente con filtros combinados; página fuera de rango; `listar`/`contar` directos.
- **HD-R08:** con extensión activa con datos, la lista sigue sin `extensiones` y no las lee.
- **§2 solo SELECT**, **AUD-R06** (`LISTAR_DEPOSITOS` EXITO / ERROR_403) y contrato de `index.js`.

### Casos en `test.todo`

Ninguno de SPEC-09. No hay `test.todo` anteriores que esperen SPEC-09.

### Pruebas fallidas

Ninguna.

### Cobertura (`src/core/` y `src/modules/`)

```
-----------------------------|---------|----------|---------|---------|-------------------
File                         | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
-----------------------------|---------|----------|---------|---------|-------------------
All files                    |   99.72 |     95.1 |   99.23 |   99.84 |
 core                        |   99.46 |    94.73 |   97.14 |   99.42 |
 core/clients                |     100 |    95.12 |     100 |     100 |
 modules/historial-depositos |    98.7 |     91.3 |     100 |     100 |
  controller.js              |     100 |      100 |     100 |     100 |
  index.js                   |     100 |      100 |     100 |     100 |
  repository.js              |     100 |      100 |     100 |     100 |
  routes.js                  |     100 |      100 |     100 |     100 |
  schema.js                  |     100 |      100 |     100 |     100 |
  service.js                 |   95.65 |       75 |     100 |     100 | 13,31
-----------------------------|---------|----------|---------|---------|-------------------
Test Suites: 23 passed, 23 total
Tests:       1 todo, 402 passed, 403 total
```

- Todo ≥ 80 %. Ramas sin cubrir en `service.js`: 13 (`roles` no arreglo) y 31 (operador sin `id`),
  defensivas: los tokens de SPEC-02 §4 siempre traen `sub` y `roles`.

## SPEC-10

- **Tester** · 2026-11-02 · Feature 10 (`limites-por-canal`).
- **Ejecución:** `bash init.sh` completo con PostgreSQL real (`deposito_test`) → **verde**.
  `[OK] SPEC-10: todos sus casos tienen prueba` · alcance OK (154 archivos) ·
  `Test Suites: 19 passed, 19 total` · `Tests: 2 todo, 316 passed, 318 total`.
- **SQL nuevo:** `tests/setup/globalSetup.js` (proyecto `integration`) hace
  `DROP SCHEMA public CASCADE` y aplica todos los `db/*.sql` en orden alfabético, así que
  `db/10-limites-canal.sql` se aplica tras `05-idempotencia.sql`. Verificado por prueba: la tabla
  tiene exactamente las 6 filas de ejemplo de §4. `limpiar()` no la vacía (`CONSERVAR` en
  `tests/helpers/db.js`). Sin bloqueo de infraestructura.
- Unitarias: `db` falso que responde al SELECT parametrizado con la tabla de ejemplo de §4;
  `jest.mock` del repository que por defecto delega en la implementación real
  (`jest.requireActual`) y en LC-T04 devuelve `null`.
- Integración: `crearApp({ manifest })` por prueba (`registrar-deposito` activo, `limites-por-canal`
  activo o inactivo según el caso, `conversion-moneda` y `alerta-uif` inactivas); `usr-agente-1`,
  canal AGENTE, cuenta `0011-0123-456789`; billetera con los helpers de nock. `afterEach` espera a
  que se estabilice `auditoria_depositos` antes del `TRUNCATE`. Líneas ≤ 100 caracteres.

### Casos cubiertos

| Caso | Archivo | Qué comprueba |
|---|---|---|
| LC-T01 | `tests/unit/limites-por-canal/limites.test.js` | AGENTE `1500.00` PEN → resuelve `undefined`; `buscarLimite(db,'AGENTE','PEN')`; sin `warn` |
| LC-T02 | `tests/unit/limites-por-canal/limites.test.js` | AGENTE `2000.00` PEN (igual al límite) → no lanza |
| LC-T03 | `tests/unit/limites-por-canal/limites.test.js` | AGENTE `2000.01` PEN → `ErrorApp` `LIMITE_CANAL_EXCEDIDO`, 422, mensaje de §5 |
| LC-T04 | `tests/unit/limites-por-canal/limites.test.js` | `buscarLimite` (jest.mock) → `null` → no lanza; `logger.warn` 1 vez con `{ canal, moneda }`; no se consulta la BD |
| LC-T05 | `tests/integration/limites-por-canal/limites.test.js` | Activa, POST `2500.00` PEN → 422 con cuerpo exacto de §5 y `correlationId`; 0 filas en `depositos`; 0 POST de acreditación |
| LC-T06 | `tests/integration/limites-por-canal/limites.test.js` | Inactiva, POST `2500.00` PEN → 201 COMPLETADO; 1 fila; billetera acredita `2500.00` |

Pruebas adicionales por regla (todas verdes): contrato SPEC-06 (`{ id, tipo, errores, ejecutar }`);
LC-R01 (busca por `moneda` del depósito aunque `monedaAcreditar` difiera; cada canal con su límite);
LC-R02 (AGENTE USD `500.00` pasa, `500.01` lanza; integración `2000.00` PEN activa → 201);
LC-R04 (montos que como `Number` son iguales al límite y con `Decimal` lo superan → lanza; cambiar
el límite en la tabla, en unitaria y con `UPDATE` en la BD real restaurado en `finally`, cambia el
resultado); LC-R05 (no modifica `deposito`, devuelve `undefined`); `buscarLimite` → `Decimal` o
`null`, SQL con `$1`/`$2` sin valores interpolados.

**Interpretación de LC-T05 "billetera no llamada":** SPEC-07 §3/RD-R04 fija que `consultarCuenta`
ocurre *antes* de `ejecutarValidadores`, así que el GET de consulta es obligatorio. Se interpreta
como "billetera no recibe acreditación" (mismo criterio que SEG-T06 y RD-T05/T06 y el criterio de
aceptación de SPEC-10): se afirma 0 POST `/creditos` y exactamente 1 GET de consulta. Si el humano
entiende "ninguna llamada", contradiría RD-R04.

### Casos en `test.todo`

Ninguno de SPEC-10. No había `test.todo` previos que esperaran SPEC-10 (siguen CD-T07/CD-T08, esperan
SPEC-11).

### Pruebas fallidas

Ninguna.

### Cobertura

| Ámbito | Stmts | Branch | Funcs | Lines |
|---|---|---|---|---|
| Total (`src/core/` + `src/modules/`) | 99.52 % | 94.98 % | 99.12 % | 99.82 % |
| `src/core/` | 98.93 % | 93.85 % | 97.14 % | 99.42 % |
| `src/modules/limites-por-canal/` | 100 % | 100 % | 100 % | 100 % |

Umbral 80 % cumplido en `src/core/` y `src/modules/`.

## SPEC-11

- **Tester** · 2026-11-03 · Feature 11 (`conversion-moneda`) · **retrabajo** por SPEC-02 §4 v2.0
  (rama `inte_biUsd`). La spec 11 no cambió; sin desarrollador; `src/` sin tocar.
- **Ejecución:** `bash init.sh` completo, con PostgreSQL real (`deposito_test`) → **`EXIT=0`**.
  `[OK] SPEC-11: todos sus casos tienen prueba` · alcance OK (178 archivos) ·
  `Test Suites: 23 passed, 23 total` · `Tests: 406 passed, 406 total` (0 todo) ·
  `[OK] Todas las pruebas en verde (unitarias + integración)`.
- **Qué cambió en el retrabajo** (actualizado/eliminado, no solo añadido):
  - SPEC-02 v2.0: `0011-0123-000002` es PEN (`usr-cliente-2`); la cuenta en dólares es la billetera
    USD `11111111-1111-4111-8111-111111111111` (`usr-cliente-1`), atendida por Billetera USD
    (`POST /api/v1/depositos/usd`). Ya no queda ninguna referencia a `0011-0123-000002` como USD en
    las pruebas de SPEC-11 (la prueba de integración PEN → `0011-0123-000002` USD de la versión
    1.0 del reporte ya no existe; la sustituyen las de la billetera USD de abajo).
  - **Eliminado** el `test.todo('CM-R03 PEN → USD a billetera 22222222-… …')` de
    `tests/integration/conversion-moneda/conversion.test.js` (esperaba el retrabajo de SPEC-07,
    ya terminado) y **convertido** en prueba real con la billetera `11111111-…` (titular
    `usr-cliente-1`, el usuario que §6 manda usar en integración) y los helpers USD
    (`billeteraUsdExiste`, `acreditaUsdOk`, `acreditaUsdFalla`).
  - Unitarias (`tests/unit/conversion-moneda/conversion.test.js`): `contexto(db, 'USD')` arma ahora
    la cuenta con `numero = 11111111-…` (antes reutilizaba `0011-0123-456789` con moneda USD, dato
    que no existe en §4); el caso CM-R05 PEN→USD usa `cuentaDestino = 11111111-…` y comprueba además
    que el SELECT recibe `['PEN','USD']`.
- Integración: `crearApp({ manifest })` por prueba con `registrar-deposito` y `consultar-deposito`
  activos, `limites-por-canal` y `alerta-uif` inactivas y `conversion-moneda` activa o inactiva según
  el caso; `usr-cliente-1`, canal APP. `afterEach` espera a que se estabilice `auditoria_depositos`
  antes del `TRUNCATE` de `limpiar()`. Cada prueba carga sus tipos (`limpiar()` vacía `tipos_cambio`).

### Casos cubiertos

| Caso | Archivo | Qué comprueba |
|---|---|---|
| CM-T01 | `tests/integration/conversion-moneda/conversion.test.js` | `100.00` USD a `0011-0123-456789`, tipo 3.7500 → 201 COMPLETADO con la extensión `{ PEN, "3.7500", "375.00" }`; billetera PEN recibe `375.00` PEN; fila de depósito y de `conversiones_deposito` (`monto_final 375.00`) |
| CM-T02 | idem | `150.00` PEN → 201, `extensiones: {}`, 0 filas de conversión, billetera recibe `150.00` PEN |
| CM-T03 | idem | USD sin tipo cargado → 422 `MONEDA_NO_SOPORTADA`; nada guardado; sin acreditación |
| CM-T04 | idem | Tipos de ayer (3.70) y de hoy (3.75) → usa 3.75 (`tipo_cambio_id` = el de hoy) |
| CM-T05 | idem | Solo tipo con `vigente_desde` mañana → 422 `MONEDA_NO_SOPORTADA`; nada guardado |
| CM-T06 | `tests/unit/conversion-moneda/conversion.test.js` | `convertir("10.01","3.7555")` → `"37.59"`; `convertir("1.00","3.7550")` → `"3.76"` |
| CM-T07 | `tests/integration/conversion-moneda/conversion.test.js` | Feature `inactivo` con tipo cargado: USD a cuenta PEN → 422; y (nueva) PEN a la billetera USD `11111111-…` con tipo PEN→USD → 422; nada guardado; sin acreditación |
| CM-T08 | idem | Billetera PEN 500 tras convertir → 502; depósito FALLIDO; la fila de conversión se queda |

Pruebas adicionales por regla (todas verdes):

- **CM-R01, CM-R02/R03, CM-R04, CM-R05, CM-R06, CM-R07, CM-R08** (unit): como antes; CM-R05 PEN→USD
  ahora con la billetera `11111111-…` (`150.00` PEN × 0.26 → `39.00` USD, SELECT `['PEN','USD']`).
- **CM-R03 PEN → USD** (integración, nueva, sustituye al `test.todo`): con filas USD→PEN 3.75 y
  PEN→USD 0.26 cargadas, `150.00` PEN a `11111111-…` → 201 con extensión
  `{ monedaCuenta: "USD", tipoCambio: "0.2600", montoAcreditado: "39.00" }`; Billetera USD recibe
  `Idempotency-Key = id`, `cliente_id usr-cliente-1`, `cuenta_destino_id 11111111-…`,
  `monto "39.00"`, `moneda "USD"`, `metodo_origen TRANSFERENCIA`, `referencia_externa = id`;
  billetera PEN no llamada; fila `monto_acreditar 39.00 USD`; conversión con `tipo_cambio_id …0002`.
- **CM-R03** (integración, nueva): solo fila USD→PEN y depósito PEN a la billetera USD → 422 (no
  invierte); y la existente: solo fila PEN→USD y depósito USD a cuenta PEN → 422.
- **CM-R09** (integración, nueva): PEN → USD y Billetera USD 500 → 502; depósito FALLIDO con
  `39.00` USD; la fila de conversión se queda.
- **CM-R08** (integración): GET `/api/v1/depositos/{id}` trae la extensión.
- **CM-R10** (integración): existe `idx_tipos_cambio_par`.

### Casos en `test.todo`

Ninguno (el de CM-R03 PEN→USD se convirtió en prueba real).

### Pruebas fallidas

Ninguna. No hizo falta ningún cambio en `src/`.

### Cobertura (`src/core/` y `src/modules/`)

```
-----------------------------|---------|----------|---------|---------|
File                         | % Stmts | % Branch | % Funcs | % Lines |
-----------------------------|---------|----------|---------|---------|
All files                    |   99.72 |     95.1 |   99.23 |   99.84 |
 core                        |   99.46 |    94.73 |   97.14 |   99.42 |
 core/clients                |     100 |    95.12 |     100 |     100 |
 core/middlewares            |     100 |    94.87 |     100 |     100 |
 core/repositories           |     100 |     87.5 |     100 |     100 |
 core/tareas                 |     100 |      100 |     100 |     100 |
 modules/alerta-uif          |     100 |       80 |     100 |     100 |
 modules/consultar-deposito  |     100 |      100 |     100 |     100 |
 modules/conversion-moneda   |     100 |      100 |     100 |     100 |
 modules/historial-depositos |    98.7 |     91.3 |     100 |     100 |
 modules/limites-por-canal   |     100 |      100 |     100 |     100 |
 modules/registrar-deposito  |     100 |      100 |     100 |     100 |
-----------------------------|---------|----------|---------|---------|
```

Umbral 80 % cumplido en `src/core/` y `src/modules/`.

### Retrabajo v1.2

- **Tester** · 2026-11-09 · Feature 11 (`conversion-moneda`) · retrabajo por spec v1.1 → v1.2
  (D1: no hay conversión hacia cuentas USD; CM-R11; CM-T09; el seed ya no trae PEN→USD).
  No toqué `src/`, `db/`, `mocks/`, `scripts/` ni los helpers/setup de `tests/`.
- **Ejecución:** `bash init.sh` completo con PostgreSQL real → `Test Suites: 23 passed, 23 total` ·
  `Tests: 492 passed, 492 total` (0 todo) · `[OK] Todas las pruebas en verde (unitarias + integración)`.
  `bash init.sh --rapido` → 263/263, sin WARN (ya no sale `SPEC-11 aún sin prueba: CM-T09`).
  No hubo deadlock de `TRUNCATE`: verde a la primera.

#### Pruebas obsoletas por v1.2 (eliminadas o reescritas)

| Prueba anterior | Archivo | Qué se hizo |
|---|---|---|
| `CM-R05 PEN → USD con 0.26 a la billetera 11111111-…: 150.00 PEN → 39.00 USD` | `tests/unit/conversion-moneda/conversion.test.js` | Eliminada. En su lugar van `CM-R11 PEN a la billetera USD…` (U:110), `CM-R11 persistir tras el corte…` (U:126) y `CM-R01 USD a la billetera USD…` (U:138) |
| `CM-R03 PEN → USD a la billetera 11111111-… usa la fila PEN→USD (0.26)…; Billetera USD recibe "39.00" USD` | `tests/integration/conversion-moneda/conversion.test.js` | Eliminada (v1.2 ya no convierte en ese sentido; CM-T09 cubre el caso). Se quitó también la constante `EXTENSION_39` |
| `CM-R09 PEN → USD y Billetera USD responde 500 → FALLIDO…` | idem | Reescrita (I:310) con USD → PEN a `0011-0123-456789` y 500: 502, FALLIDO `375.00` PEN, la fila de conversión se queda y `GET /depositos/{id}` del FALLIDO trae la extensión |
| `CM-R03 solo hay fila USD→PEN y el depósito es PEN a la billetera USD → 422 (no invierte)` | idem | Ahora se llama `CM-R11 …` (I:295); las aserciones no cambian |
| `CM-R03 solo hay fila PEN→USD y el depósito es USD a cuenta PEN → 422 (no invierte)` | idem | Sigue igual y además comprueba que `buscarVigente` se llama una vez con `('USD','PEN')`. Sirve de control de que el espía de CM-T09 funciona |
| `CM-T07 (PEN → USD) feature inactivo…` | idem | Sin cambios (sigue dando 422 en v1.2) |

#### Casos cubiertos (nuevos o convertidos)

| Caso | Archivo | Qué comprueba |
|---|---|---|
| CM-T09 | `tests/integration/conversion-moneda/conversion.test.js:262` | Feature activa y tipo PEN→USD 0.2600 cargado; `100.00` PEN a `11111111-…` → 422 `MONEDA_NO_SOPORTADA` con `correlationId`; Billetera USD consultada 1 vez; 0 créditos USD y 0 créditos PEN; `depositos` y `conversiones_deposito` vacías; `repository.buscarVigente` **no** se llama (CM-R11; `jest.spyOn` sin mock, la BD es real) |
| CM-R11 (unit) | `tests/unit/conversion-moneda/conversion.test.js:110` | `ejecutar` con cuenta USD y depósito PEN → devuelve el mismo objeto, no lanza, `db.query` no se llama aunque haya fila PEN→USD, `contexto.privado` vacío, sin extensión |
| RD-T14 (activa y con tipo PEN→USD) | `tests/integration/registrar-deposito/registrar.test.js:626` | Era el `test.todo` de SPEC-07 que esperaba esta feature. Ahora es prueba real: `conversion-moneda` activa, fila PEN→USD cargada, `100.00` PEN a `11111111-…` → 422 `MONEDA_NO_SOPORTADA`; 1 consulta a Billetera USD; 0 créditos; 0 depósitos; 0 conversiones (RD-T14 v2.2, D1) |

El resto (CM-T01..T08, CM-R01..R08, CM-R10) no cambió y sigue en verde.

#### Otras pruebas revisadas (uso de PEN→USD)

- `tests/integration/consultar-deposito/consultar.test.js` (CD-T07/CD-T08): usan USD→PEN 3.7500 a
  `0011-0123-456789`. Siguen bien con v1.2, sin cambios.
- `tests/integration/alerta-uif/*`, `tests/unit/alerta-uif/alerta.test.js` (SPEC-12): `conversion-moneda`
  inactiva y sin tipos de cambio. Sin cambios.
- `tests/unit/registrar-deposito/service.test.js` (RD-T14 unitario, sin conversión): sin cambios.
- Otras coincidencias de `PEN`/`USD` (`historial`, `permisos`, `proyecto`): no tienen que ver con la
  conversión. Sin cambios.

#### Casos en `test.todo`

Ninguno. En `tests/` ya no queda ningún `test.todo`.

#### Pruebas fallidas

Ninguna.

#### Cobertura (`src/core/` y `src/modules/`)

All files 99.76 % stmts / 94.66 % branch / 99.32 % funcs / 99.87 % lines. `core` 99.46/94.73/97.14/99.42;
`modules/conversion-moneda` 100/100/100/100; `modules/registrar-deposito` 100/93.75/100/100. Todo
supera el umbral del 80 %.

## SPEC-12

- **Tester** · 2026-11-03 · Feature 12 (`alerta-uif`) · **retrabajo** por SPEC-02 §4 v2.0 (spec 12
  sin cambios; sin desarrollador).
- **Ejecución:** `bash init.sh` completo, con PostgreSQL real (`deposito_test`) → exit 0,
  `Test Suites: 23 passed, 23 total` · `Tests: 409 passed, 409 total` (0 todo) ·
  `[OK] SPEC-12: todos sus casos tienen prueba` · `[OK] Todas las pruebas en verde` ·
  `[OK] Entorno listo`.
- **Cambios del retrabajo** (actualizado, no solo añadido):
  - `tests/unit/alerta-uif/alerta.test.js`: la prueba UIF-R03 USD usaba `0011-0123-000002` como
    cuenta USD (en v2.0 es PEN, de `usr-cliente-2`). Ahora todos los depósitos USD unitarios
    (UIF-R02, UIF-R03 ×2, UIF-R05, UIF-R06) usan la billetera USD
    `22222222-2222-4222-8222-222222222222` (`WALLET_USD`). Ya no queda ninguna referencia a
    `0011-0123-000002` en las pruebas de SPEC-12.
  - `tests/integration/alerta-uif/alerta.test.js`: `post()` acepta `body`; nuevo bloque
    «umbral USD con Billetera USD» (VENTANILLA USD, límite 15000.00, `usr-cajero-1`) con los
    helpers `billeteraUsdExiste`, `acreditaUsdOk` y `acreditaUsdFalla` de
    `tests/helpers/billetera.js`. Antes el umbral USD solo se probaba en unitarias.
- Integración: `crearApp({ manifest })` por prueba, `conversion-moneda` **inactiva**, `alerta-uif`
  activa o inactiva según el caso; umbrales de prueba de `tests/setup/env.js` (`1000.00` PEN /
  `300.00` USD). `afterEach` espera a que se estabilice `auditoria_depositos` antes de
  `limpiar()`/`TRUNCATE`. Líneas ≤ 100 caracteres.
- Unitarias: `jest.mock('src/config')` con `uif: { umbralPEN: null, umbralUSD: '300.00' }`
  (UIF-T07); `db` y `logger` falsos.

### Casos cubiertos

| Caso | Archivo | Qué comprueba |
|---|---|---|
| UIF-T01 | `tests/integration/alerta-uif/alerta.test.js` | `1000.00` PEN → 201 COMPLETADO; 1 fila en `alertas_uif`: `deposito_id` = id del depósito, `monto 1000.00`, `PEN`, `umbral 1000.00`, `PENDIENTE`, `id` UUID propio |
| UIF-T02 | idem | `999.99` PEN → 201 COMPLETADO; 0 filas |
| UIF-T03 | idem | Billetera 500, `5000.00` PEN → 502 `BILLETERA_NO_DISPONIBLE`; depósito `FALLIDO`; 0 filas. Variante USD: Billetera USD 500 con `5000.00` USD a `22222222-…` → 502, `FALLIDO`, 0 filas |
| UIF-T04 | idem | `repository.insertar` espiado reenvía al real con moneda `PENX` (error real de PostgreSQL) → 201 COMPLETADO, depósito COMPLETADO, 0 alertas; el logger del módulo recibe 1 `error` con `depositoId` |
| UIF-T05 | idem | Depósito `5000.00` con alerta → `GET /depositos/{id}` 200 con exactamente las claves del depósito + `extensiones: {}`; ni el GET ni el 201 contienen `uif`/`umbral`/`PENDIENTE`/`estadoReporte` |
| UIF-T06 | idem | Feature `inactivo`, `5000.00` PEN → 201 COMPLETADO; 0 filas |
| UIF-T07 | `tests/unit/alerta-uif/alerta.test.js` | `config` simulado sin umbral PEN, `5000.00` PEN → sin INSERT (ni `db.query`); `logger.warn` con `depositoId` y `moneda: 'PEN'`; sin `error` |

Pruebas adicionales por regla (todas verdes):

- **UIF-R01** (integración): FALLIDO con billetera 500 y reintento exitoso con la misma clave → 1
  alerta PENDIENTE.
- **UIF-R02** (unit): `100.00` USD a la billetera USD convertido a `375.00` PEN → sin alerta.
- **UIF-R03 umbral USD** (unit): `300.00` USD a `22222222-…` → INSERT `'PENDIENTE'` con
  `[uuid v4, depositoId, '300.00', 'USD', '300.00']`; `299.99` USD → sin INSERT.
- **UIF-R03 umbral USD** (integración, Billetera USD con nock): `300.00` USD VENTANILLA a
  `22222222-…` → 201 COMPLETADO, 1 GET y 1 POST a Billetera USD, 0 llamadas a la billetera PEN,
  1 fila `{ monto 300.00, USD, umbral 300.00, PENDIENTE }`; `299.99` USD → 201 COMPLETADO, 0 filas.
- **UIF-R05** (unit): contrato SPEC-06 (`id`, `tipo: 'post-proceso'`, sin `leerExtension`); el
  depósito no se modifica.
- **UIF-R06** (unit): `db.query` rechaza → `logger.error` con `depositoId`, `ejecutar` resuelve.
- **UIF-R07** (integración): ninguna fila de `auditoria_depositos` menciona uif/umbral/estado_reporte.

### Casos en `test.todo`

Ninguno.

### Pruebas fallidas

Ninguna. No hizo falta cambiar `src/`.

### Cobertura (`src/core/` y `src/modules/`)

```
-----------------------------|---------|----------|---------|---------|
File                         | % Stmts | % Branch | % Funcs | % Lines |
-----------------------------|---------|----------|---------|---------|
All files                    |   99.72 |     95.1 |   99.23 |   99.84 |
 core                        |   99.46 |    94.73 |   97.14 |   99.42 |
 core/clients                |     100 |    95.12 |     100 |     100 |
 core/middlewares            |     100 |    94.87 |     100 |     100 |
 core/repositories           |     100 |     87.5 |     100 |     100 |
 core/tareas                 |     100 |      100 |     100 |     100 |
 modules/alerta-uif          |     100 |       80 |     100 |     100 |
 modules/consultar-deposito  |     100 |      100 |     100 |     100 |
 modules/conversion-moneda   |     100 |      100 |     100 |     100 |
 modules/historial-depositos |    98.7 |     91.3 |     100 |     100 |
 modules/limites-por-canal   |     100 |      100 |     100 |     100 |
 modules/registrar-deposito  |     100 |      100 |     100 |     100 |
-----------------------------|---------|----------|---------|---------|
```

Todo por encima del 80 %.

### Retrabajo v1.3

- **Tester** · 2026-11-09 · Feature 12 (`alerta-uif`) · spec 1.2 → 1.3: solo cambia UIF-R01
  («también tras un reintento exitoso **o una reconciliación (RD-R13), una sola vez por
  depósito**»). Sin casos UIF-Tnn nuevos; sin desarrollador (no se tocó `src/`).
- **Ejecución:** `bash init.sh` completo con PostgreSQL real (`deposito_test`) → exit 0,
  `Test Suites: 23 passed, 23 total` · `Tests: 494 passed, 494 total` (0 todo) ·
  `[OK] SPEC-12: todos sus casos tienen prueba` · `[OK] Todas las pruebas en verde` ·
  `[OK] Entorno listo`. No apareció el deadlock de `TRUNCATE` (una sola pasada).
- **Pruebas nuevas** (`tests/integration/alerta-uif/alerta.test.js`, bloque «SPEC-12 v1.3
  alerta-uif: reconciliación (UIF-R01, RD-R13)»). Usan `reconciliar()` de
  `src/modules/registrar-deposito/reconciliacion.js`, igual que RD-T22..T24; POST `5000.00` USD
  VENTANILLA (`usr-cajero-1`, sobre `UIF_UMBRAL_USD = 300.00`, bajo el límite de 15000.00), con
  `acreditaUsdPendiente()` (202 VALIDADO) → depósito PROCESANDO y 0 alertas; luego se envejece
  `actualizado_en` 1 minuto (más que `RECONCILIACION_ANTIGUEDAD_MS`).
  - **UIF-R01 reconciliación COMPLETADO** (`aaaaaaaa-…` / `usr-pendiente`, replay
    `estado: 'COMPLETADO'`): `reconciliar()` → `{ completados: 1, fallidos: 0, pendientes: 0 }`;
    depósito COMPLETADO; **exactamente 1** fila en `alertas_uif` `{ deposito_id, 5000.00, USD,
    umbral 300.00, PENDIENTE }`. Una 2.ª `reconciliar()` → `{ 0, 0, 0 }`, 0 peticiones a
    Billetera USD, las mismas filas. Un replay del POST original (misma `Idempotency-Key`) →
    mismo `id`, 0 peticiones a Billetera USD, las mismas filas (sigue habiendo 1 alerta).
  - **UIF-R01 reconciliación FALLIDO (RECHAZADO)** (`bbbbbbbb-…` / `usr-pendiente-falla`,
    replay `estado: 'FALLIDO'`): `reconciliar()` → `{ 0, 1, 0 }`; depósito FALLIDO; 0 alertas.
- **Pruebas obsoletas de SPEC-12:** ninguna. Las pruebas existentes (UIF-T01..T07, UIF-R01
  reintento, UIF-R02, R03 PEN/USD, R05, R06, R07) siguen siendo válidas con v1.3: el cambio solo
  añade un camino (reconciliación) y no altera los demás.
- **Casos en `test.todo`:** ninguno.
- **Pruebas fallidas:** ninguna.

#### Cobertura (`src/core/` y `src/modules/`)

```
-----------------------------|---------|----------|---------|---------
File                         | % Stmts | % Branch | % Funcs | % Lines
-----------------------------|---------|----------|---------|---------
All files                    |   99.76 |    94.66 |   99.32 |   99.87
 core                        |   99.46 |    94.73 |   97.14 |   99.42
 core/clients                |     100 |    95.83 |     100 |     100
 core/middlewares            |     100 |    94.87 |     100 |     100
 core/repositories           |     100 |     87.5 |     100 |     100
 core/tareas                 |     100 |      100 |     100 |     100
 modules/alerta-uif          |     100 |       80 |     100 |     100
 modules/consultar-deposito  |     100 |      100 |     100 |     100
 modules/conversion-moneda   |     100 |      100 |     100 |     100
 modules/historial-depositos |    98.7 |     91.3 |     100 |     100
 modules/limites-por-canal   |     100 |      100 |     100 |     100
 modules/registrar-deposito  |     100 |    93.75 |     100 |     100
-----------------------------|---------|----------|---------|---------
```

Todo en el 80 % o por encima.
