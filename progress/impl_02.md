# impl_02 — SPEC-02 integraciones (RETRABAJO Billetera USD, spec v2.0)

> Retrabajo: sustituye al `impl_02.md` anterior. Rama `inte_biUsd`, 2026-11-03.
> Referencia usada: `Busti:codigo/` (billeteraClient, mock, helpers), verificada regla por regla.
> No se portó nada de `codigo/` fuera de §2 (en particular, NO `registrar-deposito/service.js`).

## Archivos

| Archivo (§2) | Acción |
|---|---|
| `src/core/clients/billeteraClient.js` | MODIFICADO: dos instancias axios (PEN y USD), enrutamiento INT-R10, rutas USD INT-R04/R05/R07 |
| `mocks/billetera/server.js` | MODIFICADO: rutas USD + datos §4 nuevos (`000002` PEN, billeteras `1111…`/`2222…`/`9999…`/`8888…`) |
| `tests/helpers/billetera.js` | MODIFICADO: helpers PEN (misma firma que antes, ahora sobre `config.billetera.url`) + 9 helpers USD de §2 |
| `mocks/billetera/Dockerfile` | Sin cambios (no hace falta: el mock sigue siendo Express 4.21.2 en un solo `server.js`) |
| `tests/helpers/tokens.js`, `scripts/generar-claves-dev.js`, `scripts/generar-token.js` | Sin cambios (idénticos a `Busti:codigo/`; v2.0 no los cambia) |
| `tests/unit/integraciones/billeteraClient.test.js` | No tocado (es del tester) |

## Reglas

- **INT-R01** · Solo HTTP vía axios; ningún acceso a BD ajena.
- **INT-R02** · PEN: `Authorization: Bearer config.billetera.token` + `X-Correlation-Id` siempre (`cabecerasPen`). USD: `X-Correlation-Id` siempre; `Authorization: Bearer config.billeteraUsd.token` solo si el token es truthy (`config.js` lo deja `null` si falta) (`cabecerasUsd`).
- **INT-R03** · Ambas instancias axios usan `timeout: config.billetera.timeoutMs` (`BILLETERA_TIMEOUT_MS`); timeout/error de red → `BILLETERA_NO_DISPONIBLE` en `llamar()`.
- **INT-R04** · `GET /api/v1/billetera/wallets/{id}`: 200 → `{ numero: id, estado: 'ACTIVA', moneda: data.moneda, titularId: data.user_id }` (balance/nombre no se devuelven ni se loguean); 404 → `null`; otro → `BILLETERA_NO_DISPONIBLE`.
- **INT-R05** · `POST /api/v1/depositos/usd` con `Idempotency-Key: depositoId`. 201/200 con `estado === 'COMPLETADO'` → resuelve; 409 → `logger.error` + `BILLETERA_NO_DISPONIBLE`; 201/200 con otro estado, otro status o timeout → `BILLETERA_NO_DISPONIBLE` (`logger.warn`).
- **INT-R06** · Una sola petición por llamada, sin reintentos (ambas billeteras). El body USD se arma solo con datos del depósito, así un reintento manual reenvía la misma clave con body idéntico.
- **INT-R07** · Body USD: `cliente_id = usuarioId`, `cuenta_destino_id = cuenta`, `monto = new Decimal(monto).toFixed(2)`, `moneda: 'USD'`, `metodo_origen` por tabla `METODO_ORIGEN` (VENTANILLA/AGENTE → EFECTIVO, APP → TRANSFERENCIA), `referencia_externa = depositoId`; sin `concepto`.
- **INT-R08** · No aplica al cliente (no se llama a usuario-service).
- **INT-R09** · Mock: PEN guarda `depositoId` en un `Set` → 409 si se repite. USD guarda cada `Idempotency-Key` con su body canónico (los 6 campos del contrato en orden fijo, para no depender del orden de claves del JSON) y el `Deposito` devuelto: misma clave + mismo body → 200 con el mismo `Deposito` (replay); misma clave + otro body → 409 `IDEMPOTENCY_CONFLICT`; si no → 201 `estado: 'COMPLETADO'`. Billetera `9999…` → 500 y `8888…` → espera 6 s antes de acreditar (§4). El replay se evalúa antes de la falla simulada.
- **INT-R10** · `RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/` (sin `/i`: solo minúsculas). UUID → USD; el resto → PEN. Solo vive en `billeteraClient.js`; la API pública sigue siendo `consultarCuenta(numero, correlationId)` / `acreditar(datos, correlationId)`.
- **INT-R11** · `GET /api/v1/cuentas/{numero}` igual que antes (200 → `{ numero, estado, moneda, titularId }`; 404 → `null`; otro → error).
- **INT-R12** · `POST /api/v1/cuentas/{numero}/creditos` con `{ depositoId, monto: 'x.xx', moneda, concepto: 'DEPOSITO' }`; 200/201/409 → resuelve.
- **Datos §4** · Mock y helpers: `0011-0123-000002` ahora ACTIVA **PEN** `usr-cliente-2`; billeteras USD `11111111-…` (`usr-cliente-1`), `22222222-…` (`usr-cliente-2`); especiales del mock `99999999-…` (500) y `88888888-…` (6 s).
- **PRY-R06** · Montos con `Decimal(...).toFixed(2)`; ningún `Number`/`parseFloat` sobre montos.
- **PRY-R09** · URLs solo vía `config` (grep en `src/`: ninguna URL fuera de `config.js`).
- **PRY-R10** · Logs con `enmascararCuenta(cuenta)`; nunca `balance`, `nombre` ni el token.

