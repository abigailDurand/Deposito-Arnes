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
