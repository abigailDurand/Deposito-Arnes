'use strict';

// Prueba de punta a punta: cliente → deposito-service → mock de Billetera USD v1.2.0.
// Comprueba el comportamiento de docs/specs-propuestas/. Uso:
//   SERVICE_URL=http://localhost:18080 MOCK_URL=http://localhost:14100 \
//     node docs/specs-propuestas/mock-billetera-usd/probar-integracion.js [--laxo] [--oauth]
//
//   --laxo   el mock no exige `canal`: deja ver los demás fallos de un cliente que aún no lo envía.
//   --oauth  además prueba OAuth; el servicio debe tener BILLETERA_USD_TOKEN_URL y sus credenciales.

const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const SERVICE = process.env.SERVICE_URL || 'http://localhost:18080';
const MOCK = process.env.MOCK_URL || 'http://localhost:14100';
const ESPERA_RECONCILIACION_MS = Number(process.env.ESPERA_RECONCILIACION_MS || 70000);
const LAXO = process.argv.includes('--laxo');
const OAUTH = process.argv.includes('--oauth');

const B = {
  uno: '11111111-1111-4111-8111-111111111111',
  dos: '22222222-2222-4222-8222-222222222222',
  bloqueada: '33333333-3333-4333-8333-333333333333',
  cerrada: '44444444-4444-4444-8444-444444444444',
  carrera: '55555555-5555-4555-8555-555555555555',
  clienteBloqueado: '66666666-6666-4666-8666-666666666666',
  sinUsd: '77777777-7777-4777-8777-777777777777',
  lenta: '88888888-8888-4888-8888-888888888888',
  pendiente: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  pendienteFalla: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  fallaUnaVez: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
};
const INEXISTENTE = '12345678-1234-4234-8234-123456789012';

function token(usuario) {
  const r = spawnSync(process.execPath, ['scripts/generar-token.js', usuario], {
    cwd: RAIZ,
    encoding: 'utf8',
    env: { ...process.env, BILLETERA_USD_URL: process.env.BILLETERA_USD_URL || 'http://localhost:4000' },
  });
  if (r.status !== 0) throw new Error(`No se pudo generar el token de ${usuario}: ${r.stderr}`);
  return r.stdout.trim();
}
const TOKENS = { agente: token('usr-agente-1'), cliente: token('usr-cliente-1') };

