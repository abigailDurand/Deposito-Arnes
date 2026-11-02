# impl_07 — SPEC-07 registrar-deposito

- **Agente:** desarrolladorback · **Fecha:** 2026-11-02

## Archivos (todos del §2 de SPEC-07)

- [NUEVO] `src/modules/registrar-deposito/index.js` — `{ id: 'registrar-deposito', tipo: 'endpoint', router }`.
- [NUEVO] `src/modules/registrar-deposito/routes.js` — `POST /depositos`: `requiereRol('CLIENTE','AGENTE','CAJERO')` → `idempotencia` → `manejar(controller.registrar)`.
- [NUEVO] `src/modules/registrar-deposito/schema.js` — exporta `esquemaDeposito` (zod `.strict()`).
- [NUEVO] `src/modules/registrar-deposito/controller.js` — exporta `registrar(req, res)`.
- [NUEVO] `src/modules/registrar-deposito/service.js` — `registrar(datos, usuario, correlationId)`, `reintentar(depositoId, usuario, correlationId)`.
- [NUEVO] `src/modules/registrar-deposito/repository.js` — `insertar(tx, deposito)`, `buscarPorId(db, id)`, `cambiarEstado(db, id, de, a)`.
- `tests/unit/registrar-deposito/service.test.js` · `tests/integration/registrar-deposito/registrar.test.js`: del tester (no escritos).

No se tocó `src/core/`, `db/`, infraestructura ni ningún otro archivo (PRY-R05).

## Reglas

- **RD-R01** · `esquemaDeposito` es `z.object({...}).strict()`; el controller hace `safeParse` y ante cualquier fallo (faltante, tipo, campo extra) lanza `ErrorApp('FORMATO_INVALIDO')` → 400.
- **RD-R02** · Regex `^\d{4}-\d{4}-\d{6}$` para la cuenta; `monto` `z.string()` con `^-?\d{1,13}(\.\d+)?$` (un número → 400); `z.enum` para moneda y canal; `referencia` `z.string().min(1).max(140).optional()`.
- **RD-R03** · `montoValido` en el service, primer paso: `new Decimal(texto)`; `lte(0)` o más de 2 dígitos tras el punto → 422 `MONTO_INVALIDO`. Ni `Number`, ni `parseFloat`, ni `+monto` en el módulo; el repository guarda `Decimal.toFixed(2)`.
- **RD-R04** · `registrar` sigue el diagrama: monto → `consultarCuenta` (null → `CUENTA_NO_ENCONTRADA`; estado ≠ `ACTIVA` → `CUENTA_INACTIVA`; error de billetera → 502 sin filas) → `verificarCanal` + `verificarTitular` → `ejecutarValidadores` → `ejecutarTransformadores` → `monedaAcreditar ≠ cuenta.moneda` → `MONEDA_NO_SOPORTADA` → TX → PENDIENTE→PROCESANDO → `acreditar` → COMPLETADO + post-procesos, o FALLIDO + 502. Nada se escribe antes de `enTransaccion`.
- **RD-R05** · `deposito` con exactamente los campos de SPEC-06 §4 (`id = crypto.randomUUID()`, `monto`/`montoAcreditar` Decimal, `referencia ?? null`, `extensiones: {}`; `estado: 'COMPLETADO'` se agrega solo antes de los post-procesos). `contexto = { usuario, cuenta, correlationId, logger: logger.child({ correlationId }), db: pool }`; `privado` y el logger por módulo los pone el pipeline.
- **RD-R06** · `cambiarEstado`: `UPDATE depositos SET estado=$3, actualizado_en=now() WHERE id=$1 AND estado=$2 RETURNING *`; 0 filas → `Error` (500). Antes de consultar, rechaza con `Error` toda transición fuera de SPEC-01 (`PENDIENTE→PROCESANDO`, `PROCESANDO→COMPLETADO|FALLIDO`, `FALLIDO→PROCESANDO`).
- **RD-R07** · `db.enTransaccion(tx => insertar + persistirTransformadores)`: si algo lanza, rollback y el error sale antes de llegar a `acreditar` (500).
- **RD-R08** · `reintentar`: `buscarPorId`; estado distinto de COMPLETADO/FALLIDO → 409 `SOLICITUD_EN_PROCESO` (con `depositoId`, la fila existe). COMPLETADO → se devuelve. FALLIDO → `FALLIDO→PROCESANDO` y `acreditar` con `monto_acreditar`/`moneda_acreditar` de la fila (como Decimal), sin consultar la cuenta ni ejecutar validadores/transformadores; después, el mismo `acreditarYCerrar` que `registrar`, con `contexto.cuenta = null`.
- **RD-R09** · Respuesta `aJson(fila, deposito.extensiones)` con la fila que devuelve `cambiarEstado(...COMPLETADO)` (`RETURNING *`). En el reintento, `extensiones = pipeline.leerExtensiones(depositoId, contexto)`.
- **RD-R10** · El módulo solo importa `src/core/` y sus propios archivos; no nombra limites, conversión ni UIF.

