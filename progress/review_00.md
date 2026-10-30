# Review — SPEC-00 proyecto

**Veredicto:** APROBADO CON OBSERVACIONES

- **Agente:** revisor · **Fecha:** 2026-10-30 · **Feature:** 0 (`proyecto`)
- Insumos: `specs-v2/00-proyecto.md` (v1.2), `progress/impl_00.md`, `tests/reporte.md` § SPEC-00,
  los 11 archivos del §2, `tests/core/proyecto.test.js`, `docs/*`, `CHECKPOINTS.md`, `specs-v2/README.md` (D12–D15).

## Reglas

- [x] PRY-R01..R05 — no aplican aún: no hay capas ni módulos (`src/` = `config.js` + `core/logger.js`).
  `grep` de nombres de features en `src/core/` → vacío.
- [x] PRY-R06 — `src/config.js:49-52` entrega los umbrales UIF (dinero) como string, nunca `Number`.
  `Number.parseInt` en `config.js:16,20` solo para `PORT`, `IDEMPOTENCIA_DIAS`, `BILLETERA_TIMEOUT_MS`,
  `TRUST_PROXY` (no son dinero). `grep "Number(|parseFloat" src/` → vacío.
- [x] PRY-R07 — no aplica aún.
- [x] PRY-R08 — `tests/setup/globalSetup.js:43` y `tests/helpers/db.js:11-14` usan `$1` para valores;
  lo único interpolado son identificadores (nombre de BD, `pg_tables.tablename`) entre comillas dobles
  escapadas (`globalSetup.js:23-25`, `db.js:16`), que PostgreSQL no permite parametrizar.
- [x] PRY-R09 — `src/config.js:56` es el único `process.env` de `src/`; `grep "https?://|postgres://" src/`
  → vacío. `Dockerfile` sin secretos ni URLs (ni `ENV` con credenciales). `docker-compose.yml:5-7,30-31`
  contiene la credencial `deposito/deposito` de la BD de desarrollo y las URLs internas `db`/`billetera-mock`:
  **aceptable**, porque (a) docker-compose es configuración de entorno, no código fuente, y la variable llega
  al servicio por entorno y la lee `config.js`; (b) la propia spec lo prevé: §2 `tests/setup/env.js` fija
  `postgres://deposito:deposito@localhost:5432/deposito_test` "mismas credenciales que el servicio `db` de
  docker-compose". Los secretos reales (`JWT_PUBLIC_KEY`, `BILLETERA_TOKEN`) se interpolan desde `.env`
  (`docker-compose.yml:32-33`), no se escriben. `.env.example:28` usa un placeholder, no un token inventado.
  URLs en `tests/setup/env.js:10,21` y `tests/core/proyecto.test.js:10,12`: impuestas por la spec (§2 env.js) o
  destinos ficticios de nock en pruebas; no son código fuente.
- [x] PRY-R10 — `src/core/logger.js:10` `redact: { paths: ['req.headers.authorization'], censor: '[REDACTED]' }`,
  verificado con pino real por `proyecto.test.js:126-157` (sale `[REDACTED]`, el token no aparece).
  `enmascararCuenta` (`logger.js:14-22`) devuelve `'****-****-456789'` para `'0011-0123-456789'` (PRY-T03);
  sin guiones deja visibles solo los 6 últimos. Ver observación 3.
- [x] PRY-R11 — `BILLETERA_TOKEN` y `UIF_UMBRAL_*` sin valor real (`.env.example:28,32-33`); umbrales de prueba
  son los de D14 (`tests/setup/env.js:29-30`).
- [x] PRY-R12 — `specs-v2/` intacto (`init.sh`: "specs-v2/ intacto (15 archivos)").

### §1 / §2 de SPEC-00

- [x] `package.json:16-30` — versiones exactas de §1, sin `^`/`~`, sin dependencias extra (8 deps + 3 devDeps).
  Scripts `start`, `test`, `test:unit`, `test:integration` (`package.json:11-14`).
- [x] `Dockerfile` — `node:22-alpine` (l.1), `npm ci --omit=dev` (l.7), copia `src/` (l.9) y
  `specs-v2/manifest.yaml` en la misma ruta (l.11, D15), `USER node` (l.13, no root).
