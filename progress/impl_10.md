# impl_10 — SPEC-10 limites-por-canal

**Agente:** desarrolladorback · **Fecha:** 2026-11-02

## Archivos (todos del §2 de SPEC-10)

- [NUEVO] `db/10-limites-canal.sql` — tabla `limites_canal` y los datos de EJEMPLO literales de §4
  (marcados `[POR ACORDAR]`, PRY-R11). Se aplica después de `05-idempotencia.sql` por orden alfabético.
- [NUEVO] `src/modules/limites-por-canal/repository.js` — `buscarLimite(db, canal, moneda)` →
  `Decimal` o `null`. SQL parametrizado (`$1`, `$2`, PRY-R08); ejecutor como primer parámetro.
- [NUEVO] `src/modules/limites-por-canal/index.js` — exporta
  `{ id: 'limites-por-canal', tipo: 'validador', errores, ejecutar }` (contrato SPEC-06 §4).
- No se tocó `src/core/` (PRY-R05) ni otros módulos (PRY-R04). Los `*.test.js` del §2 son del tester.

## Reglas

- **LC-R01** · `ejecutar` llama `repository.buscarLimite(contexto.db, deposito.canal, deposito.moneda)`;
  se usa `moneda` (la del depósito), nunca `monedaAcreditar`. Además el validador corre antes que los
  transformadores (PIP, SPEC-07 §3), así que es la moneda previa a cualquier conversión.
- **LC-R02** · `new Decimal(monto).gt(maximo)` → `throw new ErrorApp('LIMITE_CANAL_EXCEDIDO')`; igual al
  límite no lanza (`gt`, no `gte`).
- **LC-R03** · `maximo === null` → `contexto.logger.warn({ canal, moneda }, ...)` y retorna sin lanzar.
- **LC-R04** · Comparación con `Decimal.gt`; el repository convierte el `NUMERIC` (string de pg) con
  `new Decimal(...)`. Ningún límite en el código: solo en la tabla.
- **LC-R05** · `ejecutar` solo desestructura `deposito` (no asigna nada) y no tiene `return` con valor.
- **Contrato §5** · `errores.LIMITE_CANAL_EXCEDIDO = { status: 422, mensaje: 'El monto supera el máximo
  permitido para el canal.' }`; el cargador lo registra (PIP-R10) y `manejadorErrores` da el 422.

## Decisiones

- `index.js` llama `repository.buscarLimite(...)` a través del objeto del módulo, para que
  `jest.mock('.../repository')` (LC-T04) lo reemplace sin problemas.
- `new Decimal(monto)` sobre el monto: el contrato dice que ya es `Decimal`; envolverlo es inocuo y no
  usa `Number`.
- `limites_canal` es de configuración: `tests/helpers/db.js` (SPEC-00) ya la excluye de `limpiar()`;
  no se modificó.

## Verificación

- `node -e "require('./src/modules/limites-por-canal')"` y `.../repository` cargan sin error.
- Prueba manual (no formal) contra PostgreSQL de pruebas, en un schema temporal con ROLLBACK:
  `buscarLimite(c,'AGENTE','PEN')` → `Decimal` `2000.00`; `ejecutar` con `2000.01` PEN → `ErrorApp`
  `LIMITE_CANAL_EXCEDIDO` 422. Con un `db` simulado: `1500.00` y `2000.00` no lanzan; sin fila →
  `logger.warn({ canal, moneda })`.

### `bash init.sh --rapido`

```
[OK]    SPEC-09: todos sus casos tienen prueba
[WARN]  SPEC-10 (en curso) aún sin prueba: LC-T01, LC-T02, LC-T03, LC-T04, LC-T05, LC-T06
[OK]    Alcance de archivos correcto (151 archivos revisados)
Test Suites: 9 passed, 9 total
Tests:       140 passed, 140 total
[OK]    Pruebas unitarias en verde (modo --rapido: integración NO ejecutada)
[OK]    Entorno listo (verificación rápida).
```
