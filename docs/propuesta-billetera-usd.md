# Propuesta: integrar deposito-service con Billetera Digital USD

> Estado: **borrador para el humano** (2026-11-02). Contrato de referencia: `Billetera_USD_openapi.yaml` v1.1.0.
> `specs-v2/` es de solo lectura para los agentes (PRY-R12): los cambios de §2 los aplica una persona.
> Hasta entonces no se toca código.

## 1. Decisión tomada

Nos adaptamos a la API de Billetera USD (no les pedimos implementar nuestro contrato de SPEC-02).

## 2. Diseño propuesto

### 2.1 Identificador de cuenta

- `cuentaDestino` pasa a ser el **UUID de la billetera** (`Wallet.id`); se abandona `^\d{4}-\d{4}-\d{6}$`.
- Motivo: los endpoints de billetera por id usan UUID; el alias (`user_id`) puede cambiar de formato y no
  sirve para `/wallets/{id}`.

### 2.2 `consultarCuenta(id)` → `GET /api/v1/billetera/wallets/{id}`

| Respuesta de billetera | Devuelve `consultarCuenta` |
|---|---|
| 200 `Wallet` | `{ numero: id, estado: "ACTIVA", moneda: wallet.moneda, titularId: wallet.user_id }` |
| 404 | `null` (→ `CUENTA_NO_ENCONTRADA` / `SIN_PERMISO`, como hoy) |
| otro status o timeout | `ErrorApp('BILLETERA_NO_DISPONIBLE')` |

- Billetera no expone estado: **`CUENTA_INACTIVA` deja de poder producirse** mientras no lo añadan.
- `titularId = user_id` exige que el `sub` del JWT (usuario-service) sea el mismo alias que el `user_id` de
  billetera (ver pregunta Q4).

### 2.3 `acreditar(...)` → `POST /api/v1/depositos/usd`

Se usa este endpoint, y no `POST /wallets/{id}/depositos`, porque es el **único idempotente**: este último
no acepta clave, y un reintento tras timeout acreditaría dos veces (rompe INT-R06 / IDE-R*).

- Cabecera `Idempotency-Key: <depositoId>`. Nuestro `depositos.id` ya es UUID v4.
- Body:
  ```json
  { "cliente_id": "<depositos.usuario_id>", "cuenta_destino_id": "<UUID billetera>",
    "monto": "150.00", "moneda": "USD", "metodo_origen": "<según canal>",
    "referencia_externa": "<depositoId>" }
  ```
- `cliente_id` = quien deposita (`usuario_id` del JWT), según la descripción del contrato ("cliente que
  realiza el depósito"). Está guardado en `depositos`, así que también sirve en el reintento (RD-R08).
- `metodo_origen` [POR ACORDAR]: `VENTANILLA → EFECTIVO`, `AGENTE → EFECTIVO`, `APP → TRANSFERENCIA`.
  `canal` también está guardado en `depositos`.
- Firma nueva: `acreditar({ depositoId, cuenta, monto, moneda, usuarioId, canal }, correlationId)`.

| Respuesta de billetera | Resultado |
|---|---|
| 201, o 200 (replay de la misma clave), con `estado: COMPLETADO` | acreditado: resuelve |
| 409 `IDEMPOTENCY_CONFLICT` | **error** (misma clave con datos distintos ≠ "ya acreditado") → `BILLETERA_NO_DISPONIBLE` y log `error` |
| 201/200 con `estado` ≠ `COMPLETADO` | depende de Q1 |
| otro status o timeout | `BILLETERA_NO_DISPONIBLE` |

Cambia INT-R05: hoy 409 es éxito.

### 2.4 Moneda

- Todas las billeteras son USD. Un depósito en PEN solo se acredita si `conversion-moneda` (SPEC-11) está
  activa y hay tipo PEN→USD vigente; si no, se responde 422 `MONEDA_NO_SOPORTADA`, igual que hoy.
- Opcional (fase 2): cargar `tipos_cambio` desde `GET /api/v1/fx/tasa`. El contrato lo declara
  **referencial**, así que hay que decidir si vale para acreditar dinero real (Q5).

### 2.5 Otros

- Autenticación: billetera no la exige (`security: []`). Seguimos enviando `Authorization` (lo ignoran);
  `BILLETERA_TOKEN` sigue siendo obligatorio en config para cuando la añadan.
- `X-Correlation-Id`: billetera regenera el id si no es UUID. Nuestro middleware debería reenviar siempre
  un UUID (revisar SEG-R01/R02).
- Enmascarado en logs (PRY-R10): definir máscara para UUID (p. ej. últimos 6 caracteres).

## 3. Cambios de spec que debe aplicar el humano

| Spec | Regla / sección | Cambio |
|---|---|---|
| SPEC-02 | §3, §5, INT-R04, INT-R05, INT-R07, INT-R09, datos de prueba | Contrato de §2.2 y §2.3; nueva firma de `acreditar`; 409 = error; datos de prueba con UUID de billetera (incluidas las especiales: 500 al acreditar y lenta 6 s); el mock emula Billetera USD |
| SPEC-01 | tabla `depositos` | `cuenta_destino VARCHAR(20)` → `VARCHAR(36)` (o `UUID`) |
| SPEC-07 | RD-R02, RD-R06/R08, §5 | `cuentaDestino` = UUID; `acreditar` recibe `usuarioId` y `canal`; `CUENTA_INACTIVA` no alcanzable mientras billetera no exponga estado |
| SPEC-09 | HD-R01, §5 | `{numero}` = UUID de billetera |
| SPEC-08 | §5 / datos | Ejemplos con UUID |
| SPEC-00 / SEG | PRY-R10, SEG-R01 | Máscara de UUID; correlation id siempre UUID |
| SPEC-11 | (opcional, fase 2) | Fuente de tipos de cambio = `/api/v1/fx/tasa` |

## 4. Preguntas al equipo de Billetera USD (bloquean la spec)

- **Q1.** ¿`POST /api/v1/depositos/usd` suma el saldo a la billetera **en la misma petición** (estado
  `COMPLETADO`, `movimiento_saldo_id` no nulo)? ¿O queda `PENDIENTE`/`VALIDADO` y se acredita después? En
  ese caso, ¿cómo nos enteramos?
- **Q2.** ¿`cuenta_destino_id` debe ser el UUID de la billetera a acreditar? ¿Es obligatorio en la práctica?
- **Q3.** ¿Qué valida `cliente_id`? ¿Debe existir como usuario o billetera? El 404 del endpoint, ¿a qué se refiere?
- **Q4.** ¿El `user_id` de la billetera coincide con el `sub` que emite usuario-service?
- **Q5.** ¿La tasa de `/fx/tasa` sirve para acreditar, o solo es informativa?
- **Q6.** ¿Planean exponer el estado de la billetera (bloqueada) y autenticación entre servicios?

## 5. Plan de ejecución (cuando las specs estén actualizadas)

1. Reabrir en `feature_list.json` las features afectadas (1, 2, 7, 8, 9 y, si aplica, 0 y 3).
2. Recorrerlas en orden de dependencias con desarrolladorback → tester → revisor; `bash init.sh` entre una y otra.
3. Prueba de humo contra el Billetera USD real (o su contenedor) cambiando solo `BILLETERA_URL`.
