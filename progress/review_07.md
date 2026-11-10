# Review — SPEC-07 registrar-deposito (v2.0) · RETRABAJO Billetera USD

**Veredicto:** APROBADO

- Rama `inte_biUsd` · feature 7 · `retrabajo: true` (se conserva) · revisor · 2026-11-03.
- Diff revisado: `src/modules/registrar-deposito/schema.js`, `service.js`;
  `tests/unit/registrar-deposito/service.test.js`, `tests/integration/registrar-deposito/registrar.test.js`;
  `tests/reporte.md` (§SPEC-07), `progress/impl_07.md`. Todos los archivos están en §2 de SPEC-07.

## Reglas

- [x] PRY-R01/R02 — `controller.js` solo valida con el schema, llama a `service.registrar|reintentar` y responde 201; `routes.js` → `requiereRol('CLIENTE','AGENTE','CAJERO')` → `idempotencia` → controller.
- [x] PRY-R03/R04 — `service.js` no tiene SQL ni HTTP; solo importa `src/core/*` y `./repository`.
- [x] PRY-R06 — `service.js:17-22` `montoValido` usa `new Decimal(texto)`; `repository.js` guarda `toFixed(2)`. Grep `Number(` / `parseFloat` en el módulo: 0 resultados.
- [x] PRY-R08 — `repository.js` solo usa `$1..$9`; sin concatenación ni template en SQL.
- [x] PRY-R09/R10 — sin URLs ni `console.log` en el módulo; el logger es `logger.child({ correlationId })` (`service.js:31`).
- [x] PRY-R11 — RD-R11/INT-R04 `[POR ACORDAR]` resuelto en `billeteraClient.js:116-117` (SPEC-02), USD siempre `ACTIVA`.
- [x] PRY-R12 — `specs-v2/` intacto (init.sh).
- [x] RD-R01 — `schema.js` `z.object(...).strict()`; RD-T04 en verde.
- [x] RD-R02 — `schema.js:7` `RE_CUENTA = /^(?:\d{4}-\d{4}-\d{6}|[0-9a-f]{8}-…-[0-9a-f]{12})$/` **sin flag `i`**, anclado con un grupo `(?:…)`: las mayúsculas y los UUID incompletos se rechazan (RD-T15 integración: 5 variantes → 400 sin llamada a billetera; unitaria: además un UUID con espacio inicial).
- [x] RD-R03 — `service.js:17-22`: decimales contados sobre el **string** (`texto.split('.')[1]`), por eso `"10.100"` → 422 (prueba `RD-R03 monto "10.100"`, unit:111). **No** se arrastró el `decimalPlaces()` de `Busti`.
- [x] RD-R04 — `registrar` (`service.js:75-115`) sigue el orden exacto del diagrama: monto → consultarCuenta → null/ACTIVA → verificarCanal/Titular → validadores → transformadores → moneda → TX → PENDIENTE→PROCESANDO → acreditar. Nada se guarda antes de la TX (RD-T02/T05/T10/T14/T16: 0 filas).
- [x] RD-R05 — `armarContexto` (`service.js:26-34`) mantiene `logger` y `db`: **no** se arrastró la versión de `Busti` sin ellos. `id = crypto.randomUUID()`.
- [x] Firma de `acreditar` — `service.js:53-61` pasa `{ depositoId, cuenta, monto, moneda, usuarioId, canal }`, igual que `billeteraClient.acreditarUsd` (`billeteraClient.js:122`). RD-T13 unitaria comprueba las 6 claves exactas y `monto` como `Decimal`.
- [x] RD-R06 — `repository.js` `cambiarEstado`: `UPDATE … WHERE id=$1 AND estado=$2`, con 0 filas → lanza; transiciones de SPEC-01 en `TRANSICIONES`. Sin cambios.
- [x] RD-R07 — INSERT + `persistirTransformadores` dentro de `db.enTransaccion`. Sin cambios.
- [x] RD-R08 — `reintentar` → `depositoDesdeFila` toma `monto_acreditar`, `moneda_acreditar`, `usuario_id` y `canal` de la fila; no consulta la cuenta ni repite validadores/transformadores. Unitaria RD-R08 (fila de `usr-cajero-1`/VENTANILLA reintentada por otro usuario → `acreditar` recibe los guardados). RD-T18 integración: la 2.ª petición a Billetera USD lleva la misma `Idempotency-Key` y un body `toEqual` al de la 1.ª; consulta 1 sola vez; mismo `id`, COMPLETADO.
- [x] RD-R09 — `aJson(fila, extensiones)`; en el reintento `leerExtensiones`. Sin cambios.
- [x] RD-R10 — grep `limite|conversion|uif` en `src/modules/registrar-deposito/`: 0 resultados.
- [x] RD-R11 — `service.js:80-81` mantiene `estado !== 'ACTIVA' → CUENTA_INACTIVA`; USD siempre llega `ACTIVA` desde el client, por lo que solo aplica a PEN (RD-T06 PEN en verde).
- [x] Contrato §5 — `POST /api/v1/depositos`, 201 con el cuerpo `Deposito` (RD-T13 `toEqual` exacto con cuenta UUID), códigos 400/422/502 comprobados.

