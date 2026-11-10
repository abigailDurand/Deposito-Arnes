# Review — SPEC-08 consultar-deposito (retrabajo v1.2, Billetera USD)

**Veredicto:** APROBADO

Retrabajo solo de pruebas (AGENTS.md §5, sin desarrolladorback). `git diff --name-only HEAD -- src/` vacío:
`src/modules/consultar-deposito/` no cambió. Cambian `tests/integration/consultar-deposito/consultar.test.js` y
`tests/reporte.md` (sección SPEC-08).

## Reglas
- [x] PRY-R01..R12 — `src/` sin cambios; grep en `src/modules/consultar-deposito/` sin `Number(`, `parseFloat`,
  `console.log`, `http://`, `INSERT/UPDATE/DELETE`. `specs-v2/` intacto (init.sh).
- [x] CD-R05 — `service.js` lanza `DEPOSITO_NO_ENCONTRADO` tanto si no existe como sin permiso;
  `consultar.test.js:430` compara status, código y mensaje de ambos 404 y que nunca sea `SIN_PERMISO`;
  CD-T11 (`consultar.test.js:314`) lo cubre también con billetera USD ajena.
- [x] CD-R07 — `service.js` devuelve `aJson(fila, await pipeline.leerExtensiones(id, contexto))`, sin nombres de
  features; pruebas `consultar.test.js:453,468,491,503` y `tests/unit/consultar-deposito/service.test.js:120`.
- [x] §2 repository solo SELECT — `repository.js` contiene únicamente `SELECT * FROM depositos WHERE id = $1`
  (parametrizado); prueba `consultar.test.js:538`.
- [x] CD-R03/R04/R06 con USD — enrutamiento por UUID en `billeteraClient` (SPEC-02 INT-R10); CD-T12/T13.

## Casos de prueba
- [x] CD-T01 … CD-T09 siguen presentes y en verde (`consultar.test.js:173-279`).
- [x] CD-T10 (`:297`) — 200 con cuerpo completo (`cuentaDestino` UUID, `moneda` USD); scope nock en
  `GET /api/v1/billetera/wallets/{id}` (`tests/helpers/billetera.js:47`) `isDone()`, 1 petición, `X-Correlation-Id`
  propagado; trampa `nock(config.billetera.url).get(/.*/)` con `isDone() === false` (hosts PEN/USD distintos en
  `tests/setup/env.js`, así la trampa discrimina de verdad).
- [x] CD-T11 (`:314`) — 404 `DEPOSITO_NO_ENCONTRADO` + mensaje de §5; 1 llamada USD, 0 PEN.
- [x] CD-T12 (`:329`) — USD 404 → 404 `DEPOSITO_NO_ENCONTRADO`; 0 PEN.
- [x] CD-T13 (`:342`) — USD 500 → 502 `BILLETERA_NO_DISPONIBLE`; 0 PEN.
- [x] Pruebas obsoletas — `CUENTA_USD = '0011-0123-000002'` eliminada (grep sin `0011-0123-000002` en la suite);
  la prueba CD-R02 de `usr-cliente-2` ahora usa la billetera USD `22222222-…` con `billeteraUsdExiste` y verifica
  1 petición USD.
- 13/13 reales, sin `test.todo` de SPEC-08.

## Limpieza de BD / auditoría
- [x] `beforeEach` → `limpiar()`; `afterEach` async espera a `esperarAuditoria()` (conteo de `auditoria_depositos`
  estable) antes de la siguiente limpieza, evitando el deadlock INSERT de auditoría vs `TRUNCATE`.

## Checkpoints
- C1: [x]  C2: [x]  C3: [x]  C4: [x]  C5: [x]

## Observaciones (no bloqueantes)
- `feature_list.json` feature 8, `acceptance[2]` sigue diciendo "CD-T07/T08 quedan como test.todo hasta SPEC-11",
  ya no es cierto (están implementadas). Lo puede actualizar el líder.

## Salida de `bash init.sh` (PostgreSQL real, antes de marcar done)
```
[OK]    specs-v2/ intacto (15 archivos)
[OK]    feature_list.json válido (13 features: pending=0 in_progress=1 done=9 blocked=0 reabierta=3)
[OK]    SPEC-08: todos sus casos tienen prueba
[WARN]  SPEC-09 (reabierta) aún sin prueba: HD-T09, HD-T10, HD-T11, HD-T12
[OK]    Alcance de archivos correcto (178 archivos revisados)
Test Suites: 23 passed, 23 total
Tests:       1 todo, 396 passed, 397 total
[OK]    Todas las pruebas en verde (unitarias + integración)
[OK]    Entorno listo. Puedes empezar a trabajar.
EXIT=0
```

Tras marcar la feature 8 `done` (conserva `retrabajo: true`), `bash init.sh` de nuevo en verde:
`done=10 in_progress=0 reabierta=3`, `Tests: 1 todo, 396 passed, 397 total`, EXIT=0.

---

## Retrabajo v1.3, 2026-11-09

# Review — SPEC-08 consultar-deposito (v1.2 → v1.3)

**Veredicto:** APROBADO