## Decisiones

- **Cuenta que no es UUID en minúsculas → billetera PEN** (incluido un UUID en mayúsculas). La spec solo define los dos formatos; el formato lo valida quien llama (RD-R02 / HD-R01). Así el comportamiento PEN previo no cambia.
- **Respuestas USD con formato del contrato** (`Billetera_USD_openapi.yaml`): errores con `ApiError` (`status, code, message, correlation_id, timestamp`) y acreditaciones con `Deposito` (`deposito_id, cliente_id, cuenta_destino_id, monto, moneda, estado, movimiento_saldo_id, creado_en, completado_en`), en mock y helpers. Busti devolvía el body de vuelta, que no es el contrato.
- **`nombre`/`balance` de los datos de prueba**: no los fija §4. Para `11111111-…` uso los del ejemplo de §5 (`"Cliente Uno"`, `"350.75"`); para el resto, `nombre: null` (el contrato lo permite) y `balance: "0.00"`. Busti tenía valores inventados (`Cliente Dos`, `100.00`, `Falla`, `Lenta`).
- **Billeteras especiales del mock sin titular** (`user_id: null`), igual que las cuentas PEN especiales (`titularId: null`): §4 no les asigna titular. Busti les ponía `usr-cliente-1`, que no está en la spec.
- Mock USD: además, 400 sin `Idempotency-Key` o sin campos obligatorios y 404 si `cuenta_destino_id` no existe (respuestas declaradas en el contrato).
- **Firmas de helpers**: PEN sin cambios (`fn(numero = '0011-0123-456789', opciones)`); USD de consulta `fn(id = '11111111-…', opciones)`; USD de acreditación sin id (la ruta `POST /api/v1/depositos/usd` no lo lleva): `acreditaUsdOk()`, `acreditaUsdReplay()`, `acreditaUsdConflicto()`, `acreditaUsdPendiente()`, `acreditaUsdFalla({ status = 500 })`, `acreditaUsdLento({ demora = 6000 })`. Todas devuelven el scope de nock con `peticiones` (`{ headers, body }`). Se exportan también `CUENTAS` y `BILLETERAS_USD`.

## Verificación

- `node -e "require('./tests/setup/env.js'); require('./src/core/clients/billeteraClient'); require('./tests/helpers/billetera')"` → carga OK; `node --check mocks/billetera/server.js` → OK.
- Prueba manual con los helpers (script en scratchpad, no en el repo): consulta USD sin `balance`/`nombre` y sin `Authorization`; acreditar USD lleva `Idempotency-Key` y el body exacto de INT-R07 (`"150.00"`, `TRANSFERENCIA` para APP); 409 y `PENDIENTE` → `BILLETERA_NO_DISPONIBLE`; `000002` → PEN; UUID en mayúsculas → va a PEN.
- **El mock no se probó levantado**: el permiso para arrancar y parar un proceso en el puerto 4000 fue denegado. Queda pendiente probarlo a mano con `docker compose up billetera-mock`.

### `bash init.sh` (completo, con PostgreSQL)

```
[OK]    Alcance de archivos correcto (178 archivos revisados)
[OK]    specs-v2/ intacto (15 archivos)
[OK]    feature_list.json válido (13 features: pending=0 in_progress=1 done=6 blocked=0 reabierta=6)
[WARN]  SPEC-02 (en curso) aún sin prueba: INT-T08..INT-T15
[WARN]  SPEC-07 (reabierta) aún sin prueba: RD-T13..RD-T18
[WARN]  SPEC-08 (reabierta) aún sin prueba: CD-T10..CD-T13
[WARN]  SPEC-09 (reabierta) aún sin prueba: HD-T09..HD-T12
Test Suites: 3 failed, 20 passed, 23 total
Tests:       3 failed, 354 passed, 357 total
[FAIL]  Hay pruebas rotas
```

