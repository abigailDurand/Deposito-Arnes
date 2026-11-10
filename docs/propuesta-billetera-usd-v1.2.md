# Propuesta: adaptar deposito-service a Billetera Digital USD v1.2.0

> Estado: **borrador para el humano** (2026-11-06). D1 y D2 aprobadas; Q13 y Q14 resueltas por el humano el 2026-11-09 (§5). Q13 depende de que Billetera USD
> implemente el abono en `POST /depositos/usd`.
> Contrato nuevo: `docs/referencia/Billetera_USD_openapi_v1.2.0.yaml`.
> Contrato vigente en las specs: `docs/referencia/Billetera_USD_openapi.yaml` (v1.1.0).
> `specs-v2/` es de solo lectura para los agentes (PRY-R12): los cambios los aplica una persona.
> Hasta entonces no se toca código.

## 1. Situación

| | Valor comprobado el 2026-11-06 |
|---|---|
| Versión de la v1.2.0 | Aprobada por el propietario, pendiente de implementar (`x-implementation-status`), con cambios incompatibles |
| Documentación publicada en `http://54.167.69.62/docs/` | **v1.2.0**, sin diferencias con el archivo de `docs/referencia/` (pasó de v1.1.1 a v1.2.0 durante el 2026-11-06) |
| Autenticación real | **No se aplica aún:** sin token, `GET /wallets/{id}` y `GET /depositos/usd/{id}` responden 404, y `/fx/tasa` 200 |
| ¿Exige `canal` o rechaza campos extra? | **Sin confirmar:** con monto inválido responde 400 `INVALID_AMOUNT` antes de mirar esos campos |
| `/health/ready` | `{"status":"ready","db":"up","fakes":true}`: usa adaptadores falsos |

**Consecuencia:** el contrato v1.2.0 está publicado, pero su comportamiento solo está implementado en parte. Hay
que confirmar con el equipo de Billetera USD qué está activo (Q7) antes de publicar el cambio.

La descripción publicada de `cliente_id` ("que realiza el depósito") contradice la respuesta a Q3 ("que recibe").
Se sigue Q3; conviene que corrijan la descripción. El contrato no resuelve Q13 ni Q14.

El alcance de la v1.2.0 es solo USD: la billetera PEN no cambia y sigue siendo una propuesta nuestra.

## 2. Cambios necesarios en el cliente

### 2.1 Autenticación OAuth 2.0 (client credentials)

- Cliente propio de deposito-service, con los scopes mínimos: `billetera/wallets.read`,
  `billetera/depositos.write` y `billetera/depositos.read`.
- Reutilizar el token hasta poco antes de que expire; no pedir uno por operación. La política
  `x-outbound-service-auth` del contrato usa 60 s para las llamadas salientes de Billetera USD: se propone el
  mismo margen.
- Variables nuevas: URL de tokens, client id y client secret (el secreto solo en `Secret` o Secrets Manager).
  Sustituyen a `BILLETERA_USD_TOKEN`.
- Si no se puede obtener token → `BILLETERA_NO_DISPONIBLE`. Sin reintentos automáticos de la acreditación.
- Solo Billetera USD; la billetera PEN mantiene `BILLETERA_TOKEN`.

### 2.2 `consultarCuenta`

| `Wallet.estado` | Devuelve `estado` | Efecto en RD-R11 |
|---|---|---|
| `ACTIVE` | `ACTIVA` | Continúa |
| `BLOCKED` | `BLOQUEADA` | `CUENTA_INACTIVA` |
| `CLOSED` | Por definir (`CERRADA` o `BLOQUEADA`) | `CUENTA_INACTIVA` |
| Ausente o desconocido | Ninguno | `BILLETERA_NO_DISPONIBLE` |

`BLOCKED` y `CLOSED` no deben impedir leer el historial o un depósito ya registrado: el contrato mantiene las
consultas para auditoría, y la verificación de titular no depende del estado.

