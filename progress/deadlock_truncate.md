# Deadlock intermitente en `limpiar()` (`TRUNCATE`), 2026-11-09

Tarea de mantenimiento de pruebas (no es una feature; `feature_list.json` sin cambios).
Archivo modificado: **solo `tests/helpers/db.js`**. No se tocó `src/`, `db/`, `jest.config.js` ni otras pruebas.

## 1. Reproducción

| Método | Antes del cambio | Después |
|---|---|---|
| `npx jest --selectProjects integration --runInBand`, 5 corridas seguidas | 0/5 con deadlock | — |
| `npm test` (lo que corre `init.sh`, con `--coverage`), 6 corridas seguidas | 0/6 con deadlock (494/494) | — |
| Prueba temporal `tests/integration/zz-repro/repro.test.js` (POST real `crearApp` + nock y `limpiar()` en cuanto supertest devuelve la respuesta, 200 veces) | **13/200** y **2/200** iteraciones con `deadlock detected` | **0/600** (3 × 200) |
| Igual, solo con el orden hijas-primero (sin la espera) | — | **0/300** |
| Script `pg` con dos sesiones que fuerza la ventana (ver §2) | deadlock en 1/1 | sin deadlock en 1/1 |
| `bash init.sh` completo, 6 corridas seguidas | — | **6/6 en verde, 494/494**, 0 `deadlock detected` |

En el equipo descargado, la suite completa no lo reprodujo (0 de 11 corridas): la ventana es de microsegundos y
depende de la carga. Las fallas que vieron los agentes (≈ 1 de 2 a 5 corridas) se dieron con la máquina cargada
(otros agentes y worktrees trabajando). La prueba temporal sí lo reproduce siempre, en un 1-6 % de las iteraciones.
La prueba y el script se borraron del repo al terminar (copias en el scratchpad de la sesión: `repro.test.js`,
`repro.js`).

Diagnóstico con `ALTER SYSTEM SET log_lock_waits = on` (y `deadlock_timeout = 200ms` mientras se reproducía) en el
contenedor `chalenge-db-1`. Al terminar se restauraron los valores por defecto (`RESET`, `log_lock_waits = off`, `1s`).

## 2. Causa raíz (con evidencia)

**Un INSERT de auditoría (AUD-R03, `res.on('finish')`, `src/core/middlewares/auditoria.js:76`) que sigue en curso
cuando la prueba siguiente llama a `limpiar()`, sumado a que el `TRUNCATE` bloquea primero `depositos` (madre) y
después `auditoria_depositos` (hija).**

- El INSERT en `auditoria_depositos` con `deposito_id` no nulo toma `RowExclusiveLock` en `auditoria_depositos` y
  después, en el chequeo de la FK, `RowShareLock` en `depositos`.
- `TRUNCATE` toma `AccessExclusiveLock` tabla por tabla en el orden de la lista. La lista salía de `pg_tables`, sin
  `ORDER BY`. En este esquema empieza por `depositos` y **cambia entre corridas**: cada `TRUNCATE` reescribe las filas
  de `pg_class` (relfilenode nuevo), así que el orden cambia. En los logs aparecieron, por ejemplo,
  `depositos, tipos_cambio, alertas_uif, …` y `"conversiones_deposito", "depositos", "auditoria_depositos", …`.
- Si el `TRUNCATE` toma `depositos` justo entre los dos bloqueos del INSERT, queda un ciclo. Log de PostgreSQL
  (prueba temporal, orden antiguo):

  ```
  ERROR:  deadlock detected
  DETAIL:  Process 3621 waits for AccessExclusiveLock on relation 85996 …; blocked by process 3630.
           Process 3630 waits for RowShareLock on relation 85980 …; blocked by process 3621.
           Process 3621: TRUNCATE "conversiones_deposito", "tipos_cambio", "claves_idempotencia", "depositos", "alertas_uif", "auditoria_depositos" CASCADE
           Process 3630: INSERT INTO auditoria_depositos …
  ```
  Las 13 fallas de la primera corrida de la prueba temporal fueron este mismo par: INSERT de auditoría frente a
  `TRUNCATE`. Unas veces PostgreSQL abortó el INSERT y otras el `TRUNCATE` (es el caso que ven las pruebas en
  `tests/helpers/db.js:17`).
- Por qué aparece en `idempotencia.test.js` (IDE-T04, IDE-T07) y en `pipeline-y-cargador` (PIP-R11) y `dominio`:
  esos archivos (y `auditoria.test.js`) no esperan a la auditoría antes de la siguiente limpieza. `registrar`, `consultar`, `historial`,
  `conversion`, `limites`, `alerta` y `seguridad` tienen su propio `esperarAuditoria()`, un sondeo con un límite de
  tiempo. En IDE-T04 la primera respuesta llega a los 2 s y su auditoría (con `deposito_id`) se escribe mientras
  arranca la prueba siguiente. "En cascada" significa que cada prueba que choca falla en su `beforeEach`.