Las 3 fallas esperadas vienen del contrato anterior (`0011-0123-000002` como USD). **Son del tester; no las toqué**:

1. `tests/unit/integraciones/billeteraClient.test.js` › `consultarCuenta › INT-T01 (cuentas BLOQUEADA y USD de §4) → devuelve su estado y moneda reales`: espera `moneda: 'USD'` para `000002`; ahora es PEN.
2. `tests/integration/registrar-deposito/registrar.test.js` › `SPEC-07 registrar-deposito: reglas › verificarTitular: usr-cliente-1 por APP a su cuenta → 201; usr-cajero-1 por VENTANILLA a 0011-0123-000002 (USD) → 201`: 422 (moneda USD ≠ cuenta PEN).
3. `tests/integration/conversion-moneda/conversion.test.js` › `SPEC-11 conversion-moneda: reglas con la BD real › CM-R03 PEN → USD usa la fila PEN→USD (0.26), no la inversa de USD→PEN`: sin conversión porque `000002` ya es PEN.

Pruebas que **pasan pero quedaron obsoletas** (usan `0011-0123-000002` como cuenta USD; deben pasar a `22222222-2222-4222-8222-222222222222` con los helpers USD):

- `tests/integration/consultar-deposito/consultar.test.js` (`CUENTA_USD`, l. 20; `CD-R02 usr-cliente-2 ve un depósito a su cuenta USD 0011-0123-000002`).
- `tests/integration/conversion-moneda/conversion.test.js` (`CUENTA_USD`, l. 14).
- `tests/integration/historial-depositos/historial.test.js` (`CUENTA_USD`, l. 20).
- `tests/integration/registrar-deposito/registrar.test.js` (`CUENTA_USD`, l. 18).
- `tests/unit/seguridad/permisos.test.js` (`CUENTA_USD` con `moneda: 'USD'`, l. 18; SPEC-03).
- `tests/unit/alerta-uif/alerta.test.js` (l. 75, depósito USD a `000002`).
- `tests/integration/seguridad/seguridad.test.js` (SEG-T06 usa `000002` como cuenta ajena: sigue siendo válido, ahora PEN).

Además, los casos nuevos INT-T08..INT-T15 están sin prueba (tester).

---

# Retrabajo v2.1, 2026-11-09 (SPEC-02 v2.0 → v2.1, Billetera USD v1.2.0)

> desarrolladorback. Cambio de spec: `git diff specs-v2/02-integraciones.md`. Contrato:
> `docs/referencia/Billetera_USD_openapi_v1.2.0.yaml`. Referencia del mock USD:
> `docs/specs-propuestas/mock-billetera-usd/server.js`. Lo anterior de este archivo queda como historia.

## Archivos

| Archivo | Acción |
|---|---|
| `src/core/clients/billeteraClient.js` (§2) | MODIFICADO: OAuth client credentials (INT-R13), mapeo de `Wallet.estado` (INT-R04), nueva firma y resultado de `acreditar` (INT-R05, R07, R12); ya no lee `config.billeteraUsd.token` |
| `mocks/billetera/server.js` (§2) | MODIFICADO: rutas USD v1.2.0 (datos §4 nuevos, especiales por `cliente_id`, 202 VALIDADO, validación de body, `/oauth2/token`) |
| `tests/helpers/billetera.js` (§2) | MODIFICADO: datos §4 nuevos y helpers `billeteraUsdBloqueada`, `billeteraUsdCerrada`, `acreditaUsdRechazo`, `tokenUsdOk`, `tokenUsdFalla`; `acreditaUsdPendiente` pasa a 202 VALIDADO |
| `mocks/billetera/Dockerfile` (§2) | Sin cambios (sigue siendo Express 4.21.2 en un solo `server.js`) |
| `tests/helpers/tokens.js`, `scripts/generar-*.js` (§2) | Sin cambios (v2.1 no los toca) |
| `tests/unit/integraciones/billeteraClient.test.js` (§2) | No tocado (es del tester) |
| `src/modules/registrar-deposito/service.js` (**fuera de §2**, SPEC-07) | Ajuste transitorio autorizado por el leader; detalle abajo |

## Reglas

