# Implementación SPEC-02 — integraciones (feature 2)

**Agente:** desarrolladorback · **Fecha:** 2026-10-30 · **Estado:** `in_progress` (lista para el tester)

## Archivos creados (todos del §2 de SPEC-02)

- `src/core/clients/billeteraClient.js`: `consultarCuenta(numero, correlationId)`, `acreditar(datos, correlationId)`.
- `mocks/billetera/server.js`: mock Express en memoria, puerto 4000.
- `mocks/billetera/Dockerfile`: `node:22-alpine`, instala `express@4.21.2` exacto (el contexto de build del compose es `./mocks/billetera`, sin acceso al `package.json` raíz).
- `tests/helpers/billetera.js`: helpers nock `cuentaActiva`, `cuentaNoExiste`, `consultaFalla`, `acreditaOk`, `acreditaFalla`, `acreditaLento`, `acreditaYaExiste` (+ export `CUENTAS`).
- `tests/helpers/tokens.js`: `token(usuario, { exp, aud, clave, alg })` (+ export `USUARIOS`).
- `scripts/generar-claves-dev.js`: par RSA en `.dev-keys/` (`privada.pem`, `publica.pem`); imprime la línea `JWT_PUBLIC_KEY="..."` para el `.env`.
- `scripts/generar-token.js`: `node scripts/generar-token.js usr-agente-1`.

No se modificó ningún archivo fuera del §2 (`docker-compose.yml`, `src/config.js`, `tests/setup/*` intactos).
`tests/unit/integraciones/billeteraClient.test.js` es del tester: no se creó.
Solo `feature_list.json` (feature 2 → `in_progress`) y `progress/current.md` por protocolo.

## Reglas

- **INT-R01** · El cliente solo usa HTTP (axios); no toca ninguna BD ajena.
- **INT-R02** · `cabeceras()` añade `Authorization: Bearer <config.billetera.token>` y `X-Correlation-Id` en ambas llamadas (comprobado con nock: `Bearer token-de-prueba`, `abc`).
- **INT-R03** · `axios.create({ timeout: config.billetera.timeoutMs })` compartido por las dos llamadas.
- **INT-R04** · `consultarCuenta`: 200 → `{ numero, estado, moneda, titularId }` (solo esos campos); 404 → `null`; otro status, cuerpo no objeto, timeout o error de red → `ErrorApp('BILLETERA_NO_DISPONIBLE')`.
- **INT-R05** · `acreditar({ depositoId, cuenta, monto, moneda })`: 200/201/409 → `undefined`; cualquier otro status o timeout → `ErrorApp('BILLETERA_NO_DISPONIBLE')`.
- **INT-R06** · Una sola `http.request` por llamada, sin bucles ni interceptores de reintento (nock: 1 petición en 400, 500 y timeout).
- **INT-R07** · `monto: new Decimal(monto).toFixed(2)` (`Decimal(150)` → `"150.00"`); `concepto: 'DEPOSITO'` constante.
- **INT-R08** · Nada llama a usuario-service; los tokens se firman localmente (helper y script) y SPEC-03 los validará con la clave pública.
- **INT-R09** · El mock guarda los `depositoId` acreditados en un `Set`; repetir → 409.
- **BILLETERA_URL** · Solo `billeteraClient.js` llama a billetera, vía `config.billetera.url`. Los helpers nock interceptan `config.billetera.url` sin escribir URL. Los únicos literales de URL de billetera fuera del cliente pertenecen a SPEC-00: `.env.example`, `docker-compose.yml`, `tests/setup/env.js` y `tests/core/proyecto.test.js` (`http://billetera.test`). Aviso para el revisor, que por §6 solo espera `.env.example`.

## Decisiones

- **Mock (§4/§5):** datos de §4 literales. Cuentas especiales: `0011-0123-999999` → 500 al acreditar (no registra el `depositoId`); `0011-0123-888888` → espera 6 s y luego aplica la lógica normal (201/409). §4 no da titular a las cuentas especiales: el mock devuelve `titularId: null` en vez de inventar uno (en ellas solo pueden depositar AGENTE o CAJERO). Cuenta inexistente → 404; body sin `depositoId` o sin `monto` string → 400. §5 no define cuerpos para 201/409/404: el 201 devuelve el crédito recibido y el resto `{ mensaje }`. El mock no valida `Authorization` (autenticación entre servicios [POR ACORDAR]; §5 no define 401).
- **Helpers nock:** cada uno devuelve el scope de nock con `scope.peticiones` (`[{ headers, body }]`) para INT-T05/T06/T07. Número por defecto `0011-0123-456789`; uno fuera de §4 lanza error. `cuentaActiva(numero)` responde 200 con los datos reales de §4 (para `0011-0123-000003` devuelve `BLOQUEADA`, útil en RD-T06). `consultaFalla(numero, { status = 500, demora })` cubre 500 y timeout; `acreditaFalla(numero, { status = 500 })` cubre 400 y 500; `acreditaLento(numero, { demora = 6000 })` imita la cuenta lenta del mock (supera `BILLETERA_TIMEOUT_MS` = 5000 de `env.js`); `acreditaOk(numero, { status = 201 })` acepta también 200.
- **Tokens:** payload de §5 `{ sub, roles, iss, aud, exp }` con `noTimestamp` (sin `iat`, como en §5). `iss`/`aud` por defecto salen de `config.jwt`. `exp` en segundos epoch (por defecto ahora + 1 h); `clave` es un PEM privado (por defecto `tests/.tmp/privada.pem`); `alg: 'none'` arma a mano un token sin firma. Comprobado con `jwt.verify`: válido OK; `exp` pasado → `TokenExpiredError`; `aud` distinto, otra clave o `none` → `JsonWebTokenError`.
- **generar-token.js:** `iss`/`aud` vienen de `src/config.js` (PRY-R09). Como `config` exige las 4 variables obligatorias, el script carga `.env` con `process.loadEnvFile` si existe; sin `.env` termina con un mensaje claro (`cp .env.example .env`). Los roles salen de `USUARIOS` de `tests/helpers/tokens.js`, la única fuente de los usuarios de §4. Validez del token de desarrollo: 1 h. `generar-claves-dev.js` no sobrescribe un par ya existente.

