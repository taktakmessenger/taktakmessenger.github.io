import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { ensureServiceWorker } from './services/push.js';
import './styles/index.css';

// Se registra el service worker al arrancar, sin pedir permiso todavía. Deja el
// dispositivo listo para recibir el push de una llamada entrante; el permiso se
// pide desde Ajustes, cuando el usuario decide activar las notificaciones.
ensureServiceWorker();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