- **INT-R01** · Solo HTTP con axios; nada de BD ajena.
- **INT-R02** · PEN: `Authorization: Bearer <BILLETERA_TOKEN>` + `X-Correlation-Id` (`cabecerasPen`). USD: `X-Correlation-Id` siempre y `Authorization: Bearer <token OAuth>` cuando hay `tokenUrl` (`cabecerasUsd`, ahora async). La petición de token también lleva `X-Correlation-Id`.
- **INT-R03** · Ambas instancias axios y la petición de token usan `config.billetera.timeoutMs`.
- **INT-R04** · `ACTIVE→ACTIVA`, `BLOCKED→BLOQUEADA`, `CLOSED→CERRADA` (`ESTADOS_BILLETERA_USD`). Estado desconocido, o `user_id` ausente o vacío → `BILLETERA_NO_DISPONIBLE`. Estado ausente (`undefined`/`null`) → `ACTIVA` solo sin `tokenUrl` (ver Decisiones); con `tokenUrl` → `BILLETERA_NO_DISPONIBLE`. 404 → `null`. `balance` y `nombre` ni se devuelven ni se loguean (el log de fallo solo lleva `estadoBilletera` y el booleano `conTitular`).
- **INT-R05** · `resultadoUsd()`: 201/200 + `COMPLETADO` + `movimiento_saldo_id` no nulo → `{ estado: 'ACREDITADO' }`; 202/200 + `VALIDADO`/`PENDIENTE` → `{ estado: 'PENDIENTE' }`; 422 con `code` en `WALLET_BLOCKED`/`WALLET_CLOSED`/`CUSTOMER_BLOCKED`/`USD_ACCOUNT_NOT_ENABLED` → `ErrorApp('CUENTA_INACTIVA')` (log `warn`); 409 → `logger.error` + `BILLETERA_NO_DISPONIBLE`; 401/403 → `logger.error` + `BILLETERA_NO_DISPONIBLE`; todo lo demás (FALLIDO, COMPLETADO sin movimiento, 201 VALIDADO, 202 COMPLETADO, 422 con otro code, 429, 5xx, timeout) → `BILLETERA_NO_DISPONIBLE` (log `warn`). Firma: `acreditar({ depositoId, cuenta, monto, moneda, titularId, canal }, correlationId)`.
- **INT-R06** · Una sola petición en `acreditar`, sin reintentos. Un fallo de token no se cachea: la siguiente llamada pide otro. El body se arma solo con datos del depósito → el reenvío es idéntico.
- **INT-R07** · Body: `{ cliente_id: titularId, monto: Decimal.toFixed(2), moneda: 'USD', canal, metodo_origen: METODO_ORIGEN[canal], referencia_externa: depositoId }`. Sin `cuenta_destino_id` ni `concepto`. El mapeo de `metodo_origen` no cambia (ya cumple `x-channel-method-policy`).
- **INT-R08** · No aplica al cliente.
- **INT-R09** · Mock USD: valida `Idempotency-Key` (UUID v4), campos permitidos (los de `CrearDepositoRequest`, `additionalProperties: false`), `cliente_id`, `monto` (`^\d+(\.\d{1,2})?$`), `moneda` USD u omitida, `canal` y política canal→método → 400 `VALIDATION_ERROR`. Replay: misma clave + mismo body → 200 con el estado actual; otro body → 409 `IDEMPOTENCY_CONFLICT`. Especiales por `cliente_id` de §4: `usr-falla` 503; `usr-falla-una-vez` 503 la primera vez por clave; `usr-lento` registra y tarda 6 s; `usr-carrera` 422 `WALLET_BLOCKED`; `usr-cliente-bloqueado` 422 `CUSTOMER_BLOCKED`; `usr-sin-usd` 422 `USD_ACCOUNT_NOT_ENABLED`; `usr-pendiente` / `usr-pendiente-falla` 202 VALIDADO (con `Location` y `Retry-After: 5`) y a los 5 s `COMPLETADO` / `FALLIDO`. Además, `usr-bloqueada` → 422 `WALLET_BLOCKED` y `usr-cerrada` → 422 `WALLET_CLOSED` (como la referencia). Resto → 201 COMPLETADO con `movimiento_saldo_id: 'mov_<uuid>'`. Nunca cambia `balance`. Rutas PEN sin cambios.
- **INT-R10** · Sin cambios (`RE_UUID` en minúsculas → USD; el resto → PEN).
- **INT-R11** · Sin cambios.
- **INT-R12** · 200/201/409 → ahora resuelve `{ estado: 'ACREDITADO' }` (antes `undefined`).
- **INT-R13** · `obtenerTokenUsd()`: sin `config.billeteraUsd.tokenUrl` → `null` (no hay `Authorization`). Si no, reutiliza `tokenUsd` mientras falten más de 60 s (`MARGEN_TOKEN_MS`) para `expiraEn`; si no, pide uno, y las llamadas concurrentes comparten la misma promesa (`solicitudTokenUsd`). Petición: `POST tokenUrl`, `application/x-www-form-urlencoded` con `grant_type=client_credentials` y `scope=billetera/wallets.read billetera/depositos.write`, con las credenciales en HTTP Basic. Token inválido (status ≠ 200, sin `access_token` o sin `expires_in` entero > 0), error de red o timeout → `BILLETERA_NO_DISPONIBLE` sin llamar a la billetera. Logs: solo `motivo: 'token'` con `status` o `err.code`; nunca el objeto de error de axios (lleva las credenciales), el secreto ni el token. Usa `Date.now()`, así que el tester puede simular la expiración con los timers falsos de Jest. La caché es de módulo: `jest.resetModules()` / `isolateModules` la limpian.
- **INT-R14** · Solo `POST /api/v1/depositos/usd` (`RUTA_DEPOSITOS_USD`); no hay ninguna llamada a `/wallets/{id}/depositos`.
- **PRY-R06** · Montos con `new Decimal(monto).toFixed(2)`; ningún `Number`/`parseFloat` sobre montos (`Number.isInteger` solo se aplica a `expires_in`).
- **PRY-R09** · URLs y credenciales solo vía `config.billeteraUsd.{url,tokenUrl,clientId,clientSecret}`.
- **PRY-R10** · Comprobado a mano: con un secreto erróneo y `LOG_LEVEL=debug`, el secreto aparece 0 veces en la salida.

