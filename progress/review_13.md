# Review — SPEC-13 ci-cd (v1.0)

**Veredicto:** APROBADO

Revisor · 2026-11-10 · rama `ci-cd` · informes `progress/impl_13.md` y `tests/reporte.md` (§ SPEC-13).

## Reglas

### CI/CD (`.github/workflows/ci.yml`)
- [x] CI-R01: `ci.yml:8-11` usa `on: pull_request` (todas las ramas) y `push: branches: [main]`. El job `verificar` tiene su propio `services.postgres` con `postgres:16` y healthcheck (`:33`), hace `npm ci` y luego `bash init.sh` completo, sin `--rapido` (`:66`). Fija `DATABASE_URL_TEST` y `LOG_LEVEL`; el resto lo pone `tests/setup/env.js`, y `globalSetup` crea `deposito_test` y las claves JWT. En `init.sh`, la falta de docker solo produce `warn`, así que funciona con el Postgres de servicio.
- [x] CI-R02: `publicar` tiene `if: github.event_name == 'push' && github.ref == 'refs/heads/main'` y `needs: verificar` (`:70-71`). `IMAGEN=ghcr.io/abigaildurand/deposito-service`, en minúsculas (`:24`). Tags `${GITHUB_SHA::7}` (`:86`) y `main` (`:102-104`). La etiqueta `org.opencontainers.image.source` se calcula con `github.server_url`/`github.repository` (`:106`), sin URL escrita a mano.
- [x] CI-R03: a nivel de workflow solo hay `permissions: contents: read` (`:14-15`). `packages: write` aparece únicamente en `publicar` (`:74-76`). `avisar` y `verificar` heredan `contents: read`. El login en GHCR usa `secrets.GITHUB_TOKEN` (`:95`). No hay ninguna referencia a AWS ni a credenciales de la nube (lo comprobé con grep).
- [x] CI-R04: `avisar` lleva `needs: publicar` (`:111`). El payload lo arma `jq` y es exactamente el de §5: `event_type: "servicio-actualizado"` y `client_payload {servicio: "deposito-service", imagen: $IMAGEN, tag: <sha7>, commit: github.sha}` (`:126-131`). Se envía con `POST repos/abigailDurand/Deposito-integrador-/dispatches` (`:132`). Si `ORQUESTADOR_TOKEN` está vacío, emite `::warning::` y hace `exit 0` (`:122-125`).
- [x] CI-R05 / PRY-R09 / PRY-R10: el repo no contiene secretos ni URLs reales. Las únicas credenciales son las desechables del Postgres de CI, iguales a las de `docker-compose.yml`. Los tokens entran solo por `env:`, nunca con `echo`. `gh api --silent` no imprime la respuesta y `persist-credentials: false` está en ambos checkout (`:55`, `:82`).
- [x] CI-R06: cada ejecución de `verificar` tiene su propio contenedor de servicio. `concurrency` se agrupa por `workflow-ref` y `cancel-in-progress` solo es verdadero en `main` (`:18-20`).
- [x] Actions fijadas por SHA. Lo comprobé con `gh api repos/<repo>/git/ref/tags/<tag>`: los cinco son lightweight tags que apuntan exactamente al SHA fijado, y cada uno es además la release `latest`.
  - `actions/checkout` v7.0.1 = `3d3c42e5…`
  - `actions/setup-node` v7.1.0 = `949feb24…`
  - `docker/login-action` v4.8.0 = `8aa5831f…`
  - `docker/setup-buildx-action` v4.4.1 = `f87e5991…`
  - `docker/build-push-action` v7.4.0 = `c3c9e263…`
- [x] actionlint: `docker run rhysd/actionlint:latest` con el repo montado da `Found total 0 errors` y exit 0.

### Migraciones
- [x] CI-R07 (`scripts/migrar.js`):
  - Hace `BEGIN` (`:25`) y luego `pg_advisory_xact_lock(hashtext($1))` con parámetro (`:26`). Aplica los archivos en orden alfabético (`archivosSql` hace `.sort()`) y termina con `COMMIT` (`:36`).
  - Ante cualquier error hace `ROLLBACK` (`:40`) y relanza el error con el nombre del archivo.
  - En `main()`, un fallo pone `exitCode = 1` (`:59`, `:69`), y `pool.end()` se ejecuta en el `finally` (`:61`).
  - Reutiliza `src/core/db` y `logger` (`:52-53`), tal como permite §6.1.
