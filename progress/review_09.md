# Review — SPEC-09 historial-depositos

**Veredicto:** APROBADO CON OBSERVACIONES

- **Revisor** · 2026-11-02 · Feature 9 (`historial-depositos`).
- Insumos: `progress/impl_09.md`, `tests/reporte.md` §SPEC-09, `bash init.sh` completo con PostgreSQL.

## Alcance (§2)

- [x] Archivos nuevos solo en `src/modules/historial-depositos/` (index, routes, schema, controller,
  service, repository) y `tests/integration/historial-depositos/historial.test.js`. Todos en §2.
- [x] `git status`: `src/core/` intacto (PRY-R05); ningún otro módulo tocado; `specs-v2/` intacto.

## Reglas del proyecto

- [x] PRY-R01 — `routes.js:11-15` → `controller.listar` → `service.listar` → `repository` / `billeteraClient`. Sin saltos.
- [x] PRY-R02 — `controller.js:8-21` solo valida con zod (→ `FORMATO_INVALIDO`), llama al service y responde 200.
- [x] PRY-R03 — `service.js` no tiene SQL ni HTTP; usa `repository.listar/contar` y `billeteraClient.consultarCuenta`.
- [x] PRY-R04 — `service.js:3-8` solo importa `src/core/*` y `./repository`. No lee tablas de otros módulos (solo `depositos`).
- [x] PRY-R05 — `src/core/` sin cambios (la acción `LISTAR_DEPOSITOS` ya existía en `core/middlewares/auditoria.js:14`, SPEC-04).
- [x] PRY-R06/R07 — no hay aritmética de dinero; `monto` sale de `aJson` (`core/depositoMapper.js:16`, `Decimal.toFixed(2)`). `parseInt`/`Number.MAX_SAFE_INTEGER` en `schema.js:14,24` son paginación, no dinero.
- [x] PRY-R08 — `repository.js:5-19` arma solo condiciones fijas con `$n`; valores en arreglo. `LIMIT $n OFFSET $m` parametrizados (`repository.js:27-28`).
- [x] PRY-R09 — sin URLs ni secretos (Grep `http://` en `src/`: 0 resultados).
- [x] PRY-R10 — el módulo no loguea (Grep `console.log`: 0).
- [x] PRY-R11 — no aplica (sin `[POR ACORDAR]`).
- [x] PRY-R12 — `specs-v2/` intacto (hash OK en `init.sh`).

## Reglas de la spec

- [x] HD-R01 — `schema.js:8` regex `^\d{4}-\d{4}-\d{6}$`; `controller.js:10` → 400 antes de billetera/BD.
- [x] HD-R02 — `schema.js:11-31`: `pagina` ≥ 1 def. 1, `tamano` 1..100 def. 20, `estado` enum de los 4, `desde`/`hasta` `datetime({ offset: true })`, `refine` desde ≤ hasta.
- [x] HD-R03 — `repository.js:16-17` `creado_en >=` / `creado_en <=`.
- [x] HD-R04 — `service.js:29-32` AGENTE/CAJERO → `usuario_id` propio, sin billetera.
- [x] HD-R05 — `service.js:33-37` solo CLIENTE → `consultarCuenta` + `esTitular`; `null` → 403; 5xx/timeout → 502 propagado por el client.
- [x] HD-R06 (§6 revisor) — `repository.js:26-28` `ORDER BY creado_en DESC, id DESC LIMIT $n+1 OFFSET $n+2`; prueba de empate y prueba que verifica valores `[7, 14]` como parámetros.
- [x] HD-R07 (§6 revisor) — `listar` y `contar` usan la misma `armarWhere` con el mismo objeto `criterios` (`service.js:39-42`); `contar` sin LIMIT/OFFSET. Prueba con filtros combinados.
- [x] HD-R08 (§6 revisor) — `service.js:45` `aJson(fila)` sin segundo argumento → sin clave `extensiones` (`depositoMapper.js:24`); no llama a `pipeline.leerExtensiones` (verificado con extensión activa con datos).

## Contrato §5

- [x] `GET /api/v1/cuentas/:numero/depositos`, 200 `{ datos, pagina, tamano, total }` con `pagina/tamano/total` numéricos; elementos con los campos de §5 (HD-T01 compara cuerpo exacto).
- [x] 400 `FORMATO_INVALIDO`, 401 (core), 403 `SIN_PERMISO` con mensaje de §5, 502 `BILLETERA_NO_DISPONIBLE`.

## Decisiones del desarrollador (sin escalar)

- CLIENTE+AGENTE → rama operador: coincide con HD-R04 ("si tiene rol AGENTE o CAJERO") y §3 ("CLIENTE (y no AGENTE ni CAJERO)"). Correcta.
- `desde`/`hasta` exigen fecha-hora con zona: lectura válida de "fecha-hora ISO 8601" de HD-R02; el ejemplo de §5 usa `Z`. Aceptada.
- Query desconocida ignorada: la spec no la prohíbe. Aceptada.
- Operador sin `id` → 403: ver observación 1.

## Casos de prueba

- [x] HD-T01 … HD-T08 (8/8 reales, con aserciones de cuerpo exacto, orden, `total`, llamadas a billetera y a `repository.listar`).
- [x] Pruebas extra por regla HD-R01..R08, feature ACTIVA/INACTIVA, auditoría `LISTAR_DEPOSITOS`.
- Sin `.skip`/`.only`; `limpiar()` en `beforeEach`; PostgreSQL real + nock con `disableNetConnect`.

## Checkpoints

- C1: [x]  C2: [x]  C3: [x]  C4: [x]  C5: [x] (cobertura `modules/historial-depositos` 98.68 % stmts / 100 % líneas; reporte completo)

## Observaciones (no incumplen reglas de spec)

1. `src/modules/historial-depositos/service.js:31` — 403 `SIN_PERMISO` si un operador no trae `id`. La spec no define el caso; es inalcanzable con tokens de SPEC-03 (`sub` obligatorio) y no cambia el contrato. Si se quiere evitar código defensivo no pedido (PRY-R12), puede eliminarse en una spec futura; queda sin cubrir por pruebas (rama 31).
2. `src/modules/historial-depositos/service.js:12-15` — `tieneRol` duplica la lectura de `roles` que hace `core/permisos.js` (`rolesDe`, no exportada). Aceptable porque PRY-R05 impide tocar el core; anotarlo por si un futuro cambio del core expone el helper.

## Salida de `bash init.sh`

```
Test Suites: 17 passed, 17 total
Tests:       2 todo, 299 passed, 301 total
[OK]    Todas las pruebas en verde (unitarias + integración)
[OK]    Entorno listo. Puedes empezar a trabajar.
EXIT=0
```

Tras marcar la feature 9 como `done` en `feature_list.json`, `bash init.sh` de nuevo:

```
[OK]    SPEC-09: todos sus casos tienen prueba
Test Suites: 17 passed, 17 total
Tests:       2 todo, 299 passed, 301 total
[OK]    Entorno listo. Puedes empezar a trabajar.
EXIT=0
```
