/* ============================================================
   renderer.js — Dibujo del pentagrama y las notas en canvas
   ============================================================ */

import {
  NOTE_SLOT, SLOT_MIN, SLOT_MAX, SLOT_TO_NOTE, NOTE_DISPLAY, REST_GLYPHS,
  SS, ST, NW, ML, MR, RPP, RH,
} from './constants.js';
import { state } from './state.js';
import {
  beatsPerMeasure, noteDurationBeats, analyzeMeasures, fitsInCurrentMeasure,
} from './music.js';

export const canvas = document.getElementById('score-canvas');
const ctx = canvas.getContext('2d');

// Dimensiones lógicas (el canvas físico se escala por devicePixelRatio)
let W = 0, H = 0;

// ── Estado visual (cursor, reproducción) ──────────────────────
let cursorX = -1, cursorY = -1, cursorRow = -1;
let activeNoteIdx = -1;          // nota sonando ahora (reproducción)
let playhead = null;             // { x, row } — cabezal de reproducción

export function setCursor(x, y, row) { cursorX = x; cursorY = y; cursorRow = row; }
export function clearCursor()        { cursorX = -1; cursorY = -1; cursorRow = -1; }
export function setActiveNote(i)     { activeNoteIdx = i; }
export function getActiveNote()      { return activeNoteIdx; }
export function setPlayhead(p)       { playhead = p; }

// ── Callbacks post-render (la UI se registra aquí; evita ciclos) ──
const afterRenderFns = [];
export function onAfterRender(fn) { afterRenderFns.push(fn); }

// ── Cache de variables CSS (getComputedStyle es caro) ─────────
let cssCache = {};
function cssVar(v) {
  if (!(v in cssCache)) {
    cssCache[v] = getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  }
  return cssCache[v];
}
export function invalidateThemeCache() { cssCache = {}; }