- [x] CI-R08: los seis `db/*.sql` cumplen.
  - `00-core.sql`: `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS titular_id VARCHAR(100)` (`:21`) y dos `CREATE INDEX IF NOT EXISTS`.
  - `04-auditoria.sql`: `CREATE OR REPLACE FUNCTION` (`:16`) y `DROP TRIGGER IF EXISTS` antes de `CREATE TRIGGER` (`:20-21`).
  - `05-idempotencia.sql`: tabla e índice con `IF NOT EXISTS`.
  - `10-limites-canal.sql` y `11-conversion-moneda.sql`: los INSERT llevan `ON CONFLICT DO NOTHING`.
  - `12-alerta-uif.sql`: `IF NOT EXISTS`.
  - Tipos, restricciones y orden de columnas no cambian. CI-T01 compara columnas, restricciones, índices, triggers y funciones contra `deposito_test` y salen iguales.
- [x] CI-R09: `globalSetup` y `docker-entrypoint-initdb.d` siguen leyendo los mismos `db/*.sql`. No hay un segundo juego de SQL.

### Apagado limpio
- [x] CI-R10 (`src/server.js`): `cerrarServidor` (`:39-53`) llama a `server.close` y barre las conexiones ociosas, sin cortar las activas. `Promise.all` cubre el servidor y los `detener()` de `reconciliacion` y `limpiarClaves` (`:63`). Después se ejecuta `pool.end()` (`:65`), luego `logger.info` y `salir(0)`. `main()` registra `SIGTERM` y `SIGINT` (`:120`).
- [x] CI-R11: `setTimeout(timeoutMs)` con `unref` compite en `Promise.race` (`:77`). Si vence el tiempo, hace `logger.error` y `salir(1)`. `config.apagadoTimeoutMs` sale de `APAGADO_TIMEOUT_MS` (`config.js:82`, por defecto `10000`) y está documentado en `.env.example`.
- [x] CI-R12: si llega una segunda señal, devuelve la misma promesa y solo hace `logger.info` (`server.js:69-72`). `detener()` sin un `iniciar()` previo no falla:
  - `reconciliacion.js:42-46`
  - `limpiarClaves.js:42-46`
- [x] PIP-R12 se mantiene. `iniciar()` no cambia (`crearApp` → `limpiarClaves.iniciar` → `reconciliacion.iniciar` → `listen`). `main()` se ejecuta solo si `require.main === module` (`:123`), y el `Dockerfile` sigue con `CMD ["node", "src/server.js"]`. Si el arranque falla, se mantienen `logger.fatal` y `exitCode = 1`.

### Proyecto
- [x] PRY-R01..R04: no hay cambios de capas. `reconciliacion.js` (módulo) solo depende de `core` y de su propio `service`.
- [x] PRY-R05: en `src/core/` solo cambió `tareas/limpiarClaves.js`, que §2 autoriza expresamente. SPEC-13 es infraestructura y no una extensión.
- [x] PRY-R06/R07: no hay código de dinero en los cambios. El grep de `Number(` y `parseFloat` no da resultados en los archivos de §2.
- [x] PRY-R08: la única SQL con valores es `pg_advisory_xact_lock(hashtext($1))`, y está parametrizada. Los `db/*.sql` se ejecutan tal cual, igual que en `globalSetup`.
- [x] PRY-R09: `migrar.js` no lee `process.env` (va por `config.js`). El grep no encuentra `http(s)://` ni `process.env` en los archivos de §2 dentro de `src/`/`scripts/`.
- [x] PRY-R10: los logs de error solo registran `message` y `code`, sin tokens ni cuentas. No hay `console.log`.
- [x] PRY-R11: no aplica.
- [x] PRY-R12: `specs-v2/` está intacto según el hash de `init.sh`.
- [x] §2: todos los archivos tocados están en la lista. El tester cambió además `tests/unit/registrar-deposito/service.test.js` (añadió `await` en `detener()`), que es de SPEC-07, ya `done`, y `init.sh` lo valida en el alcance.

