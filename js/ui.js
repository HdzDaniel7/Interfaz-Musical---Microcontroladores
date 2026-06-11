/* ============================================================
   ui.js — Controladores de interfaz de usuario
   ============================================================ */

import {
  state, pushHistory, undo, redo, deleteSelected, clearAll,
  exportProject, importProject, scheduleSave, saveNow, saveTheme,
} from './state.js';
import {
  NOTE_DISPLAY, NOTE_SLOT, SLOT_MIN, SLOT_MAX, SLOT_TO_NOTE, Z2_MIN, Z2_MAX,
} from './constants.js';
import { analyzeMeasures, availableDurations, fitsAtIndex } from './music.js';
import {
  canvas, render, requestRender, setCursor, clearCursor,
  getRow, yToNote, noteAt, insertionIndexAt, onAfterRender, invalidateThemeCache,
} from './renderer.js';
import { playScore, stopScore, setVolume, previewNote, isPlaying } from './audio.js';
import { exportMidi } from './midi.js';
import { TEMPLATES, getTemplate, generateCode, currentFileName } from './codegen/registry.js';

const $ = id => document.getElementById(id);

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

function updateStatus() {
  const count = state.notes.length;
  $('status-count').textContent = `${count} nota${count !== 1 ? 's' : ''}`;

  const measures = analyzeMeasures();
  $('status-dur').textContent = `${measures.length} compás${measures.length !== 1 ? 'es' : ''}`;

  const ts = state.timeSignature;
  $('status-timesig').textContent = `Compás: ${ts.num}/${ts.den}`;
  $('status-mcu').textContent     = `MCU: ${getTemplate(state.mcu).label}`;

  if (state.selectedNote >= 0 && state.notes[state.selectedNote]) {
    const sn  = state.notes[state.selectedNote];
    const acc = sn.accidental === 'sharp' ? '♯' : sn.accidental === 'flat' ? '♭' : '';
    const dot = sn.dotted ? '.' : '';
    $('status-note').textContent = sn.rest
      ? `Silencio ${sn.dur}${dot}`
      : `${NOTE_DISPLAY[sn.note]}${acc}${dot} · ${sn.dur}`;
  } else {
    $('status-note').textContent = 'Sin selección';
  }

  $('prop-notes').textContent    = count;
  $('prop-measures').textContent = measures.length;
  $('prop-complete').textContent =
    measures.filter(m => !m.overflow && !m.underflow).length;

  updateToolbarAvailability();
}

// Deshabilitar duraciones que no caben en el compás actual
function updateToolbarAvailability() {
  const avail = availableDurations();

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
  document.body.classList.toggle('is-playing', isPlaying());
}

// ══════════════════════════════════════════════════════════════
// HERRAMIENTAS (duración, silencio, puntillo, accidental)
// ══════════════════════════════════════════════════════════════

function selectTool(dur, rest) {
  state.activeTool = { ...state.activeTool, dur, rest };
  document.querySelectorAll('.tool-btn[data-dur]').forEach(b => {
    b.classList.toggle('active', b.dataset.dur === dur && (b.dataset.rest === '1') === rest);
  });
  updateToolbarAvailability();
  requestRender(); // refrescar nota fantasma
}

