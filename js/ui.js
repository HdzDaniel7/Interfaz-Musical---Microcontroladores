/* ============================================================
   ui.js — Controladores de interfaz de usuario
   ============================================================ */

import {
  state, pushHistory, undo, redo, deleteSelected, clearAll, clearSelection,
  exportProject, importProject, scheduleSave, saveNow, saveTheme,
  saveUIPrefs, loadUIPrefs, deleteSelectedRepeat, deleteSelectedKeyChange,
} from './state.js';
import {
  NOTE_DISPLAY, NOTE_SLOT, SLOT_MIN, SLOT_MAX, SLOT_TO_NOTE, Z2_MIN, Z2_MAX,
} from './constants.js';
import {
  analyzeMeasures, availableDurations, fitsAtIndex, sanitizedRepeats, keyAt,
} from './music.js';
import {
  canvas, render, requestRender, setCursor, clearCursor,
  getRow, yToNote, noteAt, insertionIndexAt, measureAt, onAfterRender, invalidateThemeCache,
  setActiveNote, getZoom, setZoom, setKeyChangeGhost, clearKeyChangeGhost,
  setRepeatGhost, clearRepeatGhost, repeatSignAt, keyChangeMarkAt,
} from './renderer.js';
import {
  playScore, stopScore, setVolume, previewNote, isPlaying,
  setMetronomeEnabled, setTimbre, renderWavBlob,
} from './audio.js';
import {
  isSerialSupported, isSerialConnected, isSerialPlaying, onSerialStatus,
  serialConnect, serialDisconnect, serialPlay, serialStop,
} from './serial.js';
import { exportMidi, midiToProject } from './midi.js';
import { TEMPLATES, getTemplate, generateCode, currentFileName } from './codegen/registry.js';
import { safeFileName } from './codegen/common.js';
import { DEMO_PROJECT } from './demo.js';

const $ = id => document.getElementById(id);

// Preferencias de UI (volumen, salida) — independientes del proyecto,
// no se pierden al "Limpiar todo" ni al cargar otra canción.
const uiPrefs = loadUIPrefs();

// ══════════════════════════════════════════════════════════════
// TOASTS — notificaciones no bloqueantes
// ══════════════════════════════════════════════════════════════

export function showToast(message, { type = 'info', duration = 2800, actionLabel, onAction } = {}) {
  const cont = $('toast-container');
  if (!cont) return;

  const el = document.createElement('div');
  el.className = `toast toast-${type}`;

  const text = document.createElement('span');
  text.textContent = message;
  el.appendChild(text);

  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  };

  if (actionLabel && onAction) {
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = actionLabel;
    btn.addEventListener('click', () => { onAction(); dismiss(); });
    el.appendChild(btn);
  }

  cont.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(dismiss, duration);
}

// ══════════════════════════════════════════════════════════════
// PANEL DE CÓDIGO — syntax highlight + sync con la partitura
// ══════════════════════════════════════════════════════════════

let _codeDirty = true;
let _lastCodeSelection = -2;
let _titleCodeDebounce = null; // debounce de la regeneración al tipear el título

export function markCodeDirty() { _codeDirty = true; }

