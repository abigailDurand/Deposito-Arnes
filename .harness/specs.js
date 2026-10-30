'use strict';
// Uso: node .harness/specs.js verificar | generar
// `generar` solo lo ejecuta un humano después de editar specs-v2/ a propósito.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { RAIZ, listarArchivos, ok, fail } = require('./lib');

const ARCHIVO_HASH = path.join(RAIZ, '.harness', 'specs.sha256');

function calcular() {
  return listarArchivos(path.join(RAIZ, 'specs-v2'), () => false).map((rel) => {
    const contenido = fs.readFileSync(path.join(RAIZ, rel), 'utf8').replace(/\r\n/g, '\n');
    return `${crypto.createHash('sha256').update(contenido).digest('hex')}  ${rel}`;
  });
}

const modo = process.argv[2];
if (modo === 'generar') {
  fs.writeFileSync(ARCHIVO_HASH, `${calcular().join('\n')}\n`);
  ok(`Hash de specs-v2/ regenerado en .harness/specs.sha256`);
  process.exit(0);
}

if (!fs.existsSync(ARCHIVO_HASH)) {
  fail('Falta .harness/specs.sha256 (un humano debe ejecutar: node .harness/specs.js generar)');
  process.exit(1);
}
const esperado = new Map(fs.readFileSync(ARCHIVO_HASH, 'utf8').trim().split('\n')
  .map((l) => l.replace(/\r$/, '').split('  ')).map(([h, f]) => [f, h]));
const actual = new Map(calcular().map((l) => l.split('  ')).map(([h, f]) => [f, h]));

const cambios = [];
for (const [f, h] of esperado) {
  if (!actual.has(f)) cambios.push(`borrado: ${f}`);
  else if (actual.get(f) !== h) cambios.push(`modificado: ${f}`);
}
for (const f of actual.keys()) if (!esperado.has(f)) cambios.push(`nuevo: ${f}`);

if (cambios.length) {
  fail(`specs-v2/ fue modificado (PRY-R12): ${cambios.join(', ')}`);
  process.exit(1);
}
ok(`specs-v2/ intacto (${actual.size} archivos)`);
