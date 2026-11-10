# impl_07 · SPEC-07 registrar-deposito (v2.0) — RETRABAJO Billetera USD

- **Agente:** desarrolladorback · **Rama:** `inte_biUsd` · **Fecha:** 2026-11-03
- **Referencia:** `Busti:codigo/src/modules/registrar-deposito/{schema,service}.js` — solo se tomaron
  los cambios de RD-R02 y del `acreditar` con `usuarioId`/`canal`.

## Archivos modificados (todos del §2)

- `src/modules/registrar-deposito/schema.js` — `cuentaDestino` con `RE_CUENTA` (PEN o UUID minúsculas).
- `src/modules/registrar-deposito/service.js` — `acreditar` recibe además `usuarioId` y `canal`; comentarios RD-R08/RD-R11.

Sin cambios: `index.js`, `routes.js`, `controller.js`, `repository.js` (el `SELECT *` de
`buscarPorId` ya trae `usuario_id` y `canal`; `depositoDesdeFila` ya los mapeaba).

## Reglas

- **RD-R01** · Sin cambios: `z.object(...).strict()`, obligatorios y tipos → 400 `FORMATO_INVALIDO`.
- **RD-R02** · `RE_CUENTA = /^(?:\d{4}-\d{4}-\d{6}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/` **sin flag `i`**: mayúsculas o UUID incompleto → 400. Verificado con `safeParse` (PEN ok, UUID minúsculas ok, con `A` mayúscula falla, incompleto falla). Resto del esquema igual.
- **RD-R03** · Sin cambios: `montoValido` sigue contando decimales sobre el **string** (`"10.100"` → 422); NO se portó `decimalPlaces()` de `Busti`. Decimal siempre, sin `Number(`/`parseFloat`.
- **RD-R04** · Orden del diagrama intacto; único cambio en el paso `acreditar(id, cuenta, montoAcreditar, monedaAcreditar, usuarioId, canal)`.
- **RD-R05** · Sin cambios: `armarContexto` mantiene `logger` y `db` (NO se portó la versión de `Busti` sin ellos).
- **RD-R06 / RD-R07** · Sin cambios (repository y TX).
- **RD-R08** · `reintentar` usa `depositoDesdeFila`, que toma `monto_acreditar`, `moneda_acreditar`, `usuario_id` y `canal` de la fila, y `acreditarYCerrar` los pasa a `billeteraClient.acreditar` → body idéntico al original (replay INT-R06). Sin consultar cuenta ni validadores/transformadores.
- **RD-R09** · Sin cambios.
- **RD-R10** · El módulo no menciona ni importa limites, conversión ni UIF (grep limpio).
- **RD-R11** · Se conserva `cuenta.estado !== 'ACTIVA' → CUENTA_INACTIVA`; como `consultarCuenta` USD devuelve siempre `estado: 'ACTIVA'` (INT-R04, SPEC-02), en la práctica solo aplica a PEN. Comentario añadido.

## Decisiones

- Cambios mínimos: no se reordenaron imports ni se reescribió código que no cambia (a diferencia de `Busti`).
- No se portó el `canal` duplicado de `depositoDesdeFila` de `Busti`.

## Verificación

- `node -e` (con `tests/setup/env.js`) carga `schema.js` y `service.js` sin errores.
- `bash init.sh` (completo): **verde**, 23 suites, 380 passed + 1 todo. Ninguna prueba existente rota.
  Avisos: `SPEC-07 (en curso) aún sin prueba: RD-T13..RD-T18` (y los de 08/09 reabiertas).

## Para el tester

- Faltan RD-T13..RD-T18.
- `tests/unit/registrar-deposito/service.test.js` (~l.123) inspecciona `acreditar.mock.calls[0]`
  pero no comprueba `usuarioId`/`canal`; conviene ampliarlo (y RD-T12: el reintento envía los guardados).
- No se detectaron pruebas obsoletas por el contrato nuevo (todo pasa).

---

# Retrabajo v2.2, 2026-11-09 (SPEC-07 v2.0 → v2.2)

- **Agente:** desarrolladorback · **Rama:** `inte_biUsd`
- Sustituye el **ajuste transitorio** de SPEC-02 v2.1/v2.2 en `service.js` (PENDIENTE y RECHAZADO → 502)
  por la implementación real de RD-R08, RD-R11, RD-R12 y RD-R13.

## Archivos (todos del §2)

- [MODIFICADO] `src/modules/registrar-deposito/repository.js`: `insertar` guarda `titular_id` ($10);
  nuevo `tomarParaReconciliar(tx, antiguedadMs, limite)`.
- [MODIFICADO] `src/modules/registrar-deposito/service.js`: `pedirAcreditacion` (resultado único),
  `acreditarYCerrar` con PENDIENTE/CUENTA_INACTIVA/RECHAZADO, nuevo `reconciliar()` (un ciclo).