## Casos de prueba

- [x] RD-T01 … RD-T12 (12/12 reales; RD-T11/T12 ampliados con `usuarioId`/`canal`).
- [x] RD-T13 … RD-T18 (6/6 reales, en integración con PostgreSQL real + nock y en unitaria). Aserciones concretas: body exacto a Billetera USD, `Idempotency-Key` = `id`, filas en BD, estados, clave `REINTENTABLE`/`TERMINADO`, número de peticiones.
- Sin `test.todo` de SPEC-07. El único `todo` de la suite es de SPEC-11 (`conversion.test.js`, CM-R03 PEN→USD) y queda para su retrabajo.

## Checkpoints

- C1: [x]  C2: [x] (1 `in_progress` antes del cierre; dependencias 01–06 `done`)  C3: [x] (alcance 178 archivos OK, specs intactas)  C4: [x]  C5: [x] (cobertura `modules/registrar-deposito` 100 %; integración con PostgreSQL real)

## Observaciones (no bloqueantes)

- Ninguna sobre el código. Nota: el criterio de `feature_list.json` (feature 7) sigue diciendo "RD-T01 a RD-T12"; el leader puede actualizarlo a RD-T18 (archivo del arnés).

## Salida de `bash init.sh`

```
[OK]    specs-v2/ intacto (15 archivos)
[OK]    feature_list.json válido (13 features: pending=0 in_progress=1 done=8 blocked=0 reabierta=4)
[OK]    SPEC-07: todos sus casos tienen prueba
[WARN]  SPEC-08 (reabierta) aún sin prueba: CD-T10, CD-T11, CD-T12, CD-T13
[WARN]  SPEC-09 (reabierta) aún sin prueba: HD-T09, HD-T10, HD-T11, HD-T12
[OK]    Alcance de archivos correcto (178 archivos revisados)
PASS integration tests/integration/registrar-deposito/registrar.test.js
PASS unit tests/unit/registrar-deposito/service.test.js
Test Suites: 23 passed, 23 total
Tests:       1 todo, 392 passed, 393 total
[OK]    Todas las pruebas en verde (unitarias + integración)
[OK]    Entorno listo. Puedes empezar a trabajar.
EXIT=0
```

Feature 7 marcada `done` (con `retrabajo: true`); segunda corrida de `bash init.sh` tras el cambio:

```
[OK]    feature_list.json válido (13 features: pending=0 in_progress=0 done=9 blocked=0 reabierta=4)
[OK]    SPEC-07: todos sus casos tienen prueba
Test Suites: 23 passed, 23 total
Tests:       1 todo, 392 passed, 393 total
[OK]    Todas las pruebas en verde (unitarias + integración)
EXIT=0
```

