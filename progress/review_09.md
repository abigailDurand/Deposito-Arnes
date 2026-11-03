# Review — SPEC-09 historial-depositos (RETRABAJO, spec v1.2, Billetera USD)

**Veredicto:** APROBADO

Retrabajo según AGENTS.md §5 "Reabrir features". Rama `inte_biUsd`. Revisado: `git diff` de
`src/modules/historial-depositos/schema.js` y `tests/integration/historial-depositos/historial.test.js`,
`progress/impl_09.md`, sección `## SPEC-09` (retrabajo) de `tests/reporte.md`.

## Reglas
- [x] HD-R01 — `schema.js:8` `RE_NUMERO` = `^(?:\d{4}-\d{4}-\d{6}|[0-9a-f]{8}-…-[0-9a-f]{12})$`, sin flag `i`;
      idéntica carácter a carácter a `RE_CUENTA` de `registrar-deposito/schema.js:7` (RD-R02). Falla → `controller.js` lanza `FORMATO_INVALIDO` (400) antes del service.
- [x] HD-R02/R03 — sin cambios respecto a la versión aprobada (`schema.js` query, `repository.js` `>=`/`<=`).
- [x] HD-R04 — `service.js:29-32` AGENTE/CAJERO filtran por `usuario_id`, sin llamar a billetera.
- [x] HD-R05 — `service.js:35-36` `consultarCuenta` (enruta PEN/USD en `billeteraClient` de SPEC-02) + `esTitular`; null → 403; 5xx → 502.
- [x] HD-R06 — `repository.js:26-27` `ORDER BY creado_en DESC, id DESC LIMIT $n+1 OFFSET $n+2` con parámetros.
- [x] HD-R07 — `repository.js:34-41` `contar` reutiliza `armarWhere` (mismos filtros que `listar`).
- [x] HD-R08 — `service.js:45` `aJson(fila)` sin `extensiones`; ningún acceso a tablas de extensiones.
- [x] PRY-R01..R04 — capas respetadas; solo se modificó `schema.js` (en §2).
- [x] PRY-R06/R07 — sin `Number(`/`parseFloat` en el módulo (el `parseInt` de `schema.js` es para paginación, no dinero).
- [x] PRY-R08 — SQL parametrizado; solo se arman condiciones de una lista fija.
- [x] PRY-R09/R10 — sin `console.*`, sin URLs ni secretos en el módulo.
- [x] PRY-R12 — `specs-v2/` intacto (init.sh).

## Casos de prueba
- [x] HD-T01 … HD-T12 (12/12 reales, con aserciones de cuerpo exacto / códigos / peticiones nock).
  - HD-T02 reescrita: `usr-cliente-2` con `22222222-2222-4222-8222-222222222222` (`billeteraUsdExiste`), cuerpo exacto `{ datos: [], pagina: 1, tamano: 20, total: 0 }` y 1 petición a USD.
  - HD-T09: 2 depósitos en `11111111-…` + 1 en otra cuenta → cuerpo exacto con 2; USD 1 petición con `X-Correlation-Id`; espía PEN `persist()` con 0 peticiones.
  - HD-T10: 403 con mensaje de §5; USD consultada, PEN no; `repository.listar` no llamado.
  - HD-T11: UUID en mayúsculas (`3FA85F64-…`), una letra mayúscula, incompletos y sin guiones → 400; espías USD y PEN con 0 peticiones; `listar` no llamado. Correcta la observación de que `11111111-…` en mayúsculas no cambia.
  - HD-T12: USD 500 → 502 `BILLETERA_NO_DISPONIBLE`; PEN no; `listar` no llamado.
- [x] Pruebas obsoletas actualizadas: eliminada `CUENTA_USD = '0011-0123-000002'` (es PEN en SPEC-02 v2.0); pruebas HD-R04 (cajero) y HD-R05 (cliente ve cualquier operador) adaptadas a `WALLET_USD` / `CUENTA_2` PEN.
- [x] Pruebas adicionales: HD-R04 en billetera USD (ninguna billetera llamada), HD-R05 USD 404 → 403.
- [x] Limpieza de BD: `afterEach` llama a `esperarAuditoria()` (espera a que el conteo de `auditoria_depositos` se estabilice) antes del `TRUNCATE` de `limpiar()` en el `beforeEach` siguiente.

## Checkpoints
- C1: [x]  C2: [x]  C3: [x]  C4: [x]  C5: [x] (cobertura módulo 98.7 % stmts / 91.3 % branch; global > 80 %)

## Observaciones (no bloquean; no incumplen regla de spec)
1. `feature_list.json` (feature 9, `acceptance`) sigue diciendo "HD-T01 a HD-T08 pasan"; la spec v1.2 llega a HD-T12. Corresponde al leader actualizarlo.

## Salida de `bash init.sh` (completo, PostgreSQL real)
```
[OK] specs-v2/ intacto (15 archivos)
[OK] SPEC-09: todos sus casos tienen prueba
[OK] Alcance de archivos correcto (178 archivos revisados)
Test Suites: 23 passed, 23 total
Tests:       1 todo, 402 passed, 403 total
[OK] Todas las pruebas en verde (unitarias + integración)
[OK] Entorno listo. Puedes empezar a trabajar.
EXIT=0
```

## Confirmación tras marcar `done`
Feature 9 → `status: "done"` (se conserva `retrabajo: true`). Segunda corrida de `bash init.sh`:
`EXIT=0` · `in_progress=0 done=11 reabierta=2` · `Test Suites: 23 passed` · `Tests: 1 todo, 402 passed, 403 total` · "Entorno listo".