### 2.3 `acreditar`: añadir `canal`

- `canal` pasa a ser obligatorio en el body.
- El mapeo actual (`VENTANILLA → EFECTIVO`, `AGENTE → EFECTIVO`, `APP → TRANSFERENCIA`) ya cumple
  `x-channel-method-policy`: deja de estar `[POR ACORDAR]` en cuanto a validez.
- `Idempotency-Key` sigue igual: `depositoId` ya es un UUID v4.

### 2.4 `acreditar`: respuestas

| Respuesta | Hoy | Propuesta |
|---|---|---|
| 201 `COMPLETADO` con `movimiento_saldo_id` | Acreditado (no mira `movimiento_saldo_id`) | Acreditado; exigir también `movimiento_saldo_id` |
| 202 `VALIDADO` | `FALLIDO` (**incorrecto**) | Acreditación pendiente (§2.5) |
| 200 replay, `COMPLETADO` | Acreditado | Igual, con la misma exigencia del 201 |
| 200 replay, `VALIDADO` | `FALLIDO` (**incorrecto**) | Acreditación pendiente (§2.5) |
| 200 replay, `FALLIDO` | `FALLIDO` | `FALLIDO` |
| 409 `IDEMPOTENCY_CONFLICT` | Error y log `error` | Sin cambio |
| 422 `WALLET_BLOCKED`, `WALLET_CLOSED` | 502 `BILLETERA_NO_DISPONIBLE` | `CUENTA_INACTIVA` (422), `FALLIDO`, sin reintento útil |
| 422 `CUSTOMER_BLOCKED`, `USD_ACCOUNT_NOT_ENABLED` | 502 `BILLETERA_NO_DISPONIBLE` | Rechazo de negocio; código por definir en SPEC-01 |
| 401, 403 | 502 `BILLETERA_NO_DISPONIBLE` | Sin cambio, pero con log `error`: es un fallo de configuración |
| 429 | 502 `BILLETERA_NO_DISPONIBLE` | Sin cambio (INT-R06: sin reintentos automáticos) |
| 502, 503, timeout | `FALLIDO` | Resultado **ambiguo**: ver §2.5 |

### 2.5 Acreditación asíncrona

Es el cambio de mayor impacto y requiere decisión humana.

**Propuesta:**

1. 202 o replay con `VALIDADO` → el depósito **permanece en `PROCESANDO`**. No hace falta un estado nuevo en
   `depositos.estado`, y `VALIDADO` no se expone porque es un estado de otro servicio.
2. Nuestra API responde **202** con el depósito en `PROCESANDO` y la ruta para consultarlo (SPEC-08).
3. Una tarea periódica reconcilia los depósitos en `PROCESANDO` más antiguos que un umbral:
   - Vuelve a enviar el `POST` con la misma clave y el mismo body, y obtiene el depósito original.
   - `COMPLETADO` → `COMPLETADO`, y ejecuta los postprocesos. `FALLIDO` → `FALLIDO`. `VALIDADO` → sigue igual.
   - Respeta `Retry-After`.
   - Si `VALIDADO` envejece más de un umbral → log `error` y alerta; el contrato pide alertas sobre estas
     operaciones.

**Por qué reenviar el `POST` y no usar `GET /depositos/usd/{id}`:** el `id` de ese `GET` lo asigna la billetera,
y un depósito que quedó en `PROCESANDO` por un corte nunca llegó a guardarlo. Además, el replay no acredita de
nuevo. Hay que confirmar que un replay devuelve el estado **actual** y no el de la primera respuesta (Q8). Si no
fuera así, habría que guardar el `deposito_id` externo en una columna nueva (SPEC-01) y usar el `GET`.

**Efectos adicionales:**

- Resuelve también los depósitos atascados en `PROCESANDO` por un corte, hoy sin salida: el reintento responde
  `SOLICITUD_EN_PROCESO` indefinidamente. En Kubernetes es un riesgo real, comprobado en kind: `src/server.js`
  no atiende `SIGTERM` y el pod muere al vencer los 30 s de gracia.
