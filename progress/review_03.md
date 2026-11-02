# Review — SPEC-03 seguridad

**Veredicto:** APROBADO CON OBSERVACIONES

Revisor · 2026-10-30 · Feature 3 (`seguridad`). Archivos del §2 revisados:
`src/core/middlewares/correlationId.js`, `src/core/middlewares/auth.js`, `src/core/permisos.js`,
`tests/unit/seguridad/permisos.test.js`, `tests/integration/seguridad/seguridad.test.js`.

## Reglas

### Prioridad del §6 (revisor)
- [x] SEG-R05 — `auth.js:32-36` llama a `jwt.verify(token, config.jwt.publicKey, { algorithms, issuer, audience })` con los tres valores de `config.jwt` (`src/config.js:36-40`). `auth.js:11` filtra `none` de la lista aunque viniera en `JWT_ALGORITHMS`; si la lista queda vacía jsonwebtoken rechaza todo (falla cerrado). SEG-T04 lo prueba con un token real sin firma (`header.payload.`).
- [x] SEG-R07 — `auth.js` solo importa `jsonwebtoken`, `config` y `errores`; Grep de `http://`, `https://`, `fetch(`, `axios`, `usuario-service` en los 3 archivos: única coincidencia es el comentario de `auth.js:22`. Validación 100 % local.
- [ ] (diferido) "`requiereRol` está en todas las rutas de negocio" — no verificable: SPEC-03 no agrega rutas (§5). **Pendiente para los revisores de SPEC-07, SPEC-08 y SPEC-09** (y SPEC-06 para el orden `correlationId → GET /health → autenticar` de PIP-R11, ya que `autenticar` no tiene excepción interna de ruta, ver impl_03 Decisión 2).

### Resto de reglas SEG
- [x] SEG-R01 — `correlationId.js:8` `PATRON_ID = /^[A-Za-z0-9_-]{1,100}$/` (anclada, exacta); fallback `randomUUID` de `node:crypto` (`:3`, `:27`); queda en `req.correlationId` (`:25`).
- [x] SEG-R02 — `correlationId.js:29` `res.set('X-Correlation-Id', ...)` antes de `next()` → sale en 2xx/401/403/500. El cuerpo de error lo pone `manejadorErrores` (SPEC-01) con `req.correlationId` (probado en SEG-T08/T10/T09). El envío a billetera es de `billeteraClient` (SPEC-02, ya aprobado).
- [x] SEG-R03 — `correlationId.js:33-42` `res.on('finish')` → `logger.info` con `correlationId`, `usuarioId` (`?? null`), `metodo`, `ruta`, `status`, `duracionMs`. No registra headers ni body. La ruta pasa por `rutaParaLog` (`:17-20`): sin query string y con `enmascararCuenta` sobre toda secuencia de dígitos/guiones de 10+ → `/cuentas/****-****-456789/depositos`.
- [x] SEG-R04 — `auth.js:24-27` sin `Authorization` o que no sea `Bearer <token>` → `TOKEN_REQUERIDO`.
- [x] SEG-R06 — `auth.js:39` `err instanceof jwt.TokenExpiredError` → `TOKEN_EXPIRADO`; resto → `TOKEN_INVALIDO`. `payloadValido` (`auth.js:13-19`) exige `sub` string no vacío y `roles` arreglo no vacío → si no, `TOKEN_INVALIDO` (`:43`). Ver observación 1 (rama sin prueba).
- [x] SEG-R08 — `auth.js:46` `req.usuario = { id: payload.sub, roles: [...payload.roles] }`.
- [x] SEG-R09 — `auth.js:51-60` 403 `SIN_PERMISO` si ningún rol del usuario está en la lista; sin `req.usuario` también 403.
- [x] SEG-R10 + tabla rol→canal — `permisos.js:6-10` `CANAL_POR_ROL` congelada = CLIENTE→APP, AGENTE→AGENTE, CAJERO→VENTANILLA (idéntica a §4); `verificarCanal` (`:17-21`) con `Object.hasOwn` lanza `ErrorApp('SIN_PERMISO')`.
- [x] SEG-R11 — `permisos.js:31-35` solo el canal APP exige titular; AGENTE/VENTANILLA no.
- [x] SEG-R12 — `permisos.js:24-28` `cuenta != null && cuenta.titularId === usuario.id` (siempre booleano; además exige `usuario.id != null`, más estricto y coherente).
- [x] SEG-R13 — [POR ACORDAR] sin inventar: varios roles se permiten y basta con que uno cumpla (`auth.js:55`, `permisos.js:18-19`), tal como dice "mientras tanto".

