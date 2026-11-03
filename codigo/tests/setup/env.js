'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Se carga (setupFiles) antes que cualquier require de src/config.js en las pruebas.
const CLAVE_PUBLICA = path.join(__dirname, '..', '.tmp', 'publica.pem');

process.env.DATABASE_URL_TEST = process.env.DATABASE_URL_TEST
  || 'postgres://deposito:deposito@localhost:5432/deposito_test';
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;

if (fs.existsSync(CLAVE_PUBLICA)) {
  process.env.JWT_PUBLIC_KEY = fs.readFileSync(CLAVE_PUBLICA, 'utf8');
}
process.env.JWT_ALGORITHMS = 'RS256';
process.env.JWT_ISSUER = 'usuario-service';
process.env.JWT_AUDIENCE = 'banco-api';

// La billetera se simula con nock (SPEC-00 §6): esta URL nunca se resuelve de verdad.
process.env.BILLETERA_URL = 'http://billetera.test';
process.env.BILLETERA_TOKEN = 'token-de-prueba';
process.env.BILLETERA_TIMEOUT_MS = '5000';
// Billetera USD (SPEC-02), también simulada con nock. Sin BILLETERA_USD_TOKEN (INT-R02: opcional).
process.env.BILLETERA_USD_URL = 'http://billetera-usd.test';
delete process.env.BILLETERA_USD_TOKEN;

process.env.IDEMPOTENCIA_DIAS = '7';
process.env.LOG_LEVEL = 'silent';

// D14: valores de prueba, no los de la normativa (SPEC-12).
process.env.UIF_UMBRAL_PEN = '1000.00';
process.env.UIF_UMBRAL_USD = '300.00';