## Ajuste transitorio fuera de §2 (`src/modules/registrar-deposito/service.js`, SPEC-07)

Autorizado por el leader, solo para que el registro siga funcionando como hoy con la nueva firma. Líneas tocadas:

1. `depositoDesdeFila`: `+ titularId: fila.titular_id ?? null,` (para el reintento; la columna existe desde SPEC-01 v1.2, pero hoy nadie la guarda, así que vale `null`).
2. `acreditarYCerrar`: `await billeteraClient.acreditar({...})` → `const resultado = await billeteraClient.acreditar({...})`, más un comentario de 2 líneas que marca el ajuste como transitorio.
3. `acreditarYCerrar`: `- usuarioId: deposito.usuarioId,` → `+ titularId: deposito.titularId,`.
4. `acreditarYCerrar`, dentro del `try`: `+ if (resultado?.estado === 'PENDIENTE') throw new ErrorApp('BILLETERA_NO_DISPONIBLE');`. Así `PENDIENTE` sigue el mismo camino que hoy (con v2.0, un estado distinto de COMPLETADO ya daba `BILLETERA_NO_DISPONIBLE` → FALLIDO → 502), y `ACREDITADO` es el éxito de hoy. El `?.` hace que los mocks de SPEC-07 que resuelven `undefined` (contrato anterior) sigan contando como éxito; con el cliente real equivale a `!== 'ACREDITADO'`.
5. `registrar`, objeto `deposito`: `+ titularId: cuenta.titularId,` (SPEC-06 §4 v2 ya incluye `titularId` en el depósito).

**Fuera de este ajuste (queda para el retrabajo de SPEC-07):** no se guarda `titular_id` (DOM-R11 / RD-R05), no hay manejo de `PENDIENTE` ni reconciliación (RD-R12/R13), y el `CUENTA_INACTIVA` de `acreditar` (422) sigue cayendo en el `catch` actual → FALLIDO + 502 `BILLETERA_NO_DISPONIBLE`. **Hueco conocido:** como `titular_id` aún no se guarda, un reintento (RD-R08) de un depósito USD envía `cliente_id: null` y Billetera USD lo rechazaría con 400 (→ FALLIDO otra vez). Los reintentos USD no funcionan hasta SPEC-07.

## Decisiones

