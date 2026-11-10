# impl_13 · SPEC-13 ci-cd (v1.0) · desarrolladorback · 2026-11-10

## Archivos (todos del §2)

| Archivo | Marca | Cambio |
|---|---|---|
| `.github/workflows/ci.yml` | NUEVO | Jobs `verificar`, `publicar`, `avisar` |
| `scripts/migrar.js` | NUEVO | `migrar({ pool, dir, logger })` exportada + `main()` si se ejecuta directo |
| `db/00-core.sql`, `04-auditoria.sql`, `05-idempotencia.sql`, `10-limites-canal.sql`, `11-conversion-moneda.sql`, `12-alerta-uif.sql` | MODIFICAR | Idempotentes |
| `src/server.js` | MODIFICAR | `crearApagado(...)` inyectable, `main()` solo si `require.main === module` |
| `src/modules/registrar-deposito/reconciliacion.js` | MODIFICAR | `detener()` asíncrono que espera el ciclo en curso |
| `src/core/tareas/limpiarClaves.js` | MODIFICAR | `detener()` nuevo, que espera la limpieza en curso |
| `src/config.js` · `.env.example` | MODIFICAR | `APAGADO_TIMEOUT_MS` → `config.apagadoTimeoutMs` (def. 10000) |
| `package.json` | MODIFICAR | Script `"migrar": "node scripts/migrar.js"` |
| `Dockerfile` | MODIFICAR | `COPY scripts/ ./scripts/` y `COPY db/ ./db/` |

No escribí `tests/integration/ci-cd/migrar.test.js` ni `tests/unit/ci-cd/apagado.test.js` (son del tester).

## Reglas

