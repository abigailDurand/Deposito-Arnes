# deposito-service — construido con un arnés de subagentes

Microservicio de depósitos de un banco (proyecto de curso): recibe, valida y registra depósitos y
pide a billetera-service que acredite el dinero. Node.js 22 + Express 4 + PostgreSQL 16 + Docker.

> Este repo combina dos fuentes:
> - **Arnés:** [betta-tech/ejemplo-harness-subagentes](https://github.com/betta-tech/ejemplo-harness-subagentes)
>   (Harness Engineering: el repo ES el sistema, orquestación líder–trabajador–revisor, verificación ejecutable).
> - **Specs:** [TheLuisP23/DAPN-MICROSERVICIO-DEPOSITO](https://github.com/TheLuisP23/DAPN-MICROSERVICIO-DEPOSITO),
>   carpeta `specs-v2/` (la versión que resuelve las contradicciones de v1 y del PDF).

## Cómo está organizado el arnés

| Pilar | En este repo |
|---|---|
| **1. El repositorio ES el sistema** | `AGENTS.md`, `init.sh`, `feature_list.json`, `progress/`, `docs/`, `specs-v2/` |
| **2. Orquestación multi-agente** | `.claude/agents/leader.md`, `desarrolladorback.md`, `tester.md`, `revisor.md` |
| **3. Supervisión y mejora** | `CHECKPOINTS.md`, `.harness/` (verificadores), hooks en `.claude/hooks/`, `tests/` |

Diferencias con el arnés original:

- Los roles son los que nombran las specs (`desarrolladorback`, `tester`, `revisor`); el
  implementer original se separa en desarrollador y tester.
- `feature_list.json` tiene una entrada por spec (SPEC-00 a SPEC-12) con `depende_de`.
- `init.sh` además verifica que `specs-v2/` no se tocó (PRY-R12), que no aparecen archivos fuera
  del §2 de las specs y que cada caso `XX-Tnn` de una feature `done` tiene su prueba.

## Para empezar

1. Abre **Docker Desktop** (hace falta PostgreSQL para las pruebas de integración).
2. `bash init.sh` → debe terminar verde.
3. Lanza Claude Code en la raíz: `claude` (los hooks de `.claude/settings.json` se cargan solos;
   la primera vez Claude Code te pedirá confiar en ellos).
4. Pídele: **«implementa la siguiente feature pendiente»**.

El **leader** lanza `desarrolladorback` → `tester` → `revisor`. Por chat no pasa código, solo
referencias a archivos:

| Archivo | Quién lo escribe | Qué contiene |
|---|---|---|
| `progress/current.md` | todos | Plan vivo y bloqueos de la sesión |
| `progress/impl_<NN>.md` | desarrolladorback | Archivos tocados y cómo cumple cada regla |
| `tests/reporte.md` | tester | Casos cubiertos, `test.todo`, fallos, cobertura |
| `progress/review_<NN>.md` | revisor | Veredicto con archivo:línea:regla |
| `feature_list.json` | desarrolladorback / revisor | `pending` → `in_progress` → `done` |
| `progress/history.md` | leader | Resumen append-only al cerrar |

## Pendientes heredados de las specs

Las specs marcan `[POR ACORDAR]` (P1–P8 en `specs-v2/README.md`): contrato real de billetera,
JWT de usuario-service, tipo de cambio, umbral UIF, límites por canal y stack del frontend. Se
implementan con mocks que respetan el contrato propuesto; nunca con valores inventados.
El frontend (`desarrolladorfront`) queda fuera hasta que se acuerde su stack (P8).

## Estructura

```
.
├── AGENTS.md · CLAUDE.md · CHECKPOINTS.md · README.md
├── feature_list.json        # SPEC-00..12 con estado y dependencias
├── init.sh                  # Verificación (bash init.sh [--rapido])
├── specs-v2/                # Fuente de verdad (solo lectura)
├── docs/                    # architecture, conventions, verification, referencia/PDF
├── progress/                # current.md, history.md, informes de subagentes
├── .claude/agents/          # leader, desarrolladorback, tester, revisor
├── .claude/hooks/           # proteger specs, pruebas rápidas, verificación final
└── .harness/                # verificadores que usa init.sh
```

El código (`src/`, `db/`, `tests/`, `mocks/`, `scripts/`, Docker) lo crean los subagentes, spec
por spec, según `specs-v2/00-proyecto.md` §2.
