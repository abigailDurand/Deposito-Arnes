# impl_00 — SPEC-00 proyecto (RETRABAJO: integración Billetera USD)

> Retrabajo de la feature 0 (`retrabajo: true`). Sustituye al informe anterior de SPEC-00.
> Alcance: solo las variables `BILLETERA_USD_URL` / `BILLETERA_USD_TOKEN` (SPEC-00 §2 y §5).

## ATENCIÓN: pruebas obsoletas (requiere tester)

`tests/core/proyecto.test.js` (del tester, no editable por desarrolladorback) define `envBase()`
con las 4 obligatorias antiguas. Al ser `BILLETERA_USD_URL` obligatoria (§5), **5 pruebas de ese
archivo fallan** con `Faltan variables de entorno obligatorias: BILLETERA_USD_URL`
(las que llaman `cargarConfig(envBase())`: "valores por defecto de §5", "UIF_UMBRAL_*",
"JWT_PUBLIC_KEY acepta \n", "valores explícitos", "variable entera inválida").
Resultado observado por el hook del arnés tras la edición: `1 failed, 11 passed` suites,
`5 failed, 165 passed` tests (unit). El resto de suites pasa.

Corrección necesaria (tester, AGENTS.md §5 "actualiza pruebas obsoletas"): añadir
`BILLETERA_USD_URL` a `envBase()`, añadir `'BILLETERA_USD_URL'` al `test.each` de obligatorias y,
opcionalmente, comprobar `c.billeteraUsd` (`token: null` sin `BILLETERA_USD_TOKEN`).
Por tanto SPEC-00 necesita **tester** antes del revisor (el plan actual decía dev → revisor).

## Archivos modificados (todos en SPEC-00 §2)

- `src/config.js` — `BILLETERA_USD_URL` en `OBLIGATORIAS`; nuevo bloque
  `billeteraUsd: { url, token }` (`token` = `null` si `BILLETERA_USD_TOKEN` falta o está vacío).
  `BILLETERA_TIMEOUT_MS` sigue en `billetera.timeoutMs` y aplica a ambas (§5, INT-R03).
- `.env.example` — `BILLETERA_USD_URL=http://localhost:4000` (obligatoria) y
  `BILLETERA_USD_TOKEN=` (opcional, INT-R02) con comentarios; nota de que el timeout aplica a ambas.
- `docker-compose.yml` — `deposito-service` recibe `BILLETERA_USD_URL: http://billetera-mock:4000`
  y `BILLETERA_USD_TOKEN: ${BILLETERA_USD_TOKEN:-}`.
- `tests/setup/env.js` — `BILLETERA_USD_URL = 'http://billetera-usd.test'` (resuelta solo con nock)
  y `delete process.env.BILLETERA_USD_TOKEN` (por defecto sin token; INT-T15 puede asignarlo).

No se tocó `src/core/clients/billeteraClient.js` (SPEC-02).

## Reglas

- PRY-R09: las URLs/tokens nuevas solo se leen en `config.js`; `.env.example` y compose las declaran.
- §5 obligatoria: sin `BILLETERA_USD_URL` el `require` de `config.js` lanza
  `Faltan variables de entorno obligatorias: BILLETERA_USD_URL` (verificado con node).
- §5 opcional / INT-R02: sin `BILLETERA_USD_TOKEN` → `config.billeteraUsd.token === null` (verificado).
- §2 docker-compose: `BILLETERA_URL` y `BILLETERA_USD_URL` apuntan a `billetera-mock`.
- §2 tests/setup/env.js: asigna `BILLETERA_USD_URL` de prueba.
- PRY-R01..R08, R10..R12: sin cambios de capas, SQL, dinero ni logs.

## Decisiones

- Clave `billeteraUsd` separada de `billetera` para no cambiar la forma de `config.billetera`
  (la consume el `billeteraClient.js` actual y la prueba "valores por defecto" con `toEqual`).
- Dominio de prueba distinto (`billetera-usd.test`) para que INT-T14 pueda distinguir con nock
  qué billetera se llama.

## Verificación

- `node -e "require('./src/config.js')"` con las 5 obligatorias → carga; `billeteraUsd` = `{ url, token: null }`.
- Sin `BILLETERA_USD_URL` → error con el nombre de la variable.
- `bash init.sh` **no ejecutado**: el humano indicó detener la ejecución del arnés y trasladarla a
  otro agente. Ver resultado del hook unitario arriba (5 fallos esperados en `proyecto.test.js`).

