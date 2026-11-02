# SPEC-02 · Integraciones: billeteras (PEN y USD) y usuario-service

## 1. Metadatos y Tech Stack

**Objetivo:** Definir cómo deposito-service se integra con las billeteras y con usuario-service: el cliente HTTP, los mocks y los datos de prueba. Las cuentas en dólares viven en **Billetera Digital USD** (contrato `Billetera_USD_openapi.yaml` v1.1.0); las cuentas en soles viven en una **billetera PEN** que aún no existe y cuyo contrato es la PROPUESTA de deposito-service.

- **Estado:** Billetera USD: contrato publicado v1.1.0, con puntos [POR ACORDAR] (si `POST /api/v1/depositos/usd` deja el depósito `COMPLETADO` en la misma petición, `metodo_origen`, estado de la billetera). Billetera PEN y usuario-service: [POR ACORDAR].
- **Depende de:** SPEC-00, SPEC-01 (`ErrorApp`).
- **Lo usan:** SPEC-03 (JWT), SPEC-07 (consultar y acreditar), SPEC-08 y SPEC-09 (titular de la cuenta).
- **Versión spec:** 2.0

**Stack:** axios 1.7.9 (cliente), Express 4.21 (mock), jsonwebtoken 9.0.2. Pruebas: nock 13.5.

## 2. Archivos Involucrados

El Agente tiene permitido leer y modificar ÚNICAMENTE los siguientes archivos:

- [NUEVO] `src/core/clients/billeteraClient.js` (Único lugar que conoce `BILLETERA_URL` y `BILLETERA_USD_URL`. Exporta `consultarCuenta(numero, correlationId)` y `acreditar(datos, correlationId)`; enruta a la billetera PEN o USD según INT-R10).
- [NUEVO] `mocks/billetera/server.js` · `mocks/billetera/Dockerfile` (Mock en memoria, puerto 4000, que atiende las rutas de ambas billeteras de §5).
- [NUEVO] `tests/helpers/billetera.js` (Helpers de nock. PEN: `cuentaActiva`, `cuentaNoExiste`, `consultaFalla`, `acreditaOk`, `acreditaFalla`, `acreditaLento`, `acreditaYaExiste`. USD: `billeteraUsdExiste`, `billeteraUsdNoExiste`, `consultaUsdFalla`, `acreditaUsdOk`, `acreditaUsdReplay`, `acreditaUsdConflicto`, `acreditaUsdPendiente`, `acreditaUsdFalla`, `acreditaUsdLento`).
- [NUEVO] `tests/helpers/tokens.js` (`token(usuario, { exp, aud, clave, alg })` con el par RSA de `tests/.tmp/`).
- [NUEVO] `scripts/generar-claves-dev.js` (Par RSA de desarrollo en `.dev-keys/`).
- [NUEVO] `scripts/generar-token.js` (`node scripts/generar-token.js usr-agente-1`).
- [NUEVO] `tests/unit/integraciones/billeteraClient.test.js`

## 3. Flujo del Sistema

```mermaid
sequenceDiagram
    participant D as deposito-service
    participant P as billetera PEN (propuesta)
    participant U as Billetera USD
    alt cuenta con formato 0000-0000-000000 (INT-R10)
        D->>P: GET /api/v1/cuentas/{numero}
        P-->>D: { numero, estado, moneda, titularId }
        D->>P: POST /api/v1/cuentas/{numero}/creditos { depositoId, monto, moneda, concepto }
        alt 200 / 201 / 409 (ese depositoId ya se acreditó)
            P-->>D: acreditado
        else otro 4xx / 5xx / timeout
            P-->>D: falla
        end
    else cuenta UUID (INT-R10)
        D->>U: GET /api/v1/billetera/wallets/{id}
        U-->>D: { id, user_id, nombre, balance, moneda }
        D->>U: POST /api/v1/depositos/usd (Idempotency-Key = depositoId) { cliente_id, cuenta_destino_id, monto, moneda, metodo_origen, referencia_externa }
        alt 201 / 200 (replay) con estado COMPLETADO
            U-->>D: acreditado
        else 409 IDEMPOTENCY_CONFLICT / estado ≠ COMPLETADO / otro 4xx / 5xx / timeout
            U-->>D: falla
        end
    end
```

