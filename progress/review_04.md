# Review — SPEC-04 auditoria

**Veredicto:** APROBADO CON OBSERVACIONES

Revisor · 2026-10-30 · Feature 4. Insumos: `progress/impl_04.md`, `tests/reporte.md` §SPEC-04,
archivos del §2 y `tests/integration/auditoria/auditoria.test.js`. `bash init.sh` completo verde
contra PostgreSQL real (antes y después de marcar `done`).

## Reglas

Prioridad §6 (revisor):

- [x] AUD-R03 — `src/core/middlewares/auditoria.js:75-80`: el listener se engancha solo si la acción se
  deduce y llama `registrar(req, res, accion)` en `res.on('finish')` sin `await` ni `.then`; no hay
  latencia añadida. `registrar` (`:47-67`) es `async` con `try/catch` total, por lo que su promesa nunca
  rechaza (sin unhandled rejection). Usuario, depósito, body y status se leen en `finish`, después de
  `autenticar`/`express.json`.
- [x] AUD-R04 — `auditoria.js:61-65`: `logger.error({ correlationId, accion, codigoError: err.code },
  'Falló el registro de auditoría')`. No registra `err` completo (el `message`/`detail` de PostgreSQL
  puede traer valores de la fila), ni body, ni headers. AUD-T06 lo prueba con un error cuyo mensaje y
  `detail` contienen la cuenta completa: respuesta 201 intacta (cuerpo y `X-Correlation-Id`) y
  `JSON.stringify(logError.mock.calls)` no contiene `0011-0123` (`auditoria.test.js:117-148`).
- [x] AUD-R07 — `auditoria.js:31-40`: `canal` solo si es string en `AGENTE|VENTANILLA|APP`; `monto` solo
  si es **string** que cumple exactamente `^-?\d{1,13}(\.\d{1,2})?$` (`:20`); body no objeto o array →
  ambos null. No se lee ni guarda nada más del body. El monto viaja como string a `NUMERIC(15,2)`, nunca
  `Number` (PRY-R06). Probado: válidos (`VENTANILLA`, `"0.01"`), canal en minúsculas / fuera de lista,
  monto numérico `10`, `"10.001"`, body array, `undefined`/`null`.

Resto:

- [x] AUD-R01 — todo status se registra: 401 (T03), 400 de JSON mal formado, 201/200. Repetidas por
  idempotencia pasan por `finish` igual (T04 en todo, ver abajo).
- [x] AUD-R02 — `auditoria.js:9-17`: las tres acciones exactas con el método correcto. Compara contra
  `originalUrl` sin query, insensible a mayúsculas y barra final opcional (igual que Express por
  defecto). No auditadas: `/health`, rutas inexistentes (404), `DELETE /depositos/{id}`,
  `GET /depositos` → 0 filas (`auditoria.test.js:226-233`, T08).
- [x] AUD-R05 — `db/04-auditoria.sql`: tabla, función `bloquear_cambios_auditoria()` y trigger
  `auditoria_inmutable BEFORE UPDATE OR DELETE ... FOR EACH ROW` **idénticos** a §4 (comparados línea a
  línea). El repository solo exporta `insertar`. `TRUNCATE` de `limpiar()` funciona (verificado en T05).
- [x] AUD-R06 — `auditoria.js:52-53`: `res.locals.depositoId ?? null`, `req.usuario?.id ?? null`, leídos
  en `finish`. `manejadorErrores.js:20` ya propaga `err.depositoId` a `res.locals` (§5).
- [x] AUD-R08 — `auditoria.js:55` `ip: req.ip`; `:43-45` `EXITO` si `< 400`, si no `ERROR_<status>`.
- [x] PRY-R08 — `auditoriaRepository.js:6-21`: `INSERT ... VALUES ($1..$8)`, sin concatenación.
- [x] PRY-R01/R03 — solo el repository conoce SQL; el middleware le pasa `pool` (convención ejecutor
  como primer parámetro).
- [x] PRY-R06 — sin `Number(`/`parseFloat` en los archivos del §2 (grep).
- [x] PRY-R09/R10 — sin URLs ni secretos; sin `console.log`; log sin cuenta ni token.
- [x] PRY-R05 — `auditoria` y `auditoriaRepository` están en `src/core/` porque el §2 de SPEC-04 los
  declara ahí (transversal); no es una feature enchufable.
