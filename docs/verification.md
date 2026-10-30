# Verificación — Cómo demostrar que el trabajo funciona

> Regla de oro: **el agente no dice "funciona", lo demuestra**.
> Toda feature termina con evidencia ejecutable, no con afirmaciones.

## Requisitos del entorno

- Node.js ≥ 22 y npm.
- Docker Desktop **corriendo** (PostgreSQL 16 de pruebas y `docker compose up`).
- Tras SPEC-00: `npm install` y `docker compose up -d db`. No hace falta crear la BD de pruebas a
  mano: `globalSetup` crea `deposito_test` si no existe y reinicia su esquema en cada corrida (D12).

## Niveles de verificación

### Nivel 0 — Arnés (siempre)

```bash
bash init.sh            # completo: unitarias + integración (requiere PostgreSQL)
bash init.sh --rapido   # solo unitarias; lo usa el hook al cerrar sesión
```

`init.sh` comprueba además, sin ejecutar código del proyecto:

- `specs-v2/` intacto.
- `feature_list.json` coherente (1 en curso como máximo, dependencias `done`).
- Alcance: ningún archivo fuera de los §2 ni de specs `pending`.
- Cada caso `XX-Tnn` de una feature `done` tiene una prueba con ese id.

### Nivel 1 — Unitarias (obligatorio)

```bash
npm run test:unit
```

Cubren funciones puras y módulos con dependencias simuladas (`jest.mock` solo donde la spec lo
pide, p. ej. LC-T04).

### Nivel 2 — Integración (obligatorio para todo lo que toca BD o HTTP)

```bash
docker compose up -d db
npm run test:integration    # --runInBand, PostgreSQL real (DATABASE_URL_TEST), billetera con nock
```

Las extensiones (SPEC-10 a 12) se prueban **activas e inactivas** pasando un manifest a medida
a `crearApp({ manifest })`.

### Nivel 3 — Smoke end-to-end (recomendado desde SPEC-07)

```bash
docker compose up -d --build
node scripts/generar-token.js usr-agente-1      # copia el token
curl -s -X POST http://localhost:3000/api/v1/depositos \
  -H "Authorization: Bearer <token>" -H "Idempotency-Key: smoke-0001" \
  -H "Content-Type: application/json" \
  -d '{"cuentaDestino":"0011-0123-456789","monto":"150.00","moneda":"PEN","canal":"AGENTE"}'
docker compose down
```

## Evidencia que se deja en disco

| Quién | Archivo | Contenido mínimo |
|---|---|---|
| desarrolladorback | `progress/impl_<NN>.md` | Archivos tocados (todos del §2), decisiones, salida de `bash init.sh --rapido` |
| tester | `tests/reporte.md` (sección de la spec) | Casos cubiertos, `test.todo` con motivo, fallidos con causa, cobertura |
| revisor | `progress/review_<NN>.md` | Veredicto, reglas verificadas con archivo:línea, checkpoints, salida de `bash init.sh` |

## Anti-patrones (no hacer)

- ❌ "Debería funcionar." → falta prueba ejecutable.
- ❌ Prueba que solo verifica que no lanza. → tiene que comprobar status, cuerpo y filas en BD.
- ❌ Mockear PostgreSQL en integración. → BD real con `limpiar()`.
- ❌ Bajar la cobertura, usar `.skip` o borrar un caso para que pase.
- ❌ Marcar `done` con `bash init.sh` en rojo o sin haberlo corrido completo (con BD).

Si no hay PostgreSQL disponible, la feature **no se cierra**: queda `in_progress` y se anota en
`progress/current.md`.