- [x] `docker-compose.yml` — `db` = `postgres:16` (l.3), `./db` → `/docker-entrypoint-initdb.d` (l.11),
  healthcheck `pg_isready` (l.12-16), `deposito-service` con `depends_on: db: condition: service_healthy`
  (l.36-38), `billetera-mock` (l.18-21). `docker compose config -q` → exit 0. Ver observación 1.
- [x] `.gitignore` — `node_modules/`, `.env`, `.dev-keys/`, `tests/.tmp/` (+ `coverage/`, artefacto de `npm test`).
- [x] `src/config.js` — lee todas las variables de §5 con sus valores por defecto; si falta una obligatoria
  (`DATABASE_URL`, `JWT_PUBLIC_KEY`, `BILLETERA_URL`, `BILLETERA_TOKEN`) lanza con su nombre (l.24-27) y, como
  `module.exports` se evalúa al cargar (l.56), el servicio no arranca. `\n` escritos → saltos reales (l.37).
- [x] `jest.config.js` — proyectos `unit`/`integration`, `globalSetup`, `setupFiles`, `collectCoverageFrom`
  de `src/core/` y `src/modules/`, umbral 80 %.
- [x] `tests/setup/globalSetup.js` — par RSA en `tests/.tmp/` (l.12-21). D12 **verificado contra PostgreSQL real**:
  hice `DROP DATABASE deposito_test` y ejecuté el globalSetup del proyecto `integration` → recreó la BD
  conectándose a `postgres` (l.38-46), reinició `public` y aplicó `db/*.sql` en orden (l.49-63; hoy 0 archivos).
- [x] `tests/setup/env.js` — `DATABASE_URL_TEST` del entorno o el valor por defecto exacto de §2 (l.9-10);
  `UIF_UMBRAL_PEN=1000.00`, `UIF_UMBRAL_USD=300.00` (l.29-30). Se carga vía `setupFiles` antes de `config.js`.
- [x] `tests/helpers/db.js` — `limpiar()` hace `TRUNCATE ... CASCADE` de todas las tablas de `public` salvo
  `limites_canal` (l.8-18). Ejecutado contra la BD real sin error (sin tablas → no-op).

### Decisiones del desarrollador

- `--passWithNoTests` (`package.json:12-14`): **legítima, no debilita C5**. La existencia de una prueba por
  cada `XX-Tnn` la comprueba `init.sh` de forma independiente ("SPEC-00: todos sus casos tienen prueba"), así
  que el flag no oculta casos sin prueba. Hoy solo afecta a `test:integration` (sin pruebas de integración en
  SPEC-00). Ver observación 2.
- Umbral de cobertura condicional (`jest.config.js:23-28`): **legítimo, no debilita C5**. Una carpeta entra en
  el umbral en cuanto tiene `.js` (y ya existen pruebas, condición que se cumple desde ahora y para siempre).
  Como `collectCoverageFrom` incluye también los archivos no requeridos por ninguna prueba (cuentan como 0 %),
  código sin probar en `src/core/` o `src/modules/` hace fallar el umbral; la condición solo evita el error
  "Coverage data ... was not found" de una carpeta vacía. Hoy `./src/core/` está bajo umbral (100 %).

## Casos de prueba

- [x] PRY-T02 — real: `proyecto.test.js:21-25` (`cargarConfig` sin `DATABASE_URL` → `/DATABASE_URL/`) y
  `:27-37` (`require` aislado de `config.js` sin `DATABASE_URL` → lanza).
- [x] PRY-T03 — real: `proyecto.test.js:39-42`, `toBe('****-****-456789')`.
- [~] PRY-T01 — `test.todo` justificado (`proyecto.test.js:19`): requiere `crearApp` y `/health` de SPEC-06;
  lo admite `feature_list.json` (acceptance) y SPEC-00 §6.
- Extras (12) verifican valores concretos (defaults, sobrescritura, errores con nombre, redacción real).
- Resultado: 15 passed, 1 todo, 0 failed.

## Checkpoints

- C1: [x]  C2: [x]  C3: [x]  C4: [x]  C5: [x]
  - C5: la integración contra PostgreSQL real no tiene casos en SPEC-00; el setup de integración (D12,
    `limpiar()`) lo verifiqué a mano contra `chalenge-db-1` (postgres:16, healthy). Cobertura `src/core/` 100 %.
    `tests/reporte.md` § SPEC-00 lista cubiertos, `test.todo` y fallidos.

