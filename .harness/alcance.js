'use strict';
// Verifica que cada archivo del proyecto esté declarado en el §2 de alguna spec y que
// ninguno pertenezca a una spec que sigue `pending` (trabajo fuera de turno).
const { RAIZ, leerFeatures, archivosDeclarados, listarArchivos, ok, fail } = require('./lib');

const ARNES = [
  /^(CLAUDE|AGENTS|CHECKPOINTS|README)\.md$/, /^init\.sh$/, /^feature_list\.json$/,
  /^progress\//, /^docs\//, /^\.claude\//, /^\.harness\//, /^specs-v2\//,
];
const IGNORADOS = [
  /(^|\/)node_modules(\/|$)/, /^\.git(\/|$)/, /^coverage(\/|$)/, /^\.dev-keys(\/|$)/,
  /^tests\/\.tmp(\/|$)/, /^\.env$/, /(^|\/)\.DS_Store$/,
];

const data = leerFeatures();
const porNombre = new Map(data.features.map((f) => [f.name, f]));
const duenio = new Map();
for (const f of data.features) {
  for (const { archivo, marca } of archivosDeclarados(f)) {
    if (marca === 'NUEVO' && !duenio.has(archivo)) duenio.set(archivo, f);
  }
}

// Archivos que las specs permiten sin listarlos en un §2.
function duenioImplicito(rel) {
  if (rel === 'package-lock.json') return porNombre.get('proyecto'); // lo genera npm (SPEC-00, `npm ci`)
  if (rel === 'tests/reporte.md') return porNombre.get('proyecto'); // SPEC-00 §6 tester
  if (rel.startsWith('tests/core/fixtures/')) return porNombre.get('pipeline-y-cargador'); // SPEC-06 §6
  if (/^tests\/core\/[^/]+\.test\.js$/.test(rel)) return porNombre.get('proyecto'); // SPEC-00 §6
  const m = rel.match(/^tests\/(?:unit|integration)\/([^/]+)\/[^/]+\.test\.js$/); // SPEC-00 §6
  return m ? porNombre.get(m[1]) : undefined;
}

const archivos = listarArchivos(RAIZ, (rel) => IGNORADOS.some((re) => re.test(rel)));

const sinSpec = [];
const fueraDeTurno = [];
for (const rel of archivos) {
  if (ARNES.some((re) => re.test(rel))) continue;
  const f = duenio.get(rel) || duenioImplicito(rel);
  if (!f) sinSpec.push(rel);
  else if (f.status === 'pending') fueraDeTurno.push(`${rel} (SPEC-${String(f.id).padStart(2, '0')})`);
}

let codigo = 0;
if (sinSpec.length) {
  fail(`Archivos que ninguna spec declara en su §2: ${sinSpec.join(', ')}`);
  codigo = 1;
}
if (fueraDeTurno.length) {
  fail(`Archivos de specs que siguen pending: ${fueraDeTurno.join(', ')}`);
  codigo = 1;
}
if (!codigo) ok(`Alcance de archivos correcto (${archivos.length} archivos revisados)`);
process.exit(codigo);