---

## Retrabajo v1.3, 2026-11-09

> SPEC-00 1.2 → 1.3 (solo §5: variables de entorno). Feature 0 `in_progress`, `retrabajo: true`.
> Solo configuración; la lógica OAuth (INT-R13, SPEC-02) y la reconciliación (RD-R13, SPEC-07) no se implementan aquí.

### Archivos modificados (todos en SPEC-00 §2)

- `src/config.js`
  - Eliminada la lectura de `BILLETERA_USD_TOKEN` (y la clave `billeteraUsd.token`).
  - `billeteraUsd: { url, tokenUrl, clientId, clientSecret }`. `tokenUrl` = `null` si `BILLETERA_USD_TOKEN_URL` falta o está vacía.
  - Nueva lista `OBLIGATORIAS_OAUTH_USD` (`BILLETERA_USD_CLIENT_ID`, `BILLETERA_USD_CLIENT_SECRET`): se exigen solo si hay
    `BILLETERA_USD_TOKEN_URL`; si faltan, el mismo error de arranque `Faltan variables de entorno obligatorias: ...`.
  - Nuevo bloque `reconciliacion: { intervaloMs, antiguedadMs, alertaMs }` con `entero()` (defaults 30000 / 10000 / 3600000;
    valor no entero → error de arranque, igual que el resto de enteros).
- `.env.example` — fuera `BILLETERA_USD_TOKEN=`; entran `BILLETERA_USD_TOKEN_URL=` (opcional, Q7; URL real [POR ACORDAR], Q9),
  `BILLETERA_USD_CLIENT_ID=` y `BILLETERA_USD_CLIENT_SECRET=` vacías (aviso de que el secreto nunca va al repo ni a imágenes)
  y las tres `RECONCILIACION_*` con sus defaults.
- `docker-compose.yml` — fuera `BILLETERA_USD_TOKEN`; `deposito-service` recibe `BILLETERA_USD_TOKEN_URL`, `BILLETERA_USD_CLIENT_ID`,
  `BILLETERA_USD_CLIENT_SECRET` como `${VAR:-}` (vacías por defecto, el secreto solo desde el entorno/`.env` del host) y las
  tres `RECONCILIACION_*` como `${VAR:-<default>}`.
- `tests/setup/env.js` — `delete` de `BILLETERA_USD_TOKEN_URL`, `BILLETERA_USD_CLIENT_ID`, `BILLETERA_USD_CLIENT_SECRET`
  (por defecto sin OAuth, transición Q7) en lugar de `delete BILLETERA_USD_TOKEN`. `RECONCILIACION_*` sin asignar: toman los defaults.

No se tocaron `package.json`, `Dockerfile`, `.gitignore`, `jest.config.js`, `logger.js`, `globalSetup.js`, `tests/helpers/db.js` (sin cambios en v1.3).

### Reglas

- §5 `BILLETERA_USD_TOKEN_URL` opcional: ausente/vacía → `tokenUrl: null`, `clientId: null`, `clientSecret: null` (verificado con node).
- §5 `CLIENT_ID` / `CLIENT_SECRET` obligatorias si hay `TOKEN_URL`: con `TOKEN_URL` y sin ellas → `Faltan variables de entorno
  obligatorias: BILLETERA_USD_CLIENT_ID, BILLETERA_USD_CLIENT_SECRET` (verificado). Sin `TOKEN_URL` se ignoran (→ `null`).
- §5 "el secreto nunca en imágenes ni en el repositorio": `.env.example` y compose lo dejan vacío; el `Dockerfile` no copia `.env`.
- §5 "Sustituyen a `BILLETERA_USD_TOKEN`": ya no se lee en `config.js` ni aparece en `.env.example` / compose.
- §5 `RECONCILIACION_*`: defaults 30000 / 10000 / 3600000 (verificado); `'1h'` → error `debe ser un entero`.
- PRY-R09: las nuevas variables solo se leen en `src/config.js`.
- PRY-R10: config no loguea nada; el secreto no se escribe en logs (la parte de logs del cliente OAuth es de SPEC-02).
- PRY-R01..R08, R11, R12: sin cambios de capas, SQL, dinero; `[POR ACORDAR]` (Q9) sin URL inventada.