function selectAccidental(acc) {
  state.activeAccidental = acc;
  document.querySelectorAll('.acc-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.acc === acc));
  requestRender();
}

function toggleDot() {
  state.activeTool.dotted = !state.activeTool.dotted;
  $('dot-btn').classList.toggle('active', state.activeTool.dotted);
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

function doUndo() { if (undo()) { afterNotesChanged(); } }
function doRedo() { if (redo()) { afterNotesChanged(); } }
function doDelete() { if (deleteSelected()) { afterNotesChanged(); } }

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

// Transponer la nota seleccionada un slot arriba/abajo
function transposeSelected(delta) {
  const i = state.selectedNote;
  if (i < 0 || !state.notes[i] || state.notes[i].rest) return;
  const slot = NOTE_SLOT[state.notes[i].note] ?? 0;
  const next = Math.max(SLOT_MIN, Math.min(SLOT_MAX, slot + delta));
  if (next === slot) return;
  pushHistory();
  state.notes[i] = { ...state.notes[i], note: SLOT_TO_NOTE[next] };
  previewNote(state.notes[i].note, state.notes[i].accidental);
  afterNotesChanged();
}

function moveSelection(delta) {
  if (!state.notes.length) return;
  let i = state.selectedNote;
  i = i < 0 ? (delta > 0 ? 0 : state.notes.length - 1)
            : Math.max(0, Math.min(state.notes.length - 1, i + delta));
  state.selectedNote = i;
  render();
}

// ══════════════════════════════════════════════════════════════
// CANVAS — pointer events (mouse + táctil)
// ══════════════════════════════════════════════════════════════

let _dragging = false;
let _dragIdx  = -1;
let _dragHistoryPushed = false;

function canvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  return { cx: e.clientX - rect.left, cy: e.clientY - rect.top };
}

function bindCanvas() {
  canvas.addEventListener('pointerdown', e => {
    const { cx, cy } = canvasPos(e);
    canvas.setPointerCapture(e.pointerId);

    // Clic sobre nota existente → seleccionar e iniciar arrastre
    const hit = noteAt(cx, cy);
    if (hit >= 0) {
      state.selectedNote = hit;
      _dragging = true;
      _dragIdx  = hit;
      _dragHistoryPushed = false;
      const n = state.notes[hit];
      if (n && !n.rest) previewNote(n.note, n.accidental, 120);
      render();
      return;
    }

    state.selectedNote = -1;
    const row = getRow(cy);
    if (row < 0) { render(); return; }

    const t = state.activeTool;
    const insertIdx = insertionIndexAt(cx, cy);
    if (!fitsAtIndex(insertIdx, t.dur, t.dotted)) {
      showToast('Esa figura no cabe en el compás actual', { type: 'warn', duration: 2000 });
      render();
      return;
    }

    pushHistory();
    const nn = {
      note:       yToNote(cy, row),
      dur:        t.dur,
      dotted:     t.dotted,
      rest:       t.rest,
      accidental: t.rest ? 'none' : state.activeAccidental,
    };
    state.notes.splice(insertIdx, 0, nn);
    state.selectedNote = insertIdx;
    if (!nn.rest) previewNote(nn.note, nn.accidental);
    afterNotesChanged();
  });

  canvas.addEventListener('pointermove', e => {
    const { cx, cy } = canvasPos(e);
    setCursor(cx, cy, getRow(cy));

    if (_dragging && _dragIdx >= 0) {
      const row = getRow(cy);
      if (row >= 0) {
        const newNote = yToNote(cy, row);
        const n = state.notes[_dragIdx];
        if (n && !n.rest && n.note !== newNote) {
          if (!_dragHistoryPushed) { pushHistory(); _dragHistoryPushed = true; }
          state.notes[_dragIdx] = { ...n, note: newNote };
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
    requestRender();
  });
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

  document.querySelectorAll('.acc-btn').forEach(btn => {
    btn.addEventListener('click', () => selectAccidental(btn.dataset.acc));
  });

  $('title-input').addEventListener('input', e => {
    state.title = e.target.value;
    markCodeDirty();
    updateCodePanel();
    scheduleSave();
  });

  $('z2-val').addEventListener('change', e => {
    let z = parseInt(e.target.value, 10);
    if (isNaN(z)) z = 5;
    z = Math.max(Z2_MIN, Math.min(Z2_MAX, z));
    e.target.value = z;
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
    state.bpm = b;
    markCodeDirty();
    updateCodePanel();
    scheduleSave();
  });

  $('time-sig-sel').addEventListener('change', e => {
    const [num, den] = e.target.value.split('/').map(Number);
    state.timeSignature = { num, den };
    markCodeDirty();
    render();
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
  const applyVolume = () => {
    const v = parseInt(slider.value, 10) || 0;
    label.textContent = v + '%';
    setVolume((v / 100) * 0.25); // 100% = ganancia 0.25 (protege oídos)
  };
  slider.addEventListener('input', applyVolume);
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

function bindActions() {
  $('btn-undo').addEventListener('click', doUndo);
  $('btn-redo').addEventListener('click', doRedo);
  $('btn-delete').addEventListener('click', doDelete);
  $('btn-clear').addEventListener('click', doClearAll);

  $('btn-play').addEventListener('click', () => { playScore(); render(); });
  $('btn-stop').addEventListener('click', stopScore);

  $('btn-save').addEventListener('click', () => {
    downloadBlob(exportProject(), 'application/json',
      (state.title || 'proyecto').trim().replace(/\s+/g, '_') + '.json');
    showToast('Proyecto descargado', { type: 'success' });
  });

  $('btn-load').addEventListener('click', () => $('file-input').click());

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
      document.querySelectorAll('.tab[data-tab]').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      $('tab-code').style.display  = tab.dataset.tab === 'code'  ? 'flex' : 'none';
      $('tab-props').style.display = tab.dataset.tab === 'props' ? 'flex' : 'none';
    });
  });

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
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        e.shiftKey ? doRedo() : doUndo();
      } else if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault();
        doRedo();
      }
      return;
    }

    switch (e.key) {
      case 'Delete':
      case 'Backspace':
        if (state.selectedNote >= 0) { e.preventDefault(); doDelete(); }
        break;
      case ' ':
        e.preventDefault();
        isPlaying() ? stopScore() : (playScore(), render());
        break;
      case 'Escape':
        state.selectedNote = -1;
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

  $('mcu-sel').value = state.mcu;
  syncExtraCodeUI();
}

// ══════════════════════════════════════════════════════════════
// INICIALIZACIÓN
// ══════════════════════════════════════════════════════════════

export function initUI() {
  bindCanvas();
  bindToolbar();
  bindActions();
  bindKeyboard();

  window.addEventListener('resize', requestRender);

  onAfterRender(updateStatus);
  onAfterRender(updateCodePanel);
  onAfterRender(updatePageAndPlayState);

  syncControlsFromState();
}