- **Solo cubre Billetera USD.** La billetera PEN no tiene idempotencia por clave ni replay equivalente; se
  apoya en el 409 de `depositoId` (INT-R12).
- La tarea corre en cada réplica: `cambiarEstado` ya condiciona por estado de origen, pero los postprocesos deben
  ejecutarse una sola vez. Conviene tomar las filas con `FOR UPDATE SKIP LOCKED`.
- **Alternativa más simple:** sin tarea, consulta bajo demanda al hacer `GET` del depósito. No cubre a nadie que
  no vuelva a consultar, por lo que no se recomienda.

### 2.6 Mock y pruebas

- El mock debe emular la v1.2.0: `canal` obligatorio, `estado` de la billetera, 202 `VALIDADO`, 422 y un token
  OAuth de pruebas. Una billetera especial por caso nuevo.
- Prueba de contrato contra `docs/referencia/Billetera_USD_openapi_v1.2.0.yaml`.

### 2.7 `cliente_id` y `cuenta_destino_id` (según las respuestas a Q2 y Q3)

**`cliente_id` = titular de la billetera** (`Wallet.user_id`), no quien deposita. Si se envía el agente, el
depósito queda a su nombre. Este error ya existe con la v1.1.1, así que no depende de la v1.2.0.

- Reintento y reconciliación deben reenviar un body idéntico, o se recibe 409 `IDEMPOTENCY_CONFLICT`. RD-R08 no
  vuelve a consultar la cuenta, y `depositos` no guarda al titular.
- Propuesta: nueva columna core `depositos.titular_id VARCHAR(100)`, justificada igual que DOM-R05 (el reintento
  la necesita). `usuario_id` sigue siendo quien deposita, para permisos, idempotencia y auditoría.

**`cuenta_destino_id` no es el UUID de la billetera:** es la cuenta en dólares del cliente. Hoy enviamos el UUID
de la billetera (INT-R07), que es **incorrecto**. Ningún endpoint de los contratos revisados devuelve ese
identificador. **Q14 resuelta:** la cuenta en dólares es la propia billetera USD del cliente, de la que sale su
saldo. Se omite el campo, que es opcional, y Billetera USD usa la cuenta que corresponde a `cliente_id`.

**`POST /depositos/usd` no actualiza hoy automáticamente el saldo de la billetera.** **Q13 resuelta:** se elige que
`POST /depositos/usd` abone la billetera. Así `COMPLETADO` significa que subió `Wallet.balance` y se mantiene la
idempotencia (INT-R06). No se usa `POST /wallets/{id}/depositos`. Requiere el cambio en Billetera USD.

| Opción para acreditar la billetera | Sube el saldo | Idempotente | Valoración |
|---|---|---|---|
| Solo `POST /depositos/usd` | No automáticamente | Sí | Seguro, pero no cumple si "acreditado" exige saldo en billetera |
| `POST /wallets/{id}/depositos` | Sí (según contrato) | **No** | Un reintento tras timeout puede acreditar dos veces (rompe INT-R06) |
| Llamar a los dos | Sí | No en el segundo paso | Mismo riesgo, y puede contar el dinero dos veces en su ledger |
| Que Billetera USD añada `Idempotency-Key` a `/wallets/{id}/depositos` | Sí | Sí | Descartada (Q13) |
| **Que `/depositos/usd` abone la billetera** | Sí | Sí | **Elegida (Q13, 2026-11-09)** |

## 3. Cambios de spec que debe aplicar el humano