- [MODIFICADO] `src/modules/registrar-deposito/controller.js`: 202 si `estado === 'PROCESANDO'`, si no 201.
- [NUEVO] `src/modules/registrar-deposito/reconciliacion.js`: `iniciar()`, `detener()`, `reconciliar`.
- Sin cambios: `index.js`, `routes.js`, `schema.js`. **No** se tocó `src/core/` ni `src/server.js`.

## Reglas

- **RD-R01 / R02 / R03** · Sin cambios (schema estricto; `montoValido` con Decimal sobre el string).
- **RD-R04** · Orden del diagrama intacto; la única diferencia es el `alt` tras `acreditar`.
- **RD-R05** · `titularId: cuenta.titularId` en el `deposito` (ya estaba) y ahora **se guarda** en
  `titular_id` (`insertar`, DOM-R11; `?? null` para PEN sin titular).
- **RD-R06** · `cambiarEstado` sin cambios; la reconciliación lo llama con `tx` (fila ya bloqueada).
- **RD-R07** · Sin cambios (TX de INSERT + `persistirTransformadores`).
- **RD-R08** · `reintentar` usa `depositoDesdeFila` (`monto_acreditar`, `moneda_acreditar`, `titular_id`,
  `canal`) para llamar a `billeteraClient.acreditar` con los datos guardados (body idéntico). `RECHAZADO`
  → `PROCESANDO → FALLIDO` + 502 `BILLETERA_NO_DISPONIBLE` con `depositoId`. COMPLETADO → 201; otro
  estado → 409 `SOLICITUD_EN_PROCESO`.
- **RD-R09** · `aJson(fila, deposito.extensiones)` en 201 y en 202 (en 202, la fila que devolvió
  `cambiarEstado(... → PROCESANDO)`, sin consulta extra). En reintento, `extensiones = leerExtensiones`.
- **RD-R10** · El módulo no nombra ni importa limites, conversión ni UIF.
- **RD-R11** · `cuenta.estado !== 'ACTIVA'` → 422 `CUENTA_INACTIVA` en ambas billeteras (antes de guardar
  nada). `acreditar` lanza `CUENTA_INACTIVA` → `PROCESANDO → FALLIDO` + 422 `CUENTA_INACTIVA { depositoId }`.
  `manejadorErrores` pone `res.locals.depositoId` y el middleware de SPEC-05 guarda todo status < 500
  como `TERMINADO` (IDE-R08): la clave no se reintenta. Sin tocar `src/core/`.
- **RD-R12** · `PENDIENTE` → el depósito queda en `PROCESANDO`, sin `cambiarEstado` ni post-procesos; el
  controller responde 202. 202 < 500 → `TERMINADO` con status y cuerpo (IDE-R08); repetir la clave
  devuelve el mismo 202 (IDE-R07: `repetir` usa `fila.status_http`). **Verificado en `idempotencia.js`:
  no hace falta tocar el core.**
- **RD-R13** · `service.reconciliar()` = un ciclo:
  - Una TX: `tomarParaReconciliar(tx, config.reconciliacion.antiguedadMs, 50)` → `SELECT * ... WHERE
    estado='PROCESANDO' AND cuenta_destino ~ '<UUID minúsculas>' AND actualizado_en < now() - $1 ms
    ORDER BY actualizado_en LIMIT $2 FOR UPDATE SKIP LOCKED` (solo USD; PEN nunca se toma).
  - Por cada fila (bloqueada hasta el COMMIT): `acreditar` con los datos guardados (`depositoDesdeFila`,
    mismo body que el original) y un `correlationId` nuevo (`randomUUID`) por depósito.
  - `ACREDITADO` → `cambiarEstado(tx, PROCESANDO → COMPLETADO)`; `CUENTA_INACTIVA` o `RECHAZADO` →
    `PROCESANDO → FALLIDO`; `PENDIENTE` o `BILLETERA_NO_DISPONIBLE` (o error inesperado del cliente,
    logueado) → sin cambio. Si sigue en PROCESANDO y `now - actualizado_en > alertaMs` → `logger.error`
    con `depositoId`.
  - Tras el COMMIT, solo para los que esta ejecución pasó a COMPLETADO: `leerExtensiones` +
    `pipeline.ejecutarPostProcesos` con `usuario = { id: usuario_id, roles: [] }`, `cuenta = null`,
    `deposito.estado = 'COMPLETADO'` (SPEC-06 §4). Una sola vez: la transición solo la gana una ejecución
    (SKIP LOCKED + `WHERE estado = de`). Fuera de la TX para que un post-proceso que inserta con FK al
    depósito no espere el bloqueo de la fila.
  - Devuelve `{ completados, fallidos, pendientes }` (útil para RD-T22/T23).
  - `reconciliacion.iniciar()`: `setInterval(ciclo, config.reconciliacion.intervaloMs)` + `unref()`, una
    sola vez; `ciclo` no lanza (loguea) y no se solapa consigo mismo en el proceso. `detener()` limpia el
    temporizador (pruebas). `reconciliar` se reexporta para ejecutar un ciclo directo.
  - **No** se cableó en `src/server.js` (retrabajo de SPEC-06).
