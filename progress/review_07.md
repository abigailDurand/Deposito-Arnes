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
