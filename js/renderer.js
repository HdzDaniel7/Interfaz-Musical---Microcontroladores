/* ============================================================
   renderer.js — Dibujo del pentagrama y las notas en canvas
   ============================================================ */

import {
  NOTE_SLOT, SLOT_MIN, SLOT_MAX, SLOT_TO_NOTE, NOTE_DISPLAY, REST_GLYPHS,
  SS, ST, NW, ML, MR, RPP, RH,
} from './constants.js';
import { state } from './state.js';
import {
  beatsPerMeasure, noteDurationBeats, analyzeMeasures, fitsAtIndex,
  sanitizedRepeats,
} from './music.js';

export const canvas = document.getElementById('score-canvas');
const ctx = canvas.getContext('2d');

// Dimensiones lógicas (el canvas físico se escala por devicePixelRatio)
let W = 0, H = 0;

// ── Zoom del pentagrama (0.75–1.5) ─────────────────────────────
// Multiplica la escala visual sin tocar las constantes de dibujo:
// W lógico se reduce en la misma proporción y ctx.setTransform lo
// compensa, así NW/SS/ST/etc. siguen siendo las mismas unidades lógicas.
export const ZOOM_MIN = 0.75, ZOOM_MAX = 1.5;
let zoom = 1;
export function getZoom() { return zoom; }
export function setZoom(z) { zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)); }

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
  const pad  = 36; // padding del wrapper (18px por lado, ver CSS)
  const cssW = Math.max(container.clientWidth - pad, 380); // ancho visual (CSS px)
  W = cssW / zoom; // ancho lógico: a más zoom, menos unidades lógicas caben por fila
  H = ST + RPP * RH + 10;
  const cssH = H * zoom;

  const dpr = window.devicePixelRatio || 1;
  canvas.width        = Math.round(cssW * dpr);
  canvas.height       = Math.round(cssH * dpr);
  canvas.style.width  = cssW + 'px';
  canvas.style.height = cssH + 'px';
  ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, 0, 0);
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

// Espacio horizontal que ocupa la armadura tras la clave
function keySigPad() {
  const ks = Math.abs(state.keySignature || 0);
  return ks ? ks * 8 + 6 : 0;
}

// Cache del layout: noteAt()/insertionIndexAt() lo reutilizan entre
// eventos de mouse en vez de recalcularlo; render() lo invalida y
// recalcula siempre, así queda fresco para el próximo evento.
let _layoutCache = null;
export function invalidateLayout() { _layoutCache = null; }

export function buildLayout() {
  if (_layoutCache) return _layoutCache;
  _layoutCache = computeLayout();
  return _layoutCache;
}

function computeLayout() {
  const measures  = analyzeMeasures();
  const capacity  = beatsPerMeasure();
  const measurePx = capacity * NW;
  const pad       = keySigPad();
  const rowW      = W - ML - pad - MR;

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

      items.push({
        note: n, x: ML + pad + xRel, w: noteW, row: curRow,
        noteIdx: i, measureIdx: mi, beatStart: beatsInMeasure,
      });
      beatsInMeasure += nb;
    }

    boxes.push({
      measureIdx: mi,
      row:        curRow,
      x0:         ML + pad + mStartX,
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
// Posiciones (slot) estándar de la armadura en clave de SOL
const SHARP_SLOTS = [8, 5, 9, 6, 3, 7, 4];
const FLAT_SLOTS  = [4, 7, 3, 6, 2, 5, 1];

function drawKeySignature(r) {
  const ks = state.keySignature || 0;
  if (!ks) return;
  const slots = (ks > 0 ? SHARP_SLOTS : FLAT_SLOTS).slice(0, Math.abs(ks));
  const glyph = ks > 0 ? '♯' : '♭';
  ctx.fillStyle    = cssVar('--staff-clef');
  ctx.font         = '13px serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  slots.forEach((slot, k) => {
    ctx.fillText(glyph, ML + 6 + k * 8, sY(r, 4) - slot * (SS / 2));
  });
}