- **CI-R01** · `on: pull_request` (todas las ramas) + `push: branches: [main]`. `verificar`: servicio `postgres:16` con healthcheck, `actions/setup-node` con Node 22, `npm ci`, `bash init.sh` (completo). Variables: `DATABASE_URL_TEST=postgres://deposito:deposito@localhost:5432/deposito_test` y `LOG_LEVEL=silent`; el resto lo pone `tests/setup/env.js`, y `globalSetup.js` genera las claves JWT de prueba en `tests/.tmp/` y crea la BD `deposito_test` (se conecta a `/postgres`). `publicar` tiene `needs: verificar`: si falla, no se publica.
- **CI-R02** · `publicar` con `if: github.event_name == 'push' && github.ref == 'refs/heads/main'`. Usa `docker/build-push-action` con el `Dockerfile` del repo, `IMAGEN=ghcr.io/abigaildurand/deposito-service` (en minúsculas), tags `${GITHUB_SHA::7}` y `main`, y la etiqueta `org.opencontainers.image.source=${{ github.server_url }}/${{ github.repository }}` (calculada, no escrita). También añadí `org.opencontainers.image.revision` = SHA completo.
- **CI-R03** · `docker/login-action` con `secrets.GITHUB_TOKEN`. `permissions: contents: read` a nivel de workflow; solo `publicar` añade `packages: write`. Sin AWS ni credenciales de la nube.
- **CI-R04** · `avisar` (`needs: publicar`): construye el JSON de §5 con `jq` (`event_type: "servicio-actualizado"`, `client_payload: {servicio, imagen, tag, commit}`) y hace `gh api --method POST repos/abigailDurand/Deposito-integrador-/dispatches --input -` con `GH_TOKEN=${{ secrets.ORQUESTADOR_TOKEN }}`. Si está vacío: `::warning::` y `exit 0`.
- **CI-R05** · No hay secretos ni URLs reales. Las únicas credenciales son las desechables del contenedor Postgres de CI (las mismas de `docker-compose.yml` y del valor por defecto de `tests/setup/env.js`). Los tokens solo van por `env:`, sin `echo`. `gh api --silent` no imprime la respuesta. `persist-credentials: false` en los checkout.
- **CI-R06** · Cada `verificar` tiene su propio contenedor `services.postgres`. `concurrency: group: ${{ github.workflow }}-${{ github.ref }}`, `cancel-in-progress: ${{ github.ref == 'refs/heads/main' }}`: en `main` cancela la ejecución anterior (también su publicación); en los PR no cancela nada.
- **CI-R07** · `migrar()`: `pool.connect()` → `BEGIN` → `SELECT pg_advisory_xact_lock(hashtext($1))` (clave `deposito-service:migrar`, con parámetro) → cada `db/*.sql` por orden alfabético → `COMMIT`. Ante cualquier error: `ROLLBACK`, se relanza con el nombre del archivo; `main()` registra `logger.error` y pone `process.exitCode = 1`. Si todo va bien, sale con 0. Siempre hace `pool.end()`.
- **CI-R08** · `CREATE TABLE IF NOT EXISTS` (7 tablas), `CREATE INDEX IF NOT EXISTS` (4), `CREATE OR REPLACE FUNCTION bloquear_cambios_auditoria`, `DROP TRIGGER IF EXISTS auditoria_inmutable ON auditoria_depositos` antes de `CREATE TRIGGER`, `ON CONFLICT DO NOTHING` en los INSERT de `limites_canal` y `tipos_cambio`, y `ALTER TABLE depositos ADD COLUMN IF NOT EXISTS titular_id VARCHAR(100)`. No cambié tipos, restricciones ni el orden de las columnas.
- **CI-R09** · `globalSetup` (DROP SCHEMA + aplicar `db/*.sql`) y `docker-entrypoint-initdb.d` siguen leyendo los mismos archivos. No hay otro juego de SQL. `bash init.sh` completo en verde; aplicar con `psql -v ON_ERROR_STOP=1` sobre una BD vacía (que es lo que hace el entrypoint) funciona.
- **CI-R10** · `main()` registra `SIGTERM`/`SIGINT` → `apagar(senal)`. `apagar` hace `logger.info` y, en paralelo, `server.close` (deja de aceptar conexiones y resuelve cuando no queda ninguna) y `detener()` de `reconciliacion` y `limpiarClaves`. Después hace `pool.end()`, `logger.info` y `salir(0)`. Para que una conexión keep-alive que acaba de responder no retrase el cierre hasta el `keepAliveTimeout`, mientras se cierra se llama a `closeIdleConnections()` cada 50 ms. Las conexiones activas no se cortan.
- **CI-R11** · El `setTimeout(timeoutMs)` (con `unref`) compite con el trabajo (`Promise.race`). Si vence: `logger.error` y `salir(1)`. `timeoutMs = config.apagadoTimeoutMs` (`APAGADO_TIMEOUT_MS`, def. `10000`).
- **CI-R12** · `apagar` guarda la promesa del primer apagado. Una segunda señal registra `logger.info` ("ya en curso") y devuelve la misma promesa sin repetir nada. `detener()` sin `iniciar()` en las dos tareas: `clearInterval` solo si hay temporizador y espera solo si hay trabajo en curso. Resuelve sin fallar.
- **PIP-R12 (se mantiene)** · `iniciar()` de `server.js` no cambia: `crearApp` → `limpiarClaves.iniciar()` → `reconciliacion.iniciar()` → `listen`. Si el arranque falla, `logger.fatal` y `exitCode = 1`, como antes.
- **PRY-R05** · En `src/core/` solo toqué `tareas/limpiarClaves.js`, que el §2 autoriza.
- **PRY-R09** · `migrar.js` no lee el entorno: usa `pool` de `src/core/db` (es decir, `config.js`).

## Decisiones (para el tester y el revisor)

- **Interfaz testeable de `server.js`:** `module.exports = { iniciar, crearApagado, main }`. `crearApagado({ server, tareas, pool, logger, timeoutMs, salir })` devuelve `apagar(senal)`, que devuelve una promesa que se resuelve cuando ya se llamó a `salir(0|1)`. `server` necesita `close(cb)` (`closeIdleConnections` es opcional) y cada tarea necesita `detener()` (promesa). Al ejecutar `node src/server.js` el comportamiento es el mismo: `main()` solo corre si `require.main === module`, y `salir = process.exit`. Si algo falla durante el apagado (p. ej. `pool.end` rechaza): `logger.error` y `salir(1)`; la spec no lo define y elegí la opción conservadora. Si `server.close` da `ERR_SERVER_NOT_RUNNING`, se trata como ya cerrado.
- **`migrar.js` testeable:** `module.exports = { migrar, archivosSql, CLAVE_BLOQUEO }`. `migrar({ pool, dir, logger })` acepta cualquier `pg.Pool` y una carpeta de SQL (sirve para CI-T04 con un `.sql` roto) y devuelve la lista de archivos aplicados. Al ejecutarse como proceso, el código de salida es 0 o 1.
- **Consecuencia de reutilizar `src/core/db` (§6 lo permite):** `migrar` carga `config.js` completo, así que exige las mismas variables obligatorias que el servicio (`JWT_PUBLIC_KEY`, `BILLETERA_*`…). El Job de migración del integrador debe usar el mismo ConfigMap/Secret que el Deployment. Si faltan variables, sale con código 1 y lo indica en stderr (solo nombres de variables).
- **Bloqueos de tabla:** `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` toma un `ACCESS EXCLUSIVE` breve sobre `depositos` aunque no haga nada, y el lock dura hasta el `COMMIT`. La migración entera tarda unos 15 ms en local; queda anotado para el rolling update.
- **`limpiarClaves.iniciar()`** sigue creando un `setInterval` en cada llamada, como espera la prueba IDE-R09 que lo llama en dos tests. Ahora guarda el temporizador y limpia el anterior. `reconciliacion.ciclo` pasó de un booleano a una promesa (`cicloEnCurso`); sigue sin solapar ciclos ni lanzar errores.
- **Actions fijadas por SHA de commit** (resueltos con `gh api` a partir de las últimas releases): checkout v7.0.1, setup-node v7.1.0, login-action v4.8.0, setup-buildx-action v4.4.1, build-push-action v7.4.0.
- **Dockerfile:** copia `scripts/` completo, como dice el §2 (también entran `generar-claves-dev.js` y `generar-token.js`, inofensivos: no hay claves en la imagen).

