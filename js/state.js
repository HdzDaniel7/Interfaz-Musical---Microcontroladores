/* ============================================================
   state.js — Estado global de la aplicación
   ============================================================ */

const state = {
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
};

// ══════════════════════════════════════════════════════════════
// LÓGICA DE COMPÁS
// ══════════════════════════════════════════════════════════════

// Devuelve cuántos beats de negra caben en un compás.
//   4/4 → 4   3/4 → 3   2/4 → 2   6/8 → 3 (6 corcheas = 3 negras)
function beatsPerMeasure() {
  const { num, den } = state.timeSignature;
  return num / (den / 4);
}

// Duración en beats de negra de una nota
function noteDurationBeats(note) {
  const base = DUR_BEATS[note.dur] || 1;
  return note.dotted ? base * 1.5 : base;
}

// ── Analiza las notas y devuelve grupos por compás ─────────────
function analyzeMeasures() {
  const capacity = beatsPerMeasure();
  const measures = [];
  let i = 0, startIdx = 0, beats = 0;

  while (i <= state.notes.length) {
    // Fin del array → cerrar compás incompleto
    if (i === state.notes.length) {
      if (i > startIdx || beats > 0) {
        measures.push({
          startIdx, endIdx: i, beats, capacity,
          overflow:  beats > capacity + 0.001,
          underflow: beats < capacity - 0.001,
        });
      }
      break;
    }

    const nb = noteDurationBeats(state.notes[i]);

    // La nota desborda → cerrar compás anterior primero
    if (beats + nb > capacity + 0.001) {
      if (i > startIdx || beats > 0) {
        measures.push({
          startIdx, endIdx: i, beats, capacity,
          overflow:  false,
          underflow: beats < capacity - 0.001,
        });
        startIdx = i;
        beats    = 0;
      }
    }

    beats += nb;

    // Compás exactamente lleno → cerrarlo
    if (Math.abs(beats - capacity) < 0.001) {
      measures.push({
        startIdx, endIdx: i + 1, beats, capacity,
        overflow: false, underflow: false,
      });
      startIdx = i + 1;
      beats    = 0;
    }

    i++;
  }

  return measures;
}

// ── Beats usados en el compás actualmente abierto ─────────────
function usedBeatsInOpenMeasure() {
  const capacity = beatsPerMeasure();
  let beats = 0;
  for (let i = state.notes.length - 1; i >= 0; i--) {
    beats += noteDurationBeats(state.notes[i]);
    if (Math.abs(beats - capacity) < 0.001) return 0; // límite de compás anterior
    if (beats > capacity + 0.001) return beats - capacity; // datos externos inválidos
  }
  return beats;
}

// ── ¿Cabe la nota en el compás actualmente abierto? ─────────
// Modo ESTRICTO: bloquea si la nota no cabe.
function fitsInCurrentMeasure(dur, dotted) {
  const capacity  = beatsPerMeasure();
  const used      = usedBeatsInOpenMeasure();
  const newBeats  = (DUR_BEATS[dur] || 1) * (dotted ? 1.5 : 1);
  return newBeats <= capacity - used + 0.001;
}

// ── Duraciones disponibles para el compás actual ─────────────
// Devuelve un objeto { TT: bool, DT: bool, T: bool, ... , TT_dot: bool, ... }
function availableDurations() {
  const capacity  = beatsPerMeasure();
  const used      = usedBeatsInOpenMeasure();
  const remaining = capacity - used;
  const result    = {};
  for (const [dur, beats] of Object.entries(DUR_BEATS)) {
    result[dur]          = beats       <= remaining + 0.001;
    result[dur + '_dot'] = beats * 1.5 <= remaining + 0.001;
  }
  return result;
}

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

function exportProject() {
  return JSON.stringify({
    notes: state.notes, z2: state.z2, title: state.title,
    bpm: state.bpm, mcu: state.mcu, timeSignature: state.timeSignature,
  });
}

function importProject(jsonStr) {
  const d = JSON.parse(jsonStr);
  pushHistory();
  state.notes         = d.notes || [];
  state.z2            = d.z2    || 5;
  state.title         = d.title || 'Mi_Cancion';
  state.bpm           = d.bpm   || 120;
  state.mcu           = d.mcu   || 'esp32';
  state.timeSignature = d.timeSignature || { num: 4, den: 4 };
  state.currentPage   = 0;
  state.selectedNote  = -1;
}

// ══════════════════════════════════════════════════════════════
// LOCALSTORAGE — Guardado automático
// ══════════════════════════════════════════════════════════════

const LS_KEY = 'editor-musical-proyecto';

// Guarda el proyecto completo en localStorage
function saveToLocalStorage() {
  try {
    const data = JSON.stringify({
      notes:         state.notes,
      z2:            state.z2,
      title:         state.title,
      bpm:           state.bpm,
      mcu:           state.mcu,
      timeSignature: state.timeSignature,
    });
    localStorage.setItem(LS_KEY, data);
  } catch (e) {
    // localStorage lleno o deshabilitado — ignorar silenciosamente
    console.warn('localStorage no disponible:', e);
  }
}

// Carga el proyecto desde localStorage si existe
// Retorna true si encontró y cargó datos, false si no había nada
function loadFromLocalStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    state.notes         = d.notes         || [];
    state.z2            = d.z2            || 5;
    state.title         = d.title         || 'Mi_Cancion';
    state.bpm           = d.bpm           || 120;
    state.mcu           = d.mcu           || 'esp32';
    state.timeSignature = d.timeSignature || { num: 4, den: 4 };
    return true;
  } catch (e) {
    console.warn('Error al cargar localStorage:', e);
    return false;
  }
}

// Borra el proyecto guardado
function clearLocalStorage() {
  try { localStorage.removeItem(LS_KEY); } catch (e) {}
}

// Debounce: espera 2 segundos de inactividad antes de guardar
// Evita escribir en localStorage en cada keystroke o nota insertada
let _saveTimeout = null;

function scheduleSave() {
  clearTimeout(_saveTimeout);
  _saveTimeout = setTimeout(() => {
    saveToLocalStorage();
  }, 2000);
}