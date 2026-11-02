# impl_09 — SPEC-09 historial-depositos

- **Agente:** desarrolladorback · **Fecha:** 2026-11-02

## Archivos (todos del §2)

| Archivo | Estado |
|---|---|
| `src/modules/historial-depositos/index.js` | NUEVO — `{ id: 'historial-depositos', tipo: 'endpoint', router }` |
| `src/modules/historial-depositos/routes.js` | NUEVO — `GET /cuentas/:numero/depositos`, `requiereRol('CLIENTE','AGENTE','CAJERO')`, `manejar(controller.listar)` |
| `src/modules/historial-depositos/schema.js` | NUEVO — `esquemaNumero` (HD-R01) y `esquemaQuery` (HD-R02) con zod |
| `src/modules/historial-depositos/controller.js` | NUEVO — valida `numero` y query (→ `FORMATO_INVALIDO`), llama al service, 200 |
| `src/modules/historial-depositos/service.js` | NUEVO — `listar(numero, filtros, usuario, correlationId)` |
| `src/modules/historial-depositos/repository.js` | NUEVO — `listar(db, filtros)` y `contar(db, filtros)`, solo SELECT sobre `depositos` |
| `tests/integration/historial-depositos/historial.test.js` | No creado: es del tester |

No se tocó `src/core/` (PRY-R05), ni otro módulo (PRY-R04), ni `manifest.yaml` (ya trae
`historial-depositos` activo). La auditoría `LISTAR_DEPOSITOS` ya la hace el middleware del core
(`ACCIONES_AUDITADAS` reconoce `GET /api/v1/cuentas/:numero/depositos`); el módulo no asigna
`res.locals.depositoId` (es una lista, no hay un depósito único).

## Reglas

- **HD-R01** · `schema.js`: `z.string().regex(/^\d{4}-\d{4}-\d{6}$/)`; si falla → `ErrorApp('FORMATO_INVALIDO')` antes de tocar billetera o BD.
- **HD-R02** · `pagina` y `tamano`: string de solo dígitos → entero, `pagina >= 1` (def. 1), `1 <= tamano <= 100` (def. 20); `estado` = `z.enum` de los 4 estados; `desde`/`hasta` = `z.string().datetime({ offset: true })` → `Date`; `refine` rechaza `desde > hasta`. Cualquier fallo → 400 `FORMATO_INVALIDO`.
- **HD-R03** · `repository.js`: `creado_en >= $n` y `creado_en <= $n`.
- **HD-R04** · `service.js`: si tiene AGENTE o CAJERO → `criterios.usuarioId = usuario.id` (`usuario_id = $n`), sin llamar a billetera.
- **HD-R05** · Solo CLIENTE → `billeteraClient.consultarCuenta`; `null` (404) o no titular → `permisos.esTitular` false → 403 `SIN_PERMISO`. 5xx/timeout → el client ya lanza `BILLETERA_NO_DISPONIBLE` (502, INT-R04) y se propaga.
- **HD-R06** · `ORDER BY creado_en DESC, id DESC LIMIT $n OFFSET $m`, ambos como parámetros; `OFFSET = (pagina - 1) * tamano`.
- **HD-R07** · `listar` y `contar` usan la misma función `armarWhere` con el mismo objeto `criterios` → mismos filtros. `contar` no aplica LIMIT/OFFSET.
- **HD-R08** · `filas.map((fila) => aJson(fila))`: sin segundo argumento, `aJson` no pone la clave `extensiones`. No se usa `pipeline.leerExtensiones` ni ninguna tabla de extensiones.
- **PRY-R01..R03** · routes → controller → service → repository/client; el service no tiene SQL ni HTTP.
- **PRY-R06** · No hay aritmética de dinero; `monto` sale de `aJson` (`Decimal.toFixed(2)`).
- **PRY-R08** · SQL 100 % parametrizado: lo único interpolado son las condiciones fijas del código y los índices `$n`, nunca valores de la petición.
- **PRY-R10** · El módulo no loguea; el client ya enmascara la cuenta.

## Decisiones

- **Usuario con varios roles** (p. ej. CLIENTE + AGENTE): va por la rama de operador (HD-R04 dice "si el usuario tiene rol AGENTE o CAJERO"; §3: "CLIENTE (y no AGENTE ni CAJERO)").
- **Operador sin `id`** en el token: 403 `SIN_PERMISO` defensivo (no puede filtrar por "usuario_id propio"). Con los tokens de SPEC-03 nunca ocurre (`sub` es obligatorio).
- **`desde`/`hasta`**: se exige fecha-hora completa con zona (`Z` u offset), como dice HD-R02 ("fecha-hora ISO 8601"); una fecha sola (`2026-10-01`) → 400.
- **`pagina`/`tamano`**: solo dígitos (máx. 9); se rechazan `''`, `1.5`, `1e2`, valores repetidos (`?pagina=1&pagina=2` llega como arreglo).
- Parámetros de query desconocidos se ignoran (zod los descarta); la spec no los prohíbe.
- `total`: `COUNT(*)::int` (número JSON como en el contrato; no es dinero).
- `listar` y `contar` se ejecutan en paralelo sobre el pool (`Promise.all`).
- **Nota para el tester (HD-T05):** PostgreSQL guarda microsegundos y JS milisegundos. Si el depósito se inserta con `creado_en` explícito en ms (como en `consultar.test.js`), `desde` = ese valor lo incluye.

## Verificación

- `node -e "require(...)"` (con `tests/setup/env.js`) de los 6 archivos: cargan sin error.
- Smoke manual (script en el scratchpad, fuera del repo; `crearApp` con manifest a medida, nock y BD de prueba, 25 depósitos):
  - T01 200, 20 elementos (página 1), más reciente primero, `monto "100.50"`, sin `extensiones`.
  - T03 `pagina=2&tamano=20` → 5 elementos, `total 25`.
  - T04 `estado=FALLIDO` → 5 elementos, `total 5`.
  - T05 `desde` = `creado_en` exacto → incluido; `hasta` = `creado_en` exacto → incluido.
  - T06 `usr-cliente-2` → 403 `SIN_PERMISO`. Billetera 404 → 403. Billetera 500 → 502 `BILLETERA_NO_DISPONIBLE`.
  - T07 `tamano=500`, `pagina=0`, `desde > hasta` → 400 `FORMATO_INVALIDO`; número mal formado → 400.
  - T08 `usr-agente-1` → solo sus 20 de 25 (5 son de `usr-agente-2`), sin interceptor de billetera.

### `bash init.sh --rapido`

```
[OK]    SPEC-08: todos sus casos tienen prueba (todo: CD-T07, CD-T08)
[WARN]  SPEC-09 (en curso) aún sin prueba: HD-T01 .. HD-T08
[OK]    Alcance de archivos correcto (145 archivos revisados)
Test Suites: 9 passed, 9 total · Tests: 140 passed, 140 total
[OK]    Entorno listo (verificación rápida).
```