## Verificación manual

- `actionlint` (imagen `rhysd/actionlint:latest` en docker) sobre `.github/workflows/ci.yml`: **0 errores**.
- `node -e "require(...)"` de `scripts/migrar`, `src/server`, `limpiarClaves`, `reconciliacion`: cargan; `config.apagadoTimeoutMs === 10000`.
- `npm run migrar` **dos veces** contra la BD de docker compose (`DATABASE_URL` de `.env`): exit 0 ambas. `pg_dump -s` antes y después es idéntico salvo los tokens aleatorios `\restrict`; los conteos de filas no cambian (depositos 0, limites_canal 6, tipos_cambio 1, auditoria 0). Nota: el `.env` local no tiene `BILLETERA_USD_URL` (no está actualizado a v1.2), así que lo pasé en línea. No toqué `.env`.
- SQL viejo (HEAD) en una BD vacía frente al SQL nuevo aplicado dos veces en otra: `pg_dump` (esquema y datos) **idénticos**.
- Base sin `titular_id` y con 1 fila → `migrar` exit 0; la columna existe y la fila se conserva.
- Carpeta con un `99-roto.sql` → error `db/99-roto.sql: syntax error…`; 0 tablas tras el rollback.
- 3 `migrar` simultáneos (2 pools) sobre una BD vacía → los 3 terminan bien; 7 tablas y 6 límites (sin duplicados).
- Apagado (script de prueba con `crearApagado` y un Express real, petición keep-alive de 1 s en curso): una conexión nueva da `ECONNREFUSED`, la petición en curso responde 200, después `pool.end`, `logger.info` y `salir(0)` (unos 30 ms después de la respuesta). La segunda señal no repite el apagado. Antes del barrido de conexiones ociosas, el mismo escenario agotaba el timeout (`salir(1)`); por eso se añadió. No probé señales reales con `node src/server.js` (Windows no entrega `SIGTERM` de forma fiable).
- `docker build`: OK; la imagen contiene `/app/scripts/migrar.js` y `/app/db/*.sql`.

## `bash init.sh` (completo)

```
[OK]    specs-v2/ intacto (16 archivos)
[OK]    feature_list.json válido (14 features: pending=0 in_progress=1 done=13 blocked=0 reabierta=0)
[OK]    SPEC-00..SPEC-12: todos sus casos tienen prueba
[WARN]  SPEC-13 (en curso) aún sin prueba: CI-T01, CI-T02, CI-T03, CI-T04, CI-T05, CI-T06, CI-T07
[OK]    Alcance de archivos correcto (195 archivos revisados)
Test Suites: 23 passed, 23 total
Tests:       494 passed, 494 total
[OK]    Todas las pruebas en verde (unitarias + integración)
```

`bash init.sh --rapido`: 12 suites, 263 pruebas, en verde.

## Pruebas obsoletas

Ninguna se rompió. Notas para el tester:
- `tests/unit/registrar-deposito/service.test.js` (RD-R13) llama a `reconciliacion.detener()` sin `await`; sigue funcionando porque, sin ciclo en curso, la promesa resuelve sola. El tester puede añadir `await`.
- Las pruebas IDE-R09 de `tests/integration/idempotencia/idempotencia.test.js` no llaman a `limpiarClaves.detener()`. Con `setInterval` simulado no importa.