## 4. Reglas de Negocio

- **INT-R01** · Solo HTTP. Nunca acceso a la base de datos de otro servicio.
- **INT-R02** · Toda llamada envía `X-Correlation-Id`. A la billetera PEN se envía `Authorization: Bearer <BILLETERA_TOKEN>`; a Billetera USD, `Authorization: Bearer <BILLETERA_USD_TOKEN>` solo si está configurado (hoy no exige autenticación). La autenticación real entre servicios está [POR ACORDAR].
- **INT-R03** · Timeout `BILLETERA_TIMEOUT_MS` en todas las llamadas, a ambas billeteras.
- **INT-R10** · Enrutamiento por formato de la cuenta: `^\d{4}-\d{4}-\d{6}$` → billetera PEN (`BILLETERA_URL`, reglas INT-R11 e INT-R12); UUID → Billetera USD (`BILLETERA_USD_URL`, reglas INT-R04 e INT-R05). El enrutamiento vive solo en `billeteraClient.js`; quien llama no sabe a qué billetera va.

**Billetera USD**

- **INT-R04** · `consultarCuenta(id)` → `GET /api/v1/billetera/wallets/{id}` (`id` = UUID de la billetera). 200 → devuelve `{ numero: id, estado: "ACTIVA", moneda: wallet.moneda, titularId: wallet.user_id }`; 404 → devuelve `null`; otro status o timeout → lanza `ErrorApp('BILLETERA_NO_DISPONIBLE')`. Billetera no expone estado: toda billetera existente se trata como `ACTIVA` [POR ACORDAR]. `balance` y `nombre` se ignoran: no se guardan ni se loguean (PRY-R10).
- **INT-R05** · `acreditar({ depositoId, cuenta, monto, moneda, usuarioId, canal }, correlationId)` → `POST /api/v1/depositos/usd` con cabecera `Idempotency-Key: <depositoId>`. 201, o 200 (replay de la misma clave), con `estado: "COMPLETADO"` → resuelve sin valor. 409 (`IDEMPOTENCY_CONFLICT`: misma clave con datos distintos) → lanza `ErrorApp('BILLETERA_NO_DISPONIBLE')` y se loguea como `error`. Respuesta 201/200 con `estado` ≠ `COMPLETADO` → `BILLETERA_NO_DISPONIBLE` [POR ACORDAR: confirmar con Billetera USD si el depósito queda `COMPLETADO` en la misma petición o se acredita después]. Otro status o timeout → `BILLETERA_NO_DISPONIBLE`.
- **INT-R06** · Sin reintentos automáticos en `acreditar` (ambas billeteras). En Billetera USD la protección contra doble acreditación es la `Idempotency-Key` = `depositoId` (UUID v4); un reintento manual (RD-R08) reenvía la misma clave con un body idéntico, armado con los datos guardados del depósito, y billetera responde 200 (replay). En la billetera PEN la protección es el `depositoId` del body (INT-R12).
- **INT-R07** · Body: `cliente_id` = `usuarioId` (quien deposita, `sub` del JWT); `cuenta_destino_id` = UUID de la billetera; `monto` string con 2 decimales; `moneda` = `"USD"`; `metodo_origen` según canal [POR ACORDAR]: `VENTANILLA → EFECTIVO`, `AGENTE → EFECTIVO`, `APP → TRANSFERENCIA`; `referencia_externa` = `depositoId`.

**Billetera PEN (propuesta)**