---

# Review — SPEC-07 registrar-deposito · Retrabajo v2.2, 2026-11-09

**Veredicto:** APROBADO CON OBSERVACIONES

Spec v2.0 → v2.2 (`git diff specs-v2/07-registrar-deposito.md`). Leídos: `docs/architecture.md`, `docs/conventions.md`,
`CHECKPOINTS.md`, `specs-v2/00-proyecto.md` §4 y §6, la spec completa, `progress/impl_07.md` › "Retrabajo v2.2" y
`tests/reporte.md` › SPEC-07 › "Retrabajo v2.2". El código y las pruebas se escribieron antes de que la feature pasara a
`in_progress` (orden decidido por el leader); los valoro solo por su contenido.

## Reglas
- [x] Ajuste transitorio de SPEC-02 sustituido: `service.js:58-73` (`pedirAcreditacion`) clasifica el resultado en
  ACREDITADO/PENDIENTE/RECHAZADO/CUENTA_INACTIVA/BILLETERA_NO_DISPONIBLE y `acreditarYCerrar` (`:76-95`) aplica cada rama
  del `alt` de §3. Ya no queda "PENDIENTE/RECHAZADO → 502".
- [x] PRY-R01..R03: el controller no tiene lógica (`controller.js:8-21`; solo elige 201/202 según `estado`). El SQL está
  solo en `repository.js` y el HTTP solo pasa por `core/clients/billeteraClient`. `reconciliar` orquesta en el service;
  `reconciliacion.js` es solo el temporizador.
- [x] PRY-R04 / RD-R10: grep `limites|conversion|uif|UIF` en `src/modules/registrar-deposito/` da 0 resultados. Solo
  importa `src/core/` y `config`.
- [x] PRY-R05: SPEC-07 no tocó `src/core/`. Los diffs de `billeteraClient.js` y `depositoMapper.js` (solo un comentario)
  son de SPEC-02 v2.2 y SPEC-01 v1.2, ya revisados. Grep `registrar-deposito|reconcili` en `src/core/`: solo un comentario
  en `billeteraClient.js:277`. RD-R12/IDE-R07 se apoyan en `idempotencia.js:40-44,76,101`, que no cambió.
- [x] PRY-R06 / RD-R03 (§6): `montoValido` (`service.js:21-26`) usa `new Decimal(texto)`. `depositoDesdeFila` reconstruye
  `monto`/`montoAcreditar` con `new Decimal` e `insertar` guarda `.toFixed(2)`. Grep `Number(|parseFloat`: 0.
- [x] PRY-R08: `tomarParaReconciliar` (`repository.js:58-70`) está parametrizado (`$1::bigint * interval '1 millisecond'`,
  `LIMIT $2`) e `insertar` usa `$1..$10`. Sin concatenación.
- [x] PRY-R09: `RECONCILIACION_*` solo se lee en `config.js:76-80` (declarada en `.env.example:43-45`). Grep `http://` en el
  módulo: 0.
- [x] PRY-R10: los logs de la reconciliación (`service.js:168-171,181,188-191,207-210`; `reconciliacion.js:16-19`) solo
  llevan `depositoId`, `resultado`, `enProcesandoMs` y `error`/`codigoError`. Sin cuentas, tokens ni datos personales.
  Sin `console.log`.
- [x] PRY-R11: RD-R13 [POR ACORDAR, Q8] se apoya en el mock de Billetera USD (replay COMPLETADO/FALLIDO/VALIDADO).
- [x] PRY-R12: `specs-v2/` intacto (hash OK). Ver la observación 1 sobre el lote.
- [x] RD-R04 (§6): `registrar` (`service.js:98-138`) sigue el diagrama: monto → `consultarCuenta` (null 422 / no ACTIVA
  422) → `verificarCanal`/`verificarTitular` → validadores → transformadores → moneda 422 → TX (`insertar` +
  `persistirTransformadores`) → PENDIENTE→PROCESANDO → `acreditar` → `alt`. Nada se guarda antes de la TX.
