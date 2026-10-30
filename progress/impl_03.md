# Implementación SPEC-03 · seguridad (feature 3)

**Agente:** desarrolladorback · **Fecha:** 2026-10-30 · **Estado:** `in_progress` (lista para el tester)

> **Atención leader/tester:** `bash init.sh --rapido` está **verde**. `bash init.sh` completo está
> **rojo solo por el umbral de cobertura del 80 % en `./src/core/`** (65 % statements): los 3 archivos
> nuevos aún no tienen las pruebas SEG-T (son del tester). Ninguna prueba falla (60 + 1 todo).
> Se pone verde cuando existan `tests/unit/seguridad/permisos.test.js` y
> `tests/integration/seguridad/seguridad.test.js`.

## Archivos creados (todos del §2 de SPEC-03)

| Archivo | Exporta |
|---|---|
| `src/core/middlewares/correlationId.js` | la función middleware (`app.use(require(...))`) + `rutaParaLog(req)` (auxiliar, útil para probar) |
| `src/core/middlewares/auth.js` | `{ autenticar, requiereRol }` |
| `src/core/permisos.js` | `{ verificarCanal, verificarTitular, esTitular, CANAL_POR_ROL }` |

No creados: los dos `*.test.js` del §2 (del tester). No se tocó ningún archivo fuera del §2;
solo `feature_list.json` (feature 3 → `in_progress`) y `progress/current.md` por protocolo.
No se creó `app.js`: el montaje es de SPEC-06 (`crearApp`, PIP-R11).

## Reglas

- **SEG-R01** · `X-Correlation-Id` se usa si cumple `^[A-Za-z0-9_-]{1,100}$`; si falta o no cumple (101 caracteres, espacios…) → `crypto.randomUUID()`. Queda en `req.correlationId`.
- **SEG-R02** · `res.set('X-Correlation-Id', ...)` antes de `next()`, así sale en toda respuesta (también 401/403/500). El cuerpo de error lo pone `manejadorErrores` (SPEC-01) leyendo `req.correlationId`. El envío a billetera ya lo hace `billeteraClient` con el `correlationId` que le pasen los services.
- **SEG-R03** · `res.on('finish')` → `logger.info({ correlationId, usuarioId, metodo, ruta, status, duracionMs }, 'Petición atendida')`. `usuarioId = req.usuario?.id ?? null`. No se registran headers ni body (ahí van token y cuenta). Ruta: ver Decisión 1.
- **SEG-R04** · Sin `Authorization` o que no sea `Bearer <token>` (p. ej. `Basic ...`, `Bearer` vacío) → `ErrorApp('TOKEN_REQUERIDO')` vía `next`.
- **SEG-R05** · `jwt.verify(token, config.jwt.publicKey, { algorithms, issuer, audience })` con los valores de `config.jwt`. `none` se filtra de la lista de algoritmos aunque viniera en `JWT_ALGORITHMS` (y jsonwebtoken 9 lo rechaza igual con clave pública).
- **SEG-R06** · `err instanceof jwt.TokenExpiredError` → `TOKEN_EXPIRADO`; cualquier otro error (firma, `alg`, `aud`, `iss`, `nbf`, mal formado) → `TOKEN_INVALIDO`. Tras verificar: `sub` string no vacío y `roles` arreglo no vacío; si no → `TOKEN_INVALIDO`.
- **SEG-R07** · Solo `jwt.verify` local con `JWT_PUBLIC_KEY`; no hay ninguna llamada HTTP en `auth.js`.
- **SEG-R08** · `req.usuario = { id: payload.sub, roles: [...payload.roles] }`.
- **SEG-R09** · `requiereRol(...roles)` devuelve un middleware; si ningún rol de `req.usuario.roles` está en la lista (o no hay `req.usuario`) → `SIN_PERMISO`. Sin roles al construirlo → `Error` (error de programación, al arrancar).
- **SEG-R10** · `verificarCanal` usa la tabla `CANAL_POR_ROL` (CLIENTE→APP, AGENTE→AGENTE, CAJERO→VENTANILLA) en `permisos.js`; si ningún rol corresponde al canal → lanza `ErrorApp('SIN_PERMISO')`. Usa `Object.hasOwn` (un rol `toString` no coincide).
- **SEG-R11** · `verificarTitular`: si `canal === 'APP'` y `!esTitular(usuario, cuenta)` → lanza `SIN_PERMISO`; AGENTE/VENTANILLA no comprueban titular.
- **SEG-R12** · `esTitular` → `true` solo si `cuenta != null`, `usuario.id != null` y `cuenta.titularId === usuario.id`; siempre devuelve booleano.
- **SEG-R13** · [POR ACORDAR] respetado sin inventar: varios roles se permiten; `requiereRol` y `verificarCanal` aceptan si **alguno** de los roles cumple, y `verificarTitular` aplica la regla del canal elegido (la del rol que opera).
- **PRY-R09** · Algoritmos, issuer, audience y clave salen de `config.jwt`; ningún `process.env`.
- **PRY-R10** · Log de petición sin token ni cuenta completa (comprobado, ver Verificación).

## Decisiones