- **INT-R11** · `consultarCuenta(numero)` → `GET /api/v1/cuentas/{numero}`: 200 → devuelve `{ numero, estado, moneda, titularId }`; 404 → devuelve `null`; otro status o timeout → lanza `ErrorApp('BILLETERA_NO_DISPONIBLE')`.
- **INT-R12** · `acreditar({ depositoId, cuenta, monto, moneda })` → `POST /api/v1/cuentas/{numero}/creditos` con body `{ depositoId, monto, moneda, concepto: "DEPOSITO" }` (`monto` string con 2 decimales): 200, 201 o 409 (ese `depositoId` ya se acreditó) → resuelve sin valor; otro status o timeout → lanza `ErrorApp('BILLETERA_NO_DISPONIBLE')`.

**Común**

- **INT-R08** · El JWT se valida localmente (SPEC-03). Nunca se llama a usuario-service por petición.

**Datos de prueba compartidos** (los usan el mock y los helpers; ninguna prueba inventa otros):

- **Cuentas PEN (billetera PEN):** `0011-0123-456789` ACTIVA PEN, titular `usr-cliente-1` · `0011-0123-000002` ACTIVA PEN, titular `usr-cliente-2` · `0011-0123-000003` BLOQUEADA PEN, titular `usr-cliente-1`.
- **Cuentas PEN especiales del mock:** `0011-0123-999999` ACTIVA PEN, responde 500 al acreditar · `0011-0123-888888` ACTIVA PEN, tarda 6 s al acreditar.
- **Billeteras USD (Billetera USD):** `11111111-1111-4111-8111-111111111111` USD, titular `usr-cliente-1` · `22222222-2222-4222-8222-222222222222` USD, titular `usr-cliente-2`.
- **Billeteras USD especiales del mock:** `99999999-9999-4999-8999-999999999999` responde 500 al acreditar · `88888888-8888-4888-8888-888888888888` tarda 6 s al acreditar.
- **Usuarios:** `usr-cliente-1` y `usr-cliente-2` (CLIENTE) · `usr-agente-1` y `usr-agente-2` (AGENTE) · `usr-cajero-1` (CAJERO).
- **INT-R09** · Mock. Rutas PEN: guarda en memoria los `depositoId` acreditados y responde 409 si se repiten. Rutas USD: guarda en memoria cada `Idempotency-Key` con su body; misma clave y mismo body → 200 (replay); misma clave y otro body → 409 `IDEMPOTENCY_CONFLICT`; si no, 201 con `estado: "COMPLETADO"`.

## 5. El Contrato (API Contract)

**Billetera USD · Consultar billetera:** `GET /api/v1/billetera/wallets/{id}` → **HTTP 200**
```json
{ "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6", "user_id": "usr-cliente-1", "nombre": "Cliente Uno", "balance": "350.75", "moneda": "USD" }
```
**HTTP 404** si la billetera no existe.

**Billetera USD · Acreditar:** `POST /api/v1/depositos/usd` · cabecera `Idempotency-Key: 7f1c2e9a-0b1d-4c5e-9f00-123456789abc`
```json
{ "cliente_id": "usr-agente-1", "cuenta_destino_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6", "monto": "150.00", "moneda": "USD", "metodo_origen": "EFECTIVO", "referencia_externa": "7f1c2e9a-0b1d-4c5e-9f00-123456789abc" }
```
**HTTP 201** si acreditó · **HTTP 200** replay de la misma clave · en ambos casos el body es un `Deposito` de billetera y se exige `estado: "COMPLETADO"` · **HTTP 409** `IDEMPOTENCY_CONFLICT` si la clave se usó con otro body (es un error).

**Billetera PEN (propuesta) · Consultar cuenta:** `GET /api/v1/cuentas/{numero}` → **HTTP 200**
```json
{ "numero": "0011-0123-456789", "estado": "ACTIVA", "moneda": "PEN", "titularId": "usr-cliente-1" }
```
**HTTP 404** si la cuenta no existe.

