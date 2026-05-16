/* ============================================================
   state.js — Estado global de la aplicación
   ============================================================
   Toda la mutación del estado pasa por este módulo.
   El resto de módulos importan `state` y llaman a sus helpers.
   ============================================================ */

const state = {
  // ── Partitura ─────────────────────────────────────────────
  notes: [],          // Array de objetos nota

  // ── Paginación ───────────────────────────────────────────
  pages: 1,
  currentPage: 0,

  // ── Configuración del proyecto ────────────────────────────
  z2: 5,              // Escala base (int8_t z2 en el .ino)
  title: 'Mi_Cancion',
  bpm: 120,

  // ── UI: selección y arrastre ──────────────────────────────
  selectedNote: -1,

  // ── Historial para Deshacer / Rehacer ─────────────────────
  history: [],
  redoStack: [],

  // ── Herramienta activa ────────────────────────────────────
  activeTool: { dur: 'T', rest: false },

  // ── Accidental activo ─────────────────────────────────────
  activeAccidental: 'none',   // 'none' | 'sharp' | 'flat'
};

// ── Historia ──────────────────────────────────────────────────
function pushHistory() {
  state.history.push(JSON.stringify(state.notes));
  state.redoStack = [];
  if (state.history.length > 80) state.history.shift();
}

function undo() {
  if (!state.history.length) return false;
  state.redoStack.push(JSON.stringify(state.notes));
  state.notes = JSON.parse(state.history.pop());
  state.selectedNote = -1;
  return true;
}

function redo() {
  if (!state.redoStack.length) return false;
  state.history.push(JSON.stringify(state.notes));
  state.notes = JSON.parse(state.redoStack.pop());
  state.selectedNote = -1;
  return true;
}

// ── Operaciones de nota ───────────────────────────────────────
function deleteSelected() {
  if (state.selectedNote < 0) return false;
  pushHistory();
  state.notes.splice(state.selectedNote, 1);
  state.selectedNote = -1;
  return true;
}

function clearAll() {
  if (!state.notes.length) return false;
  pushHistory();
  state.notes = [];
  state.selectedNote = -1;
  return true;
}

// ── Serialización (Guardar / Cargar proyecto) ─────────────────
function exportProject() {
  return JSON.stringify({
    notes: state.notes,
    z2:    state.z2,
    title: state.title,
    bpm:   state.bpm,
  });
}

function importProject(jsonStr) {
  const d = JSON.parse(jsonStr);
  pushHistory();
  state.notes        = d.notes || [];
  state.z2           = d.z2    || 5;
  state.title        = d.title || 'Mi_Cancion';
  state.bpm          = d.bpm   || 120;
  state.currentPage  = 0;
  state.selectedNote = -1;
}
