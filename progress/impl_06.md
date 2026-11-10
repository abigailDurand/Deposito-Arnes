# impl_06 — SPEC-06 pipeline-y-cargador

- **Agente:** desarrolladorback · **Fecha:** 2026-11-02

## Archivos (todos del §2 de SPEC-06)

- [NUEVO] `src/core/pipeline.js`
- [NUEVO] `src/core/cargador.js`
- [NUEVO] `src/app.js`
- [NUEVO] `src/server.js`
- `tests/core/pipeline.test.js` · `tests/core/cargador.test.js`: son del tester (no escritos).

Ningún otro archivo de `src/`, `tests/`, `db/` ni de infraestructura fue tocado.

## API pública

- `pipeline`: `ejecutarValidadores(deposito, contexto)`, `ejecutarTransformadores(deposito, contexto)`,
  `persistirTransformadores(deposito, tx, contexto)`, `ejecutarPostProcesos(deposito, contexto)`,
  `leerExtensiones(depositoId, contexto)`. Para el cargador: `reiniciar()`, `registrar(modulo, orden)`
  y `HUECO_POR_TIPO` (`validador` → validadores, `transformador` → transformadores,
  `post-proceso` → postProcesos).
- `cargador.cargar(manifest)` → `{ routers }` (routers de los endpoints activos, en el orden del manifest).
- `app.crearApp({ manifest })` → app Express sin `listen`.
- `server.js`: lee `MANIFEST_PATH` (relativo a la raíz del proyecto), `crearApp`, `limpiarClaves.iniciar()`,
  `listen(PORT)`. Si no puede arrancar: `logger.fatal` y `process.exitCode = 1`.

## Reglas

- **PIP-R01** · `ejecutarValidadores` recorre el hueco ordenado ascendentemente con `await`; no captura nada,
  así que el primer error corta el bucle y llega intacto.
- **PIP-R02** · `ejecutarTransformadores` encadena `actual = await ejecutar(actual, ctx)`; cualquier error se
  registra con el logger del módulo (`depositoId`, mensaje y `code`) y se relanza como `ErrorApp('ERROR_INTERNO')` (500).
- **PIP-R03** · `persistirTransformadores` llama `persistir(deposito, tx, ctx)` de cada transformador que lo
  tenga; sin `try/catch` → el error se propaga y el service hace rollback.
- **PIP-R04** · `ejecutarPostProcesos`: cada post-proceso en su `try/catch`; error → `logger.error` del módulo con
  `depositoId` y se continúa. La función nunca lanza.
- **PIP-R05** · `leerExtensiones` recorre todas las extensiones activas con `leerExtension` y arma `{ [id]: objeto }`
  omitiendo `null` (y `undefined`).
- **PIP-R06** · Huecos vacíos: los bucles no iteran; `ejecutarTransformadores` devuelve el mismo `deposito`
  y `leerExtensiones` devuelve `{}`.
- **PIP-R07** · Cada módulo recibe `{ ...contexto, logger: logger.child({ correlationId, modulo: id }), privado }`.
  `privado` vive en un `WeakMap` indexado por el objeto `contexto` del service y luego por id del módulo: es distinto
  por id y el mismo objeto llega a `ejecutar` y a `persistir` mientras el service pase el mismo `contexto`
  (eso es lo que dice SPEC-06 §4, "se conserva de ejecutar a persistir").
- **PIP-R08** · `cargar` filtra `estado === 'activo'` antes de cualquier `require`; el `orden` sale de `feature.orden`
  (inserción estable: a igual orden, el del manifest).
- **PIP-R09** · Lanza si la carpeta `src/modules/<id>` no existe (`MODULE_NOT_FOUND` cuyo mensaje contiene esa ruta;
  un `MODULE_NOT_FOUND` de una dependencia interna del módulo se relanza tal cual) o si `modulo.tipo !== feature.tipo`.
  `crearApp` llama a `cargar` antes de construir la app, así que la app no se crea.
- **PIP-R10** · `registrarErrores(modulo.errores)` de cada módulo activo, una sola vez por objeto `errores`
  (`WeakSet`): llamar `crearApp` varias veces no re-registra códigos (observación de review_01).
- **PIP-R11** · `crearApp`: `trust proxy` = `config.trustProxy` → `correlationId` → `auditoria` → `GET /health` →
  `autenticar` → `express.json({ limit: '100kb' })` → routers en `/api/v1` → 404 `RUTA_NO_ENCONTRADA` →
  `manejadorErrores` (arrastre de SPEC-03/04).
- **PIP-R12** · `crearApp` no inicia tareas ni hace `listen`; solo `server.js` llama a `limpiarClaves.iniciar()`.
- §5 · Ruta inexistente → `next(new ErrorApp('RUTA_NO_ENCONTRADA'))` → 404 con el formato de SPEC-01.
- `pipeline.js` y `cargador.js` no nombran ninguna feature (solo tipos genéricos).