### Decisiones

- Nombres de claves de config no fijados por la spec: `billeteraUsd.tokenUrl/clientId/clientSecret` y
  `reconciliacion.intervaloMs/antiguedadMs/alertaMs` (mismo estilo camelCase + `Ms` que `billetera.timeoutMs`).
  SPEC-02 y SPEC-07 deben consumir esos nombres.
- `clientId`/`clientSecret` se fuerzan a `null` cuando no hay `tokenUrl`, para que SPEC-02 tenga una sola condición (`tokenUrl`).
- Se eliminó `billeteraUsd.token` en vez de dejarlo como `null`: la variable ya no existe en la spec.

### Usos de `BILLETERA_USD_TOKEN` fuera de la §2 de SPEC-00 (no tocados)

- `src/core/clients/billeteraClient.js:42-53` (SPEC-02): `cabecerasUsd` lee `config.billeteraUsd.token`, que ahora es
  `undefined` → nunca envía `Authorization` a Billetera USD. En tiempo de ejecución equivale al modo transición (sin
  `TOKEN_URL`), no lanza error; pero la autenticación USD queda desactivada hasta que SPEC-02 implemente INT-R13.

### Pruebas obsoletas (requiere tester)

`bash init.sh --rapido`: **3 fallos, 198 pasan** (201), todos por la variable eliminada:

1. `tests/core/proyecto.test.js:89-97` — "BILLETERA_USD_TOKEN opcional ... (INT-R02)": espera `billeteraUsd` = `{ url, token: null }`.
   Sustituir por prueba de `tokenUrl/clientId/clientSecret` (`null` sin `TOKEN_URL`; error si hay `TOKEN_URL` sin credenciales;
   valores con las tres) y de `reconciliacion` (defaults y entero inválido). Tester de SPEC-00.
2. `tests/unit/integraciones/billeteraClient.test.js:549` — INT-T15 "sin BILLETERA_USD_TOKEN": `expect(config.billeteraUsd.token).toBeNull()`
   (ahora `undefined`). Tester de SPEC-02 (INT-T15 ahora habla de `BILLETERA_USD_TOKEN_URL`).
3. `tests/unit/integraciones/billeteraClient.test.js:563` — INT-T15 "con BILLETERA_USD_TOKEN": `clienteCon({ BILLETERA_USD_TOKEN })`
   espera `Bearer token-usd-de-prueba`. Obsoleta por INT-R13 (token OAuth); requiere desarrolladorback + tester de SPEC-02.

Otras referencias textuales a `BILLETERA_USD_TOKEN` (sin efecto en ejecución): comentario de `billeteraClient.js:42`,
`tests/reporte.md`, `progress/review_00.md`, `progress/review_02.md`.

### Verificación

- `node -e "require('./src/config.js')"` con las 5 obligatorias en el entorno → carga (`ok`).
- Casos manuales con `cargarConfig` (salida real):
  - base → `{ url: 'v', tokenUrl: null, clientId: null, clientSecret: null }` y `{ intervaloMs: 30000, antiguedadMs: 10000, alertaMs: 3600000 }`
  - `TOKEN_URL` sin credenciales → `Faltan variables de entorno obligatorias: BILLETERA_USD_CLIENT_ID, BILLETERA_USD_CLIENT_SECRET`
  - con las tres → `{ url: 'v', tokenUrl: 'http://tok', clientId: 'id', clientSecret: 's' }`
  - `RECONCILIACION_ALERTA_MS=1h` → `Variable de entorno RECONCILIACION_ALERTA_MS inválida: debe ser un entero (1h)`
- `bash init.sh --rapido`:
  ```
  [OK]    specs-v2/ intacto (15 archivos)
  [OK]    feature_list.json válido (13 features: pending=0 in_progress=1 done=5 blocked=0 reabierta=7)
  [OK]    SPEC-00: todos sus casos tienen prueba
  [WARN]  SPEC-01/02/07/08/11 (reabierta) casos sin prueba (esperado)
  [OK]    Alcance de archivos correcto (189 archivos revisados)
  Test Suites: 2 failed, 10 passed, 12 total
  Tests:       3 failed, 198 passed, 201 total
  [FAIL]  Hay pruebas unitarias rotas   ← las 3 obsoletas de arriba
  ```
