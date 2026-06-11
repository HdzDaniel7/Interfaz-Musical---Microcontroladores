/* ============================================================
   main.js — Punto de entrada de la aplicación
   ============================================================ */

import { state, loadFromLocalStorage, loadTheme } from './state.js';
import { render } from './renderer.js';
import { initUI } from './ui.js';

// ── Tema: preferencia guardada > preferencia del sistema ──────
const savedTheme = loadTheme();
if (savedTheme === 'dark' || savedTheme === 'light') {
  document.documentElement.setAttribute('data-theme', savedTheme);
} else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
  document.documentElement.setAttribute('data-theme', 'dark');
}

// ── Recuperar proyecto del guardado automático ────────────────
const recovered = loadFromLocalStorage();
if (recovered) {
  console.log(`Proyecto recuperado: "${state.title}" — ${state.notes.length} notas`);
}

// ── Arrancar UI y primer render ───────────────────────────────
initUI();
render();