async function mock(ruta, cuerpo) {
  const r = await fetch(MOCK + ruta, cuerpo === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  return r.status === 204 ? null : r.json();
}

async function depositar(quien, datos, clave = crypto.randomUUID()) {
  const r = await fetch(`${SERVICE}/api/v1/depositos`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKENS[quien]}`,
      'Idempotency-Key': clave,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ monto: '10.00', moneda: 'USD', canal: 'AGENTE', ...datos }),
    signal: AbortSignal.timeout(20000),
  });
  return { status: r.status, cuerpo: await r.json(), clave };
}

async function consultar(quien, id) {
  const r = await fetch(`${SERVICE}/api/v1/depositos/${id}`, {
    headers: { Authorization: `Bearer ${TOKENS[quien]}` },
  });
  return { status: r.status, cuerpo: await r.json() };
}

async function postsAlMock() {
  const { peticiones } = await mock('/__mock/estado');
  return peticiones.filter((p) => p.metodo === 'POST' && p.ruta === '/api/v1/depositos/usd');
}

const resultados = [];

function comprobar(lista, ok, texto, detalle) {
  lista.push({ ok, texto, detalle });
}

function compStatus(lista, r, esperado) {
  const codigo = r.cuerpo?.codigo ? ` ${r.cuerpo.codigo}` : '';
  comprobar(lista, r.status === esperado, `responde ${esperado}`, `recibió ${r.status}${codigo}`);
}

async function caso(id, nombre, fn) {
  await mock('/__mock/peticiones/limpiar', {});
  const lista = [];
  try {
    await fn(lista);
  } catch (err) {
    comprobar(lista, false, 'se ejecuta sin error', err.message);
  }
  const ok = lista.every((c) => c.ok);
  resultados.push({ id, nombre, ok });
  console.log(`\n${ok ? 'PASA ' : 'FALLA'} ${id} · ${nombre}`);
  for (const c of lista) {
    if (!c.ok) console.log(`      ✗ ${c.texto}${c.detalle ? ` (${c.detalle})` : ''}`);
  }
}

async function esperarEstado(quien, id, estado) {
  const limite = Date.now() + ESPERA_RECONCILIACION_MS;
  let ultimo;
  while (Date.now() < limite) {
    ultimo = await consultar(quien, id);
    if (ultimo.cuerpo?.estado === estado) return ultimo;
    await new Promise((resolve) => { setTimeout(resolve, 2000); });
  }
  return ultimo;
}

async function main() {
  console.log(`Servicio: ${SERVICE}\nMock: ${MOCK}\nModo: ${LAXO ? 'laxo (sin exigir canal)' : 'contrato estricto'}`);
  await mock('/__mock/reiniciar', {});
  await mock('/__mock/config', { exigirCanal: !LAXO });

  await caso('E01', 'Billetera inexistente → 422 sin acreditar', async (l) => {
    const r = await depositar('agente', { cuentaDestino: INEXISTENTE });
    compStatus(l, r, 422);
    comprobar(l, r.cuerpo.codigo === 'CUENTA_NO_ENCONTRADA', 'código CUENTA_NO_ENCONTRADA', r.cuerpo.codigo);
    comprobar(l, (await postsAlMock()).length === 0, 'no llama a acreditar');
  });

  await caso('E02', 'Agente deposita → 201; body correcto (titular, canal, sin cuenta_destino_id)', async (l) => {
    const r = await depositar('agente', { cuentaDestino: B.uno });
    compStatus(l, r, 201);
    comprobar(l, r.cuerpo.estado === 'COMPLETADO', 'estado COMPLETADO', r.cuerpo.estado);
    const [p] = await postsAlMock();
    comprobar(l, Boolean(p), 'llama a acreditar');
    if (!p) return;
    comprobar(l, p.cuerpo.cliente_id === 'usr-cliente-1', 'cliente_id = titular', p.cuerpo.cliente_id);
    comprobar(l, p.cuerpo.canal === 'AGENTE', 'envía canal', p.cuerpo.canal ?? 'ausente');
    comprobar(l, p.cuerpo.metodo_origen === 'EFECTIVO', 'metodo_origen EFECTIVO', p.cuerpo.metodo_origen);
    comprobar(l, p.cuerpo.monto === '10.00', 'monto con 2 decimales', p.cuerpo.monto);
    comprobar(l, !('cuenta_destino_id' in p.cuerpo), 'no envía cuenta_destino_id', p.cuerpo.cuenta_destino_id);
    if (r.cuerpo.id) comprobar(l, p.clave === r.cuerpo.id, 'Idempotency-Key = id del depósito', p.clave);
  });

  await caso('E03', 'Repetir la clave → mismo depósito, una sola acreditación', async (l) => {
    const a = await depositar('agente', { cuentaDestino: B.uno });
    const b = await depositar('agente', { cuentaDestino: B.uno }, a.clave);
    compStatus(l, a, 201);
    comprobar(l, a.cuerpo.id && a.cuerpo.id === b.cuerpo.id, 'mismo id', `${a.cuerpo.id} / ${b.cuerpo.id}`);
    const n = (await postsAlMock()).length;
    comprobar(l, n === 1, 'una sola llamada a acreditar', `${n} llamadas`);
  });

  await caso('E04', 'Cliente deposita a su billetera por APP → TRANSFERENCIA', async (l) => {
    const r = await depositar('cliente', { cuentaDestino: B.uno, canal: 'APP' });
    compStatus(l, r, 201);
    const [p] = await postsAlMock();
    comprobar(l, p?.cuerpo.metodo_origen === 'TRANSFERENCIA', 'metodo_origen TRANSFERENCIA', p?.cuerpo.metodo_origen);
    comprobar(l, p?.cuerpo.cliente_id === 'usr-cliente-1', 'cliente_id = titular', p?.cuerpo.cliente_id);
  });

  await caso('E05', 'Cliente deposita a billetera ajena → 403 sin acreditar', async (l) => {
    const r = await depositar('cliente', { cuentaDestino: B.dos, canal: 'APP' });
    compStatus(l, r, 403);
    comprobar(l, (await postsAlMock()).length === 0, 'no llama a acreditar');
  });

  for (const [id, nombre, cuenta] of [
    ['E06', 'BLOCKED', B.bloqueada],
    ['E07', 'CLOSED', B.cerrada],
  ]) {
    await caso(id, `Billetera ${nombre} → 422 CUENTA_INACTIVA sin acreditar`, async (l) => {
      const r = await depositar('agente', { cuentaDestino: cuenta });
      compStatus(l, r, 422);
      comprobar(l, r.cuerpo.codigo === 'CUENTA_INACTIVA', 'código CUENTA_INACTIVA', r.cuerpo.codigo);
      const n = (await postsAlMock()).length;
      comprobar(l, n === 0, 'no llama a acreditar', `${n} llamadas`);
    });
  }

  for (const [id, nombre, cuenta] of [
    ['E08', 'WALLET_BLOCKED tras consultar ACTIVE', B.carrera],
    ['E09', 'CUSTOMER_BLOCKED', B.clienteBloqueado],
    ['E10', 'USD_ACCOUNT_NOT_ENABLED', B.sinUsd],
  ]) {
    await caso(id, `${nombre} → 422 CUENTA_INACTIVA`, async (l) => {
      const r = await depositar('agente', { cuentaDestino: cuenta });
      compStatus(l, r, 422);
      comprobar(l, r.cuerpo.codigo === 'CUENTA_INACTIVA', 'código CUENTA_INACTIVA', r.cuerpo.codigo);
    });
  }

  for (const [id, nombre, cuenta, final] of [
    ['E11', 'Pendiente que se completa', B.pendiente, 'COMPLETADO'],
    ['E12', 'Pendiente que falla', B.pendienteFalla, 'FALLIDO'],
  ]) {
    await caso(id, `${nombre} → 202 PROCESANDO y luego ${final}`, async (l) => {
      const r = await depositar('agente', { cuentaDestino: cuenta });
      compStatus(l, r, 202);
      comprobar(l, r.cuerpo.estado === 'PROCESANDO', 'estado PROCESANDO', r.cuerpo.estado ?? r.cuerpo.codigo);
      if (r.status !== 202) return;
      const c = await esperarEstado('agente', r.cuerpo.id, final);
      comprobar(l, c?.cuerpo?.estado === final, `termina en ${final}`, c?.cuerpo?.estado);
      const posts = await postsAlMock();
      const iguales = posts.every((p) => JSON.stringify(p.cuerpo) === JSON.stringify(posts[0].cuerpo));
      comprobar(l, iguales, 'reconcilia con un body idéntico');
    });
  }

  await caso('E13', 'Fallo temporal y reintento → mismo id, misma clave, body idéntico', async (l) => {
    const a = await depositar('agente', { cuentaDestino: B.fallaUnaVez });
    compStatus(l, a, 502);
    const b = await depositar('agente', { cuentaDestino: B.fallaUnaVez }, a.clave);
    comprobar(l, b.status === 201 && b.cuerpo.estado === 'COMPLETADO', 'el reintento queda COMPLETADO', `${b.status} ${b.cuerpo.estado ?? b.cuerpo.codigo}`);
    const posts = await postsAlMock();
    comprobar(l, posts.length === 2, 'dos llamadas a acreditar', `${posts.length}`);
    if (posts.length === 2) {
      comprobar(l, posts[0].clave === posts[1].clave, 'misma Idempotency-Key');
      comprobar(l, JSON.stringify(posts[0].cuerpo) === JSON.stringify(posts[1].cuerpo), 'body idéntico');
    }
  });

  await caso('E14', 'Timeout con el depósito ya aceptado → reintento sin doble acreditación', async (l) => {
    const antes = (await mock('/__mock/estado')).acreditacionesEfectivas;
    const a = await depositar('agente', { cuentaDestino: B.lenta });
    compStatus(l, a, 502);
    const b = await depositar('agente', { cuentaDestino: B.lenta }, a.clave);
    comprobar(l, b.status === 201 && b.cuerpo.estado === 'COMPLETADO', 'el reintento queda COMPLETADO', `${b.status} ${b.cuerpo.estado ?? b.cuerpo.codigo}`);
    const despues = (await mock('/__mock/estado')).acreditacionesEfectivas;
    comprobar(l, despues - antes === 1, 'una sola acreditación efectiva', `${despues - antes}`);
  });

  await caso('E15', 'D1: PEN a billetera USD → 422 MONEDA_NO_SOPORTADA sin acreditar', async (l) => {
    const r = await depositar('agente', { cuentaDestino: B.uno, moneda: 'PEN' });
    compStatus(l, r, 422);
    comprobar(l, r.cuerpo.codigo === 'MONEDA_NO_SOPORTADA', 'código MONEDA_NO_SOPORTADA', r.cuerpo.codigo);
    const n = (await postsAlMock()).length;
    comprobar(l, n === 0, 'no llama a acreditar', `${n} llamadas`);
  });

  if (OAUTH) {
    await mock('/__mock/config', { exigirOauth: true });
    await caso('E16', 'OAuth: usa token, y lo reutiliza entre peticiones', async (l) => {
      const a = await depositar('agente', { cuentaDestino: B.uno });
      const b = await depositar('agente', { cuentaDestino: B.uno });
      compStatus(l, a, 201);
      compStatus(l, b, 201);
      const estado = await mock('/__mock/estado');
      comprobar(l, estado.tokensEmitidos <= 1, 'pide un token como máximo', `${estado.tokensEmitidos}`);
    });
    await mock('/__mock/config', { exigirOauth: false });
  }

  // Q13: no se cuenta como fallo; documenta el comportamiento informado por Billetera USD.
  const estadoInicial = (await mock('/__mock/estado')).billeteras[B.uno].balance;
  const saldo = await depositar('agente', { cuentaDestino: B.uno });
  const estadoFinal = (await mock('/__mock/estado')).billeteras[B.uno].balance;
  console.log(`\nINFO  Q13 · Depósito de 10.00 con respuesta ${saldo.status}: saldo ${estadoInicial} → ${estadoFinal}.`);

  await mock('/__mock/reiniciar', {});

  const pasan = resultados.filter((r) => r.ok).length;
  console.log(`\n── Resumen: ${pasan} de ${resultados.length} casos pasan ──`);
  process.exitCode = pasan === resultados.length ? 0 : 1;
}

main().catch((err) => {
  console.error('La prueba no pudo ejecutarse:', err.message);
  process.exitCode = 2;
});