## Verificación manual

- `node -e "require(...)"` del cliente y de los helpers: cargan OK.
- Script de humo con nock (fuera del repo): los casos INT-T01..T07 se comportan como pide §6. 200 → cuenta; 404 → `null`; 500/timeout → `BILLETERA_NO_DISPONIBLE`; 201/409 resuelven; 400/500/timeout → error con 1 sola petición; headers presentes; body con `"150.00"`.
- `docker compose build billetera-mock` y `docker compose up -d billetera-mock` funcionan con el compose existente (`express` 4.21.2 en la imagen). curl:
  ```
  GET  0011-0123-456789          → 200 {"numero":"0011-0123-456789","estado":"ACTIVA","moneda":"PEN","titularId":"usr-cliente-1"}
  GET  0011-0123-000003          → 200 ... "estado":"BLOQUEADA"
  GET  0000-0000-000000          → 404
  POST 0011-0123-456789/creditos → 201 ; mismo depositoId → 409
  POST 0011-0123-999999/creditos → 500
  POST 0011-0123-888888/creditos → 201 en 6.0 s
  POST .../creditos con {}       → 400
  ```
  Al terminar: mock detenido (`docker compose stop billetera-mock`) y `db` arriba (healthy).
- `generar-claves-dev.js` + `generar-token.js usr-agente-1` (con las variables obligatorias en el entorno): token verificado con `.dev-keys/publica.pem`; `iss=usuario-service`, `aud=banco-api`, `roles=["AGENTE"]`.

### `bash init.sh --rapido`

```
[OK]    specs-v2/ intacto (15 archivos)
[OK]    feature_list.json válido (13 features: pending=10 in_progress=1 done=2 blocked=0)
[OK]    SPEC-00: todos sus casos tienen prueba (todo: PRY-T01)
[OK]    SPEC-01: todos sus casos tienen prueba
[WARN]  SPEC-02 (en curso) aún sin prueba: INT-T01, INT-T02, INT-T03, INT-T04, INT-T05, INT-T06, INT-T07
[OK]    Alcance de archivos correcto (74 archivos revisados)
Tests:       1 todo, 37 passed, 38 total
[OK]    Pruebas unitarias en verde (modo --rapido: integración NO ejecutada)
[OK]    Entorno listo (verificación rápida). Para cerrar una feature corre 'bash init.sh' completo.
EXIT=0
```

### `bash init.sh` (completo)

```
 core/clients         |       0 |        0 |       0 |       0 |
  billeteraClient.js  |       0 |        0 |       0 |       0 | 3-76
Jest: "./src/core/" coverage threshold for statements (80%) not met: 73.58%
Jest: "./src/core/" coverage threshold for branches (80%) not met: 68%
Jest: "./src/core/" coverage threshold for lines (80%) not met: 73.46%
Jest: "./src/core/" coverage threshold for functions (80%) not met: 60%
Tests:       1 todo, 42 passed, 43 total
[FAIL]  Hay pruebas rotas (¿está PostgreSQL arriba? 'docker compose up -d db')
EXIT=1
```

Única causa: `billeteraClient.js` aún no tiene las pruebas INT-T del tester, así que la cobertura de
`src/core/` queda bajo el 80 %. Ninguna prueba falla (42 verdes + 1 todo).

## Notas para tester y revisor

- El `docker compose up --build` completo que arrastra review_00 todavía no puede comprobar `deposito-service`, porque `src/server.js` llega con SPEC-06. El mock sí levanta.
- Para el timeout, `acreditaLento` y `consultaFalla({ demora })` usan el delay real de nock; con `BILLETERA_TIMEOUT_MS=5000` cada prueba tarda unos 5 s, salvo que se simule `config` o se pase una demora menor.