- **"Transición" (INT-R04, Q7) = sin `BILLETERA_USD_TOKEN_URL`.** INT-R04 acepta `estado` ausente como `ACTIVA` "solo durante la transición (Q7)", pero no dice cómo se detecta la transición. La única señal configurable en las specs es la de INT-R13 / SPEC-00 §5: `BILLETERA_USD_TOKEN_URL` es opcional "mientras dure la transición, Q7". Por eso: sin `tokenUrl` → estado ausente = `ACTIVA`; con `tokenUrl` (v1.2.0 completa) → `BILLETERA_NO_DISPONIBLE`. **Que el revisor lo confirme.** Si el humano quiere otra señal, es un cambio de una línea (`estadoBilleteraUsd`).
- **`expires_in` obligatorio** en la respuesta del token: sin él no se puede aplicar el margen de 60 s. Si falta → `BILLETERA_NO_DISPONIBLE` (INT-R13: "no obtener token").
- **Credenciales en HTTP Basic** (RFC 6749 §2.3.1, recomendado para client credentials). El mock acepta Basic o body.
- **Un 401/403 de la billetera no borra el token cacheado:** la spec no lo pide (PRY-R12). Si el token se revocara, se seguiría usando hasta 60 s antes de expirar. Lo señalo por si el humano quiere añadirlo.
- **Peticiones concurrentes con fallo de token:** todas reciben `BILLETERA_NO_DISPONIBLE`, pero solo hay una línea de log (la de la primera, con su `correlationId`).
- **Mock y OAuth:** `/oauth2/token` (client credentials; credenciales `MOCK_CLIENT_ID` / `MOCK_CLIENT_SECRET`, por defecto `deposito-service` / `secreto-solo-para-el-mock`, solo válidas contra el mock). Las rutas USD aceptan peticiones sin `Authorization` (como el servidor real hoy, Q7). Si traen un Bearer, debe ser un token vigente del mock con el scope; si no, 401 / 403. Para probar OAuth con compose: `BILLETERA_USD_TOKEN_URL=http://billetera-mock:4000/oauth2/token` y esas credenciales en `.env`.
- **Lo que NO porté de la referencia** (no está en §5): `GET /api/v1/depositos/usd/{id}`, `/health/*`, `/__mock/*` y los interruptores de configuración (`exigirOauth`, `exigirCanal`, `abonarBilletera`, `replayEstadoActual`). El mock se comporta como la referencia con `exigirCanal: true`, `abonarBilletera: false` y `replayEstadoActual: true`. El `Location` del 202 apunta a una ruta que el mock no atiende.
- **Datos §4:** las billeteras especiales tienen ahora el titular que les da §4 (`usr-falla`, `usr-lento`, ...), en el mock y en `BILLETERAS_USD` de los helpers. Todas llevan `estado`. El 404 de wallet usa `code: 'NO_ENCONTRADA'` (como la referencia).
- **Helpers (firmas):** `billeteraUsdExiste(id, cambios)`: `cambios` sobrescribe campos (`{ estado: undefined }` = ausente, `{ estado: 'OTRO' }` = desconocido, `{ user_id: undefined }`). `billeteraUsdBloqueada(id = 3333…)`, `billeteraUsdCerrada(id = 4444…)`. `acreditaUsdOk({ status = 201, cambios })` (`cambios: { movimiento_saldo_id: null }` para INT-T10). `acreditaUsdReplay({ estado = 'COMPLETADO', cambios })`. `acreditaUsdPendiente({ retryAfter = 5 })` → **202 VALIDADO** con `Location` y `Retry-After` (antes 201 PENDIENTE). `acreditaUsdRechazo(codigo = 'WALLET_BLOCKED')` → 422. `acreditaUsdFalla({ status = 500, code })`. `tokenUsdOk({ url, expiresIn = 3600, accessToken })` (el scope expone `.accessToken`). `tokenUsdFalla({ url, status = 401, demora })`. La URL de token sale de `url`, o de `process.env.BILLETERA_USD_TOKEN_URL`, o de `config`. Nuevo export `RECHAZOS_USD` (los 4 códigos de INT-T18). Los `Deposito` de los helpers llevan `cuenta_destino_id: null`, `canal` y `metodo_origen`.

## Verificación

- `node -e "require('./src/core/clients/billeteraClient'); require('./src/modules/registrar-deposito/service'); require('./tests/helpers/billetera.js')"` (con las variables obligatorias) → OK. `node --check mocks/billetera/server.js` → OK.
- **Mock levantado en local (puerto 4000) y cliente real contra él, con OAuth** (script en el scratchpad, no en el repo). Consulta: 1111→ACTIVA, 3333→BLOQUEADA, 4444→CERRADA, uuid inexistente→null. Acreditar: OK→ACREDITADO; replay→ACREDITADO; misma clave con otro body→BILLETERA_NO_DISPONIBLE; APP→ACREDITADO (política canal-método válida); `usr-carrera`, `usr-cerrada`, `usr-cliente-bloqueado`, `usr-sin-usd`→CUENTA_INACTIVA; `usr-falla`→BILLETERA_NO_DISPONIBLE; `usr-pendiente`→PENDIENTE; `usr-falla-una-vez`: 1.ª→BILLETERA_NO_DISPONIBLE, 2.ª con la misma clave→ACREDITADO; PEN→ACREDITADO. Token: tres consultas concurrentes → **1** petición de token. Con un secreto erróneo → las 3 dan `BILLETERA_NO_DISPONIBLE`, la siguiente llamada vuelve a pedir token y el secreto aparece 0 veces en los logs.

### `bash init.sh --rapido`

