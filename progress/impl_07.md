# impl_07 · SPEC-07 registrar-deposito (v2.0) — RETRABAJO Billetera USD

- **Agente:** desarrolladorback · **Rama:** `inte_biUsd` · **Fecha:** 2026-11-03
- **Referencia:** `Busti:codigo/src/modules/registrar-deposito/{schema,service}.js` — solo se tomaron
  los cambios de RD-R02 y del `acreditar` con `usuarioId`/`canal`.

## Archivos modificados (todos del §2)

- `src/modules/registrar-deposito/schema.js` — `cuentaDestino` con `RE_CUENTA` (PEN o UUID minúsculas).
- `src/modules/registrar-deposito/service.js` — `acreditar` recibe además `usuarioId` y `canal`; comentarios RD-R08/RD-R11.

Sin cambios: `index.js`, `routes.js`, `controller.js`, `repository.js` (el `SELECT *` de
`buscarPorId` ya trae `usuario_id` y `canal`; `depositoDesdeFila` ya los mapeaba).

## Reglas

- **RD-R01** · Sin cambios: `z.object(...).strict()`, obligatorios y tipos → 400 `FORMATO_INVALIDO`.
- **RD-R02** · `RE_CUENTA = /^(?:\d{4}-\d{4}-\d{6}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/` **sin flag `i`**: mayúsculas o UUID incompleto → 400. Verificado con `safeParse` (PEN ok, UUID minúsculas ok, con `A` mayúscula falla, incompleto falla). Resto del esquema igual.
- **RD-R03** · Sin cambios: `montoValido` sigue contando decimales sobre el **string** (`"10.100"` → 422); NO se portó `decimalPlaces()` de `Busti`. Decimal siempre, sin `Number(`/`parseFloat`.
- **RD-R04** · Orden del diagrama intacto; único cambio en el paso `acreditar(id, cuenta, montoAcreditar, monedaAcreditar, usuarioId, canal)`.
- **RD-R05** · Sin cambios: `armarContexto` mantiene `logger` y `db` (NO se portó la versión de `Busti` sin ellos).
- **RD-R06 / RD-R07** · Sin cambios (repository y TX).
- **RD-R08** · `reintentar` usa `depositoDesdeFila`, que toma `monto_acreditar`, `moneda_acreditar`, `usuario_id` y `canal` de la fila, y `acreditarYCerrar` los pasa a `billeteraClient.acreditar` → body idéntico al original (replay INT-R06). Sin consultar cuenta ni validadores/transformadores.
- **RD-R09** · Sin cambios.
- **RD-R10** · El módulo no menciona ni importa limites, conversión ni UIF (grep limpio).
- **RD-R11** · Se conserva `cuenta.estado !== 'ACTIVA' → CUENTA_INACTIVA`; como `consultarCuenta` USD devuelve siempre `estado: 'ACTIVA'` (INT-R04, SPEC-02), en la práctica solo aplica a PEN. Comentario añadido.

## Decisiones

- Cambios mínimos: no se reordenaron imports ni se reescribió código que no cambia (a diferencia de `Busti`).
- No se portó el `canal` duplicado de `depositoDesdeFila` de `Busti`.

## Verificación

- `node -e` (con `tests/setup/env.js`) carga `schema.js` y `service.js` sin errores.
- `bash init.sh` (completo): **verde**, 23 suites, 380 passed + 1 todo. Ninguna prueba existente rota.
  Avisos: `SPEC-07 (en curso) aún sin prueba: RD-T13..RD-T18` (y los de 08/09 reabiertas).

## Para el tester

- Faltan RD-T13..RD-T18.
- `tests/unit/registrar-deposito/service.test.js` (~l.123) inspecciona `acreditar.mock.calls[0]`
  pero no comprueba `usuarioId`/`canal`; conviene ampliarlo (y RD-T12: el reintento envía los guardados).
- No se detectaron pruebas obsoletas por el contrato nuevo (todo pasa).