- [x] RD-R05: `titularId: cuenta.titularId`, guardado en `titular_id` (`repository.js:28-29`).
- [x] RD-R06 (§6): `cambiarEstado` (`repository.js:39-52`) usa `WHERE id=$1 AND estado=$2`, lanza `Error` (500) si afecta
  0 filas y solo admite las transiciones de SPEC-01.
- [x] RD-R07: sin cambios (`service.js:132-135`).
- [x] RD-R08: `reintentar` (`service.js:143-160`) acredita con `depositoDesdeFila` (`monto_acreditar`,
  `moneda_acreditar`, `titular_id`, `canal`), sin consultar la cuenta ni repetir validadores/transformadores. `RECHAZADO` →
  FALLIDO + 502 con `depositoId` (`:82-88`). COMPLETADO → 201. Otro estado → 409.
- [x] RD-R09: `aJson(fila, deposito.extensiones)` en 201 y en 202; en un reintento, `leerExtensiones`.
- [x] RD-R11: `cuenta.estado !== 'ACTIVA'` → 422 en ambas billeteras (`service.js:104`). Si `acreditar` lanza
  `CUENTA_INACTIVA` → PROCESANDO→FALLIDO + 422 `{ depositoId }`, y la clave queda `TERMINADO` (status < 500,
  `idempotencia.js:40`).
- [x] RD-R12: `PENDIENTE` → sin `cambiarEstado` ni post-procesos (`service.js:80`) y el controller responde 202
  (`controller.js:20`). El 202 se guarda `TERMINADO` y se repite con `status_http` (`idempotencia.js:76`).
- [x] RD-R13: `FOR UPDATE SKIP LOCKED` (`repository.js:67`). Solo USD, con regex UUID en minúsculas (`:63`). La antigüedad
  se mide con `actualizado_en`. ACREDITADO → COMPLETADO dentro de la TX; los post-procesos corren una sola vez, después del
  COMMIT, solo en quien hizo la transición, con `cuenta = null` y `usuario = { id: usuario_id, roles: [] }`
  (`service.js:199-212,232-235`). `CUENTA_INACTIVA`/`RECHAZADO` → FALLIDO. `PENDIENTE`/`BILLETERA_NO_DISPONIBLE` → sin
  cambio. Alerta `logger.error` con `depositoId` si se supera `alertaMs` (`:186-192`). `server.js:25` arranca
  `reconciliacion.iniciar()` después de `crearApp` (PIP-R12, SPEC-06 v1.2) con `setInterval` + `unref`, sin que los ciclos
  se solapen dentro del proceso.
- [x] RD-R14: el filtro UUID deja fuera los depósitos PEN (probado en RD-T24).
- [x] §2: `index/routes/schema` sin cambios. Se tocaron `controller.js`, `service.js`, `repository.js`,
  `reconciliacion.js` [NUEVO] y los dos archivos de prueba. Todos están en §2.

## Casos de prueba
- [x] RD-T01 … RD-T24 (24/24 reales, en I y/o U). Las aserciones son concretas: `toEqual` del body a Billetera USD y del
  202, conteo de peticiones nock, estados y `titular_id` en BD, `status_http`/`Idempotency-Replayed` del 202 repetido,
  conteo de post-procesos, `actualizado_en` intacto. En RD-T23 el solape es determinista y la prueba falla por el tope si
  faltara `SKIP LOCKED` (`registrar.test.js:978-1016`).
- [x] `test.todo` RD-T14 "con `conversion-moneda` activa y tipo PEN→USD cargado" (`registrar.test.js:626`): justificado.
  El resultado depende del retrabajo de SPEC-11 (D1/CM-T09, feature 11 `reabierta`). La parte que solo depende de SPEC-07
  (inactiva, y activa sin tipo, `:600` y `:613`) es prueba real.
