# Review — SPEC-08 consultar-deposito

**Revisor** · 2026-11-02 · Feature 8

**Veredicto:** APROBADO CON OBSERVACIONES

## Alcance (§2)

- [x] Solo se crearon los 5 archivos de `src/modules/consultar-deposito/` y
  `tests/integration/consultar-deposito/consultar.test.js`, más `tests/unit/consultar-deposito/service.test.js`
  (permitido por SPEC-00 §6). `git status src/core` limpio: `src/core/` no se tocó (PRY-R05).
- [x] `tests/unit/registrar-deposito/service.test.js` (+1 prueba `"10.100"`) es el arrastre de review_07; solo pruebas.
- [x] `init.sh`: alcance correcto (138 archivos).

## Reglas de proyecto

- [x] PRY-R01/R02 — `routes.js:11-15` → `controller.js:12-21` (solo valida, llama al service, asigna `res.locals` y responde) → `service.js:38-55` → `repository.js` / `billeteraClient`.
- [x] PRY-R03 — `service.js` sin SQL ni HTTP; SQL solo en `repository.js:5`; HTTP solo vía `core/clients/billeteraClient`.
- [x] PRY-R04 — `service.js:3-10` solo importa `../../core/*` y `./repository`; ningún otro módulo (el repository duplica la consulta de `registrar-deposito` a propósito, sin importarlo).
- [x] PRY-R05 — `src/core/` sin cambios; ningún nombre de feature en `src/core/` (grep vacío).
- [x] PRY-R06/R07 — sin aritmética de dinero; `aJson` (`core/depositoMapper`) formatea `"100.00"`. Grep `Number(`/`parseFloat` vacío.
- [x] PRY-R08 — `repository.js:5` `SELECT * FROM depositos WHERE id = $1`. Sin concatenación.
- [x] PRY-R09 — sin URLs ni secretos en el módulo (grep `http://` vacío).
- [x] PRY-R10 — el service no loguea; sin `console.log`.
- [x] PRY-R11 — no aplica (sin `[POR ACORDAR]`).
- [x] PRY-R12 — `specs-v2/` intacto (hash OK).

## Reglas de la spec

- [x] CD-R01 — `controller.js:9,13-14` `z.string().uuid()` → `ErrorApp('FORMATO_INVALIDO')` antes del service.
- [x] CD-R02 — `service.js:20-24` (operador AGENTE/CAJERO y `usuario_id === usuario.id`) y `service.js:45-49` (CLIENTE y `permisos.esTitular`).
- [x] CD-R03 — `service.js:43-47`: billetera solo si no se cumplió la 1ª condición y tiene rol CLIENTE.
- [x] CD-R04 — `esTitular(usuario, null)` → `false` (`core/permisos.js:24-28`) → 404.
- [x] **CD-R05 (§6 revisor)** — `service.js:40,45,49`: inexistente y sin permiso lanzan el mismo `DEPOSITO_NO_ENCONTRADO`; nunca `SIN_PERMISO`. `controller.js:19` solo asigna `res.locals.depositoId` tras pasar el permiso, así la auditoría del 404 no guarda el id. Prueba "CD-R05 … idéntica a la de no existe" compara cuerpos completos.
- [x] CD-R06 — `billeteraClient.consultarCuenta` lanza `BILLETERA_NO_DISPONIBLE` y el service lo propaga.
- [x] **CD-R07 (§6 revisor)** — `service.js:53-54` `aJson(fila, await pipeline.leerExtensiones(id, contexto))`; el módulo no nombra ninguna feature. Probado con extensión falsa ACTIVA/INACTIVA vía manifest.
- [x] **Repository solo SELECT (§6 revisor)** — `repository.js` solo contiene un `SELECT`; prueba "§2 repository solo SELECT" verifica que la fila no cambia.
- [x] Contrato §5 — `GET /depositos/:id` montado en `/api/v1`, `requiereRol('CLIENTE','AGENTE','CAJERO')`, 200 con objeto `Deposito` completo, 404 con mensaje exacto "No existe un depósito con ese id.", 400/502 con códigos del catálogo.
- [x] Contrato SPEC-06 §4 — `index.js` `{ id, tipo: 'endpoint', router }`; `contexto` con `usuario, cuenta, correlationId, logger, db` (`privado` lo agrega el pipeline).