const C_KEYWORDS = new Set([
  'if', 'else', 'while', 'for', 'break', 'continue', 'return', 'switch',
  'case', 'default', 'do', 'sizeof', 'typedef', 'enum', 'struct',
  'static', 'volatile', 'const', 'inline', 'unsigned', 'signed',
]);
const C_TYPES = new Set([
  'void', 'int', 'char', 'float', 'double', 'long', 'short', 'bool',
  'int8_t', 'int16_t', 'int32_t', 'uint8_t', 'uint16_t', 'uint32_t',
  'uint64_t', 'Nota',
]);
const C_FNS = new Set(['PLAY', 'SILENCIO']);

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Resaltado ligero de C (comentarios, strings, preprocesador,
// números, keywords). Sin dependencias.
function highlightC(src) {
  const re = /(\/\*[\s\S]*?\*\/)|(\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*")|(^[ \t]*#[^\n]*)|(\b\d+(?:\.\d+)?(?:UL{1,2}|U|L|f)?\b)|(\b[A-Za-z_]\w*\b)/gm;
  let out = '', last = 0, m;
  while ((m = re.exec(src))) {
    out += escapeHtml(src.slice(last, m.index));
    const [full, blockCom, lineCom, str, pre, num, ident] = m;
    let cls = null;
    if (blockCom || lineCom) cls = 'tok-com';
    else if (str)            cls = 'tok-str';
    else if (pre)            cls = 'tok-pre';
    else if (num)            cls = 'tok-num';
    else if (ident) {
      if (C_FNS.has(ident))           cls = 'tok-fn';
      else if (C_KEYWORDS.has(ident)) cls = 'tok-kw';
      else if (C_TYPES.has(ident))    cls = 'tok-type';
    }
    out += cls ? `<span class="${cls}">${escapeHtml(full)}</span>` : escapeHtml(full);
    last = m.index + full.length;
  }
  return out + escapeHtml(src.slice(last));
}

// Convierte el código con marcadores (\x01idx\x02 … \x03) a HTML,
// envolviendo el código de cada nota para poder resaltarlo.
function renderCodeHtml(marked, selectedIdx) {
  const re = /\x01(\d+)\x02([\s\S]*?)\x03/g;
  let out = '', last = 0, m;
  while ((m = re.exec(marked))) {
    out += highlightC(marked.slice(last, m.index));
    const idx = parseInt(m[1], 10);
    const sel = idx === selectedIdx ? ' selected' : '';
    out += `<span class="code-note${sel}" data-note="${idx}">${highlightC(m[2])}</span>`;
    last = m.index + m[0].length;
  }
  return out + highlightC(marked.slice(last));
}

function updateCodePanel() {
  if (!_codeDirty && _lastCodeSelection === state.selectedNote) return;

  // Solo cambió la selección (el código en sí sigue vigente): mover la
  // clase "selected" al <span data-note> correspondiente sin regenerar
  // ni volver a resaltar todo el HTML.
  if (!_codeDirty) {
    _lastCodeSelection = state.selectedNote;
    const prev = document.querySelector('#code-output .code-note.selected');
    if (prev) prev.classList.remove('selected');
    const next = document.querySelector(`#code-output .code-note[data-note="${state.selectedNote}"]`);
    if (next) {
      next.classList.add('selected');
      next.scrollIntoView({ block: 'nearest' });
    }
    return;
  }

  _codeDirty = false;
  _lastCodeSelection = state.selectedNote;

  $('code-output').innerHTML = renderCodeHtml(generateCode({ markers: true }), state.selectedNote);
  $('code-title').textContent = currentFileName();

  const sel = document.querySelector('#code-output .code-note.selected');
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}

// ══════════════════════════════════════════════════════════════
// BARRA DE ESTADO + DISPONIBILIDAD DE HERRAMIENTAS
// ══════════════════════════════════════════════════════════════

// Descripción legible de una nota/silencio puntual (para statusbar y anuncios sr-only)
function noteDescription(idx) {
  const sn = state.notes[idx];
  if (!sn) return 'Sin selección';
  const acc = sn.accidental === 'sharp' ? '♯' : sn.accidental === 'flat' ? '♭'
            : sn.accidental === 'natural' ? '♮' : '';
  const dot = sn.dotted ? '.' : '';
  const tri = sn.triplet ? ' ³' : '';
  return sn.rest
    ? `Silencio ${sn.dur}${dot}${tri}`
    : `${NOTE_DISPLAY[sn.note]}${acc}${dot} · ${sn.dur}${tri}`;
}

// Firma barata de todo lo que puede afectar la salida de updateStatus.
// Evita repetir analyzeMeasures()/updateToolbarAvailability() (caros) en
// cada frame del playhead durante la reproducción, que no toca ninguno
// de estos campos — solo mueve el playhead y la página.
let _statusSig = '';

function updateStatus() {
  const sn = state.selectedNote >= 0 ? state.notes[state.selectedNote] : null;
  const playing = anyPlaying();
  const sig = [
    state.notes.length, state.selectedNote, state.selection.length,
    state.timeSignature.num, state.timeSignature.den, state.keySignature,
    state.keyChanges.map(k => `${k.measure}:${k.key}`).join(','),
    state.mcu, state.repeats.length, playing,
    sn ? `${sn.note}|${sn.dur}|${sn.dotted}|${sn.triplet}|${sn.rest}|${sn.accidental}` : '',
  ].join('|');
  if (sig === _statusSig) return;
  _statusSig = sig;

  const count = state.notes.length;
  $('status-count').textContent = `${count} nota${count !== 1 ? 's' : ''}`;

  const measures = analyzeMeasures();
  $('status-dur').textContent = `${measures.length} compás${measures.length !== 1 ? 'es' : ''}`;

  const ts = state.timeSignature;
  $('status-timesig').textContent = `Compás: ${ts.num}/${ts.den}`;
  $('status-mcu').textContent     = `MCU: ${getTemplate(state.mcu).label}`;

  // Armadura vigente en la nota seleccionada (o el compás 1 si no hay
  // selección) — badge puramente informativo en la barra, junto a la
  // herramienta "Armadura": con cambios de armadura a mitad de pieza
  // (Fase 8), la del compás 1 (#key-sig-sel) puede no ser la que rige
  // donde está parado el usuario.
  const curMeasureIdx = state.selectedNote >= 0
    ? measures.findIndex(m => state.selectedNote >= m.startIdx && state.selectedNote < m.endIdx)
    : 0;
  const effKey = keyAt(curMeasureIdx >= 0 ? curMeasureIdx : 0);
  const keyOpt = [...$('key-tool-sel').options].find(o => Number(o.value) === effKey);
  $('key-current-ind').textContent = keyOpt ? keyOpt.textContent : 'Do M';

  // Mientras suena, el compás/beat actual lo escribe directamente el
  // tick del playhead (audio.js) cuadro a cuadro — más barato que
  // recalcularlo acá, y evita pisarlo en cada frame de reproducción.
  if (playing) {
    // no-op: dejar el texto que puso audio.js
  } else if (state.selection.length > 1) {
    $('status-note').textContent = `${state.selection.length} notas seleccionadas`;
  } else if (state.selectedNote >= 0 && state.notes[state.selectedNote]) {
    $('status-note').textContent = noteDescription(state.selectedNote);
  } else {
    $('status-note').textContent = 'Sin selección';
  }

  $('prop-notes').textContent    = count;
  $('prop-measures').textContent = measures.length;
  $('prop-complete').textContent =
    measures.filter(m => !m.overflow && !m.underflow).length;

  const tono = $('key-sig-sel').selectedOptions[0].textContent;
  canvas.setAttribute('aria-label',
    `Partitura: ${count} nota${count !== 1 ? 's' : ''}, ` +
    `${measures.length} compás${measures.length !== 1 ? 'es' : ''}, tono ${tono}`);

  updateRepeatList(measures.length);
  updateKeyChangeList(measures.length);
  updateToolbarAvailability();
}

// ── Cambios de armadura por compás ────────────────────────────
function keyLabel(key) {
  const opt = [...$('key-change-key').options].find(o => o.value === String(key));
  return opt ? opt.textContent : String(key);
}

// Agrega (o reemplaza) el cambio de armadura desde un compás (1-based en la UI)
function addKeyChange(measure1, key) {
  const count = analyzeMeasures().length;
  const mi = measure1 - 1; // a índice 0-based
  if (isNaN(mi) || mi < 1 || mi >= count) {
    showToast('El cambio de tonalidad debe caer en el compás 2 o posterior', { type: 'warn' });
    return false;
  }
  pushHistory();
  state.keyChanges = state.keyChanges.filter(kc => kc.measure !== mi);
  state.keyChanges.push({ measure: mi, key });
  state.keyChanges.sort((a, b) => a.measure - b.measure);
  markCodeDirty();
  render();
  scheduleSave();
  showToast(`Tonalidad: ${keyLabel(key)} desde el compás ${mi + 1}`, { type: 'success' });
  return true;
}

let _keyChangeListSig = '';

function updateKeyChangeList(measureCount) {
  const sig = state.keyChanges.map(k => `${k.measure}:${k.key}`).join(',') + '|' + measureCount;
  if (sig === _keyChangeListSig) return;
  _keyChangeListSig = sig;

  const list = $('key-change-list');
  list.innerHTML = '';
  state.keyChanges.forEach((kc, i) => {
    const outOfRange = kc.measure >= measureCount;
    const item = document.createElement('div');
    item.className = 'repeat-item';
    item.innerHTML =
      `<span>Compás <strong>${kc.measure + 1}</strong> → <strong>${keyLabel(kc.key)}</strong>` +
      `${outOfRange ? ' <em>(fuera de rango)</em>' : ''}</span>`;
    const del = document.createElement('button');
    del.className = 'repeat-del';
    del.title = 'Quitar cambio de tonalidad';
    del.textContent = '✕';
    del.addEventListener('click', () => {
      pushHistory();
      state.keyChanges.splice(i, 1);
      markCodeDirty();
      render();
      scheduleSave();
    });
    item.appendChild(del);
    list.appendChild(item);
  });
}

// ── Lista de repeticiones (solo se reconstruye si cambió) ─────
let _repListSig = '';

function updateRepeatList(measureCount) {
  const sig = JSON.stringify(state.repeats) + '|' + measureCount;
  if (sig === _repListSig) return;
  _repListSig = sig;

  const list = $('rep-list');
  list.innerHTML = '';
  const valid = sanitizedRepeats(measureCount);

  state.repeats.forEach((r, i) => {
    const ok = valid.includes(r);
    const item = document.createElement('div');
    item.className = 'repeat-item';
    item.innerHTML =
      `<span>Compás <strong>${r.from + 1}–${r.to + 1}</strong> × <strong>${r.times}</strong>` +
      `${ok ? '' : ' <em>(fuera de rango)</em>'}</span>`;
    const del = document.createElement('button');
    del.className = 'repeat-del';
    del.title = 'Quitar repetición';
    del.textContent = '✕';
    del.addEventListener('click', () => {
      state.repeats.splice(i, 1);
      markCodeDirty();
      render();
      scheduleSave();
    });
    item.appendChild(del);
    list.appendChild(item);
  });
}

// Deshabilitar duraciones que no caben en el compás actual
function updateToolbarAvailability() {
  const avail = availableDurations(state.activeTool.triplet);

  // Atenuado = no cabe al FINAL de la partitura; sigue siendo
  // clicable porque puede caber en una inserción a media pieza.
  document.querySelectorAll('.tool-btn[data-dur]').forEach(btn => {
    const key = state.activeTool.dotted ? btn.dataset.dur + '_dot' : btn.dataset.dur;
    const ok  = avail[key] !== false;
    btn.classList.toggle('unavailable', !ok);
  });

  const dotBtn = $('dot-btn');
  if (dotBtn) {
    const withDot = avail[state.activeTool.dur + '_dot'] !== false;
    dotBtn.classList.toggle('unavailable', !withDot && !state.activeTool.dotted);
  }
}

function updatePageAndPlayState() {
  $('page-ind').textContent = `Pág ${state.currentPage + 1}/${state.pages}`;
  document.body.classList.toggle('is-playing', anyPlaying());
}

// ══════════════════════════════════════════════════════════════
// HERRAMIENTAS (duración, silencio, puntillo, accidental)
// ══════════════════════════════════════════════════════════════

function selectTool(dur, rest) {
  state.activeTool = { ...state.activeTool, dur, rest };
  document.querySelectorAll('.tool-btn[data-dur]').forEach(b => {
    const active = b.dataset.dur === dur && (b.dataset.rest === '1') === rest;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', String(active));
  });
  updateToolbarAvailability();
  requestRender(); // refrescar nota fantasma
}

function selectAccidental(acc) {
  state.activeAccidental = acc;
  document.querySelectorAll('.acc-btn').forEach(b => {
    const active = b.dataset.acc === acc;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', String(active));
  });
  requestRender();
}

// Puntillo y tresillo son mutuamente excluyentes en la herramienta
function toggleDot() {
  state.activeTool.dotted = !state.activeTool.dotted;
  if (state.activeTool.dotted) state.activeTool.triplet = false;
  $('dot-btn').classList.toggle('active', state.activeTool.dotted);
  $('dot-btn').setAttribute('aria-pressed', String(state.activeTool.dotted));
  $('triplet-btn').classList.toggle('active', state.activeTool.triplet);
  $('triplet-btn').setAttribute('aria-pressed', String(state.activeTool.triplet));
  updateToolbarAvailability();
  requestRender();
}

function toggleTripletTool() {
  state.activeTool.triplet = !state.activeTool.triplet;
  if (state.activeTool.triplet) state.activeTool.dotted = false;
  $('dot-btn').classList.toggle('active', state.activeTool.dotted);
  $('dot-btn').setAttribute('aria-pressed', String(state.activeTool.dotted));
  $('triplet-btn').classList.toggle('active', state.activeTool.triplet);
  $('triplet-btn').setAttribute('aria-pressed', String(state.activeTool.triplet));
  updateToolbarAvailability();
  requestRender();
}

// ══════════════════════════════════════════════════════════════
// MUTACIONES COMUNES
// ══════════════════════════════════════════════════════════════

function afterNotesChanged() {
  markCodeDirty();
  render();
  scheduleSave();
}

function doUndo() { if (undo()) { syncControlsFromState(); afterNotesChanged(); } }
function doRedo() { if (redo()) { syncControlsFromState(); afterNotesChanged(); } }

// Supr: si hay una repetición o un cambio de armadura seleccionado en la
// partitura (clic sobre su marca), se borra eso primero — mismo botón que
// borrar una nota, mutuamente excluyente con la selección de notas.
function doDelete() {
  if (state.selectedRepeatIdx >= 0) {
    if (deleteSelectedRepeat()) afterNotesChanged();
    return;
  }
  if (state.selectedKeyChangeMeasure >= 0) {
    if (deleteSelectedKeyChange()) afterNotesChanged();
    return;
  }
  if (deleteSelected()) { afterNotesChanged(); }
}

function doClearAll() {
  if (!state.notes.length) return;
  clearAll();
  markCodeDirty();
  render();
  saveNow();
  showToast('Partitura borrada', {
    type: 'warn',
    duration: 5000,
    actionLabel: 'Deshacer',
    onAction: () => { if (undo()) { markCodeDirty(); render(); saveNow(); } },
  });
}

// ── Selección múltiple y portapapeles ─────────────────────────
let _clipboard = [];

function selectedIndices() {
  if (state.selection.length) return [...state.selection].sort((a, b) => a - b);
  return state.selectedNote >= 0 ? [state.selectedNote] : [];
}

function copySelection() {
  const idxs = selectedIndices();
  if (!idxs.length) return 0;
  _clipboard = idxs.map(i => ({ ...state.notes[i] }));
  return _clipboard.length;
}

function pasteClipboard() {
  if (!_clipboard.length) {
    showToast('El portapapeles está vacío', { type: 'warn', duration: 1800 });
    return;
  }
  pushHistory();
  const idxs = selectedIndices();
  const at = idxs.length ? idxs[idxs.length - 1] + 1 : state.notes.length;
  state.notes.splice(at, 0, ..._clipboard.map(n => ({ ...n })));
  state.selection = Array.from({ length: _clipboard.length }, (_, k) => at + k);
  state.selectedNote = at + _clipboard.length - 1;
  afterNotesChanged();
}

function duplicateSelection() {
  if (copySelection()) pasteClipboard();
}

// Alternar ligadura hacia la siguiente nota en la selección
function toggleTie() {
  const idxs = selectedIndices().filter(i =>
    state.notes[i] && !state.notes[i].rest && i < state.notes.length - 1);
  if (!idxs.length) {
    showToast('Selecciona una nota (no la última) para ligarla', { type: 'warn', duration: 2200 });
    return;
  }
  pushHistory();
  const allTied = idxs.every(i => state.notes[i].tieToNext);
  for (const i of idxs) {
    state.notes[i] = { ...state.notes[i], tieToNext: !allTied };
  }
  afterNotesChanged();
}

// Atresillar la selección: alterna el flag triplet del rango.
// Cada nota pasa a durar ⅔ — tres corcheas ocupan una negra.
function tripletizeSelection() {
  const idxs = selectedIndices().filter(i => state.notes[i]);
  if (!idxs.length) {
    showToast('Selecciona las notas que quieres atresillar', { type: 'warn', duration: 2200 });
    return;
  }
  pushHistory();
  const allTriplet = idxs.every(i => state.notes[i].triplet);
  for (const i of idxs) {
    state.notes[i] = {
      ...state.notes[i],
      triplet: !allTriplet,
      // el tresillo reemplaza al puntillo
      dotted:  allTriplet ? state.notes[i].dotted : false,
    };
  }
  afterNotesChanged();
}

// Transponer la selección un slot arriba/abajo
function transposeSelected(delta) {
  const idxs = selectedIndices().filter(i => state.notes[i] && !state.notes[i].rest);
  if (!idxs.length) return;
  pushHistory();
  let preview = null;
  for (const i of idxs) {
    const slot = NOTE_SLOT[state.notes[i].note] ?? 0;
    const next = Math.max(SLOT_MIN, Math.min(SLOT_MAX, slot + delta));
    state.notes[i] = { ...state.notes[i], note: SLOT_TO_NOTE[next] };
    preview = state.notes[i];
  }
  if (preview) previewNote(preview.note, preview.accidental);
  afterNotesChanged();
}

// Destino de reproducción: 'pc' (Web Audio) · 'hw' (USB) · 'both'
// 'hw' = el microcontrolador seleccionado en el combobox MCU.
let outputMode = uiPrefs.outputMode || 'pc';

function anyPlaying() { return isPlaying() || isSerialPlaying(); }

// Reproduce desde la nota seleccionada (o desde el inicio si no hay)
function startPlayback() {
  if (anyPlaying()) return;
  const from = state.selectedNote >= 0 ? state.selectedNote : 0;

  const toPC = outputMode === 'pc' || outputMode === 'both';
  const toHW = outputMode === 'hw' || outputMode === 'both';

  if (toHW && !isSerialConnected()) {
    showToast('Conecta el microcontrolador para reproducir en vivo', { type: 'warn' });
    if (!toPC) return;
  }

  if (toPC) playScore(from);

  if (toHW && isSerialConnected()) {
    // En 'both' el playhead lo anima Web Audio (y escribe compás/beat);
    // en 'hw' lo movemos aquí y escribimos la nota activa en la statusbar
    // (updateStatus se abstiene de tocar #status-note mientras se reproduce).
    const onNote = outputMode === 'hw'
      ? idx => {
          setActiveNote(idx);
          render();
          $('status-note').textContent =
            state.notes[idx] ? noteDescription(idx) : 'Reproduciendo…';
        }
      : null;
    serialPlay(from, { onNote });
  }
  render();
}

// Detiene cualquier salida activa
function stopAll() {
  stopScore();
  serialStop();
  render();
}

function moveSelection(delta) {
  if (!state.notes.length) return;
  let i = state.selectedNote;
  i = i < 0 ? (delta > 0 ? 0 : state.notes.length - 1)
            : Math.max(0, Math.min(state.notes.length - 1, i + delta));
  state.selectedNote = i;
  state.selection = [i];
  render();
  $('sr-live').textContent = noteDescription(i);
}

// ══════════════════════════════════════════════════════════════
// CANVAS — pointer events (mouse + táctil)
// ══════════════════════════════════════════════════════════════

let _dragging = false;
let _dragIdx  = -1;
let _dragHistoryPushed = false;

function canvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  const zoom = getZoom();
  // rect está en píxeles CSS (ya escalados por el zoom); el hit-testing
  // (noteAt, insertionIndexAt, getRow…) trabaja en unidades lógicas.
  return { cx: (e.clientX - rect.left) / zoom, cy: (e.clientY - rect.top) / zoom };
}

function bindCanvas() {
  canvas.addEventListener('pointerdown', e => {
    const { cx, cy } = canvasPos(e);

    if (_keyPicking)    { handleKeyPickClick(cx, cy); return; }
    if (_repeatPicking) { handleRepeatPickClick(cx, cy, e.clientX, e.clientY); return; }

    canvas.setPointerCapture(e.pointerId);

    // Clic sobre nota existente → seleccionar e iniciar arrastre
    const hit = noteAt(cx, cy);
    if (hit >= 0) {
      state.selectedRepeatIdx = -1;
      state.selectedKeyChangeMeasure = -1;
      if (e.shiftKey && state.selectedNote >= 0) {
        // Shift: rango desde la nota primaria
        const a = Math.min(state.selectedNote, hit);
        const b = Math.max(state.selectedNote, hit);
        state.selection = Array.from({ length: b - a + 1 }, (_, k) => a + k);
        state.selectedNote = hit;
        render();
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        // Ctrl: alternar nota en la selección
        const s = new Set(state.selection.length ? state.selection
          : (state.selectedNote >= 0 ? [state.selectedNote] : []));
        s.has(hit) ? s.delete(hit) : s.add(hit);
        state.selection = [...s].sort((x, y) => x - y);
        state.selectedNote = s.has(hit) ? hit
          : (state.selection[state.selection.length - 1] ?? -1);
        render();
        return;
      }
      // Clic normal: si ya es parte de una selección múltiple, se
      // conserva (para arrastrar el grupo); si no, selección simple.
      if (!state.selection.includes(hit)) state.selection = [hit];
      state.selectedNote = hit;
      _dragging = true;
      _dragIdx  = hit;
      _dragHistoryPushed = false;
      const n = state.notes[hit];
      if (n && !n.rest) previewNote(n.note, n.accidental, 120);
      render();
      return;
    }

    // Clic sobre un signo de repetición o una marca de cambio de armadura
    // → seleccionarlo para poder borrarlo con Supr (igual que una nota),
    // sin insertar ninguna nota nueva ni tocar la selección de notas.
    const repHit = repeatSignAt(cx, cy);
    if (repHit) {
      clearSelection();
      state.selectedRepeatIdx = state.repeats.indexOf(repHit);
      render();
      return;
    }
    const kcMeasure = keyChangeMarkAt(cx, cy);
    if (kcMeasure >= 0) {
      clearSelection();
      state.selectedKeyChangeMeasure = kcMeasure;
      render();
      return;
    }

    clearSelection();
    const row = getRow(cy);
    if (row < 0) { render(); return; }

    const t = state.activeTool;
    const insertIdx = insertionIndexAt(cx, cy);
    if (!fitsAtIndex(insertIdx, t.dur, t.dotted, t.triplet)) {
      showToast('Esa figura no cabe en el compás actual', { type: 'warn', duration: 2000 });
      render();
      return;
    }

    pushHistory();
    const nn = {
      note:       yToNote(cy, row),
      dur:        t.dur,
      dotted:     t.dotted,
      triplet:    t.triplet,
      rest:       t.rest,
      accidental: t.rest ? 'none' : state.activeAccidental,
    };
    state.notes.splice(insertIdx, 0, nn);
    state.selectedNote = insertIdx;
    state.selection = [insertIdx];
    if (!nn.rest) previewNote(nn.note, nn.accidental);
    afterNotesChanged();
  });

  canvas.addEventListener('pointermove', e => {
    const { cx, cy } = canvasPos(e);

    // En modo "elegir en la partitura" / "colocar armadura" no hay cursor
    // fantasma de inserción de nota: el clic elige un compás.
    if (_keyPicking) {
      clearCursor();
      const mi = measureAt(cx, cy);
      // Los cambios de armadura solo aplican desde el compás 2 (mi ≥ 1).
      setKeyChangeGhost(mi >= 1 ? mi : -1, parseInt($('key-tool-sel').value, 10) || 0);
      requestRender();
      return;
    }
    if (_repeatPicking) {
      clearCursor();
      const mi = measureAt(cx, cy);
      setRepeatGhost(_repeatPickFrom >= 0 ? _repeatPickFrom : mi, mi);
      requestRender();
      return;
    }

    setCursor(cx, cy, getRow(cy));

    if (_dragging && _dragIdx >= 0) {
      const row = getRow(cy);
      if (row >= 0) {
        const newNote = yToNote(cy, row);
        const n = state.notes[_dragIdx];
        if (n && !n.rest && n.note !== newNote) {
          if (!_dragHistoryPushed) { pushHistory(); _dragHistoryPushed = true; }
          // Si la nota arrastrada es parte de una selección múltiple,
          // todo el grupo se transpone por el mismo intervalo.
          const delta = (NOTE_SLOT[newNote] ?? 0) - (NOTE_SLOT[n.note] ?? 0);
          const targets = state.selection.length > 1 && state.selection.includes(_dragIdx)
            ? state.selection : [_dragIdx];
          for (const i of targets) {
            const m = state.notes[i];
            if (!m || m.rest) continue;
            const slot = Math.max(SLOT_MIN, Math.min(SLOT_MAX, (NOTE_SLOT[m.note] ?? 0) + delta));
            state.notes[i] = { ...m, note: SLOT_TO_NOTE[slot] };
          }
          previewNote(newNote, n.accidental, 90);
          markCodeDirty();
          scheduleSave();
        }
      }
    } else {
      canvas.style.cursor = noteAt(cx, cy) >= 0 ? 'pointer' : 'crosshair';
    }

    requestRender();
  });

  const endDrag = () => { _dragging = false; _dragIdx = -1; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', () => {
    endDrag();
    clearCursor();
    if (_keyPicking) clearKeyChangeGhost();
    if (_repeatPicking) clearRepeatGhost();
    requestRender();
  });
}

