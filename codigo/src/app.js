'use strict';

const express = require('express');

const config = require('./config');
const { cargar } = require('./core/cargador');
const { ErrorApp } = require('./core/errores');
const auditoria = require('./core/middlewares/auditoria');
const { autenticar } = require('./core/middlewares/auth');
const correlationId = require('./core/middlewares/correlationId');
const manejadorErrores = require('./core/middlewares/manejadorErrores');

// PIP-R11: orden exacto de montaje. PIP-R12: no inicia tareas ni hace listen.
function crearApp({ manifest } = {}) {
  // PIP-R09: un manifest inválido o una feature inexistente impiden armar la app.
  const { routers } = cargar(manifest);

  const app = express();
  // req.ip sale de X-Forwarded-For según TRUST_PROXY (hay un API Gateway delante).
  app.set('trust proxy', config.trustProxy);
  app.use(correlationId);
  // D2: antes de autenticar, para auditar también los 401.
  app.use(auditoria);
  // SPEC-00 §5: única ruta sin token.
  app.get('/health', (req, res) => {
    res.status(200).json({ estado: 'ok' });
  });
  app.use(autenticar);
  app.use(express.json({ limit: '100kb' }));
  for (const router of routers) {
    app.use('/api/v1', router);
  }
  app.use((req, res, next) => {
    next(new ErrorApp('RUTA_NO_ENCONTRADA'));
  });
  app.use(manejadorErrores);

  return app;
}

module.exports = { crearApp };
