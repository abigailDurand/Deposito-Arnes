# Review — SPEC-05 idempotencia

**Veredicto:** APROBADO CON OBSERVACIONES

Archivos revisados (todos del §2 de SPEC-05; ninguno fuera de alcance):
`db/05-idempotencia.sql`, `src/core/repositories/idempotenciaRepository.js`,
`src/core/middlewares/idempotencia.js`, `src/core/tareas/limpiarClaves.js`,
`tests/integration/idempotencia/idempotencia.test.js`.

## Reglas

### Proyecto
- [x] PRY-R01..R03 — repository solo SQL; el middleware llama al repository; sin HTTP. Es core
      transversal (no hay controller/service propios en el §2).
- [x] PRY-R04/R05 — solo `src/core/`; Grep de nombres de features (`registrar`, `billetera`,
      `depositosService`) en los 3 archivos: 0 resultados.
- [x] PRY-R06/R07 — no maneja dinero. Grep `Number(`/`parseFloat`: 0 resultados.
- [x] PRY-R08 — todo el SQL usa `$1..$5`. El único `+ '` (`idempotenciaRepository.js:4`) concatena
      nombres de columnas constantes, no datos.
- [x] PRY-R09 — `IDEMPOTENCIA_DIAS` solo vía `config.idempotenciaDias` (`limpiarClaves.js:12`,
      `src/config.js:42`). Sin `process.env`, sin `http://`.
- [x] PRY-R10 — `idempotencia.js:52` loguea `{ correlationId, status, codigoError }` (sin cuerpo,
      clave ni cuenta; lo verifica la prueba "IDE-R08: el guardado falla"). `limpiarClaves.js` loguea
      solo `{ borradas }` / `{ codigoError }`. Sin `console.log`.
- [x] PRY-R11 — no hay `[POR ACORDAR]` en esta spec.
- [x] PRY-R12 — `specs-v2/` intacto (hash OK en init.sh).

### Spec
- [x] IDE-R01 — `idempotencia.js:15` (`claveValida`, 8..100, string) y `:82` → 400
      `IDEMPOTENCY_KEY_REQUERIDA` antes de tocar la BD.
- [x] IDE-R02 — PK `(usuario_id, clave)` en `db/05-idempotencia.sql`; todas las consultas filtran
      por `usuario_id` y `clave`.
- [x] IDE-R03 — `idempotencia.js:30-33`: SHA-256 hex de `método originalUrl body` con llaves
      ordenadas recursivamente; probado con valor esperado exacto.
- [x] **IDE-R04 (revisor)** — `idempotenciaRepository.js:7-15` `INSERT ... ON CONFLICT DO NOTHING`
      y `rowCount === 1`; no hay SELECT previo (`idempotencia.js:88-89` reserva primero, `buscar`
      solo tras el conflicto). Probado con 5 POST simultáneos → 1×201 + 4×409, controller 1 vez.
- [x] IDE-R05 — `idempotencia.js:99-102`: hash distinto primero, luego `EN_PROCESO`, `TERMINADO`,
      `REINTENTABLE`. Probado que con `EN_PROCESO` y hash distinto gana `REUTILIZADA`.
- [x] **IDE-R06 (revisor)** — `idempotenciaRepository.js:27-34` UPDATE literal de la spec con
      `AND estado = 'REINTENTABLE'` y `RETURNING`; `idempotencia.js:104-106`: 0 filas → 409
      `SOLICITUD_EN_PROCESO`; si no, `req.idempotencia = { depositoIdPrevio }`. La carrera se prueba
      contra PostgreSQL real (UPDATE de 0 filas).
- [x] IDE-R07 — `idempotencia.js:72-77`: status y cuerpo guardados, `Idempotency-Replayed: true`,
      `X-Correlation-Id` actual, `res.locals.depositoId = deposito_id`.
- [x] **IDE-R08 (revisor)** — `idempotencia.js:60-68` sobrescribe `res.json`, espera `guardar` y
      envía en `.finally` (guarda ANTES de enviar). `:36-57`: `<500` → `terminar` TERMINADO con
      status/cuerpo/`deposito_id`; `502` + `depositoId` → `marcarReintentable`; otro 5xx → `borrar`;
      fallo → `logger.error` y la respuesta sale igual. `manejadorErrores.js:20` copia
      `err.depositoId` a `res.locals`, así que el 502 de `ErrorApp` llega con el id (probado).