## Casos de prueba
- [x] CI-T01 a CI-T07: 13 pruebas reales, ningún `test.todo`, todas con aserciones concretas.
  - CI-T01: el esquema queda igual al de referencia. Una segunda ejecución deja el mismo esquema y los mismos datos. El proceso real devuelve código 0 dos veces con stderr vacío. Un límite editado a mano se conserva.
  - CI-T02: con el `00-core.sql` previo a v1.2 y filas cargadas, aparece `titular_id VARCHAR(100)` nullable y las filas quedan iguales.
  - CI-T03: tres `migrar` simultáneos terminan todos `fulfilled`, sin duplicar datos. Una prueba aparte demuestra el bloqueo: con el lock tomado, no termina ni crea tablas en 300 ms.
  - CI-T04: con un `.sql` roto rechaza nombrando el archivo, quedan 0 tablas y 0 funciones y el lock queda libre. El proceso real sale con código distinto de 0 y la tabla previa queda intacta.
  - CI-T05: con un `http.Server` real, una conexión nueva recibe `ECONNREFUSED`. El orden es `respuesta → pool.end → salir:0`.
  - CI-T06: se prueba con la `reconciliacion` real y con `limpiarClaves`, y en ambos casos el pool espera a que termine el ciclo.
  - CI-T07: con timeout se ejecuta `salir(1)` una sola vez, con `logger.error`, sin `pool.end` y sin repetir `detener` ni `close`.
- [x] Las bases temporales `deposito_ci_*` se eliminan con `DROP DATABASE ... WITH (FORCE)`. Tras `init.sh` quedan 0 BD `deposito_ci_%` en `chalenge-db-1` y 0 carpetas `migrar-ci-*`. No aparecen avisos de open handles ni "did not exit".

## Checkpoints
- C1: [x] El arnés está completo y `init.sh` sale con 0.
- C2: [x] Hay una sola feature `in_progress`, sus dependencias 0/5/6/7 están `done` y `current.md` describe la sesión.
- C3: [x] `specs-v2/` está intacto, el alcance es correcto (198 archivos) y la regla PRY-R05 de extensiones no aplica.
- C4: [x] Las reglas de §6 para el revisor (CI-R03, CI-R05, CI-R08 y actionlint) están verificadas.
- C5: [x] Todos los CI-Tnn tienen prueba. La integración usa PostgreSQL real. La cobertura es ≥ 80 % (all files 99.76/94.56/99.35/99.87) y `reporte.md` está completo.

## Observaciones (no bloqueantes, no incumplen reglas)
1. `scripts/migrar.js:52`: al reutilizar `src/core/db` se carga `config.js` completo, así que el Job de migración necesita todas las variables obligatorias del servicio. §6.1 lo permite expresamente. El integrador debe montar en el Job el mismo ConfigMap/Secret que usa el Deployment.
2. `src/server.js:91-97`: si el apagado falla (por ejemplo, si `pool.end` rechaza), el proceso sale con `salir(1)`. La spec no define este caso; la decisión es conservadora y coherente con CI-R11. La acepto.
3. `Dockerfile:13`: copia `scripts/` entero, y con él entran `generar-claves-dev.js` y `generar-token.js`. Cumple §2 ("Incluir `scripts/`") y no mete claves en la imagen. Si se quiere una imagen mínima, en el futuro podría copiarse solo `scripts/migrar.js`.
4. `db/00-core.sql:21`: el `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` toma un `ACCESS EXCLUSIVE` breve sobre `depositos` hasta el `COMMIT`, aunque no haga nada. Ya está anotado en `impl_13.md`, así que conviene que el Job de migración se ejecute antes del rolling update, como indica §5.
5. `ci.yml:106-107`: añade la etiqueta OCI `revision`, que es extra pero inocua.

## Salida de `bash init.sh` (completo, con PostgreSQL `chalenge-db-1`)
```
[OK]    specs-v2/ intacto (16 archivos)
[OK]    feature_list.json válido (14 features: pending=0 in_progress=1 done=13 blocked=0 reabierta=0)
[OK]    SPEC-00 … SPEC-13: todos sus casos tienen prueba
[OK]    Alcance de archivos correcto (198 archivos revisados)
Test Suites: 25 passed, 25 total
Tests:       507 passed, 507 total
[OK]    Todas las pruebas en verde (unitarias + integración)
[OK]    Entorno listo. Puedes empezar a trabajar.
EXIT=0
```
