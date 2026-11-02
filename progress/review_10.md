# Review — SPEC-10 limites-por-canal

**Revisor** · 2026-11-02 · Feature 10

**Veredicto:** APROBADO CON OBSERVACIONES

Las observaciones son para el humano (una posible ambigüedad de spec y un recordatorio sobre `[POR ACORDAR]`).
Ninguna incumple una regla de spec.

## Alcance (§2)

Archivos nuevos: `src/modules/limites-por-canal/index.js`, `src/modules/limites-por-canal/repository.js`,
`db/10-limites-canal.sql`, `tests/unit/limites-por-canal/limites.test.js`,
`tests/integration/limites-por-canal/limites.test.js`. Son exactamente los del §2. Los cambios en `tests/reporte.md`,
`progress/*` y `feature_list.json` son del arnés. `init.sh` da: "Alcance de archivos correcto (154 archivos revisados)".

## Reglas

- [x] PRY-R01..R03 — Es un validador (no tiene routes/controller/service). El único SQL está en `repository.js:7-10`. No hace HTTP.
- [x] PRY-R04 — `index.js:5-6` solo importa `../../core/errores` y su propio `./repository`. Solo lee `limites_canal`, que es su propia tabla.
- [x] PRY-R05 — `git diff HEAD -- src/core` está vacío y no hay archivos sin trackear en `src/core/`. Grep de `limites|LIMITE` en `src/core/` → 0 coincidencias.
- [x] PRY-R06/R07 — `repository.js:11` hace `new Decimal(rows[0].monto_maximo)` (string de pg) y `index.js:26` hace `new Decimal(monto).gt(maximo)`. En SQL es `NUMERIC(15,2)` (`db/10-limites-canal.sql:5`). Grep de `Number(` / `parseFloat` en el módulo → 0 coincidencias.
- [x] PRY-R08 — `repository.js:8-9` usa `WHERE canal = $1 AND moneda = $2` con `[canal, moneda]`. No hay concatenación.
- [x] PRY-R09 — No hay URLs ni secretos (grep de `http://` → 0 coincidencias).
- [x] PRY-R10 — `index.js:22` registra solo `{ canal, moneda }` en el log: sin cuenta, token ni datos personales. No hay `console.log`.
- [x] PRY-R11 — `db/10-limites-canal.sql:8-12` copia literalmente los valores de ejemplo de §4 y conserva el comentario `[POR ACORDAR]`. No se inventó ningún valor (ver observación 2).
- [x] PRY-R12 — `specs-v2/` intacto (`init.sh`: "specs-v2/ intacto (15 archivos)").
- [x] LC-R01 — `index.js:17-19` busca con `deposito.canal` y `deposito.moneda` (no con `monedaAcreditar`). Lo cubre la prueba unitaria "LC-R01 … no por monedaAcreditar".
- [x] LC-R02 — `index.js:26` usa `gt` (no `gte`) y lanza `ErrorApp('LIMITE_CANAL_EXCEDIDO')`. Probado con el monto igual al límite (unitaria e integración) y con un centavo más.
- [x] LC-R03 — `index.js:20-23`: si `maximo === null`, hace `contexto.logger.warn({ canal, moneda }, …)` y `return` sin lanzar.
- [x] LC-R04 (revisor §6) — Compara con `Decimal.gt`. No hay ningún límite literal en `src/`: el único lugar con valores es `db/10-limites-canal.sql`. La prueba con `9007199254740993.01` demuestra que no se usa `Number`. Las pruebas con `UPDATE` sobre la BD real demuestran que cambiar la tabla cambia el resultado.
- [x] LC-R05 (revisor §6) — `index.js:17` solo desestructura y no hace ninguna asignación sobre `deposito`. Las únicas salidas son `return;` (línea 23) y caer al final de la función, así que siempre devuelve `undefined`. Lo cubre la prueba unitaria "LC-R05".
- [x] Contrato §5 / SPEC-06 — `index.js:8-13,29` exporta `{ id: 'limites-por-canal', tipo: 'validador', errores, ejecutar }` con `LIMITE_CANAL_EXCEDIDO` → 422 y el mensaje exacto de §5. LC-T05 verifica el cuerpo exacto `{ codigo, mensaje, correlationId }`.

