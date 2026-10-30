# Convenciones de código

> Homogeneidad extrema. La IA predice mejor cuando el repositorio se parece a sí mismo en todas
> partes. Las specs mandan; esto solo fija lo que las specs no dicen.

## Estilo JavaScript

- **Runtime:** Node.js 22 LTS, **CommonJS** (`require` / `module.exports`). Nada de ESM ni TypeScript.
- **Formato:** 2 espacios, punto y coma, comillas simples `'...'`, template strings para interpolar.
  Líneas de máximo 100 caracteres.
- **`'use strict';`** en la primera línea de cada archivo de `src/`, `mocks/` y `scripts/`.
- **Imports:** primero módulos de Node (`node:crypto`), luego paquetes, luego locales. Rutas
  locales relativas (`../core/errores`).
- **`async/await`** siempre; nada de callbacks ni `.then()` encadenados.
- Todo controller o middleware `async` va envuelto en `manejar(fn)` (DOM-R08).

## Nombres

Los nombres públicos son **exactamente** los que escribe la spec (`registrar`, `cambiarEstado`,
`enTransaccion`, `aJson`, `consultarCuenta`...). No se traducen ni se "mejoran".

| Tipo | Convención | Ejemplo |
|---|---|---|
| Archivos de `src/core/` | `camelCase.js` | `billeteraClient.js` |
| Carpetas de módulo | `kebab-case`, igual al `id` del manifest | `limites-por-canal/` |
| Funciones / variables | `camelCase`, en español | `buscarLimite` |
| Clases | `PascalCase` | `ErrorApp` |
| Constantes | `UPPER_SNAKE` | `ACCIONES_AUDITADAS` |
| Columnas SQL | `snake_case` | `monto_acreditar` |
| Campos JSON | `camelCase` | `montoAcreditar` |
| Códigos de error | `UPPER_SNAKE` del catálogo | `MONTO_INVALIDO` |

## Módulos

- Cada módulo exporta desde `index.js` el objeto que define SPEC-06 §4.
- Los repositories reciben el ejecutor (`db` o `tx`) como **primer parámetro**.
- Los errores se lanzan como `new ErrorApp('CODIGO', { depositoId })`. Nunca `res.status(...)`
  fuera de `manejadorErrores` y los controllers.

## Pruebas

- Jest 29 + Supertest 7 + nock 13. Ubicación según SPEC-00 §6:
  `tests/unit/<id>/`, `tests/integration/<id>/`, `tests/core/`. `<id>` es el `name` de
  `feature_list.json` (`dominio`, `seguridad`, `registrar-deposito`...).
- **El nombre de cada prueba empieza por el id del caso:**
  `test('LC-T03 AGENTE 2000.01 PEN → 422', ...)`. `init.sh` lo verifica.
- Caso que depende de una spec no implementada → `test.todo('SEG-T06 ...')`. Prohibidos
  `.skip` y `.only`.
- `limpiar()` en `beforeEach`; ninguna prueba depende de otra.
- Usuarios, cuentas y datos de prueba: solo los de SPEC-02 §4. Nunca inventar otros.

## Comentarios

Por defecto **no** se escriben. Solo cuando explican un *por qué* no obvio, idealmente citando la
regla: `// IDE-R04: reserva atómica, nunca SELECT + INSERT`.