// ── Divisor arrastrable entre el pentagrama y el panel lateral ──
const SIDEBAR_W_MIN = 220;
const SIDEBAR_W_MAX = 560;

function bindSidebarResizer() {
  const resizer = $('sidebar-resizer');
  const root = document.documentElement;

  if (typeof uiPrefs.sidebarW === 'number') {
    root.style.setProperty('--sidebar-w', `${uiPrefs.sidebarW}px`);
  }

  let dragging = false, startX = 0, startW = 0;

  resizer.addEventListener('pointerdown', e => {
    dragging = true;
    resizer.setPointerCapture(e.pointerId);
    resizer.classList.add('dragging');
    startX = e.clientX;
    startW = $('side-panel').getBoundingClientRect().width;
  });

  resizer.addEventListener('pointermove', e => {
    if (!dragging) return;
    const delta = startX - e.clientX; // arrastrar a la izquierda agranda el panel
    const w = Math.max(SIDEBAR_W_MIN, Math.min(SIDEBAR_W_MAX, startW + delta));
    root.style.setProperty('--sidebar-w', `${w}px`);
    requestRender();
  });

  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    resizer.classList.remove('dragging');
    const w = parseInt(getComputedStyle(root).getPropertyValue('--sidebar-w'), 10);
    if (!isNaN(w)) saveUIPrefs({ sidebarW: w });
  };
  resizer.addEventListener('pointerup', endDrag);
  resizer.addEventListener('pointercancel', endDrag);
}

