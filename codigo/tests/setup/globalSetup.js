'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const RAIZ = path.join(__dirname, '..', '..');
const TMP = path.join(RAIZ, 'tests', '.tmp');
const DIR_SQL = path.join(RAIZ, 'db');

function generarClaves() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  fs.mkdirSync(TMP, { recursive: true });
  fs.writeFileSync(path.join(TMP, 'publica.pem'), publicKey);
  fs.writeFileSync(path.join(TMP, 'privada.pem'), privateKey);
}

function identificador(nombre) {
  return `"${nombre.replace(/"/g, '""')}"`;
}

async function conCliente(connectionString, fn) {
  const cliente = new Client({ connectionString });
  await cliente.connect();
  try {
    return await fn(cliente);
  } finally {
    await cliente.end();
  }
}

// D12: crea la BD de pruebas si no existe, conectándose a la BD `postgres` del mismo servidor.
async function crearBaseSiFalta(urlPruebas) {
  const url = new URL(urlPruebas);
  const nombre = decodeURIComponent(url.pathname.slice(1));
  url.pathname = '/postgres';
  await conCliente(url.toString(), async (cliente) => {
    const { rowCount } = await cliente.query('SELECT 1 FROM pg_database WHERE datname = $1', [nombre]);
    if (rowCount === 0) await cliente.query(`CREATE DATABASE ${identificador(nombre)}`);
  });
}

// D12: cada corrida parte de cero y aplica db/*.sql en orden alfabético.
async function reiniciarEsquema(urlPruebas) {
  const archivos = fs.existsSync(DIR_SQL)
    ? fs.readdirSync(DIR_SQL).filter((f) => f.endsWith('.sql')).sort()
    : [];
  await conCliente(urlPruebas, async (cliente) => {
    await cliente.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    for (const archivo of archivos) {
      try {
        await cliente.query(fs.readFileSync(path.join(DIR_SQL, archivo), 'utf8'));
      } catch (e) {
        throw new Error(`globalSetup: falló db/${archivo}: ${e.message}`);
      }
    }
  });
}

function esIntegracion(projectConfig) {
  const nombre = projectConfig && projectConfig.displayName;
  return (typeof nombre === 'string' ? nombre : nombre && nombre.name) === 'integration';
}

// Jest llama a este globalSetup una vez por proyecto que tenga pruebas. Solo el proyecto
// `integration` necesita PostgreSQL; así `npm run test:unit` funciona sin la BD.
module.exports = async function globalSetup(globalConfig, projectConfig) {
  generarClaves();
  require('./env');
  if (esIntegracion(projectConfig)) {
    const urlPruebas = process.env.DATABASE_URL_TEST;
    await crearBaseSiFalta(urlPruebas);
    await reiniciarEsquema(urlPruebas);
  }
};