## Decisiones (validación del contrato de §4, no reglas nuevas de negocio)

- `cargar` valida todo el manifest antes de tocar el catálogo o el pipeline (nada queda a medias) y lanza también si:
  falta `features`, una feature activa no tiene `id` o tiene un `tipo` desconocido, una extensión no tiene `orden`
  numérico, un id está repetido, el `id` exportado por el módulo difiere del manifest, un endpoint no exporta
  `router`, una extensión no exporta `ejecutar`, o un validador declara un error con status ≠ 422 (SPEC-06 §4).
- Un id con separadores (`../core`) se trata como "no existe en src/modules/" (no se hace `require` fuera de esa carpeta).
- El pipeline es un singleton de proceso (los services de SPEC-07/08 lo importan); cada `cargar` lo reinicia,
  así que la última `crearApp` define los huecos activos. Las pruebas deben armar la app/llamar `cargar` en cada caso.
- PRY-R10: los logs de error del pipeline incluyen `message` y `code`, no el objeto de error completo (el `detail`
  de PostgreSQL puede traer valores de la fila).
- `trust proxy` usa `config.trustProxy` (ya convertido a número por `config.js`): con `TRUST_PROXY=1`, `req.ip`
  toma el último salto de `X-Forwarded-For`, que es lo que registra la auditoría (arrastre de SPEC-04).

## Notas para el tester

- `cargar` hace `require(path.join(<raíz>/src/modules, id))` (ruta de la carpeta, sin `/index.js`). Para módulos
  falsos de `tests/core/fixtures/`, mapearlos con
  `jest.mock(path.join(__dirname, '../../src/modules/<id-falso>'), () => require('./fixtures/<x>'), { virtual: true })`
  o equivalente. PIP-T09: un mock virtual cuya fábrica falle/marque una bandera demuestra que no se hizo `require`.
- PIP-T05: el logger del módulo es `logger.child(...)` del logger del core (`src/core/logger.js`); se puede espiar
  `logger.child` para capturar el `error`.
- Con el manifest real (`specs-v2/manifest.yaml`) `cargar` lanza hasta que existan `src/modules/*` (SPEC-07..12):
  PRY-T01 y PIP-T10 deben usar un manifest a medida (todas `inactivo`, o fixtures).

## Verificación

- `node -e "require('./src/<archivo>')"` (con variables obligatorias) carga sin errores: `src/app.js`,
  `src/core/pipeline.js`, `src/core/cargador.js`.
- Smoke manual (script fuera del repo, con supertest): `GET /health` sin token → 200 `{ "estado": "ok" }`; ruta
  inexistente sin token → 401 `TOKEN_REQUERIDO`; feature activa inexistente y `../core` → `cargar` lanza; validadores
  20/10 corren 10 primero; `privado` compartido entre `ejecutar` y `persistir`; post-proceso que lanza no corta al
  siguiente; `leerExtensiones` omite `null`; transformador que lanza → `ERROR_INTERNO` 500.

### `bash init.sh --rapido`

```
[OK]    specs-v2/ intacto (15 archivos)
[OK]    feature_list.json válido (13 features: pending=6 in_progress=1 done=6 blocked=0)
[WARN]  SPEC-06 (en curso) aún sin prueba: PIP-T01 … PIP-T10
[OK]    Alcance de archivos correcto (101 archivos revisados)
Tests:       1 todo, 65 passed, 66 total
[OK]    Pruebas unitarias en verde (modo --rapido: integración NO ejecutada)
[OK]    Entorno listo (verificación rápida).
```

### `bash init.sh` (completo, con PostgreSQL)

```
Test Suites: 9 passed, 9 total
Tests:       13 todo, 129 passed, 142 total
Jest: "./src/core/" coverage threshold for statements (80%) not met: 71.13%
Jest: "./src/core/" coverage threshold for branches (80%) not met: 65.88%
[FAIL]  Hay pruebas rotas
```

Las 129 pruebas existentes siguen verdes. El único fallo es el umbral de cobertura de `src/core/`: `pipeline.js` y
`cargador.js` están al 0 % porque sus pruebas (`tests/core/pipeline.test.js`, `tests/core/cargador.test.js`) son del
tester. Se espera que vuelva a verde cuando el tester escriba PIP-T01..T10.

## Pendiente para el revisor (arrastre de SPEC-00/02)

- `docker compose up --build`: con el manifest real todas las features están `activo` y `src/modules/` aún no existe,
  así que `deposito-service` sale con `logger.fatal` (PIP-R09, comportamiento correcto) hasta SPEC-07..12.
  `GET /health` en compose solo se puede comprobar con un `MANIFEST_PATH` cuyas features estén `inactivo`.

---

## Retrabajo v1.2, 2026-11-09