// ── Zoom del pentagrama ──────────────────────────────────────
const ZOOM_STEP = 0.1;

function updateZoomLabel() {
  $('zoom-ind').textContent = Math.round(getZoom() * 100) + '%';
}

let _zoomSaveDebounce = null;
function applyZoomDelta(delta) {
  setZoom(getZoom() + delta);
  updateZoomLabel();
  requestRender();
  // Ctrl+rueda dispara muchos ticks seguidos: no escribir localStorage en cada uno.
  clearTimeout(_zoomSaveDebounce);
  _zoomSaveDebounce = setTimeout(() => saveUIPrefs({ zoom: getZoom() }), 300);
}

function bindZoom() {
  if (typeof uiPrefs.zoom === 'number') setZoom(uiPrefs.zoom);
  updateZoomLabel();

  $('btn-zoom-out').addEventListener('click', () => applyZoomDelta(-ZOOM_STEP));
  $('btn-zoom-in').addEventListener('click', () => applyZoomDelta(ZOOM_STEP));

  canvas.addEventListener('wheel', e => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    applyZoomDelta(e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
  }, { passive: false });
}

// ── Popover "⚙ Ajustes" (título/z2/compás/armadura inicial/BPM/MCU) ──
// Los controles en sí no cambian de comportamiento (mismos ids que
// bindToolbar()/syncControlsFromState() ya usan); esto solo alterna la
// visibilidad del contenedor, igual que cualquier menú desplegable.
function bindSettingsPopover() {
  const btn = $('btn-settings');
  const pop = $('settings-popover');

  const onOutsideClick = e => {
    if (!pop.contains(e.target) && e.target !== btn && !btn.contains(e.target)) close();
  };
  const onKeydown = e => { if (e.key === 'Escape') close(); };

  function close() {
    pop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutsideClick, true);
    document.removeEventListener('keydown', onKeydown, true);
  }
  function open() {
    pop.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    // Registrar en el siguiente tick: si no, el mismo pointerdown que
    // abrió el popover lo cerraría de inmediato (mismo patrón que el
    // popover de repeticiones).
    setTimeout(() => {
      document.addEventListener('pointerdown', onOutsideClick, true);
      document.addEventListener('keydown', onKeydown, true);
    }, 0);
  }

  btn.addEventListener('click', () => (pop.hidden ? open() : close()));
}

