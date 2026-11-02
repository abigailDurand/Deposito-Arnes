# Review — SPEC-02 integraciones

**Veredicto:** APROBADO CON OBSERVACIONES

**Revisor:** revisor · **Fecha:** 2026-10-30 · **Feature:** 2 (`integraciones`)

## Reglas

### Prioridad §6 (revisor)
- [x] **INT-R06** — `src/core/clients/billeteraClient.js:40-47` hace una única `http.request` por llamada; el `catch` transforma el error en `BILLETERA_NO_DISPONIBLE` sin repetir. `acreditar` (`:66-74`) no tiene bucle, ni interceptores (`grep interceptors|retry` sin resultados en `src/`), ni `axios-retry` en `package.json`. Las pruebas INT-T05 (`billeteraClient.test.js:171-207`) registran un segundo interceptor idéntico y comprueban que no se usa (400, 500 y timeout; en el timeout cuentan los eventos `request` = 1 tras un margen extra).
- [x] **URL de billetera solo en `billeteraClient.js` y `.env.example`** — `billeteraClient.js:13` no tiene literal: usa `config.billetera.url` (`src/config.js:44`, PRY-R09). Grep de `http://`, `:4000` y `billetera-mock` en todo el repo (sin `node_modules`/`coverage`):
  - `.env.example:26` `BILLETERA_URL=http://localhost:4000`. Permitido por §6.
  - `docker-compose.yml:31` `BILLETERA_URL: http://billetera-mock:4000` y `:21` el puerto `4000:4000`. Aceptable: SPEC-00 §2 define el compose con el servicio `billetera-mock` (SPEC-02), y SPEC-02 §2 fija el mock en el puerto 4000. Es la variable de entorno que inyecta el compose, no una URL en el código. Además el archivo es de SPEC-00 y SPEC-02 no lo modificó.
  - `tests/setup/env.js:21` y `tests/core/proyecto.test.js:12,71` usan `http://billetera.test`: es un host ficticio de pruebas que pertenece a SPEC-00 (aprobado en review_00), no apunta a billetera y nock lo intercepta. Aceptable.
  - `mocks/billetera/server.js:6` `PUERTO = 4000`: es un número de puerto, no una URL; lo define §2.
  - `tests/helpers/billetera.js:185` intercepta `config.billetera.url` sin escribir ninguna URL.
  Cambiar al billetera-service real solo requiere `BILLETERA_URL` y `BILLETERA_TOKEN` (criterio de aceptación cumplido).

### Resto de reglas INT
- [x] INT-R01 — solo HTTP con axios; ningún acceso a BD ajena.
- [x] INT-R02 — `billeteraClient.js:21-26` `Authorization: Bearer ${config.billetera.token}` + `X-Correlation-Id` en ambas llamadas (`:42`). Lo comprueba INT-T06 (también en respuestas 404/500).
- [x] INT-R03 — `axios.create({ timeout: config.billetera.timeoutMs })` (`:12-16`), compartido por las dos funciones. Probado con `BILLETERA_TIMEOUT_MS=100` aislado.
- [x] INT-R04 — `:55-60` 404 → `null`; 200 → `{ numero, estado, moneda, titularId }` (solo esos campos); otro status, cuerpo no objeto, timeout o error de red → `ErrorApp('BILLETERA_NO_DISPONIBLE')`.
- [x] INT-R05 — `:72` 200/201/409 → `undefined`; cualquier otro → `BILLETERA_NO_DISPONIBLE` (`:73`).
- [x] INT-R07 — `:70` `monto: new Decimal(monto).toFixed(2)`, `concepto: CONCEPTO` (`'DEPOSITO'`, `:18`). Probado con `Decimal(150)` → `"150.00"`, `"0.01"` y `Decimal("10.5")` → `"10.50"`.
- [x] INT-R08 — nada llama a usuario-service; los tokens se firman localmente.
- [x] INT-R09 — `mocks/billetera/server.js:23,53-57` `Set` de `depositoId`; repetir → 409. Verificado a mano (ver abajo).