Cambio de spec (v1.1 → v1.2): §2/PIP-R12, `server.js` llama también a `reconciliacion.iniciar()` (SPEC-07). En el
§4 (contexto), `titularId` en el depósito (DOM-R11) y, en una reconciliación, `usuario = { id: usuario_id, roles: [] }`
con `cuenta = null`.

### Archivos

- [MODIFICADO] `src/server.js`: importa `./modules/registrar-deposito/reconciliacion` y llama a
  `reconciliacion.iniciar()` después de `crearApp(...)` y `limpiarClaves.iniciar()`, antes de `listen(PORT)`.
- Sin cambios: `src/core/pipeline.js`, `src/core/cargador.js`, `src/app.js` (ya cumplen el §4 nuevo).
- No se tocó nada de `src/modules/registrar-deposito/` (incluido `reconciliacion.js`), ni pruebas, ni `specs-v2/`.

### Reglas afectadas

- **PIP-R12** · `crearApp` sigue sin iniciar tareas (`src/app.js` sin cambios). `server.js` inicia las dos tareas, y
  lo hace después de `crearApp`. Así, si el manifest no es válido (PIP-R08/R09), la app no arranca y la
  reconciliación no se programa. El temporizador hace `unref()` (lo hace el módulo de SPEC-07).
- **§4 `deposito.titularId`** · El pipeline no arma el depósito: lo recibe del service y lo pasa tal cual por los huecos.
  El service de SPEC-07 ya incluye `titularId` (`cuenta.titularId` al registrar, `fila.titular_id ?? null` al reintentar
  o reconciliar). No hace falta ningún cambio en `pipeline.js`.
- **§4 contexto en una reconciliación** · `contextoDe` en `pipeline.js` copia el contexto que recibe y le añade
  `logger` y `privado`. El service de SPEC-07 (`cerrarReconciliado`) ya pasa `armarContexto({ id: fila.usuario_id,
  roles: [] }, null, correlationId)`. Es decir, `usuario = { id: usuario_id, roles: [] }` y `cuenta = null`, como pide
  la spec. Sin cambios.
- **PRY-R04/R05** · `src/core/` no cambia. La referencia al módulo está en `src/server.js`, el punto de entrada (no es
  `src/core/`), como pide el §2. Ningún módulo importa otro.
- Las demás PIP-Rnn no cambian (ver las secciones anteriores).

### Decisiones

- La llamada es incondicional, como dice la spec (§2, PIP-R12): la spec no la hace depender de que
  `registrar-deposito` esté `activo` en el manifest, así que no se añadió esa condición. Todas las extensiones
  extienden `registrar-deposito`. Si el humano quiere que la reconciliación no arranque con la feature `inactivo`, la
  spec tendría que decirlo.
- Orden `limpiarClaves.iniciar()` → `reconciliacion.iniciar()`: el que da el texto de la spec.

### Verificación

- `node -e "require('./tests/setup/env.js'); require('./src/app'); require('./src/modules/registrar-deposito/reconciliacion')"`
  → `carga ok`. Sin variables de entorno, `config.js` aborta por las obligatorias. Es el comportamiento esperado
  (SPEC-00), no un fallo de carga.
- `bash init.sh --rapido`:

```
[OK]    specs-v2/ intacto (15 archivos)
[OK]    feature_list.json válido (13 features: pending=0 in_progress=1 done=8 blocked=0 reabierta=4)
[OK]    SPEC-06: todos sus casos tienen prueba
[WARN]  SPEC-07 (reabierta) aún sin prueba: RD-T19, RD-T20, RD-T21, RD-T22, RD-T23, RD-T24
[WARN]  SPEC-08 (reabierta) aún sin prueba: CD-T14, CD-T15
[WARN]  SPEC-11 (reabierta) aún sin prueba: CM-T09
[OK]    Alcance de archivos correcto (190 archivos revisados)
Test Suites: 1 failed, 11 passed, 12 total
Tests:       11 failed, 230 passed, 241 total
[FAIL]  Hay pruebas unitarias rotas
```

Los 11 fallos están en `tests/unit/registrar-deposito/service.test.js` y son las 11 pruebas unitarias de SPEC-07 que
ya se sabía que estaban obsoletas: el mock de `acreditar` no devuelve `{ estado }`, y `repository.insertar` recibe
ahora el parámetro `titular_id`. Son:
RD-T03, RD-T11, RD-T12, RD-T13, RD-T18, RD-R03 (sin referencia), RD-R03/R05, RD-R04, RD-R08, RD-R09 y
"repository (db simulada) insertar…". **No hay fallos nuevos**: `tests/core/pipeline.test.js` y
`tests/core/cargador.test.js` pasan. No hay prueba que cubra `src/server.js` (PIP-R12 no tiene caso `PIP-Tnn` nuevo).
