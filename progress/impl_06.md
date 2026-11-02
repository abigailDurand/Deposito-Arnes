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
