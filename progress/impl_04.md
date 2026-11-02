# Implementación SPEC-04 · auditoria (feature 4)

**Agente:** desarrolladorback · **Fecha:** 2026-10-30 · **Estado:** `in_progress` (lista para el tester)

> **Atención leader/tester:** `bash init.sh --rapido` está **verde**. `bash init.sh` completo está
> **rojo solo por el umbral de cobertura del 80 % en `./src/core/`** (branches 67,71 %, functions
> 79,06 %): `auditoria.js` y `auditoriaRepository.js` aún no tienen las pruebas AUD-T (son del tester).
> Ninguna prueba falla (93 + 2 todo) y el `globalSetup` aplicó `db/00-core.sql` y `db/04-auditoria.sql`
> (orden alfabético) sin error.

## Archivos creados (todos del §2 de SPEC-04)

| Archivo | Exporta |
|---|---|
| `db/04-auditoria.sql` | Tabla `auditoria_depositos`, función `bloquear_cambios_auditoria()` y trigger `auditoria_inmutable`: DDL **literal** de §4 |
| `src/core/repositories/auditoriaRepository.js` | `{ insertar(db, fila) }` (único método) |
| `src/core/middlewares/auditoria.js` | la función middleware (`app.use(require(...))`, igual que `correlationId`) + auxiliares `deducirAccion`, `extraerDelBody`, `ACCIONES_AUDITADAS` |

No creado: `tests/integration/auditoria/auditoria.test.js` (del tester). Fuera del §2 solo se tocó
`feature_list.json` (feature 4 → `in_progress`) y `progress/current.md`, por protocolo. No se montó
en ninguna app: el orden lo fija SPEC-06 (`crearApp`, PIP-R11: `correlationId → auditoria → /health →
autenticar → express.json → ...`).

## Reglas

- **AUD-R01** · Toda petición cuya acción se deduce registra en `finish`, sea cual sea el status
  (401 de `autenticar`, 400 de JSON mal formado, 422, 2xx). Las respuestas repetidas por idempotencia
  también pasan por `finish` → también se registran.
- **AUD-R02** · `ACCIONES_AUDITADAS`: `POST /api/v1/depositos` → `CREAR_DEPOSITO`,
  `GET /api/v1/depositos/{seg}` → `CONSULTAR_DEPOSITO`, `GET /api/v1/cuentas/{seg}/depositos` →
  `LISTAR_DEPOSITOS`. Se compara con `req.originalUrl` sin query (no cambia dentro de routers
  montados; `req.path` sí), sin distinguir mayúsculas y con barra final opcional, como enruta Express.
  `{seg}` = cualquier segmento no vacío sin `/` (un id mal formado que acaba en 400 sigue siendo un
  intento). `/health`, rutas inexistentes u otros métodos → no se engancha nada.
- **AUD-R03** · `res.on('finish', () => { registrar(...) })` sin `await` ni `.then`: la respuesta ya
  salió y nadie espera el INSERT. `registrar` es `async` con `try/catch` total, así que su promesa
  nunca rechaza (sin unhandled rejection).
- **AUD-R04** · En el `catch`: `logger.error({ correlationId, accion, codigoError: err.code },
  'Falló el registro de auditoría')`. No se registra el `err` completo: el `detail`/mensaje de
  PostgreSQL ("Failing row contains ...") podría incluir valores de la fila; tampoco body, headers ni cuenta.
- **AUD-R05** · Trigger `BEFORE UPDATE OR DELETE` que lanza excepción (DDL exacto). El repository solo
  ofrece `insertar`. `TRUNCATE` no dispara triggers de fila → `limpiar()` de `tests/helpers/db.js`
  funciona (verificado).
- **AUD-R06** · `usuario_id = req.usuario?.id ?? null` y `deposito_id = res.locals.depositoId ?? null`,
  ambos leídos **en `finish`** (el middleware corre antes de `autenticar`, D2).
- **AUD-R07** · `extraerDelBody(req.body)` leído en `finish` (cuando `express.json` ya corrió si la
  petición llegó hasta él; si no, `req.body` es `undefined` → null): `canal` solo si es string en
  `AGENTE|VENTANILLA|APP`; `monto` solo si es **string** que cumple `^-?\d{1,13}(\.\d{1,2})?$`
  (número JSON `10` → null). Body no objeto (array, string) → ambos null. Nada más del body se lee.
  El monto se pasa como string a PostgreSQL (NUMERIC), nunca `Number` (PRY-R06).
