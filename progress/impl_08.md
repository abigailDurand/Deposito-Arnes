# impl_08 — SPEC-08 consultar-deposito

- **Agente:** desarrolladorback · **Fecha:** 2026-11-02

## Archivos (todos del §2)

| Archivo | Estado |
|---|---|
| `src/modules/consultar-deposito/index.js` | NUEVO — `{ id: 'consultar-deposito', tipo: 'endpoint', router }` |
| `src/modules/consultar-deposito/routes.js` | NUEVO — `GET /depositos/:id`, `requiereRol('CLIENTE','AGENTE','CAJERO')`, `manejar(controller.consultar)` |
| `src/modules/consultar-deposito/controller.js` | NUEVO — valida `id` con `z.string().uuid()`, llama al service, `res.locals.depositoId`, 200 |
| `src/modules/consultar-deposito/service.js` | NUEVO — `consultar(id, usuario, correlationId)` |
| `src/modules/consultar-deposito/repository.js` | NUEVO — `buscarPorId(db, id)`, solo `SELECT` parametrizado |
| `tests/integration/consultar-deposito/consultar.test.js` | No creado: es del tester |

No se tocó `src/core/` (PRY-R05) ni ningún otro módulo (PRY-R04): el repository es propio
del módulo aunque tenga la misma consulta que el de `registrar-deposito`.

## Reglas

- **CD-R01** · `controller.js`: `z.string().uuid().safeParse(req.params.id)`; si falla → `ErrorApp('FORMATO_INVALIDO')` (400) antes de tocar la BD (así PostgreSQL nunca recibe un uuid mal formado).
- **CD-R02** · `service.js`: `loRegistro` = tiene rol AGENTE o CAJERO y `fila.usuario_id === usuario.id`; si no, rol CLIENTE y `permisos.esTitular(usuario, cuenta)` (de `src/core/permisos.js`, SPEC-03).
- **CD-R03** · Billetera solo se consulta si no se cumplió la 1ª condición y el usuario tiene rol CLIENTE. AGENTE/CAJERO ajeno → 404 sin llamar a billetera.
- **CD-R04** · `consultarCuenta` devuelve `null` en 404; `esTitular(usuario, null)` devuelve `false` → 404.
- **CD-R05** · Todo caso sin permiso lanza `DEPOSITO_NO_ENCONTRADO` (404), igual que el inexistente; nunca `SIN_PERMISO`.
- **CD-R06** · `billeteraClient.consultarCuenta` ya lanza `ErrorApp('BILLETERA_NO_DISPONIBLE')` (502) ante 5xx/timeout (INT-R04); el service lo deja propagar.
- **CD-R07** · `return aJson(fila, await pipeline.leerExtensiones(id, contexto))`. El módulo no nombra ninguna feature; `extensiones` siempre presente (`{}` si no hay extensiones activas con datos).
- **PRY-R01..R03** · routes → controller → service → repository/client; el service no tiene SQL ni HTTP.
- **PRY-R06** · No hay aritmética de dinero; el formato `"100.00"` lo hace `aJson` con `Decimal`.
- **PRY-R08** · `SELECT * FROM depositos WHERE id = $1`.
- **PRY-R10** · El service no loguea; el client ya enmascara la cuenta.

## Arrastres aplicados (history.md)

- SPEC-03: `requiereRol` en la ruta. `verificarCanal`/`verificarTitular` **no aplican** a una consulta (no hay canal de operación); CD-R02 pide `esTitular`, que es lo que se usa.
- SPEC-04/05: `res.locals.depositoId` se asigna solo tras un 200 (la fila existe → la FK de auditoría no falla). En 404 no se asigna, para no revelar el id (CD-R05).
- SPEC-06: el service usa el pipeline singleton (`require('../../core/pipeline')`) y arma **un** `contexto` por petición, con la forma de SPEC-06 §4.

## Decisiones

- `contexto.cuenta`: la cuenta consultada a billetera cuando el usuario es CLIENTE; `null` cuando no se consultó (AGENTE/CAJERO que lo registró, CD-R03). SPEC-06 §4 solo define `null` para el reintento; no se inventa una consulta extra para llenarlo.
- Usuario con varios roles (p. ej. AGENTE + CLIENTE): primero se evalúa la condición de operador; si no se cumple y tiene CLIENTE, se consulta billetera ("alguna" de CD-R02).