1. **Ruta en el log (SEG-R03 + PRY-R10).** Se registra `req.originalUrl` **sin query string** y con
   toda secuencia aislada de dígitos/guiones de 10+ caracteres pasada por `enmascararCuenta`:
   `/api/v1/cuentas/0011-0123-456789/depositos` → `/api/v1/cuentas/****-****-456789/depositos`.
   No uso el patrón de la ruta (`req.baseUrl + req.route.path`) porque en `finish` Express ya
   restauró `req.baseUrl` al salir del router, y `req.route` falta en 404/401 (autenticar corta antes
   de la ruta), así que sería poco fiable. El regex es genérico (no nombra ninguna feature en
   `src/core/`) y también cubre cuentas mal formadas que terminan en 400 (`0011-0123-4567890`,
   `00110123456789`). Los UUID de `/depositos/:id` no se alteran (sus grupos llevan letras o están
   pegados a ellas), así se mantiene la trazabilidad. La query se descarta para no registrar nada
   no previsto.
2. **`autenticar` "global, salvo /health":** no tiene excepción de ruta interna; la exclusión la da el
   orden de PIP-R11 (`GET /health` se monta antes que `autenticar` y responde sin llegar a él). Así
   no se codifica una ruta en el middleware.
3. **Middlewares síncronos:** `autenticar`, `requiereRol` y `correlationId` no son `async`, así que no
   se envuelven en `manejar`; pasan el `ErrorApp` con `next(err)` → `manejadorErrores` responde 401/403
   con `{ codigo, mensaje, correlationId }`.
4. **`duracionMs`** con `performance.now()` redondeado a entero (no es dinero).
5. **Exports extra** `rutaParaLog` y `CANAL_POR_ROL`: auxiliares para pruebas y para que SPEC-07 no
   duplique la tabla; todos los nombres de la spec están presentes.

## Notas para tester / revisor

- SEG-T09: el log de petición se captura con `jest.spyOn(logger, 'info')` (de `src/core/logger`); con
  `LOG_LEVEL=silent` pino no escribe, pero el spy sí recibe el objeto. El campo es `duracionMs`.
- SEG-T02/T03/T04/T05: `token(usuario, { exp | clave | alg: 'none' | aud })` de `tests/helpers/tokens.js`.
- SEG-T06 → `test.todo` hasta SPEC-07.
- Revisor de SPEC-06/07/08/09: `requiereRol` en cada ruta de negocio y `autenticar` montado después de `/health`.

## Verificación

Script fuera del repo (scratchpad, no versionado): app Express mínima `correlationId → GET /health →
autenticar → rutas → manejadorErrores` + Supertest + `tests/helpers/tokens.js`:

- Sin `Authorization` → 401 `TOKEN_REQUERIDO`, `correlationId` del cuerpo = header. `Basic abc` → `TOKEN_REQUERIDO`.
- `exp` pasado → `TOKEN_EXPIRADO`; otra clave, `alg: none`, `aud` distinto, `iss` distinto, sin `sub`, `roles: []` → `TOKEN_INVALIDO`.
- Token válido → `req.usuario = { id: 'usr-agente-1', roles: ['AGENTE'] }`.
- `requiereRol('AGENTE')` con CLIENTE → 403 `SIN_PERMISO`.
- `/health` sin token → 200 con `X-Correlation-Id` (UUID); con `abc` → `abc`; `a b` o 101 caracteres → UUID nuevo.
- Log (spy de `logger.info`), petición a `/cuentas/0011-0123-456789/depositos?pagina=1` y a una ruta que lanza (500):
  `[{"correlationId":"abc","usuarioId":"usr-cliente-1","metodo":"GET","ruta":"/cuentas/****-****-456789/depositos","status":200,"duracionMs":1},{"correlationId":"abc","usuarioId":"usr-cliente-1","metodo":"GET","ruta":"/boom","status":500,"duracionMs":1}]`
  → no contiene el token ni `0011-0123-456789`.
- Permisos: CLIENTE+VENTANILLA lanza `SIN_PERMISO`; CLIENTE+APP pasa; CLIENTE+CAJERO con VENTANILLA pasa; titular propio pasa, ajeno o `null` → 403; AGENTE a cuenta ajena pasa; `esTitular` con `null` / `titularId: null` → `false`.
- Resultado: `TODO OK`.

### `bash init.sh --rapido`

```
[OK]    specs-v2/ intacto (15 archivos)
[OK]    feature_list.json válido (13 features: pending=9 in_progress=1 done=3 blocked=0)
[OK]    SPEC-00: todos sus casos tienen prueba (todo: PRY-T01)
[OK]    SPEC-01: todos sus casos tienen prueba
[OK]    SPEC-02: todos sus casos tienen prueba
[WARN]  SPEC-03 (en curso) aún sin prueba: SEG-T01 ... SEG-T10
[OK]    Alcance de archivos correcto (80 archivos revisados)
Tests:       1 todo, 55 passed, 56 total
[OK]    Pruebas unitarias en verde (modo --rapido: integración NO ejecutada)
[OK]    Entorno listo (verificación rápida). Para cerrar una feature corre 'bash init.sh' completo.
```

### `bash init.sh` (completo)

```
  permisos.js         |       0 |        0 |       0 |       0 | 3-37
  auth.js             |       0 |        0 |       0 |       0 | 3-62
  correlationId.js    |       0 |        0 |       0 |       0 | 3-48
Jest: "./src/core/" coverage threshold for statements (80%) not met: 65.21%
Jest: "./src/core/" coverage threshold for branches (80%) not met: 51.64%
Jest: "./src/core/" coverage threshold for lines (80%) not met: 66.43%
Jest: "./src/core/" coverage threshold for functions (80%) not met: 54.28%
Tests:       1 todo, 60 passed, 61 total
[FAIL]  Hay pruebas rotas (¿está PostgreSQL arriba? 'docker compose up -d db')
EXIT=1
```

Única causa: cobertura de `src/core/` sin las pruebas SEG-T del tester. Ninguna prueba falla.