// ══════════════════════════════════════════════════════════════
// CONTROLES DE LA TOOLBAR
// ══════════════════════════════════════════════════════════════

function bindToolbar() {
  document.querySelectorAll('.tool-btn[data-dur]').forEach(btn => {
    btn.addEventListener('click', () => {
      selectTool(btn.dataset.dur, btn.dataset.rest === '1');
    });
  });

  $('dot-btn').addEventListener('click', toggleDot);
  $('triplet-btn').addEventListener('click', toggleTripletTool);

  document.querySelectorAll('.acc-btn').forEach(btn => {
    btn.addEventListener('click', () => selectAccidental(btn.dataset.acc));
  });

  $('title-input').addEventListener('input', e => {
    state.title = e.target.value;
    markCodeDirty();
    clearTimeout(_titleCodeDebounce);
    _titleCodeDebounce = setTimeout(updateCodePanel, 300);
    scheduleSave();
  });

  $('z2-val').addEventListener('change', e => {
    let z = parseInt(e.target.value, 10);
    if (isNaN(z)) z = 5;
    z = Math.max(Z2_MIN, Math.min(Z2_MAX, z));
    e.target.value = z;
    if (z === state.z2) return;      // sin cambio real → no ensuciar el historial
    pushHistory();                   // la octava base cambia la altura sonora y el código: deshacible
    state.z2 = z;
    markCodeDirty();
    updateCodePanel();
    scheduleSave();
  });

  $('bpm').addEventListener('change', e => {
    let b = parseInt(e.target.value, 10);
    if (isNaN(b)) b = 120;
    b = Math.max(40, Math.min(300, b));
    e.target.value = b;
    if (b === state.bpm) return;     // sin cambio real → no ensuciar el historial
    pushHistory();                   // el tempo va en el firmware: deshacible como paso propio
    state.bpm = b;
    markCodeDirty();
    updateCodePanel();
    scheduleSave();
  });

  $('time-sig-sel').addEventListener('change', e => {
    const [num, den] = e.target.value.split('/').map(Number);
    pushHistory(); // cambiar de compás reflowa toda la partitura: hacerlo deshacible
    state.timeSignature = { num, den };
    markCodeDirty();
    render();
    scheduleSave();
  });

  $('key-sig-sel').addEventListener('change', e => {
    pushHistory(); // la armadura altera alturas y dibujo: deshacible como paso propio
    state.keySignature = parseInt(e.target.value, 10) || 0;
    markCodeDirty();
    render();
    scheduleSave();
  });

  $('clef-sel').addEventListener('change', e => {
    pushHistory(); // recoloca todas las notas en el pentagrama: deshacible como paso propio
    state.clef = e.target.value === 'bass' ? 'bass' : 'treble';
    updateStaffRefLabels();
    render(); // no toca el código: la clave es puramente visual (audio/codegen ajenos a NOTE_SLOT)
    scheduleSave();
  });

  // MCU: combobox generado desde el registro de plantillas
  const mcuSel = $('mcu-sel');
  mcuSel.innerHTML = '';
  for (const tpl of TEMPLATES) {
    const opt = document.createElement('option');
    opt.value = tpl.id;
    opt.textContent = tpl.label;
    mcuSel.appendChild(opt);
  }
  mcuSel.addEventListener('change', e => {
    state.mcu = e.target.value;
    syncExtraCodeUI();
    markCodeDirty();
    render();
    updateCodeView();   // si está en vista "en vivo", recarga el firmware del MCU
    scheduleSave();
  });

  $('extra-code').addEventListener('input', e => {
    state.extraCode[state.mcu] = e.target.value;
    markCodeDirty();
    updateCodePanel();
    scheduleSave();
  });

  // ── Volumen ──────────────────────────────────────────────
  const slider = $('volume-slider');
  const label  = $('volume-label');
  if (typeof uiPrefs.volume === 'number') slider.value = uiPrefs.volume;
  const applyVolume = () => {
    const v = parseInt(slider.value, 10) || 0;
    label.textContent = v + '%';
    setVolume((v / 100) * 0.25); // 100% = ganancia 0.25 (protege oídos)
  };
  let _volumeSaveDebounce = null;
  slider.addEventListener('input', () => {
    applyVolume();
    clearTimeout(_volumeSaveDebounce);
    _volumeSaveDebounce = setTimeout(
      () => saveUIPrefs({ volume: parseInt(slider.value, 10) || 0 }), 300);
  });
  applyVolume();
}

function syncExtraCodeUI() {
  const tpl = getTemplate(state.mcu);
  $('extra-code-mcu').textContent = tpl.label;
  $('extra-code').value = state.extraCode[tpl.id] || '';
}

// ══════════════════════════════════════════════════════════════
// BOTONES DE ACCIÓN
// ══════════════════════════════════════════════════════════════

function downloadBlob(content, type, fileName) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Conexión serial (ESP32 en vivo) ──────────────────────────
function syncSerialUI() {
  const btn = $('btn-serial');
  const conn = isSerialConnected();
  btn.classList.toggle('connected', conn);
  btn.title = conn
    ? 'Microcontrolador conectado — clic para desconectar'
    : 'Conectar microcontrolador por USB (modo en vivo)';
}

// Cambia el destino de reproducción y refresca el panel de código.
function setOutputMode(mode) {
  outputMode = mode;
  $('output-sel').value = mode;
  updateCodeView();
}

// ── Panel de código: vista canción ↔ vista firmware en vivo ───
// En salida En vivo/Ambos se oculta el código por canción y se
// muestra el firmware FIJO del MCU seleccionado, para copiarlo/
// flashearlo. No sustituye ni borra el código generado: solo
// alterna visibilidad. El firmware se elige según state.mcu.
const LIVE_FIRMWARE = {
  'esp32':       { file: 'firmware/esp32-live/esp32-live.ino',             name: 'esp32-live.ino' },
  'arduino-uno': { file: 'firmware/arduino-uno-live/arduino-uno-live.ino', name: 'arduino-uno-live.ino' },
  'atmega328p':  { file: 'firmware/atmega328p-live/atmega328p-live.c',     name: 'atmega328p-live.c' },
};

let _liveFirmwareSrc = null;   // fuente del firmware mostrado (para copiar)
const _liveCache     = {};     // mcu → fuente ya descargada (o null si falló)
let _liveShownMcu    = null;   // MCU cuyo firmware se está mostrando

async function loadLiveFirmware() {
  const mcu  = state.mcu;
  const info = LIVE_FIRMWARE[mcu] || LIVE_FIRMWARE.esp32;
  _liveShownMcu = mcu;
  $('live-code-title').textContent = `${info.name} · firmware en vivo (flashear una vez)`;

  // Cache: mostrar al instante si ya se descargó
  if (mcu in _liveCache) {
    showLiveFirmware(_liveCache[mcu], info.file);
    return;
  }

  $('live-code-output').textContent = '// Cargando firmware…';
  try {
    const res = await fetch(info.file);
    if (!res.ok) throw new Error(res.status);
    _liveCache[mcu] = await res.text();
  } catch (e) {
    _liveCache[mcu] = null;
  }
  // El usuario pudo cambiar de MCU mientras descargaba → no pisar
  if (_liveShownMcu === mcu) showLiveFirmware(_liveCache[mcu], info.file);
}

function showLiveFirmware(src, file) {
  _liveFirmwareSrc = src;
  if (src) {
    $('live-code-output').innerHTML = highlightC(src);
  } else {
    $('live-code-output').textContent =
      `// No se pudo cargar el firmware en vivo.\n// Ábrelo directamente desde: ${file}`;
  }
}

function updateCodeView() {
  const live = outputMode === 'hw' || outputMode === 'both';
  $('code-view-song').style.display = live ? 'none' : 'flex';
  $('code-view-live').style.display = live ? 'flex' : 'none';
  if (live) loadLiveFirmware();
}