- [x] Reglas sin id: RD-R08 RECHAZADO (U:596, I:858), RD-R11 en reintento (U:619, I:786), RD-R12 en reintento (U:629),
  RD-R13 alerta, errores inesperados y temporizador (U:727-847, I:1046, I:1064).

## Checkpoints
- C1: [x]  C2: [x] (1 `in_progress`; dependencias 1-6 `done`)  C3: [x] (specs intactas, alcance OK en 190 archivos)
  C4: [x]  C5: [x] (cobertura de `modules/registrar-deposito`: 100 % stmts / 93.75 % ramas; el reporte lista casos, todo y
  fallidos)

## Observaciones (no incumplen ninguna regla de spec)
1. `service.js:18`: `LOTE_RECONCILIACION = 50`. RD-R13 dice "hasta un lote" y §2 pone `limite` en la firma, sin dar un
   valor. Lo considero un **parámetro técnico aceptable, no una suposición de negocio**: no cambia ningún resultado
   observable (lo que no entra en un ciclo se toma en el siguiente, en orden de `actualizado_en`) y el dev lo documentó como
   decisión a confirmar. Si el humano quiere que sea configurable, hace falta una variable nueva en SPEC-00 §5 (cambio de
   spec).
2. `service.js:216-229`: una TX por ciclo que mantiene `FOR UPDATE` durante las llamadas HTTP. Es lo que pide RD-R13
   (bloqueo + `SKIP LOCKED`) y garantiza RD-T23 sin tocar `actualizado_en`. Tiene dos costes conocidos. Primero, una
   conexión del pool queda ocupada hasta lote × `BILLETERA_TIMEOUT_MS` en el peor caso (unos 250 s con 50 y 5 s). Segundo,
   `FOR UPDATE` choca con el `FOR KEY SHARE` de una FK: un INSERT de auditoría con el `deposito_id` de una fila bloqueada
   (por ejemplo, repetir la clave de un 202 mientras se reconcilia) espera al COMMIT del ciclo. No es un incumplimiento. Si
   molesta en producción, hay dos opciones a acordar: un lote menor, o `FOR NO KEY UPDATE SKIP LOCKED` (requiere cambiar
   RD-R13).
3. `progress/impl_07.md` dice "No se cableó en `src/server.js`", pero el retrabajo de SPEC-06 v1.2 ya lo cableó
   (`server.js:25`). Es solo un desfase del informe.

## Cambios requeridos
Ninguno.

## Salida de `bash init.sh` (completo, PostgreSQL real)
```
[OK]    specs-v2/ intacto (15 archivos)
[OK]    feature_list.json válido (13 features: pending=0 in_progress=1 done=9 blocked=0 reabierta=3)
[OK]    SPEC-07: todos sus casos tienen prueba
[WARN]  SPEC-08 (reabierta) aún sin prueba: CD-T14, CD-T15
[WARN]  SPEC-11 (reabierta) aún sin prueba: CM-T09
[OK]    Alcance de archivos correcto (190 archivos revisados)
Test Suites: 23 passed, 23 total
Tests:       1 todo, 484 passed, 485 total
[OK]    Todas las pruebas en verde (unitarias + integración)
EXIT=0
```

Feature 7 marcada `done` (se mantiene `retrabajo: true`). Segunda corrida de `bash init.sh` tras el cambio, sin deadlock:

```
[OK]    feature_list.json válido (13 features: pending=0 in_progress=0 done=10 blocked=0 reabierta=3)
[OK]    SPEC-07: todos sus casos tienen prueba
Test Suites: 23 passed, 23 total
Tests:       1 todo, 484 passed, 485 total
[OK]    Todas las pruebas en verde (unitarias + integración)
EXIT=0
```
