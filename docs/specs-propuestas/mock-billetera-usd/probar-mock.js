'use strict';

// Verifica el propio mock, sin deposito-service, enviándole peticiones correctas según el contrato v1.2.0.
// Uso: MOCK_URL=http://localhost:14100 node docs/specs-propuestas/mock-billetera-usd/probar-mock.js

const crypto = require('node:crypto');

const MOCK = process.env.MOCK_URL || 'http://localhost:14100';
const DEMORA_PENDIENTE_MS = 6000;
let fallos = 0;
let total = 0;

function ver(nombre, ok, detalle) {
  total += 1;
  if (!ok) fallos += 1;
  console.log(`${ok ? 'PASA ' : 'FALLA'} ${nombre}${ok ? '' : ` (${detalle})`}`);
}

async function control(ruta, cuerpo) {
  const r = await fetch(MOCK + ruta, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo ?? {}),
  });
  return r.status === 204 ? null : r.json();
}

async function post(cliente, opciones = {}) {
  const { clave = crypto.randomUUID(), cambios = {}, token } = opciones;
  const cabeceras = { 'Content-Type': 'application/json', 'Idempotency-Key': clave };
  if (token) cabeceras.Authorization = `Bearer ${token}`;
  const r = await fetch(`${MOCK}/api/v1/depositos/usd`, {
    method: 'POST',
    headers: cabeceras,
    body: JSON.stringify({
      cliente_id: cliente, monto: '10.00', moneda: 'USD', canal: 'AGENTE', metodo_origen: 'EFECTIVO', ...cambios,
    }),
  });
  return { status: r.status, cuerpo: await r.json(), cabeceras: r.headers, clave };
}

