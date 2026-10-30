# Implementación SPEC-00 · proyecto

- **Agente:** desarrolladorback · **Fecha:** 2026-10-30 · **Feature:** 0 (`in_progress`, no se marca `done`)

## Archivos creados (todos del §2 de SPEC-00)

| Archivo | Nota |
|---|---|
| `package.json` | Versiones exactas de §1. Scripts `start`, `test`, `test:unit`, `test:integration` |
| `package-lock.json` | Generado por `npm install` (permitido implícitamente, lo exige `npm ci`) |
| `Dockerfile` | `node:22-alpine`, `npm ci --omit=dev`, `USER node`, copia `src/` y `specs-v2/manifest.yaml` en su ruta (D15) |
| `docker-compose.yml` | `db` (postgres:16 + healthcheck + `./db` en `/docker-entrypoint-initdb.d`), `billetera-mock`, `deposito-service` (`depends_on: db: service_healthy`) |
| `.env.example` | Todas las variables de §5, con obligatorias y `[POR ACORDAR]` señalados |
| `.gitignore` | `node_modules/`, `.env`, `.dev-keys/`, `tests/.tmp/` y además `coverage/` (lo genera `npm test`) |
| `src/config.js` | Lee todas las variables de §5 |
| `src/core/logger.js` | pino con `redact` de `req.headers.authorization` + `enmascararCuenta` |
| `jest.config.js` | Proyectos `unit` / `integration`, `globalSetup`, `setupFiles`, cobertura |
| `tests/setup/globalSetup.js` | Par RSA en `tests/.tmp/` + D12 |
| `tests/setup/env.js` | Variables de prueba |
| `tests/helpers/db.js` | `pool`, `limpiar()`, `cerrar()` |

No creado: `tests/core/proyecto.test.js` (es del tester). Docker creó la carpeta vacía `db/` al
montar el volumen (sin archivos, `alcance.js` no la cuenta).

## Reglas

- **PRY-R01..R05, R07, R08 (capas/módulos/monedas)**: no aplican aún (no hay capas ni módulos). En `globalSetup.js` y `tests/helpers/db.js` toda consulta con valores usa `$1`; los únicos nombres interpolados son identificadores (nombre de la BD, tablas leídas de `pg_tables`), que no se pueden parametrizar y van entre comillas dobles escapadas.
- **PRY-R06**: los umbrales UIF (dinero) se exponen como string (`config.uif.umbralPEN`), nunca `Number`, para que SPEC-12 los pase a `Decimal`.
- **PRY-R09**: `src/config.js` es el único archivo de `src/` que toca `process.env`; `grep` de `http(s)://` y `postgres://` en `src/` → vacío. El logger toma el nivel de `config.logLevel`.
- **PRY-R10**: `redact: ['req.headers.authorization']` (comprobado: sale `[REDACTED]`); `enmascararCuenta('0011-0123-456789')` → `'****-****-456789'` (comprobado con node).
- **PRY-R11**: `BILLETERA_TOKEN` y umbrales UIF quedan como placeholders en `.env.example`; ningún valor real inventado. Los umbrales de prueba son los de D14.
- **PRY-R12**: `specs-v2/` sin tocar (init.sh: "specs-v2/ intacto").

## API de `src/config.js` (para specs posteriores)

`module.exports` = objeto ya cargado desde `process.env` (si falta una obligatoria, el `require`
lanza y el servicio no arranca) + `module.exports.cargarConfig(env)` para probar con un env a medida.

```
{ port, logLevel, trustProxy, databaseUrl, databaseUrlTest, manifestPath,
  jwt: { publicKey, algorithms: ['RS256'], issuer, audience },
  idempotenciaDias, billetera: { url, token, timeoutMs }, uif: { umbralPEN, umbralUSD } }
```