- Mecanismo aislado (script con dos sesiones: A tiene `ROW EXCLUSIVE` en `auditoria_depositos`, B lanza el
  `TRUNCATE`, A inserta con FK). Con el orden antiguo: `INSERT: deadlock detected`. Con hijas primero: `INSERT ok`,
  `TRUNCATE ok`.

Candidatos descartados, con evidencia:
- **Archivos en paralelo:** `npm test` y `test:integration` usan `--runInBand` (`package.json`), así que dentro de una
  corrida los archivos van en serie. Sí hay un caso real aparte: dos `init.sh` a la vez contra la misma BD, como
  documenta `progress/review_02.md:130`. Eso no se puede arreglar en `tests/`: `init.sh` nunca debe correrse en
  paralelo.
- **Temporizadores `limpiarClaves` / `reconciliacion`:** en integración, `setInterval` está espiado con
  `mockImplementation` (`idempotencia.test.js:766,784`). `crearApp` no los arranca (PIP-R12) y la reconciliación de
  `registrar.test.js` se llama a mano. No aparecen en ningún deadlock del log.
- **nock con demora (IDE-T07, 6 s):** `afterEach` ya llama a `nock.abortPendingRequests()`. Tras el timeout de 5 s, el
  servidor no deja escrituras pendientes salvo la auditoría.
- **Contenedor `deposito-service`:** usa la BD `deposito`, no `deposito_test`. Los bloqueos son por BD.

`src/` no tiene ningún defecto: AUD-R03 exige escribir la auditoría después de responder y sin esperar. El problema
estaba en cómo limpiaban las pruebas.

## 3. Cambio (`tests/helpers/db.js`)

1. **Orden hijas-primero en el `TRUNCATE`** (`tablasHijasPrimero()`). El orden se calcula con las FKs de
   `pg_constraint` (orden topológico) y es estable entre corridas. Así el `TRUNCATE` y cualquier escritura en una hija
   que valida su FK bloquean en el mismo orden (hija → madre). El `TRUNCATE` solo espera a que el INSERT termine, y el
   ciclo ya no puede darse. Esto corrige la causa, aunque la auditoría siga en vuelo.
2. **Espera acotada a que no quede trabajo vivo** (`esperarInactividad()`, máximo 5 s). Antes de truncar se exigen dos
   lecturas seguidas sin actividad, separadas por 5 ms:
   - el pool de la app (`src/core/db`, el del mismo registro de módulos que la prueba) sin consultas en cola ni
     clientes prestados. Cubre la auditoría que todavía conecta o espera turno y aún no llegó a PostgreSQL;
   - `pg_stat_activity`: ninguna otra sesión de `deposito_test` con `state <> 'idle'`. Cubre los pools de
     `jest.isolateModules`.

   Además evita que la auditoría de una prueba se cuele en la siguiente después del `TRUNCATE`.
3. Sin reintentos ni `lock_timeout`: no hacen falta y podrían ocultar otra causa. No se relajó ninguna aserción. Los
   `esperarAuditoria()` de cada archivo se dejan como están (redundantes, pero inofensivos).

Costo: unos 7 s más por corrida completa (`Time` de jest: ≈ 98 s antes, ≈ 105.5 s después).

## 4. Verificación

`bash init.sh` completo, 6 corridas seguidas después del cambio:

```
init 1 exit 0 deadlocks=0 Tests: 494 passed, 494 total Time: 105.431 s
init 2 exit 0 deadlocks=0 Tests: 494 passed, 494 total Time: 105.941 s
init 3 exit 0 deadlocks=0 Tests: 494 passed, 494 total Time: 105.592 s
init 4 exit 0 deadlocks=0 Tests: 494 passed, 494 total Time: 106.019 s
init 5 exit 0 deadlocks=0 Tests: 494 passed, 494 total Time: 105.086 s
init 6 exit 0 deadlocks=0 Tests: 494 passed, 494 total Time: 105.541 s
```

Las 6 terminaron con "Entorno listo". En el log de PostgreSQL de ese intervalo no hay ningún `deadlock detected` ni
`still waiting`.

## 5. Pendiente (fuera de `tests/`)

- No correr dos `init.sh` / `npm test` a la vez contra `deposito_test` (agentes o worktrees en paralelo):
  `globalSetup` hace `DROP SCHEMA` y las limpiezas se pisan. Si se quiere blindar, habría que usar una BD por
  worktree (`DATABASE_URL_TEST`) o un candado en `init.sh`. Lo decide el leader o el humano.
