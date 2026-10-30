'use strict';

const fs = require('node:fs');
const path = require('node:path');

const comun = {
  testEnvironment: 'node',
  globalSetup: '<rootDir>/tests/setup/globalSetup.js',
  setupFiles: ['<rootDir>/tests/setup/env.js'],
};

const UMBRAL = { branches: 80, functions: 80, lines: 80, statements: 80 };

function tiene(dir, sufijo) {
  const abs = path.join(__dirname, dir);
  if (!fs.existsSync(abs)) return false;
  return fs.readdirSync(abs, { recursive: true }).some((f) => String(f).endsWith(sufijo));
}

// SPEC-00 §6: 80 % en src/core/ y src/modules/. Jest falla con "Coverage data ... was not found"
// si una ruta del umbral no tiene datos (carpeta sin código, o ninguna prueba ejecutada), así que
// cada carpeta entra en cuanto tiene código y existe al menos una prueba.
const coverageThreshold = {};
if (tiene('tests', '.test.js')) {
  for (const dir of ['src/core/', 'src/modules/']) {
    if (tiene(dir, '.js')) coverageThreshold[`./${dir}`] = UMBRAL;
  }
}

module.exports = {
  projects: [
    {
      ...comun,
      displayName: 'unit',
      testMatch: ['<rootDir>/tests/unit/**/*.test.js', '<rootDir>/tests/core/**/*.test.js'],
    },
    {
      ...comun,
      displayName: 'integration',
      testMatch: ['<rootDir>/tests/integration/**/*.test.js'],
    },
  ],
  collectCoverageFrom: ['<rootDir>/src/core/**/*.js', '<rootDir>/src/modules/**/*.js'],
  coverageThreshold,
};