- Obligatorias: `DATABASE_URL`, `JWT_PUBLIC_KEY`, `BILLETERA_URL`, `BILLETERA_TOKEN`. Vacío cuenta como ausente. Error: `Faltan variables de entorno obligatorias: DATABASE_URL` (lista todas las que faltan) → cumple PRY-T02 (`cargarConfig({...env sin DATABASE_URL})` o `jest.isolateModules` + `require`).
- `JWT_PUBLIC_KEY`: los `\n` escritos se convierten a saltos reales. `JWT_ALGORITHMS` separado por comas → array.
- `PORT`, `IDEMPOTENCIA_DIAS`, `BILLETERA_TIMEOUT_MS` → enteros (si no son enteros, lanza con el nombre). `TRUST_PROXY` numérico → número de saltos (lo que espera Express); si no, string.
- UIF ausente → `null` (SPEC-12: `logger.warn`, sin alerta).

`src/core/logger.js` exporta `{ logger, enmascararCuenta }`.

## Decisiones

1. **`--passWithNoTests`** en los tres scripts de prueba: sin archivos de prueba Jest sale con código 1 ("No tests found") y `init.sh` quedaría rojo hasta que el tester escriba algo; con el flag sale 0.
2. **`npm test` = `jest --coverage --runInBand --passWithNoTests`**: una sola corrida con ambos proyectos para que la cobertura se mida sobre todo; `--runInBand` cumple "integración en serie". `test:unit` = `--selectProjects unit`; `test:integration` = `--selectProjects integration --runInBand`. Sin variables de entorno inline → funcionan igual en Windows.
3. **Cobertura 80 %**: `collectCoverageFrom` = `src/core/**` y `src/modules/**`; `coverageThreshold` usa claves por carpeta (`./src/core/`, `./src/modules/`), pero Jest falla con "Coverage data for ./src/X/ was not found" si una carpeta no tiene código o no se ejecutó ninguna prueba (pasó en la primera corrida de `init.sh`). `jest.config.js` añade la clave de cada carpeta solo si esa carpeta tiene `.js` **y** existe al menos un `*.test.js` en `tests/`. Así hoy no rompe, `src/modules/` entra sola con SPEC-07 y `src/core/` en cuanto el tester escriba `proyecto.test.js` (verificado con una prueba temporal en el scratchpad, ya borrada: el umbral de `./src/core/` se aplica y `./src/modules/` no da error).
4. **`globalSetup` por proyecto**: se declara en ambos proyectos; Jest lo llama con `projectConfig` solo para proyectos que tienen pruebas. Siempre genera el par RSA (`tests/.tmp/publica.pem`, `tests/.tmp/privada.pem`, PKCS#8/SPKI 2048); la parte de BD (D12) solo para `integration`. Así `npm run test:unit` / `init.sh --rapido` no necesitan PostgreSQL. Luego hace `require('./env')` para leer `DATABASE_URL_TEST` (un solo sitio con el valor por defecto).
5. **D12**: se conecta a la BD `postgres` del mismo servidor, `SELECT 1 FROM pg_database WHERE datname = $1`, `CREATE DATABASE` si falta; luego `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` y aplica `db/*.sql` en orden alfabético (`.sort()`); si `db/` no existe o está vacío → 0 archivos. Si un SQL falla, el error nombra el archivo.
6. **`env.js`**: `DATABASE_URL = DATABASE_URL_TEST` (la app bajo prueba usa la BD de pruebas); `JWT_PUBLIC_KEY` = `tests/.tmp/publica.pem`; `JWT_*` con los valores por defecto de §5; `BILLETERA_URL = http://billetera.test` (solo destino de nock, nunca se resuelve) y `BILLETERA_TOKEN = token-de-prueba`; `LOG_LEVEL = silent`; UIF 1000.00 / 300.00 (D14).
7. **`limpiar()`**: lee las tablas de `public` salvo `limites_canal` y hace `TRUNCATE "t1", "t2" CASCADE`; sin tablas no hace nada.
8. **docker-compose**: credenciales `deposito/deposito`, BD `deposito` (las mismas que usa `env.js`). `deposito-service` recibe `DATABASE_URL` y `BILLETERA_URL` apuntando a `db` y `billetera-mock`; `JWT_PUBLIC_KEY`, `BILLETERA_TOKEN` y UIF se interpolan desde `.env` con `${VAR:-}` (con `${VAR:?}` fallaría hasta `docker compose up -d db`).

## Pendiente / limitaciones conocidas

- **`docker compose up` completo solo funcionará tras SPEC-02 y SPEC-06**: `billetera-mock` se construye desde `mocks/billetera/Dockerfile` (SPEC-02, aún no existe) y la imagen de `deposito-service` arranca `src/server.js` (SPEC-06). Hoy solo se puede levantar `db`. `docker compose config -q` valida el archivo.
- Para levantar `deposito-service` hará falta un `.env` con `JWT_PUBLIC_KEY` (de `scripts/generar-claves-dev.js`, SPEC-02) y `BILLETERA_TOKEN`.
- Los scripts de `db/` montados en `/docker-entrypoint-initdb.d` solo se aplican al inicializar un volumen vacío; las pruebas no dependen de ello (las aplica `globalSetup`).
- `npm install` avisa de paquetes deprecados (supertest 7.0.0, superagent, glob 7) y 13 vulnerabilidades en dependencias transitivas; no se tocan porque las versiones están fijadas en §1.
- Node local es v26.13.0 (init.sh exige ≥ 22); la imagen Docker usa node 22.

## Verificación

- `docker compose up -d db` → `chalenge-db-1 Up (healthy)`; puerto 5432 estaba libre. **Queda arriba.**
- `globalSetup` ejecutado a mano dos veces (`projectConfig.displayName = integration`): la 1.ª crea `deposito_test`, la 2.ª la reutiliza; esquema `public` reiniciado; `config.js` carga con `env.js`.
- Con un `db/zz-temporal.sql` temporal (ya borrado): se aplicó, `limpiar()` vació `prueba_a` y conservó `limites_canal` (0 y 1 filas). La siguiente corrida dejó `deposito_test` sin tablas.
- `node -e` : `enmascararCuenta('0011-0123-456789')` → `****-****-456789`; `cargarConfig` sin `DATABASE_URL` → `Faltan variables de entorno obligatorias: DATABASE_URL`.

### `bash init.sh --rapido`

```
── 3. Specs, estado y alcance ──────────────────────────
[OK]    specs-v2/ intacto (15 archivos)
[OK]    feature_list.json válido (13 features: pending=12 in_progress=1 done=0 blocked=0)
[WARN]  SPEC-00 (en curso) aún sin prueba: PRY-T01, PRY-T02, PRY-T03
[OK]    Alcance de archivos correcto (53 archivos revisados)
── 4. Ejecutando pruebas ───────────────────────────────
Running one project: unit
No tests found, exiting with code 0
[OK]    Pruebas unitarias en verde (modo --rapido: integración NO ejecutada)
── 5. Resumen ──────────────────────────────────────────
[OK]    Entorno listo (verificación rápida). Para cerrar una feature corre 'bash init.sh' completo.
EXIT=0
```

### `bash init.sh` (completo)

```
── 3. Specs, estado y alcance ──────────────────────────
[OK]    specs-v2/ intacto (15 archivos)
[OK]    feature_list.json válido (13 features: pending=12 in_progress=1 done=0 blocked=0)
[WARN]  SPEC-00 (en curso) aún sin prueba: PRY-T01, PRY-T02, PRY-T03
[OK]    Alcance de archivos correcto (53 archivos revisados)
── 4. Ejecutando pruebas ───────────────────────────────
No tests found, exiting with code 0
All files |       0 |        0 |       0 |       0 |
[OK]    Todas las pruebas en verde (unitarias + integración)
── 5. Resumen ──────────────────────────────────────────
[OK]    Entorno listo. Puedes empezar a trabajar.
EXIT=0
```

El WARN es esperado: las pruebas PRY-T01..T03 son del tester (PRY-T01 como `test.todo` hasta SPEC-06).
