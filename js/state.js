/* ============================================================
   state.js — Estado global, historia y persistencia
   ============================================================ */

import { NOTE_SLOT, DUR_BEATS, Z2_MIN, Z2_MAX } from './constants.js';

export const PROJECT_VERSION = 2;

export const state = {
  notes:         [],
  pages:         1,
  currentPage:   0,
  z2:            5,
  title:         'Mi_Cancion',
  bpm:           120,
  mcu:           'esp32',
  timeSignature: { num: 4, den: 4 },
  selectedNote:  -1,
  history:       [],
  redoStack:     [],
  activeTool:    { dur: 'T', rest: false, dotted: false },
  activeAccidental: 'none',
  // Código C adicional del usuario, por plantilla de MCU
  extraCode:     {},
};

// ══════════════════════════════════════════════════════════════
// HISTORIA (undo / redo)
// ══════════════════════════════════════════════════════════════

export function pushHistory() {
  state.history.push(JSON.stringify(state.notes));
  state.redoStack = [];
  if (state.history.length > 80) state.history.shift();
}

export function undo() {
  if (!state.history.length) return false;
  state.redoStack.push(JSON.stringify(state.notes));
  state.notes = JSON.parse(state.history.pop());
  state.selectedNote = -1;
  return true;
}

export function redo() {
  if (!state.redoStack.length) return false;
  state.history.push(JSON.stringify(state.notes));
  state.notes = JSON.parse(state.redoStack.pop());
  state.selectedNote = -1;
  return true;
}

export function deleteSelected() {
  if (state.selectedNote < 0) return false;
  pushHistory();
  state.notes.splice(state.selectedNote, 1);
  state.selectedNote = -1;
  return true;
}

export function clearAll() {
  if (!state.notes.length) return false;
  pushHistory();
  state.notes = [];
  state.selectedNote = -1;
  return true;
}

// ══════════════════════════════════════════════════════════════
// VALIDACIÓN Y MIGRACIÓN
// ══════════════════════════════════════════════════════════════

const VALID_ACCIDENTALS = ['none', 'sharp', 'flat'];
const VALID_MCUS        = ['esp32', 'arduino-uno', 'atmega328p'];

// Filtra el array de notas dejando solo entradas bien formadas
function sanitizeNotes(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(n => n && typeof n === 'object' && DUR_BEATS[n.dur] !== undefined)
    .filter(n => n.rest || NOTE_SLOT[n.note] !== undefined)
    .map(n => ({
      note:       n.rest ? (n.note || 'SI') : n.note,
      dur:        n.dur,
      dotted:     !!n.dotted,
      rest:       !!n.rest,
      accidental: VALID_ACCIDENTALS.includes(n.accidental) ? n.accidental : 'none',
    }));
}

function sanitizeTimeSignature(ts) {
  const valid = [[2, 4], [3, 4], [4, 4], [6, 8]];
  if (ts && valid.some(([n, d]) => ts.num === n && ts.den === d)) {
    return { num: ts.num, den: ts.den };
  }
  return { num: 4, den: 4 };
}

// 'arduino' (v1 generaba código ATmega con etiqueta Arduino) → plantilla UNO real
function migrateMcu(mcu) {
  if (mcu === 'arduino') return 'arduino-uno';
  return VALID_MCUS.includes(mcu) ? mcu : 'esp32';
}

function clampZ2(v) {
  const z = parseInt(v, 10);
  if (isNaN(z)) return 5;
  return Math.max(Z2_MIN, Math.min(Z2_MAX, z));
}

function clampBpm(v) {
  const b = parseInt(v, 10);
  if (isNaN(b)) return 120;
  return Math.max(40, Math.min(300, b));
}

function sanitizeExtraCode(raw) {
  const out = {};
  if (raw && typeof raw === 'object') {
    for (const id of VALID_MCUS) {
      if (typeof raw[id] === 'string') out[id] = raw[id];
    }
    // migración v1: claves antiguas
    if (typeof raw.arduino === 'string' && !out['arduino-uno']) out['arduino-uno'] = raw.arduino;
    if (typeof raw.atmega  === 'string' && !out.atmega328p)     out.atmega328p     = raw.atmega;
  }
  return out;
}

function applyProjectData(d) {
  state.notes         = sanitizeNotes(d.notes);
  state.z2            = clampZ2(d.z2 ?? 5);
  state.title         = typeof d.title === 'string' && d.title.trim() ? d.title : 'Mi_Cancion';
  state.bpm           = clampBpm(d.bpm ?? 120);
  state.mcu           = migrateMcu(d.mcu);
  state.timeSignature = sanitizeTimeSignature(d.timeSignature);
  state.extraCode     = sanitizeExtraCode(d.extraCode);
}

// ══════════════════════════════════════════════════════════════
// IMPORT / EXPORT DE PROYECTO (.json)
// ══════════════════════════════════════════════════════════════

export function exportProject() {
  return JSON.stringify({
    version:       PROJECT_VERSION,
    notes:         state.notes,
    z2:            state.z2,
    title:         state.title,
    bpm:           state.bpm,
    mcu:           state.mcu,
    timeSignature: state.timeSignature,
    extraCode:     state.extraCode,
  }, null, 2);
}

export function importProject(jsonStr) {
  const d = JSON.parse(jsonStr);
  if (!d || typeof d !== 'object') throw new Error('Formato inválido');
  pushHistory();
  applyProjectData(d);
  state.currentPage  = 0;
  state.selectedNote = -1;
}

// ══════════════════════════════════════════════════════════════
// LOCALSTORAGE — Guardado automático
// ══════════════════════════════════════════════════════════════

const LS_KEY    = 'editor-musical-proyecto';
const THEME_KEY = 'editor-musical-tema';

export function saveToLocalStorage() {
  try {
    localStorage.setItem(LS_KEY, exportProject());
  } catch (e) {
    // localStorage lleno o deshabilitado — ignorar silenciosamente
    console.warn('localStorage no disponible:', e);
  }
}

// Retorna true si encontró y cargó datos, false si no había nada
export function loadFromLocalStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return false;
    applyProjectData(JSON.parse(raw));
    return true;
  } catch (e) {
    console.warn('Error al cargar localStorage:', e);
    return false;
  }
}

export function clearLocalStorage() {
  try { localStorage.removeItem(LS_KEY); } catch (e) {}
}

// ── Tema (claro/oscuro) persistente ──────────────────────────
export function saveTheme(theme) {
  try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
}

export function loadTheme() {
  try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; }
}

// ── Debounce: espera 1.5 s de inactividad antes de guardar ────
let _saveTimeout = null;

export function scheduleSave() {
  clearTimeout(_saveTimeout);
  _saveTimeout = setTimeout(saveToLocalStorage, 1500);
}

// Guardado inmediato (acciones destructivas como "Limpiar todo")
export function saveNow() {
  clearTimeout(_saveTimeout);
  saveToLocalStorage();
}
