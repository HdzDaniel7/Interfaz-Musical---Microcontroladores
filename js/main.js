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
} else {
  const darkMedia = window.matchMedia('(prefers-color-scheme: dark)');
  document.documentElement.setAttribute('data-theme', darkMedia.matches ? 'dark' : 'light');
  // Sigue al sistema en vivo mientras el usuario no haya elegido un tema explícito
  darkMedia.addEventListener('change', e => {
    if (!loadTheme()) {
      document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
    }
  });
}

// ── Recuperar proyecto del guardado automático ────────────────
const recovered = loadFromLocalStorage();
if (recovered) {
  console.log(`Proyecto recuperado: "${state.title}" — ${state.notes.length} notas`);
}

// ── Arrancar UI y primer render ───────────────────────────────
initUI();
render();

// ── Service worker (PWA instalable, cache-first del app shell) ─
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err =>
      console.warn('No se pudo registrar el service worker:', err)
    );
  });
}
