# Arquitectura — Qué significa "hacer un buen trabajo"

> Este documento es un **mapa** hacia las reglas, no una copia de ellas. La fuente de verdad
> es `specs-v2/`. Si este archivo y una spec se contradicen, gana la spec y se reporta.
> Si algo no está en una spec, **no es un requisito** y no se programa (PRY-R12).

## Principios y dónde viven

| Principio | Regla | Dónde |
|---|---|---|
| Capas `routes → controller → service → repository / client`, sin saltos | PRY-R01..R03 | `specs-v2/00-proyecto.md` §4 |
| Un módulo solo depende de `src/core/`; nunca de otro módulo | PRY-R04, PRY-R05 | `00-proyecto.md` §4 |
| Dinero: `NUMERIC(15,2)` / `Decimal` / string `"150.00"`. Nunca `Number` | PRY-R06, R07 | `00-proyecto.md` §4 |
| SQL siempre parametrizado | PRY-R08 | `00-proyecto.md` §4 |
| Secretos y URLs solo vía `src/config.js` | PRY-R09 | `00-proyecto.md` §4 |
| Logs sin tokens ni cuentas completas (`enmascararCuenta`) | PRY-R10 | `00-proyecto.md` §4 |
| `[POR ACORDAR]` → mock que respete el contrato | PRY-R11 | `00-proyecto.md` §4 |
| Formato único de error y catálogo | DOM-R06..R09 | `01-dominio.md` |
| Contrato de módulo y huecos del pipeline | PIP-R01..R12 | `06-pipeline-y-cargador.md` |
| Decisiones donde el PDF y v1 se contradecían | D1..D11 | `specs-v2/README.md` |

## Forma del sistema

```
                 ┌──────────────── src/core/ (no conoce ninguna feature) ───────────────┐
petición ─► correlationId ─► auditoria ─► /health ─► autenticar ─► express.json ─► /api/v1
                                                                                   │
                     cargador.cargar(manifest)  ──►  routers de modules/<endpoint>/ ◄┘
                              │
                              └──► pipeline: validadores → transformadores → persistir → post-procesos
                                             ▲                  ▲                         ▲
                              modules/limites-por-canal  modules/conversion-moneda  modules/alerta-uif
```

Orden exacto de middlewares: PIP-R11. Orden del service de registro: diagrama de SPEC-07 §3.

## Estructura de carpetas

La define `specs-v2/00-proyecto.md` §2. Cada spec crea solo su parte (su §2).
`init.sh` (vía `.harness/alcance.js`) falla si aparece un archivo que ninguna spec declara.

Además de los archivos listados en algún §2, las specs permiten:

- `tests/unit/<id>/*.test.js`, `tests/integration/<id>/*.test.js`, `tests/core/*.test.js` (SPEC-00 §6).
- `tests/core/fixtures/**` — módulos falsos para el pipeline (SPEC-06 §6).
- `tests/reporte.md` (SPEC-00 §6) y `package-lock.json` (requerido por `npm ci`).

## Qué NO hacer

- No agregar dependencias fuera de las versiones exactas de SPEC-00 §1 (ni linters, ni ORMs).
- No crear capas, carpetas o archivos que ninguna spec declara.
- No nombrar features en `src/core/` (`pipeline.js` y `cargador.js` son genéricos).
- No modificar `src/core/` al implementar SPEC-07 a SPEC-12 (PRY-R05). Si una feature lo
  necesita, es un bloqueo que se reporta.
- No resolver un `[POR ACORDAR]` inventando un valor real (umbral UIF, límites, tipo de cambio).
