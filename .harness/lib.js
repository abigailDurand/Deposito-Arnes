'use strict';
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');

function leerFeatures() {
  return JSON.parse(fs.readFileSync(path.join(RAIZ, 'feature_list.json'), 'utf8'));
}

function leerSpec(feature) {
  return fs.readFileSync(path.join(RAIZ, feature.spec), 'utf8').replace(/\r\n/g, '\n');
}

function seccion(texto, numero) {
  const inicio = texto.search(new RegExp(`^## ${numero}\\.`, 'm'));
  if (inicio === -1) return '';
  const resto = texto.slice(inicio + 1);
  const fin = resto.search(/^## \d+\./m);
  return fin === -1 ? resto : resto.slice(0, fin);
}

// Archivos que declara el §2 de una spec: solo los nombres antes del primer " (" de cada viñeta,
// porque dentro del paréntesis hay valores que no son archivos (`node:22-alpine`, `db/`, etc.).
function archivosDeclarados(feature) {
  const resultado = [];
  for (const linea of seccion(leerSpec(feature), 2).split('\n')) {
    const m = linea.match(/^- \[([A-ZÁÉÍÓÚ ]+)\]\s+(.*)$/);
    if (!m) continue;
    const cabecera = m[2].split(' (')[0];
    for (const t of cabecera.matchAll(/`([^`]+)`/g)) {
      resultado.push({ archivo: t[1], marca: m[1] });
    }
  }
  return resultado;
}

function casosDePrueba(feature) {
  const ids = [];
  for (const m of seccion(leerSpec(feature), 6).matchAll(/\*\*([A-Z]{2,3}-T\d{2})\*\*([^\n]*)/g)) {
    const requiere = m[2].match(/\(requiere SPEC-(\d{2})\)/);
    ids.push({ id: m[1], requiere: requiere ? Number(requiere[1]) : null });
  }
  return ids;
}

function listarArchivos(dir, ignorar) {
  const salida = [];
  (function recorrer(actual) {
    if (!fs.existsSync(actual)) return;
    for (const e of fs.readdirSync(actual, { withFileTypes: true })) {
      const abs = path.join(actual, e.name);
      const rel = path.relative(RAIZ, abs).split(path.sep).join('/');
      if (ignorar(rel)) continue;
      if (e.isDirectory()) recorrer(abs);
      else salida.push(rel);
    }
  })(dir);
  return salida.sort();
}

const ok = (m) => console.log(`\x1b[0;32m[OK]\x1b[0m    ${m}`);
const warn = (m) => console.log(`\x1b[0;33m[WARN]\x1b[0m  ${m}`);
const fail = (m) => console.log(`\x1b[0;31m[FAIL]\x1b[0m  ${m}`);

module.exports = {
  RAIZ, leerFeatures, leerSpec, seccion, archivosDeclarados, casosDePrueba, listarArchivos,
  ok, warn, fail,
};