### Reglas de proyecto
- [x] PRY-R03 — solo `src/core/clients/` hace HTTP hacia otro servicio.
- [x] PRY-R06/R07 — sin `Number(`/`parseFloat` en `src/`, `mocks/`, `scripts/`, `tests/helpers/`.
- [x] PRY-R09 — token y URL solo vía `config.js`. `scripts/generar-token.js:24-26` lee `iss`/`aud` de `config`.
- [x] PRY-R10 — `billeteraClient.js:33-36` registra `enmascararCuenta(numero)` y nunca el token ni los headers.
- [x] PRY-R11 — mock fiel al contrato propuesto de §5 [POR ACORDAR]; usa solo los datos de §4.
- [x] PRY-R12 — `specs-v2/` intacto (hash OK).
- [x] Sin `console.log` (el mock usa `process.stdout.write` para un único mensaje de arranque).

### Archivos y nombres de §2
- [x] `billeteraClient.js` exporta `consultarCuenta(numero, correlationId)` y `acreditar(datos, correlationId)`.
- [x] `tests/helpers/billetera.js` exporta exactamente `cuentaActiva`, `cuentaNoExiste`, `consultaFalla`, `acreditaOk`, `acreditaFalla`, `acreditaLento`, `acreditaYaExiste` (+ `CUENTAS`).
- [x] `tests/helpers/tokens.js` — `token(usuario, { exp, aud, clave, alg })` firma con `tests/.tmp/privada.pem` (`:19`). Verificado con `tests/.tmp/publica.pem`: el token válido pasa `jwt.verify` (RS256, `iss=usuario-service`, `aud=banco-api`, `roles=["AGENTE"]`); `exp:1` → `TokenExpiredError`; `aud:'otro'` → `audience invalid`; `alg:'none'` → `signature is required`.
- [x] Los scripts no imprimen la clave privada: `generar-claves-dev.js:20` solo la escribe a `.dev-keys/privada.pem` (modo 0600) y en stdout imprime la pública (`:32-33`); `generar-token.js:47` imprime solo el token firmado. `.dev-keys/` y `tests/.tmp/` están en `.gitignore`.
- [x] El mock (`server.js` + `Dockerfile`, `express@4.21.2` exacto, puerto 4000) respeta §5.

## Verificación manual del mock (arrastre de SPEC-00)

`docker compose up -d --build db billetera-mock`: la imagen se construye y los dos servicios arrancan (`db` healthy). curl:

```
GET  0011-0123-456789            → 200 {"numero":"0011-0123-456789","estado":"ACTIVA","moneda":"PEN","titularId":"usr-cliente-1"}
GET  0011-0123-000002            → 200 ... "estado":"ACTIVA","moneda":"USD","titularId":"usr-cliente-2"
GET  0011-0123-000003            → 200 ... "estado":"BLOQUEADA","moneda":"PEN","titularId":"usr-cliente-1"
GET  0011-0123-999999            → 200 ... "estado":"ACTIVA","moneda":"PEN","titularId":null
GET  0000-0000-000000            → 404
POST 0011-0123-456789/creditos   → 201 (0.01 s)
POST mismo depositoId            → 409  (INT-R09)
POST 0011-0123-999999/creditos   → 500  (cuenta especial §4)
POST 0011-0123-888888/creditos   → 201 en 6.005 s (cuenta especial §4)
POST cuenta inexistente          → 404
POST body {}                     → 400
```

Al terminar: `docker compose stop billetera-mock`; solo `db` queda arriba (healthy).

**Pendiente para el revisor de SPEC-06:** `deposito-service` todavía no puede arrancar (su `src/server.js` llega en SPEC-06). Este revisor debe correr `docker compose up --build` con los 3 servicios y comprobar `GET /health` (criterio de SPEC-00). Esto no es motivo de rechazo en SPEC-02.

## Casos de prueba
- [x] INT-T01 … INT-T07 (7/7 reales, en `tests/unit/integraciones/billeteraClient.test.js`). Comprueban valores concretos: cuerpo exacto, `null`, `codigo`/`status` 502, número de peticiones, headers y body. Hay pruebas extra para INT-R04 (400, cuerpo no objeto, ECONNREFUSED), INT-R05 (200) e INT-R07 (montos límite).
- Ningún `test.todo` de SPEC-02.