## Casos de prueba

- [x] LC-T01 … LC-T04 (unitarias, `tests/unit/limites-por-canal/limites.test.js:93-136`). Afirman resultados concretos: `resolves.toBeUndefined()`, argumentos de `buscarLimite`, código, status y mensaje del error, y `warn` con `{ canal, moneda }`. LC-T04 usa `jest.mock` como pide la spec.
- [x] LC-T05, LC-T06 (integración con PostgreSQL real y nock, `tests/integration/limites-por-canal/limites.test.js:317-351`).
- 6/6 son pruebas reales y no hay `test.todo`. Hay además pruebas por regla (LC-R01, R02, R04, R05, repository y datos de la tabla).

### Interpretación de LC-T05 ("billetera no llamada")

La prueba afirma 0 POST de acreditación y exactamente 1 GET de consulta de cuenta. **La considero correcta.**
SPEC-07 RD-R04 fija el orden del diagrama, y en el código `service.js:76` (`consultarCuenta`) va antes que
`service.js:99` (`ejecutarValidadores`). Por eso es imposible que haya 0 llamadas a billetera sin violar RD-R04 o
sin tocar `src/core`/SPEC-07. Además, el criterio de aceptación de SPEC-10 ("sin guardar nada ni llamar a
billetera") se refiere a la acreditación, con el mismo criterio que RD-T05/T06. Aun así, la redacción literal de
LC-T05 es ambigua: ver la observación 1.

## Checkpoints

- C1: [x] Arnés completo; `bash init.sh` con exit 0.
- C2: [x] Solo hay una feature `in_progress` (la 10) y sus dependencias (06, 07) están `done`. `progress/current.md` describe la sesión activa.
- C3: [x] `specs-v2/` intacto, alcance correcto, ningún archivo de spec `pending` y `src/core/` sin modificar (PRY-R05).
- C4: [x] PRY-R01..R04, R06..R10, LC-R04 y LC-R05 verificados arriba.
- C5: [x] Cada LC-Tnn tiene una prueba con el prefijo correcto. La integración usa PostgreSQL real y nock. La extensión se prueba ACTIVA (LC-T05) e INACTIVA (LC-T06) con un manifest a medida. Cobertura de `src/core` 98.93 %, de `src/modules/limites-por-canal` 100 % y total 99.52 %. `tests/reporte.md` incluye las secciones de casos cubiertos, todo y fallidos.

## Observaciones (para el humano, no bloquean)

1. **Posible ambigüedad de spec — `specs-v2/10-limites-por-canal.md` §6 LC-T05.** Dice "billetera no llamada",
   pero RD-R04 (SPEC-07) obliga a consultar la cuenta (GET) antes de los validadores. El tester lo interpretó como
   "sin acreditación" (0 POST `/creditos`, 1 GET), y es la única lectura compatible con RD-R04. Se recomienda que
   el humano aclare la redacción en una próxima versión de la spec (p. ej. "billetera no acreditada").
   No se editó `specs-v2/` (PRY-R12).
2. **PRY-R11 — `db/10-limites-canal.sql:8-12`.** Los límites son los valores de EJEMPLO `[POR ACORDAR]` de la spec,
   copiados literalmente y con su marca. El equipo debe definir los valores reales antes de producción. Como
   LC-R04 lo garantiza, cambiarlos no requiere tocar código.

## Cambios requeridos

Ninguno.

## Salida de `bash init.sh`

```
[OK]    specs-v2/ intacto (15 archivos)
[OK]    feature_list.json válido (13 features: pending=2 in_progress=1 done=10 blocked=0)
[OK]    SPEC-00 … SPEC-09: todos sus casos tienen prueba (SPEC-08 todo: CD-T07, CD-T08)
[OK]    SPEC-10: todos sus casos tienen prueba
[OK]    Alcance de archivos correcto (154 archivos revisados)
Test Suites: 19 passed, 19 total
Tests:       2 todo, 316 passed, 318 total
[OK]    Todas las pruebas en verde (unitarias + integración)
[OK]    Entorno listo. Puedes empezar a trabajar.
```