function bindSerial() {
  const btn = $('btn-serial');

  // Restaura la salida elegida en la sesión anterior (persistida aparte del proyecto).
  setOutputMode(outputMode);

  // El selector de salida funciona siempre: también permite ver y
  // copiar el firmware aunque el navegador no soporte Web Serial.
  $('output-sel').addEventListener('change', e => {
    setOutputMode(e.target.value);
    saveUIPrefs({ outputMode });
    if ((outputMode === 'hw' || outputMode === 'both')
        && isSerialSupported() && !isSerialConnected()) {
      showToast('Firmware en vivo listo para copiar · conecta el MCU para reproducir', {
        type: 'info', duration: 2600,
      });
    }
  });

  $('btn-copy-live').addEventListener('click', async () => {
    if (!_liveFirmwareSrc) return;
    try {
      await navigator.clipboard.writeText(_liveFirmwareSrc);
      const b = $('btn-copy-live');
      b.textContent = '✓ Copiado';
      setTimeout(() => { b.textContent = 'Copiar'; }, 1500);
    } catch {
      showToast('No se pudo copiar al portapapeles', { type: 'error' });
    }
  });

  if (!isSerialSupported()) {
    btn.disabled = true;
    btn.title = 'Web Serial no disponible (usa Chrome/Edge). Aun así puedes ver y copiar el firmware.';
    return;
  }

  btn.addEventListener('click', async () => {
    try {
      if (isSerialConnected()) {
        await serialDisconnect();
        showToast('Microcontrolador desconectado', { type: 'info', duration: 1800 });
      } else {
        await serialConnect();
        showToast('Microcontrolador conectado · elige la salida', { type: 'success' });
      }
    } catch (e) {
      // El usuario canceló el diálogo de puertos → no es un error real
      if (e && e.name !== 'NotFoundError') {
        showToast(`No se pudo conectar: ${e.message}`, { type: 'error', duration: 4000 });
      }
    }
  });

  // La capa serial avisa al conectar/desconectar (incluida la
  // desconexión física del cable) para refrescar la UI.
  onSerialStatus(() => {
    syncSerialUI();
    document.body.classList.toggle('is-playing', anyPlaying());
  });

  syncSerialUI();
}

// ── Repeticiones: agregar (compartido por el form y el modo "elegir
// en la partitura") y el modo de selección de compases en el canvas ──
function addRepeat(from, to, times) {
  const count = analyzeMeasures().length;
  if (isNaN(from) || isNaN(to) || isNaN(times) ||
      from < 0 || to < from || to >= count || times < 2 || times > 16) {
    showToast('Rango de compases o repeticiones inválido', { type: 'warn' });
    return false;
  }
  const overlap = sanitizedRepeats(count).some(r => !(to < r.from || from > r.to));
  if (overlap) {
    showToast('Ese rango se solapa con otra repetición', { type: 'warn' });
    return false;
  }
  state.repeats.push({ from, to, times });
  markCodeDirty();
  render();
  scheduleSave();
  showToast(`Repetición agregada: compases ${from + 1}–${to + 1} ×${times}`, { type: 'success' });
  return true;
}

let _repeatPicking  = false; // modo activo: el próximo clic en el canvas elige un compás
let _repeatPickFrom = -1;    // compás inicial ya elegido (-1 = ninguno todavía)
let _repeatPopoverEl = null;

function setRepeatPicking(on) {
  _repeatPicking  = on;
  _repeatPickFrom = -1;
  if (on) setKeyPicking(false);
  clearRepeatGhost();
  const btn = $('btn-repeat-pick');
  btn.classList.toggle('active', on);
  btn.setAttribute('aria-pressed', String(on));
  canvas.style.cursor = on ? 'crosshair' : '';
  requestRender();
}

function handleRepeatPickClick(cx, cy, clientX, clientY) {
  const mi = measureAt(cx, cy);
  if (mi < 0) {
    showToast('Hacé clic sobre un compás de la partitura', { type: 'warn', duration: 2000 });
    return;
  }
  if (_repeatPickFrom < 0) {
    _repeatPickFrom = mi;
    showToast(`Compás ${mi + 1} elegido como inicio · hacé clic en el compás final`,
      { type: 'info', duration: 2400 });
    return;
  }
  const from = Math.min(_repeatPickFrom, mi);
  const to   = Math.max(_repeatPickFrom, mi);
  setRepeatPicking(false);
  openRepeatPopover(from, to, clientX, clientY);
}

function closeRepeatPopover() {
  if (_repeatPopoverEl) { _repeatPopoverEl.remove(); _repeatPopoverEl = null; }
  document.removeEventListener('pointerdown', onRepeatPopoverOutsideClick, true);
  document.removeEventListener('keydown', onRepeatPopoverKeydown, true);
}

function onRepeatPopoverOutsideClick(e) {
  if (_repeatPopoverEl && !_repeatPopoverEl.contains(e.target)) closeRepeatPopover();
}

function onRepeatPopoverKeydown(e) {
  if (e.key === 'Escape') closeRepeatPopover();
}

function openRepeatPopover(from, to, clientX, clientY) {
  closeRepeatPopover();

  const container = $('score-container');
  const rect = container.getBoundingClientRect();

  const pop = document.createElement('div');
  pop.className = 'repeat-popover';
  pop.style.left = Math.max(0, Math.min(clientX - rect.left, rect.width - 160)) + 'px';
  pop.style.top  = Math.max(0, Math.min(clientY - rect.top, rect.height - 90)) + 'px';
  pop.innerHTML = `
    <div class="repeat-popover-title">Compás ${from + 1}–${to + 1}</div>
    <label class="field-group">
      <span class="field-label">×</span>
      <input class="num-input rp-times" type="number" min="2" max="16" value="2">
    </label>
    <div class="repeat-popover-actions">
      <button class="icon-btn rp-cancel" title="Cancelar" aria-label="Cancelar">✕</button>
      <button class="copy-btn rp-ok">Agregar</button>
    </div>`;
  container.appendChild(pop);
  _repeatPopoverEl = pop;

  const timesInput = pop.querySelector('.rp-times');
  timesInput.focus();
  timesInput.select();

  pop.querySelector('.rp-ok').addEventListener('click', () => {
    const times = parseInt(timesInput.value, 10);
    if (addRepeat(from, to, times)) closeRepeatPopover();
  });
  pop.querySelector('.rp-cancel').addEventListener('click', closeRepeatPopover);

  // Se registran en el siguiente tick: si no, el mismo pointerdown que
  // abrió el popover (evento en curso) lo cerraría de inmediato.
  setTimeout(() => {
    document.addEventListener('pointerdown', onRepeatPopoverOutsideClick, true);
    document.addEventListener('keydown', onRepeatPopoverKeydown, true);
  }, 0);
}

function bindRepeatPicker() {
  $('btn-repeat-pick').addEventListener('click', () => {
    if (_repeatPicking) {
      setRepeatPicking(false);
    } else {
      closeRepeatPopover();
      setRepeatPicking(true);
      showToast('Hacé clic en el compás inicial de la repetición', { type: 'info', duration: 2400 });
    }
  });
}

// ── Cambios de armadura (sección Tonalidad) ───────────────────
function bindKeyChanges() {
  $('key-change-add').addEventListener('click', () => {
    const measure = parseInt($('key-change-measure').value, 10);
    const key     = parseInt($('key-change-key').value, 10) || 0;
    addKeyChange(measure, key);
  });
}

// ── Herramienta "Armadura": modo activo, próximo clic en un compás
// (2 o posterior) coloca ahí la armadura elegida en #key-tool-sel.
// Excluyente con la inserción de notas y con "elegir repetición"
// (mismo patrón que _repeatPicking).
let _keyPicking = false;

function setKeyPicking(on) {
  _keyPicking = on;
  if (on) setRepeatPicking(false);
  else clearKeyChangeGhost();
  const btn = $('btn-key-pick');
  btn.classList.toggle('active', on);
  btn.setAttribute('aria-pressed', String(on));
  canvas.style.cursor = on ? 'crosshair' : '';
  requestRender();
}

function handleKeyPickClick(cx, cy) {
  const mi = measureAt(cx, cy);
  if (mi < 0) {
    showToast('Hacé clic sobre un compás de la partitura', { type: 'warn', duration: 2000 });
    return;
  }
  const key = parseInt($('key-tool-sel').value, 10) || 0;
  addKeyChange(mi + 1, key);
}

