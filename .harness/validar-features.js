'use strict';
// Valida feature_list.json y que cada caso XX-Tnn de una feature `done` tenga su prueba.
const fs = require('fs');
const path = require('path');
const {
  RAIZ, leerFeatures, casosDePrueba, listarArchivos, ok, warn, fail,
} = require('./lib');

let errores = 0;
const error = (m) => { fail(m); errores += 1; };

let data;
try {
  data = leerFeatures();
} catch (e) {
  fail(`feature_list.json inválido: ${e.message}`);
  process.exit(1);
}

const validos = new Set(data.rules.valid_status);
const porId = new Map(data.features.map((f) => [f.id, f]));

// `reabierta`: feature que estuvo done y cuya spec cambió; su código existe y espera retrabajo.
// Mientras se retrabaja (`retrabajo: true`, de reabierta → in_progress → done), sus dependientes
// done siguen siendo válidos. Una feature in_progress exige dependencias done (orden estricto).
function satisfecha(id, estricta) {
  const d = porId.get(id);
  if (!d) return false;
  if (d.status === 'done') return true;
  if (estricta) return false;
  return d.status === 'reabierta' || (d.status === 'in_progress' && d.retrabajo === true);
}

for (const f of data.features) {
  if (!validos.has(f.status)) error(`Estado inválido en feature ${f.id}: ${f.status}`);
  if (!fs.existsSync(path.join(RAIZ, f.spec))) error(`Feature ${f.id}: no existe ${f.spec}`);
  if (['in_progress', 'done', 'reabierta'].includes(f.status)) {
    const faltan = f.depende_de.filter((d) => !satisfecha(d, f.status === 'in_progress'));
    if (faltan.length) error(`Feature ${f.id} está ${f.status} pero sus dependencias ${faltan.join(', ')} no están done`);
  }
}

const enCurso = data.features.filter((f) => f.status === 'in_progress');
if (enCurso.length > 1) error(`Hay ${enCurso.length} features en in_progress (máximo 1)`);

if (errores === 0) {
  const resumen = [...validos].map((s) => `${s}=${data.features.filter((f) => f.status === s).length}`);
  ok(`feature_list.json válido (${data.features.length} features: ${resumen.join(' ')})`);
}

// --- Casos de prueba XX-Tnn ------------------------------------------------
const pruebas = listarArchivos(path.join(RAIZ, 'tests'), (rel) => rel.includes('node_modules'))
  .filter((f) => f.endsWith('.test.js'))
  .map((f) => fs.readFileSync(path.join(RAIZ, f), 'utf8'))
  .join('\n');

function estadoCaso(id) {
  const re = new RegExp(`\\b(?:test|it)(\\.(?:todo|skip|only))?\\(\\s*['"\`]${id}\\b`, 'g');
  const marcas = [...pruebas.matchAll(re)].map((m) => m[1] || '');
  if (!marcas.length) return 'falta';
  if (marcas.some((m) => m === '.skip' || m === '.only')) return 'skip';
  return marcas.every((m) => m === '.todo') ? 'todo' : 'real';
}

const todasDone = data.features.every((f) => f.status === 'done');
for (const f of data.features.filter((x) => ['done', 'in_progress', 'reabierta'].includes(x.status))) {
  const faltan = [];
  const todos = [];
  const erroresAntes = errores;
  for (const caso of casosDePrueba(f)) {
    const estado = estadoCaso(caso.id);
    if (estado === 'falta') faltan.push(caso.id);
    if (estado === 'skip') error(`${caso.id}: usa .skip/.only (prohibido)`);
    if (estado === 'todo') {
      if (todasDone || (caso.requiere !== null && porId.get(caso.requiere)?.status === 'done')) {
        if (f.status === 'done') error(`${caso.id}: sigue en test.todo pero lo que requiere ya está done`);
        else warn(`${caso.id}: sigue en test.todo pero lo que requiere ya está done`);
      } else {
        todos.push(caso.id);
      }
    }
  }
  if (faltan.length && f.status === 'done') error(`SPEC-${String(f.id).padStart(2, '0')} done sin prueba para: ${faltan.join(', ')}`);
  else if (faltan.length) warn(`SPEC-${String(f.id).padStart(2, '0')} (${f.status === 'reabierta' ? 'reabierta' : 'en curso'}) aún sin prueba: ${faltan.join(', ')}`);
  else if (errores === erroresAntes) ok(`SPEC-${String(f.id).padStart(2, '0')}: todos sus casos tienen prueba${todos.length ? ` (todo: ${todos.join(', ')})` : ''}`);
}

process.exit(errores ? 1 : 0);