## Observaciones (no incumplen reglas de spec)

1. `docker-compose.yml:19` / criterio "docker compose up levanta la BD, el servicio y el mock": **hoy solo
   levanta `db`**. `billetera-mock` se construye desde `mocks/billetera/` (SPEC-02 §2) y la imagen del servicio
   arranca `src/server.js` (SPEC-06). No es RECHAZO: SPEC-00 §2 declara el mock como "(SPEC-02)" y C3 prohíbe
   crear archivos de specs en `pending`, así que el criterio es inalcanzable dentro del alcance de SPEC-00; el
   compose ya está escrito y validado (`docker compose config -q`) y la limitación está documentada en
   `progress/impl_00.md`. **Queda pendiente de verificar**: el revisor de SPEC-02 y el de SPEC-06 deben correr
   `docker compose up --build` y comprobar que los tres servicios quedan arriba (y `GET /health` → 200).
   Además hará falta un `.env` con `JWT_PUBLIC_KEY`/`BILLETERA_TOKEN` (de lo contrario `config.js` aborta,
   que es el comportamiento correcto).
2. `package.json:12-14` — cuando SPEC-01 aporte pruebas de integración, `--passWithNoTests` deja de ser
   necesario en `test:integration`; conviene retirarlo entonces para que una ruta `testMatch` rota no pase en
   verde con 0 pruebas.
3. `src/core/logger.js:15` — `enmascararCuenta` devuelve tal cual cualquier valor no string (p. ej. un número
   de cuenta numérico). Las cuentas son strings por contrato (SPEC-02), así que no incumple PRY-R10, pero los
   llamadores deben pasar siempre el string.
4. `docs/conventions.md` (líneas ≤ 100): `tests/setup/globalSetup.js:43` (103), `tests/core/proyecto.test.js:27`
   (103) y `:78` (102). Convención de estilo, no regla de spec.

## Cambios requeridos

Ninguno.

## Salida de `bash init.sh`

```
── 1. Verificando entorno ─────────────────────────────
[OK]    node -> v26.13.0
[OK]    npm -> 11.20.0
[OK]    docker -> Docker version 29.8.0
── 2. Verificando archivos base del arnés ──────────────
[OK]    Archivos base del arnés presentes
── 3. Specs, estado y alcance ──────────────────────────
[OK]    specs-v2/ intacto (15 archivos)
[OK]    feature_list.json válido (13 features: pending=12 in_progress=1 done=0 blocked=0)
[OK]    SPEC-00: todos sus casos tienen prueba (todo: PRY-T01)
[OK]    Alcance de archivos correcto (56 archivos revisados)
── 4. Ejecutando pruebas ───────────────────────────────
PASS unit tests/core/proyecto.test.js
All files  |     100 |      100 |     100 |     100 |
 logger.js |     100 |      100 |     100 |     100 |
Tests:       1 todo, 15 passed, 16 total
[OK]    Todas las pruebas en verde (unitarias + integración)
── 5. Resumen ──────────────────────────────────────────
[OK]    Entorno listo. Puedes empezar a trabajar.
EXIT=0
```

Verificación adicional contra PostgreSQL real (`chalenge-db-1`, postgres:16, healthy):

```
DROP DATABASE deposito_test        → DROP DATABASE
globalSetup(projectConfig integration) → recreada OK
pg_database                         → deposito_test
pool + limpiar()                    → [{ d: 'deposito_test', n: '0' }], sin error
docker compose config -q            → exit 0
```

### `bash init.sh` tras marcar la feature 0 como `done`

```
[OK]    specs-v2/ intacto (15 archivos)
[OK]    feature_list.json válido (13 features: pending=12 in_progress=0 done=1 blocked=0)
[OK]    SPEC-00: todos sus casos tienen prueba (todo: PRY-T01)
[OK]    Alcance de archivos correcto (57 archivos revisados)
Tests:       1 todo, 15 passed, 16 total
[OK]    Todas las pruebas en verde (unitarias + integración)
[OK]    Entorno listo. Puedes empezar a trabajar.
EXIT=0
```