async function wallet(id, token) {
  const r = await fetch(`${MOCK}/api/v1/billetera/wallets/${id}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: r.status, cuerpo: await r.json() };
}

async function main() {
  await control('/__mock/reiniciar');

  const ok = await post('usr-cliente-1');
  ver('201 COMPLETADO con movimiento_saldo_id', ok.status === 201 && ok.cuerpo.estado === 'COMPLETADO' && Boolean(ok.cuerpo.movimiento_saldo_id), JSON.stringify(ok.cuerpo));

  const replay = await post('usr-cliente-1', { clave: ok.clave });
  ver('Replay → 200 con el mismo deposito_id', replay.status === 200 && replay.cuerpo.deposito_id === ok.cuerpo.deposito_id, replay.status);

  const conflicto = await post('usr-cliente-1', { clave: ok.clave, cambios: { monto: '11.00' } });
  ver('Misma clave y otro body → 409 IDEMPOTENCY_CONFLICT', conflicto.status === 409 && conflicto.cuerpo.code === 'IDEMPOTENCY_CONFLICT', conflicto.status);

  const sinCanal = await post('usr-cliente-1', { cambios: { canal: undefined } });
  ver('Sin canal → 400', sinCanal.status === 400, sinCanal.status);
  const extra = await post('usr-cliente-1', { cambios: { concepto: 'x' } });
  ver('Campo extra → 400', extra.status === 400, extra.status);
  const politica = await post('usr-cliente-1', { cambios: { metodo_origen: 'TRANSFERENCIA' } });
  ver('AGENTE con TRANSFERENCIA → 400 por la política', politica.status === 400, politica.status);
  const pen = await post('usr-cliente-1', { cambios: { moneda: 'PEN' } });
  ver('Moneda PEN → 400', pen.status === 400, pen.status);

  const r = await fetch(`${MOCK}/api/v1/depositos/usd`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'no-es-uuid' },
    body: '{}',
  });
  ver('Idempotency-Key que no es UUID v4 → 400', r.status === 400, r.status);

  for (const [cliente, codigo] of [
    ['usr-bloqueada', 'WALLET_BLOCKED'], ['usr-carrera', 'WALLET_BLOCKED'], ['usr-cerrada', 'WALLET_CLOSED'],
    ['usr-cliente-bloqueado', 'CUSTOMER_BLOCKED'], ['usr-sin-usd', 'USD_ACCOUNT_NOT_ENABLED'],
  ]) {
    const x = await post(cliente);
    ver(`${cliente} → 422 ${codigo}`, x.status === 422 && x.cuerpo.code === codigo, `${x.status} ${x.cuerpo.code}`);
  }

  const estados = [
    ['11111111-1111-4111-8111-111111111111', 'ACTIVE'],
    ['33333333-3333-4333-8333-333333333333', 'BLOCKED'],
    ['44444444-4444-4444-8444-444444444444', 'CLOSED'],
  ];
  for (const [id, estado] of estados) {
    const w = await wallet(id);
    ver(`GET billetera ${estado}`, w.status === 200 && w.cuerpo.estado === estado, w.cuerpo.estado);
  }
  const noExiste = await wallet(crypto.randomUUID());
  ver('GET billetera inexistente → 404 NO_ENCONTRADA', noExiste.status === 404 && noExiste.cuerpo.code === 'NO_ENCONTRADA', noExiste.status);

  const falla = await post('usr-falla-una-vez');
  ver('Fallo temporal → 503', falla.status === 503, falla.status);
  const reintento = await post('usr-falla-una-vez', { clave: falla.clave });
  ver('Reintento del fallo temporal → 201', reintento.status === 201, reintento.status);

  const inicio = Date.now();
  const lento = await post('usr-lento');
  ver('Lento → 201 tras unos 6 s', lento.status === 201 && Date.now() - inicio >= 5500, `${lento.status} en ${Date.now() - inicio} ms`);

  const pend = await post('usr-pendiente');
  ver('Pendiente → 202 VALIDADO con Location y Retry-After', pend.status === 202 && pend.cuerpo.estado === 'VALIDADO' && Boolean(pend.cabeceras.get('location')) && Boolean(pend.cabeceras.get('retry-after')), pend.status);
  const pendFalla = await post('usr-pendiente-falla');
  const pendReplay = await post('usr-pendiente', { clave: pend.clave });
  ver('Replay inmediato → 200 VALIDADO', pendReplay.status === 200 && pendReplay.cuerpo.estado === 'VALIDADO', pendReplay.cuerpo.estado);
  await new Promise((resolve) => { setTimeout(resolve, DEMORA_PENDIENTE_MS); });
  const pendFinal = await post('usr-pendiente', { clave: pend.clave });
  ver('Replay posterior → 200 COMPLETADO', pendFinal.status === 200 && pendFinal.cuerpo.estado === 'COMPLETADO', pendFinal.cuerpo.estado);
  const fallaFinal = await post('usr-pendiente-falla', { clave: pendFalla.clave });
  ver('Pendiente que falla → replay 200 FALLIDO', fallaFinal.status === 200 && fallaFinal.cuerpo.estado === 'FALLIDO', fallaFinal.cuerpo.estado);

  const antes = (await wallet('11111111-1111-4111-8111-111111111111')).cuerpo.balance;
  await post('usr-cliente-1');
  const despues = (await wallet('11111111-1111-4111-8111-111111111111')).cuerpo.balance;
  ver('Por defecto el depósito no cambia el saldo (Q13)', antes === despues, `${antes} → ${despues}`);
  await control('/__mock/config', { abonarBilletera: true });
  await post('usr-cliente-1');
  const abonado = (await wallet('11111111-1111-4111-8111-111111111111')).cuerpo.balance;
  ver('Con abonarBilletera, 350.75 + 10.00 = 360.75', abonado === '360.75', abonado);

  await control('/__mock/config', { exigirOauth: true });
  const sinToken = await wallet('11111111-1111-4111-8111-111111111111');
  ver('OAuth activo, sin token → 401', sinToken.status === 401, sinToken.status);
  const malo = await fetch(`${MOCK}/oauth2/token`, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: 'x', client_secret: 'y' }),
  });
  ver('Credenciales incorrectas → 401', malo.status === 401, malo.status);
  const pedir = async (scope) => (await (await fetch(`${MOCK}/oauth2/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: 'deposito-service',
      client_secret: 'secreto-solo-para-el-mock',
      ...(scope ? { scope } : {}),
    }),
  })).json()).access_token;
  const token = await pedir();
  const conToken = await wallet('11111111-1111-4111-8111-111111111111', token);
  ver('Con token válido → 200', conToken.status === 200, conToken.status);
  const sinScope = await post('usr-cliente-1', { token: await pedir('billetera/wallets.read') });
  ver('Token sin scope de escritura → 403 INSUFFICIENT_SCOPE', sinScope.status === 403 && sinScope.cuerpo.code === 'INSUFFICIENT_SCOPE', sinScope.status);

  await control('/__mock/reiniciar');
  console.log(`\n── Resumen: ${total - fallos} de ${total} comprobaciones pasan ──`);
  process.exitCode = fallos ? 1 : 0;
}

main().catch((err) => {
  console.error('No se pudo ejecutar:', err.message);
  process.exitCode = 2;
});