```
[OK]    specs-v2/ intacto (15 archivos)
[OK]    feature_list.json válido (13 features: pending=0 in_progress=1 done=7 blocked=0 reabierta=5)
[WARN]  SPEC-02 (en curso) aún sin prueba: INT-T16, INT-T17, INT-T18, INT-T19
[WARN]  SPEC-07 (reabierta) aún sin prueba: RD-T19..RD-T24
[WARN]  SPEC-08 (reabierta) aún sin prueba: CD-T14, CD-T15
[WARN]  SPEC-11 (reabierta) aún sin prueba: CM-T09
[OK]    Alcance de archivos correcto (189 archivos revisados)
FAIL unit tests/unit/integraciones/billeteraClient.test.js
FAIL unit tests/unit/registrar-deposito/service.test.js
Tests:       16 failed, 1 todo, 195 passed, 212 total
[FAIL]  Hay pruebas unitarias rotas
```

`bash init.sh` completo (PostgreSQL arriba): `Tests: 19 failed, 1 todo, 402 passed, 422 total`, es decir, las 16 de arriba más 3 de integración. Todas vienen del contrato anterior; ninguna es una regresión del comportamiento de v2.1.

## Pruebas obsoletas o rotas (para el tester)

**SPEC-02, `tests/unit/integraciones/billeteraClient.test.js` (10 rotas; son del tester de esta feature):**
- `INT-R12 acreditar con 200 → resuelve sin valor`, `INT-T04 acreditar con 201 → resuelve sin valor` e `INT-T04 ... 409 ... → resuelve sin valor`: ahora resuelve `{ estado: 'ACREDITADO' }`.
- `INT-T10 acreditar con 201 COMPLETADO → resuelve` e `INT-T10 ... 200 (replay)`: esperan `undefined`; ahora `{ estado: 'ACREDITADO' }`.
- `INT-T11 acreditar con 201 estado PENDIENTE → BILLETERA_NO_DISPONIBLE`: el caso ya no existe; `acreditaUsdPendiente` es ahora 202 VALIDADO → `PENDIENTE`.
- `INT-T13 body exacto ...` y los 3 `INT-T13 canal ... cliente_id = usuarioId`: pasan `usuarioId` y esperan `cuenta_destino_id` y `cliente_id = usuarioId`; ahora es `titularId`, con `canal` y sin `cuenta_destino_id`.
- INT-T15 "con token → lo lleva" (si sigue como `test.todo` desde SPEC-00) ya se puede implementar con `tokenUsdOk`. Faltan INT-T16..T19.

**SPEC-07 (no son de esta feature; las arreglará el retrabajo de SPEC-07). Rotas por el cambio de firma de `acreditar`:**
- `tests/unit/registrar-deposito/service.test.js` (6): `RD-T11`, `RD-T12`, `RD-R08`, `RD-T13` y `RD-T18` esperan `usuarioId` en el crédito (ahora `titularId`); `RD-R03/R05` espera las claves del depósito sin `titularId` (ahora lo lleva, como manda SPEC-06 §4 v2).
- `tests/integration/registrar-deposito/registrar.test.js` (2): `RD-T13` espera el body v1.1 (`cliente_id: usr-agente-1`, `cuenta_destino_id`). `RD-T18` usa un nock propio (`billeteraFallaExiste`) con `user_id: null` y sin `estado`, que INT-R04 rechaza: ahora la consulta da 502 y no se crea la fila. Debería usar `billetera.billeteraUsdExiste('99999999-…')` (`usr-falla`).

**SPEC-11 (`tests/integration/conversion-moneda/conversion.test.js`, 1):** `CM-R03 PEN → USD ... Billetera USD recibe "39.00" USD` espera `cuenta_destino_id` en el body.

**Pasan, pero dependen del contrato anterior (revisar al retrabajar sus features):** las pruebas con nocks propios de wallet sin `estado`. Hoy pasan solo porque, sin `tokenUrl`, el estado ausente cuenta como `ACTIVA`.

---

# Retrabajo v2.2, 2026-11-09 (SPEC-02 v2.1 → v2.2)

Retrabajo corto. Cambios de spec: INT-R05 (200 `FALLIDO` → `RECHAZADO`), INT-R13 (401 descarta el token
guardado; 403 no), INT-R04 (transición Q7 = sin `BILLETERA_USD_TOKEN_URL`), INT-T11 e INT-T19.

## Archivos

- [MODIFICADO] `src/core/clients/billeteraClient.js` (§2).
- [MODIFICADO, fuera de §2, ajuste transitorio autorizado por el leader] `src/modules/registrar-deposito/service.js` (SPEC-07).
- Sin cambios: `mocks/billetera/server.js` (ya devuelve 200 replay `FALLIDO` para `usr-pendiente-falla` y 401 con
  token inválido) y `tests/helpers/billetera.js` (`acreditaUsdReplay({ estado: 'FALLIDO' })` y `acreditaUsdFalla({ status: 401 })` ya cubren INT-T11/T19).

## Reglas