function bindKeyPicker() {
  $('btn-key-pick').addEventListener('click', () => {
    if (_keyPicking) {
      setKeyPicking(false);
    } else {
      setKeyPicking(true);
      showToast('Hacé clic en el compás (2 o posterior) donde empieza la nueva armadura',
        { type: 'info', duration: 2400 });
    }
  });
}

// ── Panel flotante de repeticiones (acoplable/arrastrable/fijable) ──
function bindRepeatPanel() {
  const panel  = $('repeat-panel');
  const head   = $('repeat-panel-head');
  const toggle = $('btn-repeat-toggle');
  const pinBtn = $('btn-repeat-pin');
  const prefs  = uiPrefs.repeatPanel || {};
  let pinned   = prefs.pinned !== false; // fijado por defecto

  const reflectToggle = () => toggle.setAttribute('aria-pressed', String(!panel.hidden));
  const reflectPin    = () => pinBtn.setAttribute('aria-pressed', String(pinned));

  const save = () => saveUIPrefs({ repeatPanel: {
    open:   !panel.hidden,
    pinned,
    free:   panel.classList.contains('free'),
    left:   panel.style.left || null,
    top:    panel.style.top  || null,
  }});

  const setDocked = () => {
    panel.classList.remove('free');
    panel.style.left = '';
    panel.style.top  = '';
  };

  // Restaurar posición libre guardada
  if (prefs.free && prefs.left && prefs.top) {
    panel.classList.add('free');
    panel.style.left = prefs.left;
    panel.style.top  = prefs.top;
  }

  const open  = () => { panel.hidden = false; reflectToggle(); save(); };
  const close = () => { panel.hidden = true;  reflectToggle(); save(); };

  toggle.addEventListener('click', () => (panel.hidden ? open() : close()));
  $('btn-repeat-close').addEventListener('click', close);
  $('btn-repeat-dock').addEventListener('click', () => { setDocked(); save(); });
  pinBtn.addEventListener('click', () => { pinned = !pinned; reflectPin(); save(); });
  reflectPin();

  // Arrastre por la cabecera (clamp dentro del área de la partitura)
  let dragging = false, sx = 0, sy = 0, sl = 0, st = 0;
  head.addEventListener('pointerdown', e => {
    if (e.target.closest('.repeat-panel-btn')) return; // no arrastrar al tocar un botón
    dragging = true;
    head.setPointerCapture(e.pointerId);
    const wrap = $('score-container').getBoundingClientRect();
    const r    = panel.getBoundingClientRect();
    sx = e.clientX; sy = e.clientY;
    sl = r.left - wrap.left; st = r.top - wrap.top;
    panel.classList.add('free');
    panel.style.left = sl + 'px';
    panel.style.top  = st + 'px';
  });
  head.addEventListener('pointermove', e => {
    if (!dragging) return;
    const wrap = $('score-container').getBoundingClientRect();
    let nl = Math.max(0, Math.min(sl + (e.clientX - sx), wrap.width  - panel.offsetWidth));
    let nt = Math.max(0, Math.min(st + (e.clientY - sy), wrap.height - panel.offsetHeight));
    panel.style.left = nl + 'px';
    panel.style.top  = nt + 'px';
  });
  const endDrag = () => { if (dragging) { dragging = false; save(); } };
  head.addEventListener('pointerup', endDrag);
  head.addEventListener('pointercancel', endDrag);

  // Apertura inicial: solo si estaba fijado y abierto
  if (pinned && prefs.open) { panel.hidden = false; }
  reflectToggle();
}

function bindActions() {
  $('btn-undo').addEventListener('click', doUndo);
  $('btn-redo').addEventListener('click', doRedo);
  $('btn-delete').addEventListener('click', doDelete);
  $('btn-tie').addEventListener('click', toggleTie);
  $('btn-triplet').addEventListener('click', tripletizeSelection);
  $('btn-clear').addEventListener('click', doClearAll);

  $('btn-play').addEventListener('click', startPlayback);
  $('btn-stop').addEventListener('click', stopAll);

  // ── Metrónomo (toggle, persistido en editor-musical-ui) ──
  const metroBtn = $('btn-metronome');
  const metroOn  = !!uiPrefs.metronome;
  setMetronomeEnabled(metroOn);
  metroBtn.setAttribute('aria-pressed', String(metroOn));
  metroBtn.addEventListener('click', () => {
    const on = metroBtn.getAttribute('aria-pressed') !== 'true';
    setMetronomeEnabled(on);
    metroBtn.setAttribute('aria-pressed', String(on));
    saveUIPrefs({ metronome: on });
  });

  // ── Timbre (solo monitoreo en PC; persistido en editor-musical-ui) ──
  const timbreSel = $('timbre-sel');
  timbreSel.value = uiPrefs.timbre || 'square';
  setTimbre(timbreSel.value);
  timbreSel.addEventListener('change', () => {
    setTimbre(timbreSel.value);
    saveUIPrefs({ timbre: timbreSel.value });
  });

  // ── Reproducción en vivo por USB (ESP32) ─────────────────
  bindSerial();

  $('btn-save').addEventListener('click', () => {
    downloadBlob(exportProject(), 'application/json',
      (state.title || 'proyecto').trim().replace(/\s+/g, '_') + '.json');
    showToast('Proyecto descargado', { type: 'success' });
  });

  $('btn-load').addEventListener('click', () => $('file-input').click());

  $('btn-demo').addEventListener('click', () => {
    importProject(JSON.stringify(DEMO_PROJECT));
    syncControlsFromState();
    markCodeDirty();
    render();
    scheduleSave();
    showToast('Demo cargada: Himno de la Alegría', {
      type: 'success',
      duration: 4500,
      actionLabel: 'Deshacer',
      onAction: () => { if (undo()) { syncControlsFromState(); markCodeDirty(); render(); saveNow(); } },
    });
  });

  $('file-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        importProject(ev.target.result);
        syncControlsFromState();
        markCodeDirty();
        render();
        scheduleSave();
        showToast(`Proyecto "${state.title}" cargado`, { type: 'success' });
      } catch {
        showToast('No se pudo leer el archivo de proyecto', { type: 'error' });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  $('btn-export').addEventListener('click', () => {
    const name = currentFileName();
    downloadBlob(generateCode(), 'text/plain', name);
    showToast(`${name} exportado`, { type: 'success' });
  });

  $('btn-export-midi').addEventListener('click', () => {
    if (exportMidi()) showToast('MIDI exportado', { type: 'success' });
    else showToast('No hay notas en la partitura', { type: 'warn' });
  });

  $('btn-import-midi').addEventListener('click', () => $('midi-file-input').click());

  $('midi-file-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const r = midiToProject(ev.target.result);
        pushHistory();
        state.notes = r.notes;
        state.z2    = r.z2;
        if (r.bpm) state.bpm = r.bpm;
        if (r.timeSig && [...$('time-sig-sel').options]
              .some(o => o.value === `${r.timeSig.num}/${r.timeSig.den}`)) {
          state.timeSignature = r.timeSig;
        }
        state.title        = file.name.replace(/\.(mid|midi)$/i, '');
        state.currentPage  = 0;
        state.selectedNote = -1;
        syncControlsFromState();
        markCodeDirty();
        render();
        scheduleSave();
        const extra = r.info.ajustadas ? ` (${r.info.ajustadas} ajustadas de octava)` : '';
        showToast(`MIDI importado: ${r.info.total} notas${extra}`, {
          type: 'success',
          duration: 5000,
          actionLabel: 'Deshacer',
          onAction: () => { if (undo()) { syncControlsFromState(); markCodeDirty(); render(); saveNow(); } },
        });
      } catch (err) {
        showToast(`No se pudo importar: ${err.message}`, { type: 'error', duration: 4000 });
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  });

  $('btn-export-png').addEventListener('click', () => {
    canvas.toBlob(blob => {
      if (!blob) { showToast('No se pudo generar la imagen', { type: 'error' }); return; }
      const name = safeFileName(state.title) + '.png';
      downloadBlob(blob, 'image/png', name);
      showToast(`${name} exportado`, { type: 'success' });
    }, 'image/png');
  });

  $('btn-export-wav').addEventListener('click', async () => {
    if (!state.notes.length) {
      showToast('No hay notas para exportar', { type: 'warn' });
      return;
    }
    try {
      const blob = await renderWavBlob(0);
      const name = safeFileName(state.title) + '.wav';
      downloadBlob(blob, 'audio/wav', name);
      showToast(`${name} exportado`, { type: 'success' });
    } catch (e) {
      showToast('Error al exportar el WAV', { type: 'error' });
    }
  });

  $('btn-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(generateCode());
      const btn = $('btn-copy');
      btn.textContent = '✓ Copiado';
      setTimeout(() => { btn.textContent = 'Copiar'; }, 1500);
    } catch {
      showToast('No se pudo copiar al portapapeles', { type: 'error' });
    }
  });

  $('btn-prev-page').addEventListener('click', () => {
    if (state.currentPage > 0) { state.currentPage--; render(); }
  });
  $('btn-next-page').addEventListener('click', () => {
    if (state.currentPage < state.pages - 1) { state.currentPage++; render(); }
  });

  $('btn-theme').addEventListener('click', () => {
    const root  = document.documentElement;
    const next  = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    saveTheme(next);
    invalidateThemeCache();
    render();
  });

  // Tabs del panel lateral
  document.querySelectorAll('.tab[data-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab[data-tab]').forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      $('tab-code').style.display  = tab.dataset.tab === 'code'  ? 'flex' : 'none';
      $('tab-props').style.display = tab.dataset.tab === 'props' ? 'flex' : 'none';
    });
  });

  // ── Repeticiones ──────────────────────────────────────────
  $('rep-add').addEventListener('click', () => {
    const from  = parseInt($('rep-from').value, 10) - 1;
    const to    = parseInt($('rep-to').value, 10) - 1;
    const times = parseInt($('rep-times').value, 10);
    addRepeat(from, to, times);
  });

  bindRepeatPicker();

  // Clic en una línea de código → seleccionar la nota correspondiente
  $('code-output').addEventListener('click', e => {
    const span = e.target.closest('.code-note');
    if (!span) return;
    const idx = parseInt(span.dataset.note, 10);
    if (!isNaN(idx) && state.notes[idx]) {
      state.selectedNote = idx;
      render();
    }
  });
}