// ── Tamaño del canvas (con escala HiDPI para nitidez) ─────────
function calcCanvas() {
  const container = document.getElementById('score-container');
  const pad = 36; // padding del wrapper (18px por lado, ver CSS)
  W = Math.max(container.clientWidth - pad, 380);
  H = ST + RPP * RH + 10;

  const dpr = window.devicePixelRatio || 1;
  canvas.width        = Math.round(W * dpr);
  canvas.height       = Math.round(H * dpr);
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ── Coordenadas del pentagrama ────────────────────────────────
export function sY(row, line) {
  return ST + row * RH + line * SS;
}

export function noteToY(naturalNote, row) {
  const slot = NOTE_SLOT[naturalNote] !== undefined ? NOTE_SLOT[naturalNote] : 0;
  return sY(row, 4) - slot * (SS / 2);
}

export function yToNote(y, row) {
  const rel  = sY(row, 4) - y;
  const slot = Math.max(SLOT_MIN, Math.min(SLOT_MAX, Math.round(rel / (SS / 2))));
  return SLOT_TO_NOTE[slot] || 'MI';
}

// Extensión vertical clickeable de cada fila:
// slots por encima de la 5ª línea y por debajo de la 1ª + margen
const ROW_EXT = Math.ceil((SLOT_MAX - 8) * SS / 2) + 6; // = 31px

export function getRow(y) {
  for (let r = 0; r < RPP; r++) {
    const top = sY(r, 0) - ROW_EXT;
    const bot = sY(r, 4) + ROW_EXT;
    if (y >= top && y <= bot) return r;
  }
  return -1;
}

// ══════════════════════════════════════════════════════════════
// LAYOUT PROPORCIONAL
//
//  1. Un compás completo ocupa exactamente measurePx px
//     (measurePx = beatsPerMeasure() * NW).
//  2. Cada nota ocupa un ancho proporcional a su duración
//     respecto a la capacidad del compás.
//  3. Si un compás no cabe en la fila, salta a la siguiente.
//
// Devuelve { items, boxes }:
//   items: [{ note, x, w, row, noteIdx, measureIdx }]
//   boxes: [{ measureIdx, row, x0, w, startIdx, endIdx,
//             underflow, overflow }]
// ══════════════════════════════════════════════════════════════

export function buildLayout() {
  const measures  = analyzeMeasures();
  const capacity  = beatsPerMeasure();
  const measurePx = capacity * NW;
  const rowW      = W - ML - MR;

  const items = [];
  const boxes = [];

  let curRow = 0;
  let curX   = 0; // posición x dentro de la fila (relativa a ML)

  for (let mi = 0; mi < measures.length; mi++) {
    const m = measures[mi];

    // Compás incompleto (el último) ocupa solo lo proporcional
    const mPx = m.underflow
      ? (m.beats / capacity) * measurePx
      : measurePx;

    // Si no cabe completo en la fila, saltar a la siguiente
    if (curX > 0 && curX + mPx > rowW + 0.5) {
      curRow++;
      curX = 0;
    }

    const mStartX = curX;
    let beatsInMeasure = 0;

    for (let i = m.startIdx; i < m.endIdx; i++) {
      const n     = state.notes[i];
      const nb    = noteDurationBeats(n);
      const noteW = (nb / capacity) * measurePx;
      const xRel  = mStartX + (beatsInMeasure / capacity) * measurePx + noteW / 2;

      items.push({ note: n, x: ML + xRel, w: noteW, row: curRow, noteIdx: i, measureIdx: mi });
      beatsInMeasure += nb;
    }

    boxes.push({
      measureIdx: mi,
      row:        curRow,
      x0:         ML + mStartX,
      w:          mPx,
      startIdx:   m.startIdx,
      endIdx:     m.endIdx,
      underflow:  m.underflow,
      overflow:   m.overflow,
    });

    curX += mPx;
  }

  return { items, boxes, measures };
}

// ── Fondos de compás: activo (reproducción) + incompletos ─────
function drawMeasureBackgrounds(boxes, rowOffset) {
  for (const b of boxes) {
    const pageRow = b.row - rowOffset;
    if (pageRow < 0 || pageRow >= RPP) continue;

    const y = sY(pageRow, 0) - 6;
    const h = SS * 4 + 12;

    // Compás sonando ahora
    const isActive = activeNoteIdx >= 0 &&
                     activeNoteIdx >= b.startIdx && activeNoteIdx < b.endIdx;

    if (isActive) {
      ctx.save();
      ctx.fillStyle   = cssVar('--accent') || '#5B6CFF';
      ctx.globalAlpha = 0.08;
      ctx.fillRect(b.x0, y, b.w, h);
      ctx.restore();
    }

    // Compás con problema de duración
    if (b.overflow || b.underflow) {
      const warn = b.overflow ? (cssVar('--danger') || '#E5484D')
                              : (cssVar('--warning') || '#F5A524');
      ctx.save();
      ctx.fillStyle   = warn;
      ctx.globalAlpha = 0.06;
      ctx.fillRect(b.x0, y, b.w, h);

      // Barra punteada al final del compás incompleto
      ctx.globalAlpha = 0.75;
      ctx.strokeStyle = warn;
      ctx.lineWidth   = 1.4;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(b.x0 + b.w, sY(pageRow, 0));
      ctx.lineTo(b.x0 + b.w, sY(pageRow, 4));
      ctx.stroke();
      ctx.restore();
    }
  }
}

// ── Pentagrama: líneas, clave, compás, divisores ──────────────
function drawStaff() {
  const capacity  = beatsPerMeasure();
  const measurePx = capacity * NW;
  const rowW      = W - ML - MR;

  for (let r = 0; r < RPP; r++) {
    // Cinco líneas horizontales
    ctx.lineWidth   = 0.8;
    ctx.strokeStyle = cssVar('--staff-line');
    for (let l = 0; l < 5; l++) {
      ctx.beginPath();
      ctx.moveTo(ML - 8, sY(r, l));
      ctx.lineTo(W - MR, sY(r, l));
      ctx.stroke();
    }

    // Clave de SOL
    ctx.fillStyle    = cssVar('--staff-clef');
    ctx.font         = 'bold 46px serif';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('𝄞', ML - 50, sY(r, 0) + 38);

    // Indicador de compás
    ctx.font         = `bold ${SS * 1.4}px sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(state.timeSignature.num), ML - 14, sY(r, 1) + 2);
    ctx.fillText(String(state.timeSignature.den), ML - 14, sY(r, 3) + 2);

    // Divisores de compás (rejilla fija)
    ctx.strokeStyle = cssVar('--staff-bar');
    ctx.lineWidth   = 0.8;
    for (let b = 1; ; b++) {
      const xInRow = b * measurePx;
      if (xInRow > rowW + 1) break;
      const bx = ML + xInRow;
      ctx.beginPath();
      ctx.moveTo(bx, sY(r, 0));
      ctx.lineTo(bx, sY(r, 4));
      ctx.stroke();
    }

    // Línea de cierre
    ctx.strokeStyle = cssVar('--staff-clef');
    ctx.lineWidth   = 1.4;
    ctx.beginPath();
    ctx.moveTo(W - MR, sY(r, 0));
    ctx.lineTo(W - MR, sY(r, 4));
    ctx.stroke();
  }
}

// ── Dibuja una nota (o silencio) ──────────────────────────────
function drawNote(n, x, row, { selected = false, isActive = false, ghost = false } = {}) {
  const noteColor = ghost
    ? (fitsInCurrentMeasure(n.dur, n.dotted) ? (cssVar('--accent') || '#5B6CFF')
                                             : (cssVar('--danger') || '#E5484D'))
    : isActive ? (cssVar('--note-active') || '#FF8A3D')
    : selected ? cssVar('--note-selected')
    : (n.rest ? cssVar('--note-rest') : cssVar('--note-normal'));

  ctx.fillStyle   = noteColor;
  ctx.strokeStyle = noteColor;

  if (n.rest) {
    ctx.font         = '30px serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(REST_GLYPHS[n.dur] || '𝄽', x, sY(row, 2) + 4);
    if (n.dotted) {
      ctx.beginPath(); ctx.arc(x + 14, sY(row, 2) - 4, 1.8, 0, Math.PI * 2); ctx.fill();
    }
    return;
  }

  const y      = noteToY(n.note, row);
  const t0     = sY(row, 0);
  const t4     = sY(row, 4);
  const slot   = NOTE_SLOT[n.note] !== undefined ? NOTE_SLOT[n.note] : 0;
  const stemUp = slot < 4;

  // Líneas auxiliares
  ctx.strokeStyle = ghost ? noteColor : cssVar('--ledger-line');
  ctx.lineWidth   = 0.8;
  if (y < t0 - SS / 2) {
    for (let ly = t0 - SS; ly >= y - SS / 2; ly -= SS) {
      ctx.beginPath(); ctx.moveTo(x - 9, ly); ctx.lineTo(x + 9, ly); ctx.stroke();
    }
  }
  if (y > t4 + SS / 2) {
    for (let ly = t4 + SS; ly <= y + SS / 2; ly += SS) {
      ctx.beginPath(); ctx.moveTo(x - 9, ly); ctx.lineTo(x + 9, ly); ctx.stroke();
    }
  }

  ctx.strokeStyle = noteColor;
  ctx.fillStyle   = noteColor;

  if (n.dur === 'TT') {
    ctx.beginPath(); ctx.ellipse(x, y, 6, 4, 0, 0, Math.PI * 2);
    ctx.lineWidth = 1.4; ctx.stroke();

  } else if (n.dur === 'DT') {
    ctx.beginPath(); ctx.ellipse(x, y, 6, 4, -0.2, 0, Math.PI * 2);
    ctx.lineWidth = 1.4; ctx.stroke();
    const sx  = stemUp ? x + 6 : x - 6;
    const sy2 = stemUp ? y - 30 : y + 30;
    ctx.beginPath(); ctx.moveTo(sx, y); ctx.lineTo(sx, sy2);
    ctx.lineWidth = 1.4; ctx.stroke();

  } else {
    ctx.beginPath(); ctx.ellipse(x, y, 6, 4, -0.3, 0, Math.PI * 2); ctx.fill();
    const sx  = stemUp ? x + 6 : x - 6;
    const sy2 = stemUp ? y - 30 : y + 30;
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(sx, y); ctx.lineTo(sx, sy2); ctx.stroke();

    if (n.dur === 'MT' || n.dur === 'CT') {
      const dir = stemUp ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(sx, sy2 + dir * 2);
      ctx.quadraticCurveTo(sx + 10, sy2 + 9 * dir, sx + 4, sy2 + 18 * dir);
      ctx.stroke();
      if (n.dur === 'CT') {
        ctx.beginPath();
        ctx.moveTo(sx, sy2 + 8 * dir);
        ctx.quadraticCurveTo(sx + 9, sy2 + 16 * dir, sx + 2, sy2 + 24 * dir);
        ctx.stroke();
      }
    }
  }

  if (n.dotted) {
    ctx.beginPath(); ctx.arc(x + 10, y - 2, 1.8, 0, Math.PI * 2); ctx.fill();
  }

  if (n.accidental === 'sharp' || n.accidental === 'flat') {
    ctx.font         = '12px serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(n.accidental === 'sharp' ? '♯' : '♭', x - 13, y);
  }

  // Etiqueta bajo el pentagrama (no para fantasma)
  if (!ghost) {
    ctx.font         = `600 11px ${cssVar('--font-sans') || 'sans-serif'}`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle    = isActive ? (cssVar('--note-active') || '#FF8A3D')
                     : selected ? cssVar('--note-selected')
                     : cssVar('--note-label');
    const accSuffix = n.accidental === 'sharp' ? '#' : n.accidental === 'flat' ? 'b' : '';
    ctx.fillText(NOTE_DISPLAY[n.note] + accSuffix, x, sY(row, 4) + 38);
  }

  ctx.lineWidth    = 0.8;
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'alphabetic';
}

// ── Nota fantasma: previsualiza la herramienta bajo el cursor ──
function drawGhost(layoutItems, rowOffset) {
  if (cursorRow < 0 || cursorX < ML || cursorX > W - MR) return;
  if (activeNoteIdx >= 0) return; // no durante reproducción

  // No dibujar fantasma encima de una nota existente
  if (noteAtFromLayout(layoutItems, cursorX, cursorY, rowOffset) >= 0) return;

  const t = state.activeTool;
  const ghostNote = {
    note:       yToNote(cursorY, cursorRow),
    dur:        t.dur,
    dotted:     t.dotted,
    rest:       t.rest,
    accidental: t.rest ? 'none' : state.activeAccidental,
  };

  ctx.save();
  ctx.globalAlpha = 0.38;
  drawNote(ghostNote, cursorX, cursorRow, { ghost: true });
  ctx.restore();

  // Etiqueta junto al fantasma
  if (!t.rest) {
    const y = noteToY(ghostNote.note, cursorRow);
    ctx.save();
    ctx.font         = `600 10px ${cssVar('--font-sans') || 'sans-serif'}`;
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle    = cssVar('--accent') || '#5B6CFF';
    ctx.globalAlpha  = 0.85;
    const acc = ghostNote.accidental === 'sharp' ? '#'
              : ghostNote.accidental === 'flat' ? 'b' : '';
    ctx.fillText(NOTE_DISPLAY[ghostNote.note] + acc, cursorX + 16, y);
    ctx.restore();
  }
}

// ── Cabezal de reproducción ───────────────────────────────────
function drawPlayhead(rowOffset) {
  if (!playhead) return;
  const pageRow = playhead.row - rowOffset;
  if (pageRow < 0 || pageRow >= RPP) return;

  const accent = cssVar('--accent') || '#5B6CFF';
  ctx.save();
  ctx.strokeStyle = accent;
  ctx.lineWidth   = 2;
  ctx.shadowColor = accent;
  ctx.shadowBlur  = 6;
  ctx.beginPath();
  ctx.moveTo(playhead.x, sY(pageRow, 0) - 14);
  ctx.lineTo(playhead.x, sY(pageRow, 4) + 14);
  ctx.stroke();

  // Triángulo superior
  ctx.shadowBlur = 0;
  ctx.fillStyle  = accent;
  ctx.beginPath();
  ctx.moveTo(playhead.x - 5, sY(pageRow, 0) - 20);
  ctx.lineTo(playhead.x + 5, sY(pageRow, 0) - 20);
  ctx.lineTo(playhead.x, sY(pageRow, 0) - 12);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ── Hit-test: qué nota está en (cx, cy) ───────────────────────
function noteAtFromLayout(items, cx, cy, rowOffset) {
  for (const { note, x, row, noteIdx } of items) {
    const pageRow = row - rowOffset;
    if (pageRow < 0 || pageRow >= RPP) continue;
    const y = note.rest ? sY(pageRow, 2) : noteToY(note.note, pageRow);
    if (Math.abs(cx - x) < NW / 2 && Math.abs(cy - y) < 14) return noteIdx;
  }
  return -1;
}

export function noteAt(cx, cy) {
  const { items } = buildLayout();
  return noteAtFromLayout(items, cx, cy, state.currentPage * RPP);
}

// ── Render principal ──────────────────────────────────────────
export function render() {
  calcCanvas();
  ctx.clearRect(0, 0, W, H);

  ctx.fillStyle = cssVar('--bg-score');
  ctx.fillRect(0, 0, W, H);

  const { items, boxes } = buildLayout();
  const maxRow = items.length > 0 ? Math.max(...items.map(l => l.row)) : 0;
  const pg     = Math.max(1, Math.ceil((maxRow + 1) / RPP));

  if (pg !== state.pages) {
    state.pages = pg;
    if (state.currentPage >= pg) state.currentPage = pg - 1;
  }

  const rowOffset = state.currentPage * RPP;

  drawMeasureBackgrounds(boxes, rowOffset);
  drawStaff();

  for (const { note, x, row, noteIdx } of items) {
    const pageRow = row - rowOffset;
    if (pageRow < 0 || pageRow >= RPP) continue;
    drawNote(note, x, pageRow, {
      selected: noteIdx === state.selectedNote,
      isActive: noteIdx === activeNoteIdx,
    });
  }

  drawGhost(items, rowOffset);
  drawPlayhead(rowOffset);

  for (const fn of afterRenderFns) fn();
}

// ── Render diferido a un frame (para mousemove/resize) ────────
let _renderPending = false;
export function requestRender() {
  if (_renderPending) return;
  _renderPending = true;
  requestAnimationFrame(() => {
    _renderPending = false;
    render();
  });
}
