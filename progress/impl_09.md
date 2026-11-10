# impl_09 — SPEC-09 historial-depositos (RETRABAJO, spec v1.2)

Retrabajo por integración Billetera USD (AGENTS.md §5). Rama `inte_biUsd`.

## Archivos modificados (todos del §2)
- `src/modules/historial-depositos/schema.js` [MODIFICADO] — `esquemaNumero` usa `RE_NUMERO`
  (PEN `^\d{4}-\d{4}-\d{6}$` o UUID minúsculas, sin flag `i`). Tomado de `Busti:codigo/src/modules/historial-depositos/schema.js`.

Sin cambios: `index.js`, `routes.js`, `controller.js`, `service.js`, `repository.js`
(el enrutamiento PEN/USD lo hace `billeteraClient.js` de SPEC-02). No se tocaron tests.

## Reglas
- HD-R01: regex combinada idéntica a `RE_CUENTA` de RD-R02; mayúsculas/incompleto → falla zod → 400 `FORMATO_INVALIDO` (controller sin cambios).
- HD-R02..HD-R08: sin cambios respecto a la versión aprobada.

## Verificación
- `node -e` sobre `esquemaNumero`: `0011-0123-456789` ok, `11111111-1111-4111-8111-111111111111` ok,
  UUID con `A` mayúscula rechazado, `1111` rechazado.
- `bash init.sh` (completo): 23 suites, 396 passed + 1 todo, 0 fallas. "Entorno listo".

## Para el tester
- Ninguna prueba existente falla por el cambio.
- Pendientes de spec v1.2: HD-T09..HD-T12 (Billetera USD). HD-T02 ahora usa `usr-cliente-2` con
  `22222222-2222-4222-8222-222222222222`: revisar si la prueba actual usa otro dato y actualizarla.