- [x] PRY-R11/R12 — nada `[POR ACORDAR]`; `specs-v2/` intacto.
- [x] Alcance — solo archivos del §2 (+ `feature_list.json`/`progress/` por protocolo); init.sh
  "Alcance de archivos correcto (89)".
- [x] §5 — no agrega rutas ni cambia respuestas (T06 verifica la respuesta intacta).

## Casos de prueba

- [x] AUD-T03, AUD-T05, AUD-T06, AUD-T07, AUD-T08 — reales, contra PostgreSQL, con aserciones concretas
  sobre las filas (acción, resultado, usuario, correlation_id, canal, monto) y reintentos ≤ 1 s (§6).
- [x] Pruebas extra de AUD-R02/R07/R08 (7 pruebas).
- [~] AUD-T01, AUD-T02, AUD-T04 — `test.todo`. Evaluación de legitimidad:
  - **AUD-T04: legítimo.** Necesita idempotencia (SPEC-05) y creación real (SPEC-07).
  - **AUD-T01: legítimo según §6** ("Los casos que piden un depósito real requieren SPEC-07"), pero su
    parte de auditoría podía probarse ya: insertar una fila en `depositos` por SQL y una ruta falsa que
    asigne `res.locals.depositoId`. Hoy **ninguna prueba cubre `deposito_id` no nulo** (AUD-R06,
    camino feliz) ni la FK. Ver observación 1.
  - **AUD-T02: aceptable, discutible.** El 422 lo produce SPEC-07; la parte de auditoría (`"-5"` →
    `-5.00`, `ERROR_422`) depende solo del middleware y estaba al alcance con ruta falsa. El riesgo está
    mitigado: `extraerDelBody({monto:'-5'})` se prueba y `ERROR_<status>` se prueba con 400/401.

Totales: 5/8 reales, 3/8 `test.todo` anotados en `tests/reporte.md`.

## Checkpoints

- C1: [x]  C2: [x] (una sola `in_progress` → pasa a `done`; deps 1 y 3 `done`; `current.md` describe la
  sesión activa)  C3: [x]  C4: [x]  C5: [x] (PostgreSQL real; cobertura `src/core/` 98,64 % stmts /
  94,59 % branches; `auditoria.js` 100 % líneas; reporte completo)

## Observaciones (no incumplen reglas de spec)

1. `tests/integration/auditoria/auditoria.test.js:70` — AUD-R06 — el camino `deposito_id` lleno no
   tiene prueba. Al implementar SPEC-07, el tester debe convertir AUD-T01 en prueba real y verificar
   `deposito_id` = id del depósito creado (y la FK). Si se quiere antes, puede hacerse ya con un depósito
   insertado por SQL + `res.locals.depositoId` en la ruta falsa.
2. `auditoria.test.js:72` — AUD-T02 — al llegar SPEC-07, verificar `monto` = `'-5.00'` y `ERROR_422` con
   la validación real.
3. `auditoria.test.js:92` — AUD-R08 — solo se comprueba `typeof ip === 'string'`, no que sea `req.ip`.
   Cuando exista `crearApp` (SPEC-06, `trust proxy`), conviene una prueba con `X-Forwarded-For`.
4. `src/core/middlewares/auditoria.js` (decisión 3 de impl_04) — si `res.locals.depositoId` no existe en
   `depositos` o `sub` > 50 caracteres, el INSERT falla y solo se loguea (AUD-R04). Correcto según la
   spec; el revisor de SPEC-07/05 debe confirmar que siempre se asigna un id existente.
5. Montaje: el orden `correlationId → auditoria → /health → autenticar` lo verifica el revisor de SPEC-06
   (PIP-R11); hoy el middleware no está montado en ninguna app de producción.

## Cambios requeridos

Ninguno.

## Salida de `bash init.sh`

```
[OK]    specs-v2/ intacto (15 archivos)
[OK]    feature_list.json válido (13 features: pending=8 in_progress=1 done=4 blocked=0)
[OK]    SPEC-04: todos sus casos tienen prueba (todo: AUD-T01, AUD-T02, AUD-T04)
[OK]    Alcance de archivos correcto (89 archivos revisados)
PASS integration tests/integration/auditoria/auditoria.test.js
  auditoria.js           |     100 |    88.88 |     100 |     100 | 55-65
  auditoriaRepository.js |     100 |      100 |     100 |     100 |
Test Suites: 8 passed, 8 total
Tests:       5 todo, 105 passed, 110 total
[OK]    Todas las pruebas en verde (unitarias + integración)
[OK]    Entorno listo. Puedes empezar a trabajar.
exit 0
```