**Billetera PEN (propuesta) · Acreditar:** `POST /api/v1/cuentas/{numero}/creditos`
```json
{ "depositoId": "7f1c2e9a-0b1d-4c5e-9f00-123456789abc", "monto": "150.00", "moneda": "PEN", "concepto": "DEPOSITO" }
```
**HTTP 201** si acreditó · **HTTP 409** si ese `depositoId` ya fue acreditado.

**usuario · Payload propuesto del JWT** (firma RS256 [POR ACORDAR])
```json
{ "sub": "usr-cliente-1", "roles": ["CLIENTE"], "iss": "usuario-service", "aud": "banco-api", "exp": 1760000000 }
```

- `sub` → `usuario_id` en depósitos, idempotencia y auditoría; en Billetera USD, `sub` del titular = `user_id` de la billetera y `sub` de quien deposita = `cliente_id`.
- `roles` → CLIENTE, AGENTE o CAJERO (SPEC-03).
- `iss`, `aud`, `exp` → validación del token.

## 6. Instrucciones de Ejecución para el Agente

1. **`desarrolladorback`:** Crear los archivos de §2. El mock es para probar a mano con `docker compose`; las pruebas automáticas usan nock.
2. **`tester`:**
   - Billetera PEN:
   - **INT-T01** · Consultar con 200 → devuelve la cuenta.
   - **INT-T02** · Consultar con 404 → devuelve `null`.
   - **INT-T03** · Consultar con 500 y con timeout → `BILLETERA_NO_DISPONIBLE`.
   - **INT-T04** · Acreditar con 201 y con 409 → resuelve.
   - **INT-T05** · Acreditar con 400, 500 y timeout → `BILLETERA_NO_DISPONIBLE`; nock recibió 1 sola llamada.
   - **INT-T06** · Cualquier llamada → lleva `Authorization` y `X-Correlation-Id`.
   - **INT-T07** · `acreditar` con monto `Decimal(150)` → el body lleva `"150.00"`.
   - Billetera USD:
   - **INT-T08** · Consultar con 200 → `{ numero: id, estado: "ACTIVA", moneda: "USD", titularId: user_id }`, sin `balance` ni `nombre`.
   - **INT-T09** · Consultar con 404 → `null`; con 500 y con timeout → `BILLETERA_NO_DISPONIBLE`.
   - **INT-T10** · Acreditar con 201 `COMPLETADO` y con 200 (replay) `COMPLETADO` → resuelve; la petición lleva `Idempotency-Key` = `depositoId`.
   - **INT-T11** · Acreditar con 409 → `BILLETERA_NO_DISPONIBLE` y log `error`; con 201 `estado: "PENDIENTE"` → `BILLETERA_NO_DISPONIBLE`.
   - **INT-T12** · Acreditar con 400, 500 y timeout → `BILLETERA_NO_DISPONIBLE`; nock recibió 1 sola llamada.
   - **INT-T13** · Body exacto: monto `Decimal(150)` → `"150.00"`, `moneda: "USD"`, `cliente_id` = `usuarioId`, `referencia_externa` = `depositoId`, sin `concepto`; `metodo_origen` correcto para los 3 canales.
   - Enrutamiento y cabeceras:
   - **INT-T14** · INT-R10: cuenta `0011-0123-456789` → solo se llama a la billetera PEN; UUID → solo a Billetera USD.
   - **INT-T15** · Billetera USD sin `BILLETERA_USD_TOKEN` → sin `Authorization`; con token → lo lleva; `X-Correlation-Id` siempre.
3. **`revisor`:** Verificar INT-R06, INT-R10 y que ninguna URL de billetera aparece fuera de `billeteraClient.js` y `.env.example`.

**Criterios de aceptación:**
- ✅ El servicio funciona de punta a punta con el mock mientras los otros equipos confirman.
- ✅ Cambiar a cada billetera real solo requiere cambiar su URL y su token: `BILLETERA_URL` / `BILLETERA_TOKEN` (PEN) y `BILLETERA_USD_URL` / `BILLETERA_USD_TOKEN` (USD).
- ✅ Un depósito a una billetera USD nunca se acredita dos veces aunque se reintente.