- **INT-R05** · `resultadoUsd`: nuevo caso `status === 200 && estado === 'FALLIDO'` → `{ estado: 'RECHAZADO' }` (constante
  `RECHAZADO`), con log `warn` sin datos sensibles. `FALLIDO` con otro status (p. ej. 201/202) sigue cayendo en
  `BILLETERA_NO_DISPONIBLE` (la spec solo define el 200 replay). El resto de casos, sin cambios.
- **INT-R13** · `cabecerasUsd` devuelve ahora `{ cabeceras, token }`; tras la respuesta, `descartarTokenUsdSi401(status, token)`
  pone `tokenUsd = null` si el status es 401 y el token guardado sigue siendo el enviado (si otra petición ya lo
  renovó, se conserva el nuevo). Se aplica en `acreditarUsd` y en `consultarCuentaUsd` (la regla habla de "un 401
  de Billetera USD", sin limitarlo a una operación). Esa llamada sigue lanzando `BILLETERA_NO_DISPONIBLE` sin
  reintento (INT-R06); la siguiente pide token nuevo. 403 no toca el token. El token no se loguea (PRY-R10).
- **INT-R04** · Confirmado: `estadoBilleteraUsd` acepta `estado` ausente como `ACTIVA` solo si
  `config.billeteraUsd.tokenUrl` está vacío; con él → `undefined` → `BILLETERA_NO_DISPONIBLE`. Solo cambió el
  comentario (y el de `obtenerTokenUsd`) para citar la definición de v2.2.

## Ajuste transitorio fuera de §2 (`src/modules/registrar-deposito/service.js`)

- Líneas 55-56: comentario actualizado (v2.1/v2.2, PENDIENTE y RECHAZADO siguen el camino de fallo).
- Líneas 65-67: `if (resultado?.estado === 'PENDIENTE' || resultado?.estado === 'RECHAZADO') { throw new ErrorApp('BILLETERA_NO_DISPONIBLE'); }`
  → mismo camino que hoy: `PROCESANDO → FALLIDO` + 502 con `depositoId`. RD-R12/R13 no se implementan (retrabajo de SPEC-07).

## Verificación

- `node -e "require(...)"` de ambos archivos (vía script) → OK.
- Script con nock en el scratchpad (no en el repo), con `BILLETERA_USD_TOKEN_URL` configurada: 200 `FALLIDO` →
  `{ estado: 'RECHAZADO' }`; 401 → `BILLETERA_NO_DISPONIBLE`; 403 → `BILLETERA_NO_DISPONIBLE`; consulta siguiente
  → total 2 peticiones de token (el 401 descartó, el 403 no); consulta con 401 → `BILLETERA_NO_DISPONIBLE` y la
  siguiente consulta pide el 3.er token.

### `bash init.sh --rapido`

```
[OK]    specs-v2/ intacto (15 archivos)
[OK]    feature_list.json válido (13 features: pending=0 in_progress=1 done=7 blocked=0 reabierta=5)
[OK]    SPEC-02: todos sus casos tienen prueba
[WARN]  SPEC-07 (reabierta) aún sin prueba: RD-T19..RD-T24
[WARN]  SPEC-08 (reabierta) aún sin prueba: CD-T14, CD-T15
[WARN]  SPEC-11 (reabierta) aún sin prueba: CM-T09
[OK]    Alcance de archivos correcto (189 archivos revisados)
FAIL unit tests/unit/integraciones/billeteraClient.test.js
  ● Billetera USD · acreditar › INT-T11 acreditar con 200 (replay) FALLIDO → BILLETERA_NO_DISPONIBLE
Tests:       1 failed, 236 passed, 237 total
[FAIL]  Hay pruebas unitarias rotas
```

No se ejecutó `init.sh` completo (integración) en este retrabajo.

## Pruebas obsoletas o rotas (para el tester)

- **Rota (obsoleta por v2.2):** `tests/unit/integraciones/billeteraClient.test.js:~570`, `INT-T11 acreditar con 200 (replay)
  FALLIDO → BILLETERA_NO_DISPONIBLE`: ahora debe esperar que resuelva `{ estado: 'RECHAZADO' }`, con 1 sola petición.
- **Falta (INT-T19 v2.2):** tras un 401, la siguiente llamada pide un token nuevo; tras un 403, no (con `tokenUsdOk`
  y `BILLETERA_USD_TOKEN_URL` configurada). Conviene cubrirlo en `acreditar` (y opcionalmente en `consultarCuenta`).
- SPEC-07: ninguna prueba unitaria actual se rompe; una prueba de `service.test.js` con `acreditar` → `RECHAZADO`
  quedará para el retrabajo de SPEC-07 (RD-R08/R13 v2.2), que reemplazará el ajuste transitorio.
