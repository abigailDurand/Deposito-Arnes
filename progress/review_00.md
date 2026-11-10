# Review — SPEC-00 proyecto (RETRABAJO: integración Billetera USD)

> Retrabajo de la feature 0 (`retrabajo: true`). Sustituye a la revisión anterior de SPEC-00.
> Alcance revisado: variables `BILLETERA_USD_URL` (obligatoria) y `BILLETERA_USD_TOKEN` (opcional)
> según SPEC-00 §2 y §5. Diff revisado: `src/config.js`, `.env.example`, `docker-compose.yml`,
> `tests/setup/env.js`, `tests/core/proyecto.test.js`.

**Veredicto:** APROBADO

## Reglas
- [x] §5 — `src/config.js:4-10` añade `BILLETERA_USD_URL` a `OBLIGATORIAS`; ausente o vacía → `Faltan variables de entorno obligatorias: BILLETERA_USD_URL` (cubierto por el `test.each` de `tests/core/proyecto.test.js:57`).
- [x] §5 / INT-R02 — `src/config.js:56-59` `billeteraUsd: { url, token }`; `token` = `null` si `BILLETERA_USD_TOKEN` falta o está vacío (prueba `tests/core/proyecto.test.js:89-97`).
- [x] §5 — `BILLETERA_TIMEOUT_MS` sigue siendo único (`config.billetera.timeoutMs`) y se documenta en `.env.example:29` que aplica a ambas billeteras.
- [x] PRY-R09 — Grep de `http://`, `https://`, `process.env` y `BILLETERA_USD` en `src/` fuera de `config.js`: 0 resultados. URLs nuevas solo en `.env.example:33`, `docker-compose.yml:33` y `tests/setup/env.js:25` (dominio de prueba resuelto con nock). `BILLETERA_USD_TOKEN` sin valor en `.env.example:35` y `${BILLETERA_USD_TOKEN:-}` en compose: ningún secreto en el repo.
- [x] §2 docker-compose — `deposito-service` recibe `BILLETERA_USD_URL: http://billetera-mock:4000` junto a `BILLETERA_URL` (`docker-compose.yml:31-34`).
- [x] §2 tests/setup/env.js — asigna `BILLETERA_USD_URL` de prueba y borra `BILLETERA_USD_TOKEN` (`tests/setup/env.js:24-26`).
- [x] Alcance — `src/core/clients/billeteraClient.js` sin cambios (`git diff --quiet` limpio); en `src/` solo cambia `config.js`.
- [x] PRY-R01..R08, R10..R12 — sin cambios de capas, SQL, dinero ni logs en el diff; no hay `console.log`, `Number(`/`parseFloat` nuevos. `specs-v2/` no lo tocó ningún subagente de implementación (cambios de spec provienen del humano/arnés, fuera del alcance de esta revisión).

## Casos de prueba
- [x] PRY-T01 … PRY-T03 (3/3 reales, sin `test.todo`).
- [x] Pruebas obsoletas actualizadas por el tester: `envBase()` con las 5 obligatorias; `test.each` incluye `BILLETERA_USD_URL`; prueba nueva de `BILLETERA_USD_TOKEN` con aserciones concretas (`toEqual({ url, token: null })`, vacío → `null`, presente → `'token-usd'`).

## Checkpoints
- C1: [x]  C2: [x]  C3: [x]  C4: [x]  C5: [x]

## Observaciones (no bloquean; no incumplen regla de spec)
1. `feature_list.json` feature 0, `acceptance[3]` sigue diciendo "PRY-T01 queda como test.todo hasta SPEC-06", pero PRY-T01 ya es real. Texto desactualizado del arnés; corresponde al líder actualizarlo si lo desea.

## Salida de `bash init.sh`
Ejecutado completo en primer plano, con PostgreSQL (proyectos `unit` + `integration`):

```
Test Suites: 23 passed, 23 total
Tests:       357 passed, 357 total
Ran all test suites in 2 projects.
[OK]    Todas las pruebas en verde (unitarias + integración)
[OK]    Entorno listo. Puedes empezar a trabajar.
EXIT=0
```

---

## Retrabajo v1.3, 2026-11-09

> SPEC-00 1.2 → 1.3 (solo §5: sale `BILLETERA_USD_TOKEN`; entran `BILLETERA_USD_TOKEN_URL`,
> `BILLETERA_USD_CLIENT_ID`, `BILLETERA_USD_CLIENT_SECRET` y `RECONCILIACION_*`). Feature 0, `retrabajo: true`.
> Diff revisado: `src/config.js`, `.env.example`, `docker-compose.yml`, `tests/setup/env.js`,
> `tests/core/proyecto.test.js`, `tests/unit/integraciones/billeteraClient.test.js` (ajuste transitorio de INT-T15).

**Veredicto:** APROBADO