- **AUD-R08** · `ip = req.ip` (trust proxy lo configura SPEC-06). `resultado = status < 400 ? 'EXITO' :
  'ERROR_<status>'`.
- **PRY-R08** · INSERT con `$1..$8`. **Convenciones:** el repository recibe el ejecutor como primer
  parámetro; el middleware le pasa `pool` de `src/core/db.js`.

## Decisiones

1. **La acción se deduce al entrar** (con `originalUrl`, que no cambia durante la petición) para no
   enganchar `finish` en rutas no auditadas; todo lo demás (usuario, depósito, body, status) se lee en
   `finish`.
2. **Llamada vía objeto del módulo** (`auditoriaRepository.insertar(...)`) en vez de desestructurar,
   para que el tester pueda forzar el fallo de AUD-T06 con `jest.spyOn(auditoriaRepository, 'insertar')`.
3. Si `res.locals.depositoId` no es un UUID existente o `sub` excede 50 caracteres, el INSERT falla y se
   aplica AUD-R04 (log, sin afectar la respuesta). No se trunca ni se valida aparte: la spec no lo pide.
4. Si el cliente aborta antes de terminar la respuesta, `finish` no se emite y no hay fila: la spec fija
   `finish` (AUD-R03).

## Notas para tester / revisor

- La fila se escribe después de responder: consultar con reintentos cortos (≤ 1 s), como dice §6.
- AUD-T03, T05, T08 se pueden probar ya con app mínima (`correlationId → auditoria → /health →
  autenticar → express.json → router → manejadorErrores`). T06 también, con una ruta falsa que
  responda 201 + spy de `insertar`/`logger.error`. T01, T02, T04, T07 piden SPEC-07/08 (T04 además
  SPEC-05) → `test.todo`.
- Revisor de SPEC-06: montar `auditoria` entre `correlationId` y `GET /health` (PIP-R11).
- SPEC-05/07/08: asignar `res.locals.depositoId` (manejadorErrores ya lo hace con `err.depositoId`).

## Verificación

Script fuera del repo (scratchpad, no versionado): `globalSetup` real (aplica `00-core.sql` y
`04-auditoria.sql`) + app Express mínima con el orden de PIP-R11 + Supertest + `tests/helpers/tokens.js`.
Filas resultantes (`/health` y `/api/v1/nada` no generaron filas):

```
usuario_id    accion              canal   monto  resultado  correlation_id
null          CREAR_DEPOSITO      null    null   ERROR_401  c1   (sin token; body no parseado)
usr-agente-1  CREAR_DEPOSITO      null    -5.00  ERROR_422  c2   (canal 'XX' descartado)
usr-agente-1  CREAR_DEPOSITO      AGENTE  null   EXITO      c3   (monto numérico 10 descartado; ?x=1)
usr-agente-1  CONSULTAR_DEPOSITO  null    null   EXITO      c4
usr-agente-1  LISTAR_DEPOSITOS    null    null   EXITO      c5   (?pagina=1)
usr-agente-1  CREAR_DEPOSITO      null    null   ERROR_400  c6   (JSON mal formado)
```

- `UPDATE` y `DELETE` directos → ambos lanzan `auditoria_depositos es solo de inserción`. `TRUNCATE` OK.
- `insertar` forzado a lanzar → respuesta **201** normal; `logger.error` recibió solo
  `{"correlationId":"c7","accion":"CREAR_DEPOSITO","codigoError":"XX000"}` (sin la cuenta del body ni
  el mensaje del error, que la contenía).

### `bash init.sh --rapido`

```
Test Suites: 5 passed, 5 total
Tests:       1 todo, 65 passed, 66 total
[OK]    Pruebas unitarias en verde (modo --rapido: integración NO ejecutada)
[OK]    Entorno listo (verificación rápida). Para cerrar una feature corre 'bash init.sh' completo.
```

### `bash init.sh` (completo)

```
[OK]    Alcance de archivos correcto (87 archivos revisados)
  auditoria.js           |       0 |        0 |       0 |       0 | 3-86
  auditoriaRepository.js |       0 |      100 |       0 |       0 | 6-23
Jest: "./src/core/" coverage threshold for branches (80%) not met: 67.71%
Jest: "./src/core/" coverage threshold for functions (80%) not met: 79.06%
Tests:       2 todo, 93 passed, 95 total
[FAIL]  Hay pruebas rotas (¿está PostgreSQL arriba? 'docker compose up -d db')
```

Única causa: cobertura de `src/core/` sin las pruebas AUD-T del tester. Ninguna prueba falla.