| Spec | Regla o sección | Cambio |
|---|---|---|
| SPEC-00 | §5, variables | Variables OAuth; retirar `BILLETERA_USD_TOKEN`; nueva tarea en `src/server.js` |
| SPEC-01 | Errores, tabla `depositos` | Códigos para los rechazos de §2.4; JSON de respuesta 202 si aplica; columna `titular_id` (§2.7) |
| SPEC-02 | §3, §5, INT-R02, R04, R05, R07, R09; datos de prueba; INT-T13 y otros | §2.1 a §2.4, §2.6 y §2.7; `cliente_id` = titular; contrato de referencia v1.2.0 |
| SPEC-07 | RD-R05, R06, R08, R09, R11; §3, §5; RD-T13 y otros | 202 y `PROCESANDO` como resultado válido; reconciliación (§2.5); guardar y reenviar `titular_id` |
| SPEC-08 | §5 | Cómo se consulta un depósito en `PROCESANDO` |
| SPEC-11 | Alcance, CM-Tnn | Sin conversión hacia cuentas USD: `MONEDA_NO_SOPORTADA` (D1) |
| SPEC-12 | Postprocesos | Comprobar que la alerta UIF se ejecute al completar en diferido, una sola vez |

### 3.1 Texto propuesto para adelantar la corrección de `cliente_id`

Corrige a quién se abona el depósito, pero **no resuelve el saldo de la billetera** (Q13).

**SPEC-01 · tabla `depositos`**: añadir, después de `usuario_id`:

```sql
    titular_id        VARCHAR(100),
```

**SPEC-01 · regla nueva**

> **DOM-R11** · `titular_id` guarda el titular de la cuenta destino al registrar el depósito. Es del core porque
> el reintento lo necesita para reenviar un body idéntico (RD-R08). `aJson` no lo expone.

**SPEC-02 · INT-R05** (firma): sustituir `usuarioId` por `titularId`:

> `acreditar({ depositoId, cuenta, monto, moneda, titularId, canal }, correlationId)`

**SPEC-02 · INT-R07** (reemplaza su inicio; el resto de la regla no cambia):

> Body: `cliente_id` = `titularId` (`user_id` de la billetera: el cliente que recibe el depósito, no quien lo
> registra); sin `cuenta_destino_id`, que es la cuenta en dólares del cliente y no el UUID de la billetera
> [POR ACORDAR: de dónde se obtiene];

**SPEC-02 · §5, §3 y datos:** en el ejemplo, `"cliente_id": "usr-cliente-1"` y sin `cuenta_destino_id`. En la línea
sobre `sub`: `user_id` de la billetera = `cliente_id`.

**SPEC-07 · RD-R05:** añadir `titularId = cuenta.titularId` al objeto `deposito`.

**SPEC-07 · RD-R08:** sustituir `usuario_id` por `titular_id` en la lista de datos guardados.

**Pruebas**

- **INT-T13:** `cliente_id` = `titularId` y sin `cuenta_destino_id`.
- **RD-T13:** `usr-agente-1` deposita en la billetera de `usr-cliente-1` → `cliente_id: "usr-cliente-1"`.
- **RD-T18:** el reintento envía el mismo `cliente_id`, con el dato guardado.

**Datos existentes:** `titular_id` admite `NULL` porque las cuentas PEN especiales del mock no tienen titular. No hay
producción desplegada, pero una base ya creada necesitaría migración, porque `db/` solo se ejecuta en una base vacía.
Un depósito `FALLIDO` anterior no se podría reintentar con el mismo body, porque se envió con el agente en
`cliente_id`.

**El texto completo ya aplicado está en `docs/specs-propuestas/`.**

## 4. Decisiones humanas

> **Aprobadas por el humano el 2026-11-06:** D1 opción **b)**, D2 y D3 (`CUSTOMER_BLOCKED` y
> `USD_ACCOUNT_NOT_ENABLED` → 422 `CUENTA_INACTIVA`, sin códigos nuevos). También adelantar la corrección de
> `cliente_id` (§2.7) sin esperar a la v1.2.0.