### Reglas
- [x] §5 `BILLETERA_USD_TOKEN_URL` opcional — `src/config.js:69` → `null` si falta o está vacía.
- [x] §5 `CLIENT_ID`/`CLIENT_SECRET` obligatorias si hay `TOKEN_URL` — `src/config.js:13-16` y `:37-40`; mismo error de arranque `Faltan variables de entorno obligatorias: ...`. Sin `TOKEN_URL` se fuerzan a `null` (`:70-73`).
- [x] §5 "Sustituyen a `BILLETERA_USD_TOKEN`" — `config.js` ya no lo lee ni expone `billeteraUsd.token`; tampoco aparece en `.env.example` ni en `docker-compose.yml`.
- [x] §5 `RECONCILIACION_*` con defaults 30000 / 10000 / 3600000 — `src/config.js:76-80` vía `entero()` (no entero → error de arranque).
- [x] §5 "el secreto nunca en imágenes ni en el repositorio" / PRY-R09 — `.env.example:39-40` vacías; `docker-compose.yml:35-36` como `${VAR:-}`; `Dockerfile` sin cambios (no copia `.env`). Grep de `process.env`, `BILLETERA_USD_CLIENT`, `RECONCILIACION_` en `src/` fuera de `config.js`: 0 resultados.
- [x] PRY-R10 — `config` no se loguea (único uso: `src/server.js:25` solo `port`). Sin `console.log`.
- [x] PRY-R11 — URL real de token [POR ACORDAR] (Q9) no inventada: `.env.example:36` vacía.
- [x] PRY-R06 — sin `Number(`/`parseFloat` en `config.js`; `UIF_UMBRAL_*` siguen como string.
- [x] PRY-R01..R05, R07, R08 — el diff no toca capas, módulos, SQL ni dinero.
- [x] PRY-R12 — `specs-v2/` intacto respecto a `.harness/specs.sha256` (init.sh `[OK]`).
- [x] Alcance §2 — los archivos de código tocados están en el §2 de SPEC-00. Excepción aceptada como transitoria por indicación del líder: `tests/unit/integraciones/billeteraClient.test.js` (de SPEC-02), cambio mínimo y justificado (l. 549-550 aserción `tokenUrl` en lugar de `token`; l. 564-566 caso con token pasado a `test.todo` con motivo "espera SPEC-02").
- [x] Referencias a `BILLETERA_USD_TOKEN` (sin sufijo) en código/pruebas: solo `src/core/clients/billeteraClient.js:42,52` (SPEC-02, se retrabaja después) y la prueba negativa `tests/core/proyecto.test.js:144-148` (verifica que ya no se lee) y comentarios de `billeteraClient.test.js:549,564`. El resto son textos históricos en `progress/` y `tests/reporte.md` y el HTML generado en `coverage/`.

### Casos de prueba
- [x] PRY-T01 … PRY-T03 (3/3 reales, sin cambios).
- [x] Prueba obsoleta de `BILLETERA_USD_TOKEN` sustituida por pruebas con resultados concretos (`tests/core/proyecto.test.js:89-173`): `toEqual` exacto de `billeteraUsd` sin/con OAuth, mensaje de error exacto con ambos nombres, `test.each` por credencial ausente y vacía, prueba negativa de `token`, defaults y valores explícitos de `reconciliacion`, `'1h'` → error con nombre.
- [x] INT-T15 (SPEC-02): caso sin OAuth sigue real; caso con OAuth en `test.todo` justificado (transitorio hasta el retrabajo de SPEC-02).

### Checkpoints
- C1: [x]  C2: [x] (una sola `in_progress`: feature 0)  C3: [x]  C4: [x]  C5: [x] (cobertura `core` 99.46 %, módulos ≥ 98.7 %)

### Observaciones (no bloquean; fuera del alcance de SPEC-00)
1. `src/core/clients/billeteraClient.js:52` (SPEC-02, INT-R13) — lee `config.billeteraUsd.token`, que ya no existe (`undefined`): hasta el retrabajo de SPEC-02 nunca se envía `Authorization` a Billetera USD. Equivale al modo transición (Q7) y no rompe nada, pero SPEC-02 debe consumir `billeteraUsd.tokenUrl/clientId/clientSecret` y actualizar el comentario de la l. 42.
2. SPEC-07 (RD-R13) debe consumir `config.reconciliacion.intervaloMs/antiguedadMs/alertaMs` (nombres decididos aquí; la spec no los fija).
3. Deadlock intermitente en `TRUNCATE` de `limpiar()` (`tests/helpers/db.js:17`) reportado por el tester (2 de 5 corridas). No lo causa este cambio (solo toca config y pruebas unitarias; `tests/helpers/db.js` sin cambios). En las 2 corridas completas de esta revisión no se reprodujo. Conviene vigilarlo en SPEC-02/SPEC-05 (posible petición de una prueba anterior aún viva, p. ej. IDE-T04 con billetera que tarda 2 s).

### Salida de `bash init.sh` (completo, PostgreSQL real)
```
[OK]    specs-v2/ intacto (15 archivos)
[OK]    feature_list.json válido (13 features: pending=0 in_progress=1 done=5 blocked=0 reabierta=7)
[OK]    SPEC-00: todos sus casos tienen prueba
[WARN]  SPEC-01/02/07/08/11 (reabierta) casos sin prueba (esperado)
[OK]    Alcance de archivos correcto (189 archivos revisados)
Test Suites: 23 passed, 23 total
Tests:       1 todo, 418 passed, 419 total
[OK]    Todas las pruebas en verde (unitarias + integración)
[OK]    Entorno listo. Puedes empezar a trabajar.
EXIT=0
```

Tras marcar la feature 0 como `done` (`retrabajo: true` se mantiene), `bash init.sh` completo sigue en verde:
`feature_list.json válido (... in_progress=0 done=6 ...)` · `Test Suites: 23 passed` · `Tests: 1 todo, 418 passed, 419 total` · EXIT=0.
