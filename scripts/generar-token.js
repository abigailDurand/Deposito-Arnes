'use strict';

const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');

// SPEC-02 §2: token de desarrollo firmado con .dev-keys/ (scripts/generar-claves-dev.js).
// Uso: node scripts/generar-token.js usr-agente-1
const RAIZ = path.join(__dirname, '..');
const CLAVE_PRIVADA = path.join(RAIZ, '.dev-keys', 'privada.pem');
const ARCHIVO_ENV = path.join(RAIZ, '.env');
const UNA_HORA_S = 3600;

function salir(mensaje) {
  process.stderr.write(`${mensaje}\n`);
  process.exit(1);
}

const usuario = process.argv[2];
if (!usuario) salir('Uso: node scripts/generar-token.js <usuario>   (ej. usr-agente-1)');
if (!fs.existsSync(CLAVE_PRIVADA)) {
  salir('No existe .dev-keys/privada.pem: ejecuta antes node scripts/generar-claves-dev.js');
}

// PRY-R09: iss y aud salen de src/config.js, que lee el entorno; .env se carga si existe.
if (fs.existsSync(ARCHIVO_ENV)) process.loadEnvFile(ARCHIVO_ENV);
let config;
let USUARIOS;
try {
  config = require('../src/config');
  ({ USUARIOS } = require('../tests/helpers/tokens'));
} catch (err) {
  salir(`${err.message}\nCrea el .env a partir de .env.example (cp .env.example .env).`);
}

const roles = USUARIOS[usuario];
if (!roles) {
  salir(`Usuario fuera de SPEC-02 §4: ${usuario}. Válidos: ${Object.keys(USUARIOS).join(', ')}`);
}

// SPEC-02 §5: payload propuesto, RS256 [POR ACORDAR].
const payload = {
  sub: usuario,
  roles: [...roles],
  iss: config.jwt.issuer,
  aud: config.jwt.audience,
  exp: Math.floor(Date.now() / 1000) + UNA_HORA_S,
};
const firmado = jwt.sign(payload, fs.readFileSync(CLAVE_PRIVADA, 'utf8'), {
  algorithm: 'RS256',
  noTimestamp: true,
});
process.stdout.write(`${firmado}\n`);
