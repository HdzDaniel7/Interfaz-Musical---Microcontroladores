/* ============================================================
   state.js — Estado global, historia y persistencia
   ============================================================ */

import { NOTE_SLOT, DUR_BEATS, Z2_MIN, Z2_MAX } from './constants.js';

export const PROJECT_VERSION = 3;

export const state = {
  notes:         [],
  pages:         1,
  currentPage:   0,
  z2:            5,
  title:         'Mi_Cancion',
  bpm:           120,
  mcu:           'esp32',
  timeSignature: { num: 4, den: 4 },
  clef:          'treble', // clave: 'treble' (Sol) o 'bass' (Fa) — solo visual, no toca audio/codegen
  keySignature:  0,    // armadura INICIAL (compás 1): sostenidos (+) / bemoles (−), 0 = Do M
  // Cambios de armadura a mitad de pieza: [{ measure, key }] (measure = índice
  // de compás 0-based, ≥1; key = semitonos de armadura, −7..7). La armadura
  // efectiva de un compás es keySignature + el último cambio con measure ≤ compás.
  keyChanges:    [],
  selectedNote:  -1,   // nota primaria (sync con el código)
  selection:     [],   // selección múltiple (incluye la primaria)
  history:       [],
  redoStack:     [],
  activeTool:    { dur: 'T', rest: false, dotted: false, triplet: false },
  activeAccidental: 'none',
  // Código C adicional del usuario, por plantilla de MCU
  extraCode:     {},
  // Repeticiones: [{ from, to, times }] índices de compás 0-based
  repeats:       [],
};

// ══════════════════════════════════════════════════════════════
// HISTORIA (undo / redo)
// ══════════════════════════════════════════════════════════════

function snapshotState() {
  return {
    notes:         state.notes,
    repeats:       state.repeats,
    timeSignature: state.timeSignature,
    keySignature:  state.keySignature,
    keyChanges:    state.keyChanges,
    bpm:           state.bpm,
    z2:            state.z2,
    title:         state.title,
    clef:          state.clef,
  };
}

// Snapshots viejos (previos a los fixes B1/B3) eran un array plano de notas,
// o un objeto { notes, repeats } sin el resto de los campos: lo que falte
// se completa con el valor actual para no perder configuración vigente.
function parseHistorySnapshot(json) {
  const parsed = JSON.parse(json);
  if (Array.isArray(parsed)) return { ...snapshotState(), notes: parsed };
  return { ...snapshotState(), ...parsed };
}

function applySnapshot(snap) {
  state.notes         = snap.notes;
  state.repeats        = snap.repeats;
  state.timeSignature  = snap.timeSignature;
  state.keySignature   = snap.keySignature;
  state.keyChanges     = snap.keyChanges || [];
  state.bpm            = snap.bpm;
  state.z2             = snap.z2;
  state.title          = snap.title;
  state.clef           = snap.clef === 'bass' ? 'bass' : 'treble';
}

export function pushHistory() {
  state.history.push(JSON.stringify(snapshotState()));
  state.redoStack = [];
  if (state.history.length > 80) state.history.shift();
}

export function clearSelection() {
  state.selectedNote = -1;
  state.selection = [];
}

export function undo() {
  if (!state.history.length) return false;
  state.redoStack.push(JSON.stringify(snapshotState()));
  applySnapshot(parseHistorySnapshot(state.history.pop()));
  clearSelection();
  return true;
}

export function redo() {
  if (!state.redoStack.length) return false;
  state.history.push(JSON.stringify(snapshotState()));
  applySnapshot(parseHistorySnapshot(state.redoStack.pop()));
  clearSelection();
  return true;
}

// Borra todas las notas de la selección múltiple (o la primaria)
export function deleteSelected() {
  const idxs = state.selection.length
    ? [...state.selection]
    : (state.selectedNote >= 0 ? [state.selectedNote] : []);
  if (!idxs.length) return false;
  pushHistory();
  idxs.sort((a, b) => b - a).forEach(i => state.notes.splice(i, 1));
  clearSelection();
  return true;
}

