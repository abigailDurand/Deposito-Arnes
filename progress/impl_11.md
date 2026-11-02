# impl_11 — SPEC-11 conversion-moneda

**Agente:** desarrolladorback · **Fecha:** 2026-11-02

## Archivos (todos del §2 de SPEC-11)

- [NUEVO] `db/11-conversion-moneda.sql` — tablas `tipos_cambio` (+ índice `idx_tipos_cambio_par`) y
  `conversiones_deposito`, literales de §4, con las 2 filas de EJEMPLO `[POR ACORDAR]` (CM-R10, PRY-R11).
  Se aplica después de `10-limites-canal.sql`; `depositos` ya existe (`00-core.sql`).
- [NUEVO] `src/modules/conversion-moneda/service.js` — `convertir(monto, valor)` con Decimal.
- [NUEVO] `src/modules/conversion-moneda/repository.js` — `buscarVigente(db, origen, destino)`,
  `insertar(tx, fila)`, `buscarPorDeposito(db, depositoId)`. SQL parametrizado (PRY-R08), ejecutor primero.
- [NUEVO] `src/modules/conversion-moneda/index.js` —
  `{ id: 'conversion-moneda', tipo: 'transformador', ejecutar, persistir, leerExtension }` (SPEC-06 §4).
- No se tocó `src/core/` (PRY-R05), ni otros módulos (PRY-R04), ni `tests/helpers/db.js`: `limpiar()` ya
  vacía todas las tablas salvo `limites_canal`, así que vacía `tipos_cambio` y `conversiones_deposito`
  como pide §6. Los `*.test.js` del §2 son del tester.

## Reglas

- **CM-R01** · `deposito.moneda === contexto.cuenta.moneda` → `return deposito` (el mismo objeto, sin cambios).
- **CM-R02** · `buscarVigente`: `WHERE moneda_origen = $1 AND moneda_destino = $2 AND vigente_desde <= now()
  ORDER BY vigente_desde DESC LIMIT 1`, con `$1 = deposito.moneda`, `$2 = cuenta.moneda`.
- **CM-R03** · Se busca solo el par en el sentido origen→destino; nunca se invierte el valor del otro sentido.
- **CM-R04** · `convertir`: `Decimal(monto) × Decimal(valor)` con un clon de Decimal de precisión 40 (producto
  exacto antes del único redondeo) → `toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2)`. Devuelve string
  con 2 decimales (`"37.59"`, `"3.76"`, como en CM-T06). Sin `Number`/`parseFloat`.
- **CM-R05** · Devuelve una copia del `deposito` con `montoAcreditar = new Decimal(convertido)`,
  `monedaAcreditar = cuenta.moneda`, `extensiones['conversion-moneda'] = { monedaCuenta, tipoCambio (toFixed(4)),
  montoAcreditado }`, y asigna `contexto.privado.tipoCambioId`.
- **CM-R06** · `buscarVigente` → `null` ⇒ `return deposito` sin lanzar; el service de SPEC-07 ya responde 422
  `MONEDA_NO_SOPORTADA` porque `monedaAcreditar !== cuenta.moneda`.
- **CM-R07** · `persistir(deposito, tx, contexto)`: si no existe `extensiones['conversion-moneda']` → return; si
  existe → `repository.insertar(tx, ...)` con la `tx` recibida y `contexto.privado.tipoCambioId` (PIP-R07).
- **CM-R08** · `leerExtension(depositoId, contexto)` → `buscarPorDeposito(contexto.db, ...)`; sin fila → `null`;
  con fila → `{ monedaCuenta, tipoCambio: "x.xxxx", montoAcreditado: "x.xx" }`.
- **CM-R09** · La fila se inserta en la misma tx que el INSERT del depósito, que se confirma antes de llamar a
  billetera (SPEC-07); si billetera falla solo cambia el estado a FALLIDO, la fila queda. Nada que hacer en el módulo.
- **CM-R10** · Sin fuente externa: los tipos se leen de la tabla (carga manual); filas de ejemplo marcadas `[POR ACORDAR]`.
- **Contrato §5** · Sin rutas nuevas. El bloque sale en POST (vía `deposito.extensiones` → `aJson`) y en GET/reintento
  (vía `pipeline.leerExtensiones` → `leerExtension`). Billetera recibe `montoAcreditar` en `monedaAcreditar`.

## Decisiones

- `convertir` devuelve **string** de 2 decimales (formato literal de CM-T06 y de PRY-R06 para JSON); `index.js` lo
  envuelve en `Decimal` para `montoAcreditar`. El cálculo es 100 % Decimal.
- `ejecutar` devuelve un objeto nuevo en vez de mutar el recibido (el pipeline usa el valor devuelto, PIP-R02).
- `index.js` llama `repository.*` y `service.*` a través del objeto del módulo, para que `jest.mock` funcione.
- `contexto.cuenta` nunca es `null` en `ejecutar`: los transformadores no corren en un reintento (RD-R08).
- Nota para el tester: con `conversion-moneda` activa en `specs-v2/manifest.yaml`, una prueba existente que use el
  manifest real y espere 422 `MONEDA_NO_SOPORTADA` por moneda distinta seguirá obteniéndolo solo si no hay tipo
  cargado (`limpiar()` vacía `tipos_cambio`), así que no debería cambiar.

## Verificación

- `node -e "require('./src/modules/conversion-moneda/<archivo>')"` → index, service y repository cargan sin error.
- `convertir('10.01','3.7555')` → `37.59`; `convertir('1.00','3.7550')` → `3.76`; `convertir(Decimal('100.00'),'3.7500')` → `375.00`.
- Prueba manual (no formal) contra PostgreSQL de pruebas en un schema temporal con ROLLBACK (`00-core.sql` +
  `11-conversion-moneda.sql`): tipos de ayer 3.70 y de hoy 3.75 → usa 3.75, `tipoCambioId` correcto en `privado`,
  extensión `{"monedaCuenta":"PEN","tipoCambio":"3.7500","montoAcreditado":"375.00"}`; tipo solo con
  `vigente_desde` mañana → depósito sin cambios; `persistir` + `leerExtension` devuelven el mismo bloque; depósito
  sin fila → `null`.

### `bash init.sh --rapido`

```
[WARN]  SPEC-11 (en curso) aún sin prueba: CM-T01, CM-T02, CM-T03, CM-T04, CM-T05, CM-T06, CM-T07, CM-T08
[OK]    Alcance de archivos correcto (159 archivos revisados)
Test Suites: 10 passed, 10 total
Tests:       152 passed, 152 total
[OK]    Pruebas unitarias en verde (modo --rapido: integración NO ejecutada)
[OK]    Entorno listo (verificación rápida).
```