### Reglas del proyecto
- [x] PRY-R01..R04 — solo `src/core/`; sin nombres de features en core (Grep de `deposit|limite|billetera` en los 3 archivos: solo comentarios/nombres genéricos de cuenta/titular, que la spec define en core).
- [x] PRY-R05 — N/A (feature transversal declarada en core por su §2).
- [x] PRY-R06/R07/R08 — N/A (sin dinero ni SQL). Grep de `Number(`/`parseFloat`: 0 coincidencias.
- [x] PRY-R09 — algoritmos, issuer, audience y clave solo desde `config.jwt`; 0 `process.env` en los 3 archivos.
- [x] PRY-R10 — log sin token ni cuenta completa (incluido el path y la query); `logger.js` además redacta `req.headers.authorization`. 0 `console.log`.
- [x] PRY-R11 — SEG-R13 respetado sin valores inventados.
- [x] PRY-R12 — `specs-v2/` intacto (init.sh).

### Contrato §5
- [x] 401 `{ codigo, mensaje, correlationId }` con `TOKEN_EXPIRADO` / "Token vencido." (SEG-T02 comprueba el mensaje exacto).
- [x] 403 `{ codigo: "SIN_PERMISO", mensaje: "El rol o la cuenta no permiten la operación.", correlationId }` (SEG-T10 compara el cuerpo completo con `toEqual`).
- [x] Header `X-Correlation-Id` siempre (SEG-T08, también en 401).

## Casos de prueba
- [x] SEG-T01 … SEG-T05, SEG-T07 … SEG-T10 (9/9 reales, con aserciones concretas de status, `codigo`, cuerpo y header).
- [x] SEG-T06 — `test.todo` justificado (requiere la ruta POST de SPEC-07). **Pendiente para el revisor de SPEC-07.**
- [x] SEG-T09 verifica de verdad la salida del log: usa pino real con las opciones de `src/core/logger.js` redirigido a un `Writable`, `LOG_LEVEL=info` durante la carga, y aserta sobre el texto serializado (`lineas.join('')`) que no contiene el JWT, ni su firma, ni `0011-0123-456789`, ni `0011-0123` — aunque la cuenta va en el path, en la query y en el body; y que el registro JSON trae `status: 500`, `duracionMs` entero ≥ 0, `usuarioId`, `metodo` y ruta enmascarada. No es un spy sobre argumentos: es la salida real.
- [x] T01–T05 y T07–T10 montan los middlewares reales en una app Express mínima (§6 tester).

## Checkpoints
- C1: [x]  C2: [x]  C3: [x]  C4: [x] (requiereRol en rutas de negocio diferido a SPEC-07/08/09)  C5: [x]

C5 cobertura: `src/core/` 98.64 % stmts / 94.59 % branch / 93.75 % funcs / 98.55 % lines (≥ 80 %). `src/modules/` aún sin código.

## Observaciones (no incumplen reglas de spec)
1. `src/core/middlewares/auth.js:43` — SEG-R06 (token firmado válido sin `sub` o con `roles: []` → `TOKEN_INVALIDO`): implementado correctamente pero sin prueba (línea sin cubrir en el reporte). No es un caso SEG-Tnn, por eso no bloquea; conviene que el tester añada una prueba firmando con `jwt.sign` y la clave de prueba un payload sin `sub` y otro con `roles: []`.
2. Para los revisores de SPEC-07/08/09: comprobar que **cada** ruta de negocio lleva `requiereRol(...)` y que los services llaman a `verificarCanal` + `verificarTitular` tras consultar la cuenta (§3). Para SPEC-06: `autenticar` montado después de `GET /health` y `correlationId` primero (PIP-R11).
3. Para el revisor de SPEC-07: convertir SEG-T06 de `test.todo` a prueba real (403 y nock de billetera sin llamada).
4. `src/core/middlewares/correlationId.js:18` — fallback `req.url || ''` sin cubrir (inalcanzable en Express); sin impacto.

## Cambios requeridos
Ninguno.

## Salida de `bash init.sh`

Primera ejecución (completa, PostgreSQL real), antes de marcar `done`:
```
[OK]    specs-v2/ intacto (15 archivos)
[OK]    feature_list.json válido (13 features: pending=9 in_progress=1 done=3 blocked=0)
[OK]    SPEC-00: todos sus casos tienen prueba (todo: PRY-T01)
[OK]    SPEC-01: todos sus casos tienen prueba
[OK]    SPEC-02: todos sus casos tienen prueba
[OK]    SPEC-03: todos sus casos tienen prueba (todo: SEG-T06)
[OK]    Alcance de archivos correcto (83 archivos revisados)
Test Suites: 7 passed, 7 total
Tests:       2 todo, 87 passed, 89 total
[OK]    Todas las pruebas en verde (unitarias + integración)
[OK]    Entorno listo. Puedes empezar a trabajar.
EXIT=0
```

Segunda ejecución (completa), tras marcar la feature 3 como `done`:
```
[OK]    feature_list.json válido (13 features: pending=9 in_progress=0 done=4 blocked=0)
[OK]    SPEC-03: todos sus casos tienen prueba (todo: SEG-T06)
[OK]    Alcance de archivos correcto (84 archivos revisados)
Test Suites: 7 passed, 7 total
Tests:       2 todo, 87 passed, 89 total
[OK]    Todas las pruebas en verde (unitarias + integración)
[OK]    Entorno listo. Puedes empezar a trabajar.
EXIT=0
```
