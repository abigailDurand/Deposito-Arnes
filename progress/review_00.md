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
