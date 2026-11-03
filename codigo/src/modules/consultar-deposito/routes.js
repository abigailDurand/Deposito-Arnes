'use strict';

const express = require('express');

const { manejar } = require('../../core/errores');
const { requiereRol } = require('../../core/middlewares/auth');
const controller = require('./controller');

const router = express.Router();

router.get(
  '/depositos/:id',
  requiereRol('CLIENTE', 'AGENTE', 'CAJERO'),
  manejar(controller.consultar),
);

module.exports = router;
