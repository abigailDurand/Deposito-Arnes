# impl_05 — SPEC-05 idempotencia (desarrolladorback)

## Archivos (todos del §2)

- [NUEVO] `db/05-idempotencia.sql` — tabla `claves_idempotencia` + `idx_claves_creado`, copia literal del §4.
- [NUEVO] `src/core/repositories/idempotenciaRepository.js` — `reservar`, `buscar`, `tomarReintento`,
  `terminar`, `marcarReintentable`, `borrar`, `borrarAntiguas`. Todos reciben el ejecutor (`db`) primero.
- [NUEVO] `src/core/middlewares/idempotencia.js` — exporta `manejar(idempotencia)`; además expone
  `calcularHash` y `claveValida` para pruebas.
- [NUEVO] `src/core/tareas/limpiarClaves.js` — exporta `iniciar()`.
- `tests/integration/idempotencia/idempotencia.test.js` — no creado: es del tester.

## Reglas

- **IDE-R01** · `claveValida`: header `Idempotency-Key` string de 8 a 100 caracteres; si no → `ErrorApp('IDEMPOTENCY_KEY_REQUERIDA')` (400). Se valida antes de tocar la BD.
- **IDE-R02** · PK `(usuario_id, clave)`; todas las consultas filtran por `req.usuario.id` y la clave.
- **IDE-R03** · `calcularHash`: SHA-256 hex de `` `${req.method} ${req.originalUrl} ${JSON.stringify(ordenarLlaves(req.body))}` ``; `ordenarLlaves` ordena las llaves de forma recursiva (los arrays conservan su orden).
- **IDE-R04** · `reservar`: `INSERT ... VALUES (..., 'EN_PROCESO') ON CONFLICT DO NOTHING`; `rowCount === 1` → clave nueva. No hay SELECT antes del INSERT.
- **IDE-R05** · Si la clave existía: `buscar` → primero hash distinto (409 `IDEMPOTENCY_KEY_REUTILIZADA`), luego `EN_PROCESO` (409 `SOLICITUD_EN_PROCESO`), `TERMINADO` (repetir), `REINTENTABLE` (IDE-R06).
- **IDE-R06** · `tomarReintento`: `UPDATE ... SET estado='EN_PROCESO' WHERE usuario_id=$1 AND clave=$2 AND estado='REINTENTABLE' RETURNING ...`; 0 filas → 409 `SOLICITUD_EN_PROCESO`; si no, `req.idempotencia = { depositoIdPrevio: deposito_id }` y `next()`.
- **IDE-R07** · `repetir`: `status_http` y `respuesta` guardados, `Idempotency-Replayed: true`, `X-Correlation-Id` = `req.correlationId` de la petición actual, `res.locals.depositoId = deposito_id` (solo si no es null).
- **IDE-R08** · `interceptarRespuesta` sobrescribe `res.json` (en clave nueva y en reintento): restaura el original, espera `guardar(...)` y después envía. `< 500` → `terminar` (TERMINADO, status, cuerpo, `deposito_id = res.locals.depositoId ?? null`); `502` con `res.locals.depositoId` → `marcarReintentable`; otro 5xx → `borrar`. Si el guardado falla → `logger.error` (correlationId, status, código de PG; sin cuerpo ni clave) y la respuesta sale igual (`.finally`).
- **IDE-R09** · `limpiarClaves.iniciar()`: `setInterval` de 1 h que llama a `borrarAntiguas(pool, config.idempotenciaDias)` (`DELETE ... WHERE creado_en < now() - make_interval(days => $1::int)`, en cualquier estado). Los errores se loguean; el temporizador tiene `unref()`.
- **IDE-R10** · Fuera de alcance; no se implementa recuperación de claves `EN_PROCESO` huérfanas.
- **PRY-R08** · Todo el SQL es parametrizado. **PRY-R09** · `IDEMPOTENCIA_DIAS` solo vía `config.idempotenciaDias`. **PRY-R10** · Los logs no llevan body, token ni cuenta.

## Decisiones

1. **Observación arrastrada de SPEC-04** (`res.locals.depositoId` siempre debe ser un id existente):
   en la repetición, `deposito_id` sale de `claves_idempotencia`, que tiene FK a `depositos(id)`,
   así que siempre existe. En el guardado se usa `res.locals.depositoId` tal cual; si SPEC-07 asignara
   un id inexistente, la FK rechaza el UPDATE, se loguea y la clave queda `EN_PROCESO` (IDE-R08 dice
   solo "logger.error y la respuesta se envía igual"). SPEC-07 debe asignar `res.locals.depositoId` solo
   después de que exista la fila del depósito.
2. **Conflicto en el INSERT pero la fila ya no está en el SELECT** (borrada en ese instante por un 5xx o
   por la limpieza): se responde 409 `SOLICITUD_EN_PROCESO`, que es el estado que causó el conflicto.
   La spec no cubre esta carrera; no agrega códigos ni estados nuevos.
3. `terminar` y `marcarReintentable` llevan `AND estado = 'EN_PROCESO'` en el WHERE, para no pisar una fila
   que ya cambió.
4. `borrarAntiguas(db, dias)`: la spec la escribe `borrarAntiguas(IDEMPOTENCIA_DIAS)`; se antepone el
   ejecutor por la convención de repositories (`docs/conventions.md`). Devuelve el número de filas borradas.
5. `respuesta` se guarda con `JSON.stringify(cuerpo ?? null)` como JSONB y se repite con `res.json`.
6. El middleware no se monta en ninguna ruta todavía: va en `routes.js` de SPEC-07, después de `requiereRol`.
   `limpiarClaves.iniciar()` lo llama `server.js` (SPEC-06, PIP-R12).

## Verificación

- `node -e "require(...)"` de los 3 módulos: carga sin errores.
- Prueba manual (script fuera del repo, app mínima con PostgreSQL de pruebas): sin clave y 7 caracteres
  → 400; nueva → 201; repetida con llaves en otro orden → 201 + `Idempotency-Replayed: true`; monto
  distinto → 409 `IDEMPOTENCY_KEY_REUTILIZADA`; otro usuario misma clave → 201; segunda a los 100 ms con
  la primera lenta → 409 `SOLICITUD_EN_PROCESO`; 5 simultáneas → 1×201 + 4×409; 500 → clave borrada;
  502 con depositoId → `REINTENTABLE`; 2 reintentos simultáneos → 1×201 con `depositoIdPrevio` + 1×409;
  fila final `TERMINADO` 201 con el mismo `deposito_id`; `borrarAntiguas(0)` borra todo.
- `bash init.sh --rapido`:

```
Test Suites: 5 passed, 5 total
Tests:       1 todo, 65 passed, 66 total
[OK]    Pruebas unitarias en verde (modo --rapido: integración NO ejecutada)
[OK]    Entorno listo (verificación rápida).
```

- `bash init.sh` completo: alcance OK (94 archivos), 105 pruebas verdes + 5 todo, 8/8 suites; **falla
  solo el umbral de cobertura de `src/core/`** (≈67 %), porque los 3 archivos nuevos aún no tienen
  pruebas (`idempotencia.test.js` es del tester). No es un fallo de prueba; el tester debe cubrirlo.