## Decisiones de impl_08 (valoradas, aceptables, sin escalado)

1. `contexto.cuenta = null` cuando el operador que registró el depósito consulta. Aceptable: CD-R03 prohíbe
   consultar billetera si no hace falta, así que no hay otra cuenta que poner sin violar la spec; `null` ya es
   un valor contemplado por SPEC-06 §4. Probada (2 pruebas).
2. Usuario con varios roles: primero condición de operador, luego CLIENTE + titular. Es la lectura literal de
   "alguna" (CD-R02) y del orden de CD-R03. Probada (3 pruebas unitarias).

Ninguna requiere decisión humana.

## Arrastres de history.md

- [x] SPEC-01 — `aJson` siempre recibe `extensiones` (`service.js:54`).
- [x] SPEC-03 — `requiereRol` en la ruta. `verificarCanal`/`verificarTitular` no aplican a una consulta; CD-R02 pide `esTitular`, que se usa.
- [x] SPEC-04/05 — `res.locals.depositoId` solo con fila existente (`controller.js:19`); prueba de auditoría: 200 → `deposito_id` real, 404 → `null`.
- [x] SPEC-06 — pipeline singleton; cada prueba arma su app con su manifest dentro del test.
- [x] SPEC-07 — prueba `"10.100"` → 422 añadida; `tests/reporte.md` § SPEC-00/03/04/05 actualizado.

## Casos de prueba

- [x] CD-T01..T06, CD-T09 — 7/7 reales, con aserciones concretas (cuerpo completo con `toEqual`, número de llamadas a billetera, header de correlación).
- [x] CD-T07, CD-T08 — `test.todo` justificado: dependen de `conversiones_deposito` y del módulo de SPEC-11 (coincide con `feature_list.json`). La mecánica de CD-R07 se cubre con la extensión falsa.
- [x] Pruebas adicionales por regla CD-R01..R07, auditoría y decisiones.

## Checkpoints

- C1: [x]  C2: [x]  C3: [x]  C4: [x]  C5: [x] (PostgreSQL real `deposito_test` + nock; extensión ACTIVA/INACTIVA; cobertura `src/modules/consultar-deposito` 100 %, global 99,62 %; `tests/reporte.md` § SPEC-08 completo)

## Observaciones (no incumplen reglas de spec)

1. `tests/integration/consultar-deposito/consultar.test.js:60,141,192,217,219,234,247,255,266,282` — líneas de
   más de 100 caracteres (`docs/conventions.md`, estilo). Ajustar cuando se toque el archivo.
2. `tests/integration/consultar-deposito/consultar.test.js:116-124` — el `afterEach` espera a que la auditoría
   (escrita tras responder) se estabilice para evitar un deadlock con el `TRUNCATE` de `limpiar()`. Es correcto,
   pero es un patrón que otras suites de integración (SPEC-09..12) deberán replicar; considerar llevarlo a un helper
   compartido en una spec que lo permita.

## Salida de `bash init.sh`

```
[OK]    specs-v2/ intacto (15 archivos)
[OK]    feature_list.json válido (13 features: pending=4 in_progress=1 done=8 blocked=0)
[OK]    SPEC-00..SPEC-07: todos sus casos tienen prueba
[OK]    SPEC-08: todos sus casos tienen prueba (todo: CD-T07, CD-T08)
[OK]    Alcance de archivos correcto (138 archivos revisados)
Test Suites: 16 passed, 16 total
Tests:       2 todo, 268 passed, 270 total
All files | 99.62 | 94.83 | 98.98 | 99.79
modules/consultar-deposito | 100 | 100 | 100 | 100
[OK]    Todas las pruebas en verde (unitarias + integración)
[OK]    Entorno listo. Puedes empezar a trabajar.
EXIT=0
```

Tras marcar la feature 8 como `done`: `feature_list.json válido (pending=4 in_progress=0 done=9)`,
16 suites, 268 pasan + 2 todo, `Entorno listo`, EXIT=0.