Cambio de spec: CD-R08, CD-R09 (nuevas); CD-T13 precisa `usr-cliente-1`; CD-T14, CD-T15 (nuevos).
Dev: sin cambios de código (`progress/impl_08.md`, "Retrabajo v1.3"). Confirmado: `git diff --stat --
src/modules/consultar-deposito/` vacío.

### Reglas
- [x] CD-R08 — `service.js:39` lee con `repository.buscarPorId` (solo SELECT, `repository.js:5`) y `service.js:54`
  devuelve `aJson(fila, ...)`: `estado` sale tal cual. El único uso de billetera es `consultarCuenta`
  (`service.js:47`, CD-R03); no hay `acreditar` ni escrituras en `depositos` (grep `INSERT|UPDATE|DELETE` vacío).
- [x] CD-R09 — `service.js:49` decide solo con `permisos.esTitular` (`src/core/permisos.js:24-28`, compara
  `titularId`); el service no lee `cuenta.estado`. `billeteraClient.js:40-41` mapea `BLOCKED/CLOSED` →
  `BLOQUEADA/CERRADA` sin lanzar en `consultarCuentaUsd`.
- [x] CD-R05 — sin permiso → `DEPOSITO_NO_ENCONTRADO` (`service.js:45`, `:49`); 404 con el mismo cuerpo.
- [x] CD-R07 — `service.js:53-54`, sin nombres de features en el módulo.
- [x] Repository solo SELECT, parametrizado (`$1`) — PRY-R08.
- [x] PRY-R01..R04 capas y dependencias solo a `src/core/`; PRY-R06/R07 sin dinero calculado aquí; PRY-R09/R10
  sin secretos ni `console.log`; sin URLs; PRY-R12 `specs-v2/` intacto (init.sh). Grep de `Number(`,
  `parseFloat`, `console.log`, `http://`, `+ '` en `src/modules/consultar-deposito/`: vacío.

### Casos de prueba (`tests/integration/consultar-deposito/consultar.test.js`)
- [x] CD-T01 … CD-T12 sin cambios, verdes.
- [x] CD-T13 (`:342`) — `usuario: 'usr-cliente-1'` explícito; 502 con cuerpo exacto, 1 petición USD, PEN no llamada.
- [x] CD-T14 (`:355`) — depósito `PROCESANDO`; titular y operador reciben 200 con cuerpo completo `toEqual`;
  interceptores `POST /depositos/usd` (`acreditaUsdOk`, `acreditaUsdReplay`) con 0 peticiones; fila de
  `depositos` idéntica antes/después. Aserciones concretas.
- [x] CD-T15 (`:411`, `test.each`) — `usr-bloqueada`/`33333333-…` BLOCKED → 200 con cuerpo completo y
  `contexto.cuenta.estado === 'BLOQUEADA'`; variante CLOSED (`usr-cerrada`) → 200. Control negativo
  (`:441`, `usr-cliente-1` → 404) prueba que el 200 viene de la titularidad. Extra: cuenta PEN BLOQUEADA → 200.
- 17/17 casos CD con prueba real (CD-T15 cuenta como uno; más pruebas de regla CD-R09).

### Sobre el token firmado en la prueba (`consultar.test.js:397-408`)
Aceptable. `usr-bloqueada` y `usr-cerrada` son datos de SPEC-02 §4 (titulares de las billeteras USD 33333333/44444444),
y CD-T15 exige un token suyo. `tests/helpers/tokens.js` pertenece al §2 de SPEC-02 y el tester de SPEC-08 no puede
editarlo (alcance). La firma local replica exactamente el payload de SPEC-02 §5 (`sub`, `roles`, `iss`, `aud`,
`exp`, RS256, misma clave de `tests/.tmp/`), así que no se salta la seguridad real. No incumple ninguna regla.
Sugerencia (no bloqueante, para un futuro retrabajo de SPEC-02): añadir esos dos titulares al helper o un
`token(usuario, { roles })` para no duplicar la firma.

### Checkpoints
- C1: [x]  C2: [x] (una sola `in_progress`, la 8)  C3: [x] (specs intactas, alcance OK 190 archivos)
- C4: [x]  C5: [x] (PostgreSQL real + nock; cobertura `modules/consultar-deposito` 100 %; reporte actualizado)

### Cambios requeridos
Ninguno.

### Salida de `bash init.sh` (completo, con PostgreSQL)
```
[OK]    specs-v2/ intacto (15 archivos)
[OK]    feature_list.json válido (13 features: pending=0 in_progress=1 done=10 blocked=0 reabierta=2)
[OK]    SPEC-08: todos sus casos tienen prueba
[WARN]  SPEC-11 (reabierta) aún sin prueba: CM-T09
[OK]    Alcance de archivos correcto (190 archivos revisados)
All files                    |   99.76 |    94.63 |   99.32 |   99.87 |
Test Suites: 23 passed, 23 total
Tests:       1 todo, 489 passed, 490 total
[OK]    Todas las pruebas en verde (unitarias + integración)
EXIT=0
```
Sin deadlock de `TRUNCATE` en esta corrida.

Tras marcar la feature 8 `done` (conserva `retrabajo: true`), `bash init.sh` de nuevo en verde:
`done=11 in_progress=0 reabierta=2`, `Tests: 1 todo, 489 passed, 490 total`, EXIT=0.