function drawStaff() {
  const capacity  = beatsPerMeasure();
  const measurePx = capacity * NW;
  const pad       = keySigPad();
  const rowW      = W - ML - pad - MR;

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

    drawKeySignature(r);

    // Divisores de compás (rejilla fija)
    ctx.strokeStyle = cssVar('--staff-bar');
    ctx.lineWidth   = 0.8;
    for (let b = 1; ; b++) {
      const xInRow = b * measurePx;
      if (xInRow > rowW + 1) break;
      const bx = ML + pad + xInRow;
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

// ── Texto fantasma cuando la partitura está vacía (onboarding) ──
function drawEmptyHint() {
  if (state.notes.length > 0) return;
  ctx.fillStyle    = cssVar('--text-muted');
  ctx.font         = `500 14px ${cssVar('--font-sans') || 'sans-serif'}`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Hacé clic para agregar tu primera nota, o probá el botón ✨ Demo', W / 2, H / 2, W - 40);
}

// ── Dibuja una nota (o silencio) ──────────────────────────────
function drawNote(n, x, row, { selected = false, isActive = false, ghost = false, fits = true, beamed = false } = {}) {
  const noteColor = ghost
    ? (fits ? (cssVar('--accent') || '#5B6CFF')
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

    // Las notas unidas por barra (beam) reciben plica y barra aparte
    if (!beamed) {
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
  }

  if (n.dotted) {
    ctx.beginPath(); ctx.arc(x + 10, y - 2, 1.8, 0, Math.PI * 2); ctx.fill();
  }

  if (n.accidental !== 'none') {
    ctx.font         = '12px serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    const glyph = n.accidental === 'sharp' ? '♯'
                : n.accidental === 'flat' ? '♭' : '♮';
    ctx.fillText(glyph, x - 13, y);
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
    triplet:    t.triplet,
    rest:       t.rest,
    accidental: t.rest ? 'none' : state.activeAccidental,
  };

  // Punto de inserción: ¿cabe ahí? + caret si es en medio
  const insertIdx = insertionIndexFromLayout(layoutItems, cursorX, cursorY, rowOffset);
  const fits      = fitsAtIndex(insertIdx, t.dur, t.dotted, t.triplet);

  if (insertIdx < state.notes.length) {
    const target = layoutItems.find(it => it.noteIdx === insertIdx);
    if (target) {
      const pageRow = target.row - rowOffset;
      if (pageRow >= 0 && pageRow < RPP) {
        const cxLine = target.x - target.w / 2;
        ctx.save();
        ctx.strokeStyle = cssVar('--accent') || '#5B6CFF';
        ctx.lineWidth   = 2;
        ctx.globalAlpha = 0.65;
        ctx.beginPath();
        ctx.moveTo(cxLine, sY(pageRow, 0) - 10);
        ctx.lineTo(cxLine, sY(pageRow, 4) + 10);
        ctx.stroke();
        // Pequeñas alas del caret
        ctx.beginPath();
        ctx.moveTo(cxLine - 4, sY(pageRow, 0) - 10);
        ctx.lineTo(cxLine + 4, sY(pageRow, 0) - 10);
        ctx.moveTo(cxLine - 4, sY(pageRow, 4) + 10);
        ctx.lineTo(cxLine + 4, sY(pageRow, 4) + 10);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  ctx.save();
  ctx.globalAlpha = 0.38;
  drawNote(ghostNote, cursorX, cursorRow, { ghost: true, fits });
  // Indicador de tresillo sobre el fantasma
  if (t.triplet) {
    const gy = ghostNote.rest ? sY(cursorRow, 2) : noteToY(ghostNote.note, cursorRow);
    ctx.font         = `italic 700 11px ${cssVar('--font-sans') || 'sans-serif'}`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle    = cssVar('--accent') || '#5B6CFF';
    ctx.fillText('3', cursorX, gy - 40);
  }
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
              : ghostNote.accidental === 'flat' ? 'b'
              : ghostNote.accidental === 'natural' ? '♮' : '';
    ctx.fillText(NOTE_DISPLAY[ghostNote.note] + acc, cursorX + 16, y);
    ctx.restore();
  }
}

// ── Beaming: agrupar corcheas/semicorcheas del mismo pulso ────
// Devuelve grupos (≥2 notas) de items consecutivos beamables:
// misma fila, mismo compás y mismo pulso de negra.
function computeBeamGroups(items) {
  const groups = [];
  let group = [];

  const beamable = it => !it.note.rest && (it.note.dur === 'MT' || it.note.dur === 'CT');

  const flush = () => {
    if (group.length >= 2) groups.push(group);
    group = [];
  };

  for (const it of items) {
    if (!beamable(it)) { flush(); continue; }
    const prev = group[group.length - 1];
    const sameBeat = prev &&
      prev.row === it.row &&
      prev.measureIdx === it.measureIdx &&
      Math.floor(prev.beatStart + 1e-6) === Math.floor(it.beatStart + 1e-6);
    if (prev && !sameBeat) flush();
    group.push(it);
  }
  flush();
  return groups;
}

function drawBeams(groups, rowOffset, selSet) {
  for (const group of groups) {
    const pageRow = group[0].row - rowOffset;
    if (pageRow < 0 || pageRow >= RPP) continue;

    const ys = group.map(it => noteToY(it.note.note, pageRow));
    const avgSlot = group.reduce((s, it) => s + (NOTE_SLOT[it.note.note] ?? 0), 0) / group.length;
    const up = avgSlot < 4;
    const beamY = up ? Math.min(...ys) - 30 : Math.max(...ys) + 30;
    const stemX = it => (up ? it.x + 6 : it.x - 6);

    // Plicas (con el color de cada nota)
    group.forEach((it, k) => {
      ctx.strokeStyle = selSet.has(it.noteIdx)
        ? cssVar('--note-selected') : cssVar('--note-normal');
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(stemX(it), ys[k]);
      ctx.lineTo(stemX(it), beamY);
      ctx.stroke();
    });

    // Barra principal
    ctx.strokeStyle = cssVar('--note-normal');
    ctx.lineWidth   = 3.2;
    ctx.beginPath();
    ctx.moveTo(stemX(group[0]), beamY);
    ctx.lineTo(stemX(group[group.length - 1]), beamY);
    ctx.stroke();

    // Segunda barra para semicorcheas
    const second = beamY + (up ? 5 : -5);
    const allCT  = group.every(it => it.note.dur === 'CT');
    ctx.lineWidth = 2.4;
    if (allCT) {
      ctx.beginPath();
      ctx.moveTo(stemX(group[0]), second);
      ctx.lineTo(stemX(group[group.length - 1]), second);
      ctx.stroke();
    } else {
      group.forEach((it, k) => {
        if (it.note.dur !== 'CT') return;
        const dir = k > 0 ? -1 : 1; // stub hacia el vecino
        ctx.beginPath();
        ctx.moveTo(stemX(it), second);
        ctx.lineTo(stemX(it) + dir * 9, second);
        ctx.stroke();
      });
    }
  }
}

// ── Tresillos: corchete con "3" sobre cada grupo ──────────────
// Las notas/silencios consecutivos con triplet se agrupan de a 3
// (misma fila y mismo compás); cada grupo recibe su corchete.
function computeTripletGroups(items) {
  const groups = [];
  let run = [];

  const flushRun = () => {
    for (let k = 0; k < run.length; k += 3) groups.push(run.slice(k, k + 3));
    run = [];
  };

  for (const it of items) {
    const prev   = run[run.length - 1];
    const breaks = prev && (prev.row !== it.row || prev.measureIdx !== it.measureIdx);
    if (!it.note.triplet || breaks) flushRun();
    if (it.note.triplet) run.push(it);
  }
  flushRun();
  return groups;
}

function drawTripletBrackets(groups, rowOffset) {
  for (const g of groups) {
    const pageRow = g[0].row - rowOffset;
    if (pageRow < 0 || pageRow >= RPP) continue;

    const ys = g.map(it => it.note.rest ? sY(pageRow, 2) : noteToY(it.note.note, pageRow));
    const avgSlot = g.reduce((s, it) =>
      s + (it.note.rest ? 4 : (NOTE_SLOT[it.note.note] ?? 0)), 0) / g.length;
    const up  = avgSlot < 4;             // plicas/barra hacia arriba
    const top = Math.min(...ys);
    const y   = up ? top - 40 : top - 14; // por encima de plicas o cabezas

    const x0 = g[0].x - 8;
    const x1 = g[g.length - 1].x + 8;
    const mx = (x0 + x1) / 2;

    ctx.save();
    ctx.strokeStyle = ctx.fillStyle = cssVar('--note-label') || '#888';
    ctx.lineWidth   = 1.1;
    ctx.beginPath();
    ctx.moveTo(x0, y + 4); ctx.lineTo(x0, y); ctx.lineTo(mx - 6, y);
    ctx.moveTo(mx + 6, y); ctx.lineTo(x1, y); ctx.lineTo(x1, y + 4);
    ctx.stroke();

    ctx.font         = `italic 700 11px ${cssVar('--font-sans') || 'sans-serif'}`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('3', mx, y);
    ctx.restore();
  }
}

// ── Arcos de ligadura entre notas consecutivas ────────────────
// `items[it.noteIdx + 1]` asume 1 item por nota en el mismo orden que
// state.notes (cierto hoy: buildLayout no filtra notas) — si eso cambia,
// buscar el siguiente item por noteIdx en vez de indexar directo.
function drawTies(items, rowOffset) {
  ctx.save();
  ctx.strokeStyle = cssVar('--note-label') || '#5B6CFF';
  ctx.lineWidth   = 1.3;

  for (const it of items) {
    const n = it.note;
    if (!n.tieToNext || n.rest) continue;
    const next = items[it.noteIdx + 1];
    if (!next || next.note.rest) continue;

    const pageRow = it.row - rowOffset;

    // Arco de salida: solo si la nota origen es visible en esta página
    if (pageRow >= 0 && pageRow < RPP) {
      const y1   = noteToY(n.note, pageRow);
      const slot = NOTE_SLOT[n.note] ?? 0;
      const up   = slot < 2; // arco por arriba para notas graves, abajo para agudas
      const off  = up ? -8 : 10;

      ctx.beginPath();
      if (next.row === it.row) {
        const y2  = noteToY(next.note.note, pageRow);
        const mx  = (it.x + next.x) / 2;
        const my  = Math.min(y1, y2) * (up ? 1 : 0) + Math.max(y1, y2) * (up ? 0 : 1) + off * 1.6;
        ctx.moveTo(it.x + 7, y1 + off * 0.5);
        ctx.quadraticCurveTo(mx, my, next.x - 7, y2 + off * 0.5);
      } else {
        // La siguiente está en otra fila: arco abierto hacia el borde
        ctx.moveTo(it.x + 7, y1 + off * 0.5);
        ctx.quadraticCurveTo(it.x + 18, y1 + off * 1.4, it.x + 30, y1 + off * 0.6);
      }
      ctx.stroke();
    }

    // Arco de llegada (espejado) en la fila destino, si cruza de fila
    if (next.row !== it.row) {
      const pageRow2 = next.row - rowOffset;
      if (pageRow2 >= 0 && pageRow2 < RPP) {
        const y2    = noteToY(next.note.note, pageRow2);
        const slot2 = NOTE_SLOT[next.note.note] ?? 0;
        const up2   = slot2 < 2;
        const off2  = up2 ? -8 : 10;

        ctx.beginPath();
        ctx.moveTo(next.x - 30, y2 + off2 * 0.6);
        ctx.quadraticCurveTo(next.x - 18, y2 + off2 * 1.4, next.x - 7, y2 + off2 * 0.5);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

// ── Signos de repetición (║: … :║ ×N) ─────────────────────────
function drawRepeatSigns(boxes, rowOffset) {
  const reps = sanitizedRepeats(boxes.length);
  if (!reps.length) return;

  const color = cssVar('--accent') || '#5B6CFF';

  const sign = (x, pageRow, opening) => {
    const yTop = sY(pageRow, 0), yBot = sY(pageRow, 4);
    const dir  = opening ? 1 : -1;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle   = color;
    // Barra gruesa + barra fina
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x, yTop); ctx.lineTo(x, yBot); ctx.stroke();
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + 4 * dir, yTop); ctx.lineTo(x + 4 * dir, yBot); ctx.stroke();
    // Dos puntos
    ctx.beginPath(); ctx.arc(x + 8 * dir, sY(pageRow, 1) + SS / 2, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 8 * dir, sY(pageRow, 2) + SS / 2, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  };

  for (const rep of reps) {
    const a = boxes[rep.from], b = boxes[rep.to];
    if (!a || !b) continue;

    const rowA = a.row - rowOffset, rowB = b.row - rowOffset;
    if (rowA >= 0 && rowA < RPP) sign(a.x0 + 2, rowA, true);
    if (rowB >= 0 && rowB < RPP) {
      sign(b.x0 + b.w - 2, rowB, false);
      // Etiqueta ×N sobre el final de la repetición
      ctx.save();
      ctx.font         = `700 11px ${cssVar('--font-sans') || 'sans-serif'}`;
      ctx.textAlign    = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle    = color;
      ctx.fillText(`×${rep.times}`, b.x0 + b.w - 2, sY(rowB, 0) - 6);
      ctx.restore();
    }
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

// ── Índice de inserción para un punto del canvas ──────────────
// Devuelve el índice de la primera nota que queda "después" del
// punto (misma fila a la derecha, o cualquier fila posterior).
// Si el punto cae después de todas, devuelve notes.length (append).
function insertionIndexFromLayout(items, cx, cy, rowOffset) {
  const row = getRow(cy);
  if (row < 0) return state.notes.length;
  const absRow = row + rowOffset;
  for (const it of items) {
    if (it.row > absRow || (it.row === absRow && it.x >= cx)) return it.noteIdx;
  }
  return state.notes.length;
}

export function insertionIndexAt(cx, cy) {
  const { items } = buildLayout();
  return insertionIndexFromLayout(items, cx, cy, state.currentPage * RPP);
}

// ── Hit-test: qué compás está en (cx, cy) — para elegir repeticiones ──
export function measureAt(cx, cy) {
  const row = getRow(cy);
  if (row < 0) return -1;
  const absRow = row + state.currentPage * RPP;
  const { boxes } = buildLayout();
  for (const b of boxes) {
    if (b.row === absRow && cx >= b.x0 && cx <= b.x0 + b.w) return b.measureIdx;
  }
  return -1;
}

// ── Render principal ──────────────────────────────────────────
export function render() {
  calcCanvas();
  invalidateLayout(); // el repintado siempre parte de un layout fresco
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
  drawEmptyHint();
  drawRepeatSigns(boxes, rowOffset);

  const selSet = new Set(state.selection);
  if (state.selectedNote >= 0) selSet.add(state.selectedNote);

  const beamGroups = computeBeamGroups(items);
  const beamedSet  = new Set();
  for (const g of beamGroups) for (const it of g) beamedSet.add(it.noteIdx);

  for (const { note, x, row, noteIdx } of items) {
    const pageRow = row - rowOffset;
    if (pageRow < 0 || pageRow >= RPP) continue;
    drawNote(note, x, pageRow, {
      selected: selSet.has(noteIdx),
      isActive: noteIdx === activeNoteIdx,
      beamed:   beamedSet.has(noteIdx),
    });
  }

  drawBeams(beamGroups, rowOffset, selSet);
  drawTripletBrackets(computeTripletGroups(items), rowOffset);
  drawTies(items, rowOffset);
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