## Verificación

- `node -e "require('./src/modules/consultar-deposito/<archivo>')"` (con `tests/setup/env.js`): los 5 cargan sin error.
- Smoke manual (script fuera del repo, en el scratchpad, con `crearApp`, nock y la BD de prueba): CD-T01 200 con todos los campos y `extensiones: {}`; CD-T02 404; CD-T03 400 `FORMATO_INVALIDO`; CD-T04 404; CD-T05 404 sin llamada a billetera; CD-T06 200; CD-T09 502 `BILLETERA_NO_DISPONIBLE`.

### `bash init.sh --rapido`

```
[OK]    SPEC-00..SPEC-07: todos sus casos tienen prueba
[WARN]  SPEC-08 (en curso) aún sin prueba: CD-T01 .. CD-T09
[OK]    Alcance de archivos correcto (135 archivos revisados)
Test Suites: 8 passed, 8 total · Tests: 131 passed, 131 total
[OK]    Entorno listo (verificación rápida).
```

### `bash init.sh` (completo, BD arriba)

```
Test Suites: 14 passed, 14 total · Tests: 234 passed, 234 total
Jest: "./src/modules/" coverage threshold for statements (80%) not met: 65.51%
[FAIL]  Hay pruebas rotas
```

Las 234 pruebas pasan; el único fallo es el umbral de cobertura de `src/modules/`, porque
`consultar-deposito` aún no tiene pruebas (0 %). Se resuelve cuando el tester escriba
CD-T01..T09. No es una regresión.

## Retrabajo v1.3, 2026-11-09

Cambio de spec (v1.2 → v1.3): nuevas reglas CD-R08 y CD-R09; casos nuevos CD-T14 y CD-T15; CD-T13 solo
precisa el usuario (`usr-cliente-1`).

### Resultado: sin cambios de código

Se revisaron los 5 archivos de `src/modules/consultar-deposito/` contra las reglas nuevas. Ya las cumplen; no se
modificó ningún archivo.

- **CD-R08** · `service.consultar` lee la fila con `repository.buscarPorId` (solo SELECT) y la devuelve con
  `aJson(fila, ...)`, así que `estado` sale tal cual (incluido `PROCESANDO`). El service solo importa
  `billeteraClient.consultarCuenta` (y solo para CLIENTE, CD-R03); nunca llama a `acreditar` ni a
  `POST /depositos/usd`, y no escribe en `depositos`. La prueba de integración existente
  "CD-R07 estados PENDIENTE, PROCESANDO y FALLIDO se devuelven tal cual" ya cubre el estado.
- **CD-R09** · El service no lee `cuenta.estado`: el permiso es solo `permisos.esTitular(usuario, cuenta)`, que
  compara `cuenta.titularId === usuario.id` (`src/core/permisos.js:24`). En `billeteraClient.consultarCuentaUsd`,
  `BLOCKED`/`CLOSED` se mapean a `BLOQUEADA`/`CERRADA` y se devuelven sin lanzar (solo lanza con un estado
  desconocido o sin `user_id`, INT-R04), y la cuenta PEN tampoco lanza por estado. Una billetera bloqueada o
  cerrada del titular permite la consulta (200).
- Reglas CD-R01..R07: sin cambios, siguen como en las secciones anteriores.

### Pruebas obsoletas

Ninguna. No hay pruebas de SPEC-08 que esperen rechazo por estado de billetera ni llamadas a billetera para
actualizar un depósito. Faltan las nuevas **CD-T14** y **CD-T15** (tester). CD-T13 cambió solo su enunciado; la
prueba existente sigue siendo válida si usa `usr-cliente-1` (lo debe confirmar el tester).

### `bash init.sh --rapido`

```
[WARN]  SPEC-08 (en curso) aún sin prueba: CD-T14, CD-T15
[WARN]  SPEC-11 (reabierta) aún sin prueba: CM-T09
[OK]    Alcance de archivos correcto (190 archivos revisados)
Test Suites: 12 passed, 12 total · Tests: 261 passed, 261 total
[OK]    Entorno listo (verificación rápida).
```