## Arrastres de SPEC-03..06

- **SPEC-03** · `requiereRol` en la ruta; `verificarCanal` + `verificarTitular` justo después de `consultarCuenta`.
- **SPEC-04/05** · `res.locals.depositoId` lo asigna el controller solo después de que el service devuelve (la fila existe). En el 502 lo pone `manejadorErrores` a partir de `ErrorApp('BILLETERA_NO_DISPONIBLE', { depositoId })`, que solo se lanza después del INSERT (fila en FALLIDO) → la clave queda `REINTENTABLE`. Los errores previos a la TX no llevan `depositoId`.
- **SPEC-06 / PIP-R07** · Se crea un único objeto `contexto` en `registrar`, y ese mismo objeto pasa por `ejecutarValidadores`, `ejecutarTransformadores`, `persistirTransformadores` y `ejecutarPostProcesos`.
- Para que la prueba RD-T11 pueda hacer spy, el service llama a `repository.*`, `billeteraClient.*`, `pipeline.*`, `permisos.*` y `db.enTransaccion` desde el objeto del módulo (sin desestructurar).

## Decisiones (sin reglas nuevas)

1. **"Más de 2 decimales"** se cuenta sobre el string recibido: `"10.100"` → 422 (PRY-R07 "máximo 2 decimales", igual que el patrón de AUD-R07). `Decimal.decimalPlaces()` lo habría aceptado, porque descarta los ceros finales.
2. **Reintento: `leerExtensiones` antes de `FALLIDO→PROCESANDO`.** Si esa lectura falla (500, la clave se borra), el depósito sigue FALLIDO y no se acreditó. Si se leyera después de acreditar y fallara, el cliente reintentaría con la clave borrada y billetera acreditaría dos veces.
3. **El controller elige `registrar` o `reintentar`** según `req.idempotencia?.depositoIdPrevio` (diagrama §3: "registrar(datos) o reintentar(depositoIdPrevio)"). En el reintento el body también se valida con el schema; tiene el mismo hash que el original, que ya pasó.
4. **`acreditar` que lanza algo que no es `ErrorApp`** (el client solo lanza `ErrorApp`): se relanza tal cual (500). El `alt` del diagrama solo cubre `ErrorApp`.
5. **`reintentar` sobre un id que no existe**: `Error` (500). No ocurre en la práctica, porque `claves_idempotencia.deposito_id` tiene FK a `depositos`.

## Verificación

- `node -r ./tests/setup/env.js -e "require('./src/modules/registrar-deposito/<archivo>')"` → los 6 cargan sin error. Sin `env.js`, los que importan `config.js` fallan como corresponde: faltan las variables obligatorias.
- Smoke manual (script en el scratchpad, fuera del repo; app con solo `registrar-deposito`, nock y BD de prueba):
  201 COMPLETADO con billetera recibiendo `"150.00"` y el `depositoId`; repetición → 201 `Idempotency-Replayed: true`;
  `"0"`, `"-1"`, `"10.001"`, `"10.100"` → 422; monto número / campo extra → 400; BLOQUEADA → 422 `CUENTA_INACTIVA`;
  USD a cuenta PEN → 422 `MONEDA_NO_SOPORTADA`; AGENTE con canal APP → 403; consulta 500 → 502 sin `deposito_id`;
  acreditación 500 → 502 (FALLIDO) y luego reintento con la misma clave → 201 COMPLETADO, mismo `id`, sin consulta de cuenta.
  La auditoría guardó `deposito_id` solo en los 201 y los 502 de acreditación. No quedaron mocks de nock pendientes.

### `bash init.sh --rapido`

```
[OK]    Alcance de archivos correcto (126 archivos revisados)
[WARN]  SPEC-07 (en curso) aún sin prueba: RD-T01 … RD-T12
Test Suites: 7 passed, 7 total
Tests:       109 passed, 109 total
[OK]    Entorno listo (verificación rápida).
```

### `bash init.sh` (completo, BD arriba)

```
Test Suites: 12 passed, 12 total
Tests:       12 todo, 177 passed, 189 total
Jest: "./src/modules/" coverage threshold for statements (80%) not met: 0%
  (ídem branches, lines, functions)
[FAIL]  Hay pruebas rotas
```

Las 177 pruebas pasan. Lo único que falla es el umbral de cobertura del 80 % sobre `src/modules/`
(SPEC-00 §6), que está en 0 % porque aún no existen las pruebas de SPEC-07. Se resuelve cuando el
tester escriba RD-T01..T12. Ninguna prueba anterior se rompió.
