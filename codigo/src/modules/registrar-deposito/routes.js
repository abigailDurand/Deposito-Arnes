'use strict';

const express = require('express');

const { manejar } = require('../../core/errores');
const { requiereRol } = require('../../core/middlewares/auth');
const idempotencia = require('../../core/middlewares/idempotencia');
const controller = require('./controller');

const router = express.Router();

router.post(
  '/depositos',
  requiereRol('CLIENTE', 'AGENTE', 'CAJERO'),
  idempotencia,
  manejar(controller.registrar),
);

module.exports = router;
