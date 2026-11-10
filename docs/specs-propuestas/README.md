# Specs propuestas: Billetera USD v1.2.0

Estas specs **no están vigentes**. Las vigentes siguen en `specs-v2/`, que solo edita una persona (PRY-R12).
Motivo y decisiones: `docs/propuesta-billetera-usd-v1.2.md`.

## Qué cambia

| Spec | Versión | Cambio |
|---|---|---|
| 00-proyecto | 1.3 | Variables OAuth y de reconciliación |
| 01-dominio | 1.2 | Columna `titular_id`; depósitos que permanecen en `PROCESANDO` |
| 02-integraciones | 2.1 | `cliente_id` = titular; sin `cuenta_destino_id`; `canal`; `estado`; 202; 422; OAuth |
| 06-pipeline-y-cargador | 1.2 | `titularId`; inicio de la reconciliación |
| 07-registrar-deposito | 2.1 | 202, rechazos 422 y reconciliación |
| 08-consultar-deposito | 1.3 | Consulta de depósitos pendientes y de billeteras bloqueadas |
| 09-historial-depositos | Sin cambios | Copia de la vigente |
| 11-conversion-moneda | 1.2 | Sin conversión hacia cuentas USD (D1) |
| 12-alerta-uif | 1.3 | Alerta también tras una reconciliación |

**Bloqueantes resueltos (2026-11-09):** Q13 (`POST /depositos/usd` abona la billetera, INT-R14) y Q14 (la cuenta
en dólares es la billetera USD del cliente; se omite `cuenta_destino_id`, INT-R07). Q13 requiere el cambio en
Billetera USD. El mock lo emula con `POST /__mock/config {"abonarBilletera": true}`; el valor por defecto
(`false`) refleja el servidor real de hoy.

## Mock de Billetera USD v1.2.0

`mock-billetera-usd/` emula lo que consume deposito-service. Vive aquí porque `mocks/` solo cambia con una spec
aprobada. Al aprobarse SPEC-02 v2.1, sus rutas USD deben pasar a `mocks/billetera/server.js`.

| Archivo | Para qué sirve |
|---|---|
| `server.js`, `Dockerfile`, `k8s.yaml` | El mock (puerto 4100) |
| `probar-mock.js` | Comprueba el propio mock con peticiones correctas |
| `probar-integracion.js` | Prueba de punta a punta a través de deposito-service |

Como el body ya no lleva la billetera, los casos especiales dependen de `cliente_id`. Los datos están en SPEC-02 §4.

### Cómo ejecutarlo en kind

Con `BILLETERA_USD_URL` del servicio apuntando a `http://billetera-usd-mock:4100`:

```bash
M=docs/specs-propuestas/mock-billetera-usd
docker build -t billetera-usd-mock:1.2.0 $M
kind load docker-image billetera-usd-mock:1.2.0 --name deposito
kubectl apply -f $M/k8s.yaml
kubectl -n deposito port-forward svc/deposito-service 18080:80 &
kubectl -n deposito port-forward svc/billetera-usd-mock 14100:4100 &
node $M/probar-mock.js
node $M/probar-integracion.js           # contrato estricto
node $M/probar-integracion.js --laxo    # sin exigir canal
node $M/probar-integracion.js --oauth   # además OAuth; requiere la implementación
```

Variables del servicio para OAuth contra el mock: `BILLETERA_USD_TOKEN_URL=http://billetera-usd-mock:4100/oauth2/token`,
`BILLETERA_USD_CLIENT_ID=deposito-service` y `BILLETERA_USD_CLIENT_SECRET=secreto-solo-para-el-mock`.

### Línea base (2026-11-06, código actual, sin implementar la propuesta)

- `probar-mock.js`: **30 de 30**.
- `probar-integracion.js`: **2 de 15** con contrato estricto y **4 de 15** en modo laxo. Son fallos esperados: el
  objetivo es llegar a 15 de 15 (16 con `--oauth`) al implementar la propuesta.

| Fallo detectado | Casos |
|---|---|
| No envía `canal`: toda acreditación USD responde 400 y termina en 502 | Casi todos, en modo estricto |
| `cliente_id` es el agente, no el titular | E02 |
| Envía el UUID de la billetera en `cuenta_destino_id` | E02 |
| Ignora el `estado`: acredita en `BLOCKED` y `CLOSED` | E06, E07 |
| Convierte y acredita PEN hacia una cuenta USD | E15 |

En modo laxo, E08 a E14 responden 201 porque el servicio envía `usr-agente-1` y el comportamiento especial del mock
depende del titular. Sus fallos **aún no prueban** el manejo de 422, 202, 503 ni timeouts: hay que volver a
evaluarlos tras corregir `cliente_id`.

La prueba todavía no se ha visto pasar completa con un cliente correcto, porque ese cliente no existe aún.
