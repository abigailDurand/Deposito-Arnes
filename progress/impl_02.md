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
