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
