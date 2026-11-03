'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// SPEC-02 §2: par RSA de desarrollo en .dev-keys/ (ignorado por git). Simula la firma de
// usuario-service [POR ACORDAR]. Uso: node scripts/generar-claves-dev.js
const DIR = path.join(__dirname, '..', '.dev-keys');
const PRIVADA = path.join(DIR, 'privada.pem');
const PUBLICA = path.join(DIR, 'publica.pem');

function generar() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(PRIVADA, privateKey, { mode: 0o600 });
  fs.writeFileSync(PUBLICA, publicKey);
}

// No se regeneran si ya existen: invalidaría los tokens y el JWT_PUBLIC_KEY del .env.
if (fs.existsSync(PRIVADA) && fs.existsSync(PUBLICA)) {
  process.stdout.write(`Las claves ya existen en ${DIR} (bórralas para regenerarlas).\n`);
} else {
  generar();
  process.stdout.write(`Par RSA generado en ${DIR}\n`);
}

const publica = fs.readFileSync(PUBLICA, 'utf8').trim().replace(/\r?\n/g, '\\n');
process.stdout.write(`\nCopia esta línea en tu .env:\nJWT_PUBLIC_KEY="${publica}"\n`);
