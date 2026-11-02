'use strict';

const express = require('express');

// Endpoint falso: rutas relativas, la app lo monta en /api/v1 (SPEC-06 §4).
const router = express.Router();
router.get('/fx-ping', (req, res) => {
  res.status(200).json({ pong: true, usuarioId: req.usuario.id });
});
router.post('/fx-eco', (req, res) => {
  res.status(200).json({ recibido: req.body });
});

module.exports = { id: 'fx-endpoint', tipo: 'endpoint', router };