- **D1. Conversión PEN → USD (SPEC-11).** SPEC-11 convierte con nuestra tabla y acredita USD. El contrato deja
  fuera el "cambio con liquidación" y dice que una conversión con liquidación "requiere un contrato y una
  orquestación separados". Como enviamos USD, la petición pasaría técnicamente, pero hay dudas sobre si se
  permite. Opciones:
  - **a)** Mantener la conversión, con la confirmación del propietario de la billetera.
  - **b)** Desactivarla para cuentas USD y responder `MONEDA_NO_SOPORTADA`.

  Recomendación: **b)** salvo confirmación explícita. Los tipos de cambio de `db/11-conversion-moneda.sql` son
  además de ejemplo, y `/fx` solo es referencial.
- **D2.** Aprobar §2.5: 202 hacia nuestros clientes y tarea de reconciliación.
- **D3.** Código de error para `CUSTOMER_BLOCKED` y `USD_ACCOUNT_NOT_ENABLED`.
- **D4.** Mantener `moneda_acreditar` sin cambios para PEN, que sigue siendo responsabilidad de la billetera PEN.

## 5. Preguntas al equipo de Billetera USD

Las Q1, Q5 y Q6 de `docs/propuesta-billetera-usd.md` quedan resueltas por la v1.2.0. Siguen abiertas, o son
nuevas:

- **Q2. Resuelta (2026-11-06).** `cuenta_destino_id` es la cuenta en dólares del cliente donde se deposita, no el
  ID de la billetera. Es opcional y el depósito no actualiza automáticamente el saldo de la billetera.
- **Q3. Resuelta (2026-11-06).** `cliente_id` es el cliente que recibe el depósito, no el agente. Si se envía el
  agente, el depósito se registra a su nombre.
- **Q13. Resuelta (2026-11-09).** `POST /depositos/usd` abona la billetera; no se usa `POST /wallets/{id}/depositos`.
  Pendiente: que Billetera USD lo implemente y confirme desde qué versión (ver Q7).
- **Q14. Resuelta (2026-11-09).** La cuenta en dólares es la billetera USD del cliente, de la que sale su saldo. Se
  omite `cuenta_destino_id` y se usa la cuenta que corresponde a `cliente_id`.
- **Q4.** ¿El `user_id` de la billetera coincide con el `sub` que emite usuario-service?
- **Q7.** ¿Cuándo se despliega la v1.2.0? ¿Habrá un periodo en que convivan ambas versiones?
- **Q8.** ¿Un replay de `POST /depositos/usd` devuelve el estado actual o el de la primera respuesta?
- **Q9.** URL real de tokens y credenciales por ambiente (`auth.billetera-usd.example` es de ejemplo).
- **Q10.** `x-jwt-validation` exige validar la propiedad de la billetera además del scope. Un token de servicio,
  ¿puede leer y acreditar cualquier billetera?
- **Q11.** Con `fakes: true`, ¿`POST /depositos/usd` cambia el `balance` de `GET /wallets/{id}`? ¿Hay un entorno
  con Saldos real, o una forma de activar el sandbox (hoy `active: false`)?
- **Q12.** `CLOSED` y `BLOCKED`, ¿pueden devolverse como 422 en el `POST` aunque el `GET` anterior indicara
  `ACTIVE`? Se asume que sí (condición de carrera) y §2.4 lo cubre.

## 6. Plan de ejecución (cuando las specs estén actualizadas)

1. ~~Resolver las preguntas bloqueantes Q13 y Q14.~~ Hecho el 2026-11-09. Falta que el humano aplique las specs.
2. Reabrir en `feature_list.json` las features afectadas, en orden de dependencias
   (`reabierta → in_progress → done`).
3. Recorrerlas con desarrolladorback → tester → revisor; `bash init.sh` entre una y otra.
4. Prueba de humo en kind contra el entorno v1.2.0: consulta, depósito de importe mínimo, replay y 202.
5. Coordinar el cambio en EKS con el despliegue de la v1.2.0 (Q7).