- **RD-R14** · Documental: el filtro UUID de `tomarParaReconciliar` deja fuera los depósitos PEN.

## Decisiones (a confirmar por el humano o el revisor)

- **Tamaño del lote = 50** (`LOTE_RECONCILIACION` en `service.js`). RD-R13 dice "hasta un lote" y la
  firma tiene `limite`, pero ninguna spec ni variable de SPEC-00 da el valor. Es un parámetro técnico, no
  de negocio; si se quiere configurable, haría falta una variable nueva en SPEC-00 §5.
- Una TX por ciclo que mantiene el bloqueo durante las llamadas HTTP: así una segunda reconciliación no
  toma el mismo depósito (RD-T23) sin tocar `actualizado_en`, que mide el tiempo en PROCESANDO para la
  alerta. Coste: una conexión del pool ocupada hasta lote × timeout en el peor caso. Un error de BD en el
  ciclo hace rollback del lote entero; los replays son idempotentes y se repite en el siguiente ciclo.
- `correlationId` de la reconciliación: `crypto.randomUUID()` por depósito (no hay petición entrante).
- `reconciliar` vive en `service.js` (PRY-R01/R03: el service orquesta, el repository tiene el SQL);
  `reconciliacion.js` es solo el temporizador. Se reutilizan `pedirAcreditacion`, `depositoDesdeFila`,
  `armarContexto` y `pipeline.ejecutarPostProcesos`/`leerExtensiones`; no se duplica lógica.
- El `alt` del diagrama ahora clasifica con `pedirAcreditacion` (traduce `ErrorApp` `CUENTA_INACTIVA` u
  otro a un resultado) en vez de `try/catch` + `throw`; los errores que no son `ErrorApp` siguen saliendo
  como 500.

## Verificación

- `node -e "require('./tests/setup/env.js'); require('./src/modules/registrar-deposito/<f>')"` carga
  `service`, `controller`, `repository`, `reconciliacion`, `index` y `routes` sin errores.
- Prueba manual (script en el scratchpad, BD de pruebas + nock): 3 filas en PROCESANDO (USD antigua, PEN
  antigua, USD reciente), dos `reconciliar()` simultáneos → `[{completados:1}, {completados:0}]`, una sola
  llamada a Billetera USD con `Idempotency-Key` = id y body `{ cliente_id: 'usr-cliente-1', monto:
  '150.00', moneda: 'USD', canal: 'AGENTE', metodo_origen: 'EFECTIVO', referencia_externa: id }`,
  post-proceso 1 vez; USD antigua → COMPLETADO; PEN y USD reciente siguen en PROCESANDO.
- `bash init.sh --rapido`: FAIL por (a) 11 pruebas unitarias obsoletas (abajo) y (b) **chequeo del arnés**
  `Feature 7 está in_progress pero sus dependencias 6 no están done` (6 está `reabierta`; el orden 07
  antes que 06 lo decidió el leader, ver `current.md`). Alcance OK (190 archivos). Avisos: RD-T19..T24
  sin prueba; CD-T14, CD-T15, CM-T09 (reabiertas).
- `bash init.sh` (completo, con PostgreSQL): 23 suites, **440 passed, 11 failed, 1 todo** (452). Todas las
  de integración pasan (RD-T01..T18 actuales y 08/09/11/12 incluidas).

## Pruebas existentes rotas u obsoletas (para el tester)

`tests/unit/registrar-deposito/service.test.js`: 11 fallos, todos por el contrato nuevo.
- 10 por mocks de `billeteraClient.acreditar` que resuelven `undefined` (SPEC-02 v2.2 siempre resuelve
  `{ estado }`): RD-T03, RD-T11, RD-T12, RD-T13, RD-T18, RD-R03 (×2), RD-R04, RD-R08, RD-R09. Deben
  mockear `{ estado: 'ACREDITADO' }`.
- 1 en "SPEC-07 repository (db simulada) › insertar ..." (l.392): espera 9 parámetros; ahora son 10
  (`titular_id`).
- RD-R08 unitaria: el título dice `usuario_id`; ahora es `titular_id`.
- `tests/integration/registrar-deposito/registrar.test.js:700`: el `test.todo('RD-T18 ... body idéntico')`
  ya puede ser prueba real (titular_id guardado). RD-T18 de la l.651 usa `99999999-…`/500; la spec v2.2
  pide `cccccccc-cccc-4ccc-8ccc-cccccccccccc`/503.
- Faltan RD-T19..RD-T24. Para RD-T22..T24: `require('src/modules/registrar-deposito/reconciliacion')
  .reconciliar()` (o `service.reconciliar()`) con filas en PROCESANDO cuyo `actualizado_en` sea más
  antiguo que `RECONCILIACION_ANTIGUEDAD_MS` (def. 10000). RD-T23: dos `reconciliar()` con `Promise.all`
  y un `delay` en nock. RD-T21: comprobar el 202 repetido por HTTP.