// ══════════════════════════════════════════════════════════════
// ATAJOS DE TECLADO
// ══════════════════════════════════════════════════════════════

const KEY_TO_DUR = { 1: 'TT', 2: 'DT', 3: 'T', 4: 'MT', 5: 'CT' };

function isTypingTarget(el) {
  return el && (
    el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' || el.isContentEditable
  );
}

function bindKeyboard() {
  document.addEventListener('keydown', e => {
    if (isTypingTarget(e.target)) return;

    if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase();
      if (k === 'z') {
        e.preventDefault();
        e.shiftKey ? doRedo() : doUndo();
      } else if (k === 'y') {
        e.preventDefault();
        doRedo();
      } else if (k === 'c') {
        const n = copySelection();
        if (n) showToast(`${n} nota${n !== 1 ? 's' : ''} copiada${n !== 1 ? 's' : ''}`, { duration: 1500 });
      } else if (k === 'x') {
        e.preventDefault();
        const n = copySelection();
        if (n && deleteSelected()) {
          afterNotesChanged();
          showToast(`${n} nota${n !== 1 ? 's' : ''} cortada${n !== 1 ? 's' : ''}`, { duration: 1500 });
        }
      } else if (k === 'v') {
        e.preventDefault();
        pasteClipboard();
      } else if (k === 'd') {
        e.preventDefault();
        duplicateSelection();
      } else if (k === 'a') {
        e.preventDefault();
        if (state.notes.length) {
          state.selection = state.notes.map((_, i) => i);
          state.selectedNote = state.notes.length - 1;
          render();
        }
      }
      return;
    }

    switch (e.key) {
      case 'Delete':
      case 'Backspace':
        // Backspace dispara "atrás" en algunos navegadores: prevenirlo siempre
        // fuera de campos de texto para no perder el trabajo sin querer.
        e.preventDefault();
        if (state.selectedNote >= 0 || state.selectedRepeatIdx >= 0 || state.selectedKeyChangeMeasure >= 0) {
          doDelete();
        }
        break;
      case ' ':
        // No secuestrar Espacio cuando el foco está en un botón: dejá que
        // Espacio lo active (evita, p. ej., que Tab+Espacio en "Guardar" reproduzca).
        if (document.activeElement && document.activeElement.tagName === 'BUTTON') break;
        e.preventDefault();
        anyPlaying() ? stopAll() : startPlayback();
        break;
      case 'Escape':
        clearSelection();
        render();
        break;
      case 'ArrowLeft':  e.preventDefault(); moveSelection(-1); break;
      case 'ArrowRight': e.preventDefault(); moveSelection(1);  break;
      case 'ArrowUp':    e.preventDefault(); transposeSelected(1);  break;
      case 'ArrowDown':  e.preventDefault(); transposeSelected(-1); break;
      case '.':
        toggleDot();
        break;
      case 'r':
      case 'R':
        selectTool(state.activeTool.dur, !state.activeTool.rest);
        break;
      case 'l':
      case 'L':
        toggleTie();
        break;
      case 't':
      case 'T':
        // Con selección: atresillar el rango; sin ella: herramienta
        selectedIndices().length ? tripletizeSelection() : toggleTripletTool();
        break;
      default:
        if (KEY_TO_DUR[e.key]) selectTool(KEY_TO_DUR[e.key], state.activeTool.rest);
    }
  });
}

// ══════════════════════════════════════════════════════════════
// SINCRONIZAR CONTROLES ← ESTADO (carga de proyecto / inicio)
// ══════════════════════════════════════════════════════════════

export function syncControlsFromState() {
  $('title-input').value = state.title;
  $('z2-val').value      = state.z2;
  $('bpm').value         = state.bpm;

  const tsSel = $('time-sig-sel');
  const tsVal = `${state.timeSignature.num}/${state.timeSignature.den}`;
  if ([...tsSel.options].some(o => o.value === tsVal)) tsSel.value = tsVal;

  const ksSel = $('key-sig-sel');
  const ksVal = String(state.keySignature || 0);
  if ([...ksSel.options].some(o => o.value === ksVal)) ksSel.value = ksVal;
  else { ksSel.value = '0'; state.keySignature = 0; }

  $('clef-sel').value = state.clef === 'bass' ? 'bass' : 'treble';
  updateStaffRefLabels();

  $('mcu-sel').value = state.mcu;
  syncExtraCodeUI();
}

// Referencia "Líneas del pentagrama" (Propiedades): qué nota cae en cada
// línea, según la clave activa. Los slots de línea (0,2,4,6,8, de abajo
// hacia arriba) son fijos por geometría; la clave solo cambia el offset
// que traduce esos slots a nombres de nota reales (mismo cálculo que
// clefOffset()/displaySlot() en renderer.js, sin duplicar ese módulo
// porque acá alcanza con los 5 puntos fijos de línea, no todo el rango).
function updateStaffRefLabels() {
  const off    = state.clef === 'bass' ? -2 : 0;
  const lines  = { l1: 0, l2: 2, l3: 4, l4: 6, l5: 8 };
  for (const [id, displaySlotVal] of Object.entries(lines)) {
    const raw   = displaySlotVal - off;
    const name  = SLOT_TO_NOTE[raw];
    let label   = name ? NOTE_DISPLAY[name] : '?';
    if (id === 'l1' && state.clef !== 'bass') label += ' ← ref. 0';
    $(`staff-ref-${id}`).textContent = label;
  }
  $('staff-ref-clef').textContent = state.clef === 'bass' ? 'clave de Fa' : 'clave de Sol';
}

// ══════════════════════════════════════════════════════════════
// INICIALIZACIÓN
// ══════════════════════════════════════════════════════════════

export function initUI() {
  bindCanvas();
  bindToolbar();
  bindActions();
  bindKeyboard();
  bindSidebarResizer();
  bindZoom();
  bindKeyChanges();
  bindKeyPicker();
  bindRepeatPanel();
  bindSettingsPopover();

  window.addEventListener('resize', requestRender);

  // Guardado inmediato al salir: el debounce de 1.5s de scheduleSave()
  // puede perder los últimos cambios si la pestaña se cierra antes de que dispare.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) saveNow();
  });
  window.addEventListener('pagehide', saveNow);

  onAfterRender(updateStatus);
  onAfterRender(updateCodePanel);
  onAfterRender(updatePageAndPlayState);

  syncControlsFromState();
  updateCodeView();
}
