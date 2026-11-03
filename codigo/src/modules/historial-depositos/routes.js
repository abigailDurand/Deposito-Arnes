'use strict';

const express = require('express');

const { manejar } = require('../../core/errores');
const { requiereRol } = require('../../core/middlewares/auth');
const controller = require('./controller');

const router = express.Router();

router.get(
  '/cuentas/:numero/depositos',
  requiereRol('CLIENTE', 'AGENTE', 'CAJERO'),
  manejar(controller.listar),
);

module.exports = router;
