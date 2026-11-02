# impl_12 — SPEC-12 alerta-uif

**Agente:** desarrolladorback · **Fecha:** 2026-11-02

## Archivos (todos del §2 de SPEC-12)

- [NUEVO] `db/12-alerta-uif.sql` — tabla `alertas_uif` literal de §4. Se aplica después de `00-core.sql`
  (`depositos` ya existe). `limpiar()` de `tests/helpers/db.js` ya la vacía (todas salvo `limites_canal`).
- [NUEVO] `src/modules/alerta-uif/repository.js` — `insertar(db, alerta)`, SQL parametrizado (PRY-R08), ejecutor primero.
- [NUEVO] `src/modules/alerta-uif/index.js` — `{ id: 'alerta-uif', tipo: 'post-proceso', ejecutar }`, sin `leerExtension`.
- [SOLO LEER] `src/config.js` — ya expone `config.uif.umbralPEN` / `config.uif.umbralUSD` como string o `null`.
- No se tocó `src/core/` (PRY-R05) ni otros módulos (PRY-R04). Los `*.test.js` del §2 son del tester.

## Reglas

- **UIF-R01** · El llamado solo con COMPLETADO lo garantiza `registrar-deposito` (`acreditarYCerrar` llama a
  `ejecutarPostProcesos` tras `cambiarEstado(..., 'COMPLETADO')`, también en el reintento). El módulo no filtra de nuevo.
- **UIF-R02** · Usa `deposito.monto` y `deposito.moneda`; nunca `montoAcreditar` / `monedaAcreditar`.
- **UIF-R03** · `new Decimal(monto).gte(new Decimal(umbral))` → `repository.insertar` con `id = crypto.randomUUID()`,
  `estado_reporte = 'PENDIENTE'` y el umbral usado (`toFixed(2)`). Monto y umbral viajan como string de 2 decimales.
- **UIF-R04** · El umbral se lee de `config.uif['umbral' + moneda]` en cada llamada (sin valor en el código ni en
  la BD). Si es `null` → `contexto.logger.warn({ depositoId, moneda }, ...)` y return, sin alerta.
- **UIF-R05** · `ejecutar` no modifica `deposito`, no devuelve nada y el módulo no exporta `leerExtension`.
- **UIF-R06** · `try/catch` alrededor del INSERT → `contexto.logger.error({ depositoId, error, codigoError }, ...)`,
  sin relanzar. Solo mensaje y código del error (PRY-R10: el `detail` de pg puede traer valores de la fila).
- **UIF-R07** · `estado_reporte` vive solo en `alertas_uif` (con su CHECK); nada se escribe en auditoría.
- **UIF-R08** · No se implementa fraccionamiento ni pantalla de cumplimiento.

## Decisiones

- `index.js` llama `repository.insertar` y lee `config` a través del objeto del módulo, para que `jest.mock`
  funcione (UIF-T04 forzar error, UIF-T07 config sin `UIF_UMBRAL_PEN`).
- Un umbral configurado con texto no numérico haría lanzar `new Decimal(...)`; ese error lo atrapa el pipeline
  (PIP-R04: `logger.error` con `depositoId`, no se propaga). No se añadió validación extra: la spec no la define.

## Verificación

- `node -e "require('./src/modules/alerta-uif/repository')"` → OK. `index.js` carga con las variables obligatorias
  de entorno (sin ellas falla `config.js`, como corresponde a SPEC-00).
- Prueba manual (no formal) con `db` y `logger` simulados, `UIF_UMBRAL_PEN=1000.00` y sin `UIF_UMBRAL_USD`:
  1000.00 PEN → 1 INSERT `[uuid, id, "1000.00", "PEN", "1000.00"]`; 999.99 PEN → nada; 300.00 USD → `warn`
  con `depositoId` y `moneda`; INSERT que lanza → `error` con `depositoId`, sin relanzar.

### `bash init.sh --rapido`

```
[WARN]  SPEC-12 (en curso) aún sin prueba: UIF-T01, UIF-T02, UIF-T03, UIF-T04, UIF-T05, UIF-T06, UIF-T07
[OK]    Alcance de archivos correcto (166 archivos revisados)
Test Suites: 11 passed, 11 total
Tests:       163 passed, 163 total
[OK]    Pruebas unitarias en verde (modo --rapido: integración NO ejecutada)
[OK]    Entorno listo (verificación rápida).
```

## Nota operativa

- Un comando auxiliar que solo editaba `progress/current.md` (intento con `python`, que en esta máquina se quedó
  colgado; el cambio se hizo después con Edit) quedó en segundo plano (tarea `ba7elmj8l`). Ya terminó (exit 0)
  sin tocar la BD ni duplicar líneas en `progress/current.md` (verificado).
