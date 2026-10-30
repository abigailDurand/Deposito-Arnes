# AGENTS.md — Mapa de navegación para agentes de IA

> Punto de entrada para cualquier agente que trabaje en **deposito-service**.
> NO es una biblia de reglas: es un **mapa**. Las reglas viven en `specs-v2/`.
> Lee solo lo que necesites cuando lo necesites (divulgación progresiva).

---

## 1. Antes de empezar (obligatorio)

1. Ejecuta `bash init.sh` y verifica que termina sin errores. Si falla, **para**.
2. Lee `progress/current.md` para saber en qué quedó la última sesión.
3. Lee `feature_list.json` y elige **una** feature `pending` cuyas `depende_de` estén
   todas en `done`. No trabajes en más de una a la vez.

## 2. Mapa del repositorio

| Archivo / carpeta | Qué contiene | Cuándo leerlo |
|---|---|---|
| `feature_list.json` | Una entrada por spec (SPEC-00 a SPEC-12) con estado | Siempre, al empezar |
| `progress/current.md` | Estado de la sesión actual | Siempre, al empezar |
| `progress/history.md` | Bitácora append-only | Si necesitas contexto histórico |
| `specs-v2/README.md` | Cómo están escritas las specs + decisiones D1–D11 + pendientes P1–P8 | Una vez, al empezar |
| `specs-v2/00-proyecto.md` | Stack exacto, reglas de oro PRY-R01..R12, reglas de pruebas y revisión | **Siempre** antes de tocar código |
| `specs-v2/NN-*.md` | La spec de la feature en curso (6 secciones fijas) | La de tu feature |
| `specs-v2/manifest.yaml` | Qué features están activas (lo lee el cargador) | Si trabajas en SPEC-06 a 12 |
| `docs/architecture.md` | Resumen de capas y dónde vive cada regla | Antes de implementar |
| `docs/conventions.md` | Estilo de código JS y de pruebas | Antes de escribir código |
| `docs/verification.md` | Cómo demostrar que funciona (unit, integración, smoke) | Antes de pedir revisión |
| `docs/referencia/*.pdf` | PDF de arquitectura original (fuente de las specs) | Solo si una spec cita el PDF |
| `CHECKPOINTS.md` | Criterios objetivos de "estado final correcto" | Para auto-evaluarte |
| `.claude/agents/` | leader, desarrolladorback, tester, revisor | Si orquestas trabajo |
| `.harness/` | Scripts de verificación que usa `init.sh` | Si `init.sh` falla |

## 3. Reglas duras (no negociables)

- **Una sola feature a la vez**, y solo si sus dependencias están en `done`.
- **Solo se tocan los archivos del §2 de la spec en curso.** `init.sh` falla si aparece
  un archivo que ninguna spec declara, o un archivo de una spec que sigue `pending`.
- **`specs-v2/` es de solo lectura** (PRY-R12). Si algo es ambiguo, contradictorio o
  falta → estado `blocked`, se anota en `progress/current.md` y se para. **Nunca supongas.**
- **`[POR ACORDAR]` se implementa con mock que respete el contrato** (PRY-R11), nunca con
  valores inventados.
- **No hay `done` sin pruebas verdes**: `bash init.sh` completo (con PostgreSQL) en verde y
  cada caso `XX-Tnn` de la spec con su prueba.
- **Documenta mientras trabajas** en `progress/current.md`, no al final.

## 4. Cómo elegir una feature

```
1. Abre feature_list.json
2. Filtra status == "pending" y depende_de ⊆ features done
3. Coge la de menor "id" (coincide con el número de spec)
4. Cambia su status a "in_progress" y guarda
5. Anota en progress/current.md: feature, hora de inicio, plan breve
```

## 5. Flujo por feature

```
leader ──► desarrolladorback ──► tester ──► revisor ──► (APROBADO) done
               │                    │          │
               ▼                    ▼          ▼
     progress/impl_NN.md   tests/reporte.md   progress/review_NN.md
```

Si el revisor responde RECHAZADO, el leader relanza a quien corresponda con la ruta del
review. Máximo 2 vueltas; a la tercera, `blocked`.

## 6. Cierre de sesión

1. `bash init.sh` — todo verde.
2. Resumen de `progress/current.md` al final de `progress/history.md`.
3. Vacía `progress/current.md` dejando solo la plantilla.
4. Sin archivos temporales, `console.log` de debug ni TODOs sin contexto.

## 7. Si te bloqueas

- Relee la spec y `specs-v2/README.md` (las decisiones D1–D11 resuelven muchas dudas).
- Si la herramienta no hace lo que esperas, **no inventes un workaround**: documenta el
  bloqueo en `progress/current.md`, pon la feature en `blocked` y para.
