import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';
// Garante que os interceptors do axios sejam registrados no bootstrap.
import './lib/api';
import { iniciarTema } from './lib/tema';

// Tema claro/escuro é preferência global do usuário (doc 02 §27.6) — aplicado antes do primeiro render.
iniciarTema();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