## Checkpoints
- C1: [x]  C2: [x] (1 feature `in_progress`, dependencias 0 y 1 `done`; `current.md` describe la sesión)  C3: [x] (specs intactas, alcance OK con 76 archivos)  C4: [x]  C5: [x] (`src/core/` 98.41 % stmts, 91.66 % branch; `billeteraClient.js` 100 % líneas; reporte completo)

## Observaciones (no incumplen reglas de spec)
1. `tests/helpers/billetera.js:8-12` — `CUENTAS` no incluye las cuentas especiales `0011-0123-999999` y `0011-0123-888888`, así que `cuentaActiva('0011-0123-999999')` lanza error. Hoy esos casos se simulan con `acreditaFalla`/`acreditaLento` sobre cuentas normales, lo cual es válido. Si SPEC-07 quiere usar las cuentas especiales con nock, tendrá que tenerlo en cuenta.
2. `mocks/billetera/server.js:17-18` — §4 no define titular para las cuentas especiales y el mock devuelve `titularId: null` en vez de inventar uno (es correcto por PRY-R11/R12). Conviene llevarlo a la lista P1/P3 del README para acordarlo con el equipo de billetera.
3. `scripts/generar-token.js:30` hace `require('../tests/helpers/tokens')` para leer `USUARIOS`: un script de desarrollo depende de un helper de pruebas. Funciona y evita duplicar los usuarios de §4, pero el acoplamiento es poco habitual.
4. `billeteraClient.js:59-60` — un 200 con objeto sin los cuatro campos devuelve campos `undefined` en lugar de fallar. §5 no lo exige; se anota para cuando el contrato se acuerde.
5. `billeteraClient.js:45` — la rama `err.message` (error sin `code`) no tiene cobertura; solo afecta al detalle del log.

## Cambios requeridos
Ninguno.

## Salida de `bash init.sh`

Antes de marcar `done` (con PostgreSQL real arriba):

```
[OK]    specs-v2/ intacto (15 archivos)
[OK]    feature_list.json válido (13 features: pending=10 in_progress=1 done=2 blocked=0)
[OK]    SPEC-00: todos sus casos tienen prueba (todo: PRY-T01)
[OK]    SPEC-01: todos sus casos tienen prueba
[OK]    SPEC-02: todos sus casos tienen prueba
[OK]    Alcance de archivos correcto (76 archivos revisados)
PASS unit tests/unit/integraciones/billeteraClient.test.js
PASS unit tests/unit/dominio/errores.test.js
PASS unit tests/core/proyecto.test.js
PASS integration tests/integration/dominio/transaccion.test.js
PASS unit tests/unit/dominio/depositoMapper.test.js
 core/clients         |     100 |    92.85 |     100 |     100 |
  billeteraClient.js  |     100 |    92.85 |     100 |     100 | 45
Test Suites: 5 passed, 5 total
Tests:       1 todo, 60 passed, 61 total
[OK]    Todas las pruebas en verde (unitarias + integración)
[OK]    Entorno listo. Puedes empezar a trabajar.
EXIT=0
```

Después de marcar la feature 2 como `done`: ver la sección siguiente.

### Después de marcar la feature 2 `done`

```
[OK]    feature_list.json válido (13 features: pending=10 in_progress=0 done=3 blocked=0)
[OK]    SPEC-00: todos sus casos tienen prueba (todo: PRY-T01)
[OK]    SPEC-01: todos sus casos tienen prueba
[OK]    SPEC-02: todos sus casos tienen prueba
[OK]    Alcance de archivos correcto (77 archivos revisados)
Test Suites: 5 passed, 5 total
Tests:       1 todo, 60 passed, 61 total
[OK]    Todas las pruebas en verde (unitarias + integración)
[OK]    Entorno listo. Puedes empezar a trabajar.
EXIT=0
```
