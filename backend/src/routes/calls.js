const express = require('express');
const env = require('../config/env');
const { auth } = require('../middleware/auth');
const { asyncHandler } = require('../utils/http');

const router = express.Router();

// Configuración ICE para las llamadas WebRTC.
//
// Va con sesión a propósito: las credenciales de TURN permiten retransmitir
// tráfico por el servidor, así que no deben estar al alcance de cualquiera. Un
// visitante anónimo no puede llamar, luego no necesita esta lista.
//
// Se sirve desde el backend y no desde el bundle para poder rotar el TURN sin
// reconstruir el frontend y para que las credenciales caduquen por entorno.
router.get(
  '/ice',
  auth,
  asyncHandler(async (req, res) => {
    res.json({
      iceServers: env.iceServers,
      // Permite a la UI avisar de que las llamadas pueden cortarse fuera de la
      // red local cuando no hay TURN configurado.
      hasTurn: env.iceServers.some((server) => {
        const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
        return urls.some((url) => typeof url === 'string' && url.startsWith('turn'));
      }),
    });
  })
);

module.exports = router;
