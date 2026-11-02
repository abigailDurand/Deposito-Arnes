'use strict';

const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');

const config = require('../../src/config');

// SPEC-02 §4: usuarios de prueba y sus roles. Ninguna prueba inventa otros.
const USUARIOS = {
  'usr-cliente-1': ['CLIENTE'],
  'usr-cliente-2': ['CLIENTE'],
  'usr-agente-1': ['AGENTE'],
  'usr-agente-2': ['AGENTE'],
  'usr-cajero-1': ['CAJERO'],
};

// Par RSA que genera tests/setup/globalSetup.js; la pública queda en JWT_PUBLIC_KEY (env.js).
const CLAVE_PRIVADA = path.join(__dirname, '..', '.tmp', 'privada.pem');
const UNA_HORA_S = 3600;

function base64url(objeto) {
  return Buffer.from(JSON.stringify(objeto)).toString('base64url');
}

// SPEC-02 §5: payload { sub, roles, iss, aud, exp }, firmado RS256.
// - exp: segundos epoch (def. ahora + 1 h). Uno en el pasado da un token vencido.
// - aud: def. JWT_AUDIENCE de la configuración.
// - clave: PEM privado para firmar (def. el de tests/.tmp/); otro PEM da una firma inválida.
// - alg: def. 'RS256'; 'none' produce un token sin firma.
function token(usuario, { exp, aud, clave, alg = 'RS256' } = {}) {
  const roles = USUARIOS[usuario];
  if (!roles) throw new Error(`Usuario fuera de los datos de prueba de SPEC-02 §4: ${usuario}`);
  const payload = {
    sub: usuario,
    roles: [...roles],
    iss: config.jwt.issuer,
    aud: aud === undefined ? config.jwt.audience : aud,
    exp: exp === undefined ? Math.floor(Date.now() / 1000) + UNA_HORA_S : exp,
  };
  if (alg === 'none') {
    return `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url(payload)}.`;
  }
  const privada = clave === undefined ? fs.readFileSync(CLAVE_PRIVADA, 'utf8') : clave;
  return jwt.sign(payload, privada, { algorithm: alg, noTimestamp: true });
}

module.exports = { USUARIOS, token };