- [x] IDE-R09 — `limpiarClaves.js:20-24` `setInterval` 1 h con `unref()`;
      `idempotenciaRepository.js:63` borra en cualquier estado; probado con 3 estados y límites 6/7/8 días.
- [x] IDE-R10 — fuera de alcance; no se implementa (correcto).
- [x] §5 contrato — 409 `SOLICITUD_EN_PROCESO` con cuerpo exacto y `correlationId` (probado con
      `toEqual`); header `Idempotency-Replayed` solo en la repetición (probado ausente en las demás).
- [x] SQL de §4 copiado literal en `db/05-idempotencia.sql`.

### Decisiones de `impl_05.md` no cubiertas por la spec
1. **FK de `deposito_id` / `res.locals.depositoId` inexistente** — aceptable. Aplica IDE-R08 tal cual
   (`logger.error` y la respuesta sale igual). La consecuencia (clave queda `EN_PROCESO`, 409 hasta la
   limpieza) es la misma familia de riesgo que IDE-R10. No requiere escalar; sí debe trasladarse a
   SPEC-07: asignar `res.locals.depositoId` solo cuando la fila del depósito exista.
2. **Conflicto en el INSERT y fila ausente en el SELECT** (`idempotencia.js:98`) — aceptable, no
   bloqueante. Sin ese guard, `fila.hash_solicitud` sobre `null` daría un 500 no controlado; la elección
   usa un código ya del catálogo (DOM), refleja el estado que causó el conflicto, no crea estados ni
   códigos y nunca puede producir doble acreditación (criterio de aceptación). Recomiendo que el líder
   la **informe** al humano en la bitácora como decisión tomada (no como bloqueo), por PRY-R12.

Observaciones menores (no incumplen reglas):
- Decisión 3 (`AND estado = 'EN_PROCESO'` en `terminar`/`marcarReintentable`,
  `idempotenciaRepository.js:40,48`) es más estricta que la spec y coherente con IDE-R06; correcta.
- Decisión 4: firma `borrarAntiguas(db, dias)` en vez de `borrarAntiguas(IDEMPOTENCIA_DIAS)`; sigue
  `docs/conventions.md` (ejecutor primero). Aceptable.

## Casos de prueba
- [x] IDE-T01 (2 pruebas reales: 201 y 422), IDE-T09 (2 pruebas reales: sin header y 7 caracteres).
- [x] IDE-T02..T08, IDE-T10 en `test.todo` — justificado: SPEC-05 §6 dice "IDE-T01 e IDE-T09 se
      prueban con una app mínima; el resto requiere SPEC-07". Además hay 17 pruebas por regla
      (IDE-R01..R09) con aserciones concretas (status, cuerpo exacto, filas en BD, logs).
- Pendiente para SPEC-07: convertir esos 8 `todo` en pruebas reales con nock.

## Checkpoints
- C1: [x]  C2: [x] (una sola `in_progress`; dependencias 1 y 3 en `done`; `current.md` describe la sesión)
- C3: [x] (specs intactas, alcance 96 archivos OK; SPEC-10..12 no aplica)
- C4: [x]  C5: [x] (integración con PostgreSQL real; cobertura `src/core/` 99,64 % stmts / 94,38 % branches;
  reporte completo; extensiones ACTIVA/INACTIVA no aplica a esta spec)

## Cambios requeridos
Ninguno.

## Salida de `bash init.sh`
```
[OK]    specs-v2/ intacto (15 archivos)
[OK]    feature_list.json válido (13 features: pending=7 in_progress=1 done=5 blocked=0)
[OK]    SPEC-05: todos sus casos tienen prueba (todo: IDE-T02, IDE-T03, IDE-T04, IDE-T05, IDE-T06, IDE-T07, IDE-T08, IDE-T10)
[OK]    Alcance de archivos correcto (96 archivos revisados)
All files                   |   99.64 |    94.38 |   98.38 |   99.61 |
Test Suites: 9 passed, 9 total
Tests:       13 todo, 129 passed, 142 total
[OK]    Todas las pruebas en verde (unitarias + integración)
[OK]    Entorno listo. Puedes empezar a trabajar.
EXIT=0
```