export function clearAll() {
  if (!state.notes.length) return false;
  pushHistory();
  state.notes = [];
  state.repeats = [];
  state.keyChanges = []; // los cambios de armadura referenciaban compases ya inexistentes
  clearSelection();
  return true;
}

// ══════════════════════════════════════════════════════════════
// VALIDACIÓN Y MIGRACIÓN
// ══════════════════════════════════════════════════════════════

const VALID_ACCIDENTALS = ['none', 'sharp', 'flat', 'natural'];
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
      triplet:    !!n.triplet,
      rest:       !!n.rest,
      accidental: VALID_ACCIDENTALS.includes(n.accidental) ? n.accidental : 'none',
      tieToNext:  !!n.tieToNext,
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

function sanitizeRepeatsShape(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(r => r && Number.isInteger(r.from) && Number.isInteger(r.to) && Number.isInteger(r.times))
    .filter(r => r.from >= 0 && r.to >= r.from && r.times >= 2 && r.times <= 16)
    .map(r => ({ from: r.from, to: r.to, times: r.times }));
}

// Cambios de armadura: measure ≥ 1 (el compás 1 usa keySignature), key −7..7,
// un solo cambio por compás (el último gana), ordenados por compás.
function sanitizeKeyChanges(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  return raw
    .filter(kc => kc && Number.isInteger(kc.measure) && Number.isInteger(kc.key))
    .filter(kc => kc.measure >= 1 && kc.key >= -7 && kc.key <= 7)
    .sort((a, b) => a.measure - b.measure)
    .filter(kc => (seen.has(kc.measure) ? false : (seen.add(kc.measure), true)))
    .map(kc => ({ measure: kc.measure, key: kc.key }));
}

function applyProjectData(d) {
  state.notes         = sanitizeNotes(d.notes);
  state.repeats       = sanitizeRepeatsShape(d.repeats);
  state.keyChanges    = sanitizeKeyChanges(d.keyChanges);
  state.z2            = clampZ2(d.z2 ?? 5);
  state.title         = typeof d.title === 'string' && d.title.trim() ? d.title : 'Mi_Cancion';
  state.bpm           = clampBpm(d.bpm ?? 120);
  state.mcu           = migrateMcu(d.mcu);
  state.timeSignature = sanitizeTimeSignature(d.timeSignature);
  state.keySignature  = Number.isInteger(d.keySignature)
    ? Math.max(-7, Math.min(7, d.keySignature)) : 0;
  state.clef          = d.clef === 'bass' ? 'bass' : 'treble';
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
    clef:          state.clef,
    keySignature:  state.keySignature,
    keyChanges:    state.keyChanges,
    extraCode:     state.extraCode,
    repeats:       state.repeats,
  }, null, 2);
}

export function importProject(jsonStr) {
  const d = JSON.parse(jsonStr);
  if (!d || typeof d !== 'object') throw new Error('Formato inválido');
  pushHistory();
  applyProjectData(d);
  state.currentPage = 0;
  clearSelection();
}

// ══════════════════════════════════════════════════════════════
// LOCALSTORAGE — Guardado automático
// ══════════════════════════════════════════════════════════════

const LS_KEY    = 'editor-musical-proyecto';
const THEME_KEY = 'editor-musical-tema';
const UI_KEY    = 'editor-musical-ui';

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

// ── Preferencias de UI (volumen, salida, ancho de sidebar…) ──
// Independiente del proyecto (LS_KEY): sobrevive a "Limpiar todo"/cargar otro proyecto.
export function saveUIPrefs(partial) {
  try {
    const current = loadUIPrefs();
    localStorage.setItem(UI_KEY, JSON.stringify({ ...current, ...partial }));
  } catch (e) {}
}

export function loadUIPrefs() {
  try {
    const raw = localStorage.getItem(UI_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
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
