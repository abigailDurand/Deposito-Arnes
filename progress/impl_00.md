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
