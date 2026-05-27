/* ============================================================
   renderer.js — Dibujo del pentagrama y las notas en canvas
   ============================================================ */

let cursorX = -1;
let cursorY   = -1;
let cursorRow = -1;

function cssVar(v) {
  return getComputedStyle(document.documentElement).getPropertyValue(v).trim();
}

function calcCanvas() {
  const container = document.getElementById('score-container');
  const w = container.clientWidth - 20;
  canvas.width  = Math.max(w, 380);
  canvas.height = RPP * RH + ST + 28;
}

// ══════════════════════════════════════════════════════════════
// LAYOUT PROPORCIONAL
//
// Reglas:
//  1. Un compás completo siempre ocupa exactamente measurePx px.
//     measurePx = beatsPerMeasure() * NW
//     (ej: 4/4 → 4*NW, 2/4 → 2*NW, 3/4 → 3*NW, 6/8 → 3*NW)
//
//  2. Dentro de un compás, cada nota ocupa un ancho proporcional
//     a su duración RESPECTO a la capacidad total del compás:
//       noteW = (noteDurationBeats(n) / capacity) * measurePx
//     Así 4 semicorcheas en 2/4 → cada una ocupa (0.25/2)*2*NW = 0.25*NW
//     y las 4 juntas ocupan exactamente 1*NW = measurePx/2.
//     Una blanca en 2/4 → (2/2)*2*NW = 2*NW = measurePx.
//
//  3. La posición x de una nota es el centro de su slot:
//       x = compásStartX + beatsUsadosAntes/capacity * measurePx + noteW/2
//
//  4. Las notas se distribuyen en filas de ancho (canvas.width - ML - MR).
//     Cuando el cursor x supera el ancho de una fila, salta a la siguiente.
//     Los compases siempre empiezan en un límite de fila limpio si no caben.
// ══════════════════════════════════════════════════════════════

function buildLayout() {
  const measures  = analyzeMeasures();
  const capacity  = beatsPerMeasure();
  const measurePx = capacity * NW;
  const rowW      = canvas.width - ML - MR;

  const layout = []; // { note, x, row, noteIdx, measureIdx }

  let curRow  = 0;
  let curX    = 0;  // posición x dentro de la fila actual (relativa a ML)

  for (let mi = 0; mi < measures.length; mi++) {
    const m = measures[mi];

    // Espacio real que ocupa este compás en px
    // Si el compás está completo → measurePx
    // Si está incompleto (último compás con menos beats) → proporcional
    const mPx = m.underflow
      ? (m.beats / capacity) * measurePx   // compás incompleto: solo lo que hay
      : measurePx;                          // compás completo: ancho fijo

    // ¿Cabe el compás en el espacio restante de la fila actual?
    // Si no cabe completo, saltar a la siguiente fila.
    if (curX > 0 && curX + mPx > rowW + 0.5) {
      curRow++;
      curX = 0;
    }

    // Posición x del inicio de este compás
    const mStartX = curX;

    // Beats acumulados dentro del compás (para calcular x de cada nota)
    let beatsInMeasure = 0;

    for (let i = m.startIdx; i < m.endIdx; i++) {
      const n    = state.notes[i];
      const nb   = noteDurationBeats(n);
      const noteW = (nb / capacity) * measurePx;

      // x = inicio del compás + offset proporcional + centro de la nota
      const xRel = mStartX + (beatsInMeasure / capacity) * measurePx + noteW / 2;
      const x    = ML + xRel;

      layout.push({ note: n, x, row: curRow, noteIdx: i, measureIdx: mi });
      beatsInMeasure += nb;
    }

    curX += mPx;
  }

  return layout;
}

// ── Dibuja el pentagrama (líneas + divisores de compás) ────────
function drawStaff() {
  const capacity  = beatsPerMeasure();
  const measurePx = capacity * NW;
  const rowW      = canvas.width - ML - MR;

  for (let r = 0; r < RPP; r++) {
    // ── Highlight del compás activo durante reproducción ──────
    if (typeof activeNoteIdx !== 'undefined' && activeNoteIdx >= 0) {
      const measures      = analyzeMeasures();
      const activeMeasure = measures.find(m =>
        activeNoteIdx >= m.startIdx && activeNoteIdx < m.endIdx
      );

      if (activeMeasure) {
        const layout       = buildLayout();
        const rowOffset    = state.currentPage * RPP;
        const notesInMeasure = layout.filter(l =>
          l.noteIdx >= activeMeasure.startIdx && l.noteIdx < activeMeasure.endIdx
        );

        if (notesInMeasure.length > 0) {
          const firstNote = notesInMeasure[0];
          const lastNote  = notesInMeasure[notesInMeasure.length - 1];
          const pageRow   = firstNote.row - rowOffset;

          if (pageRow === r) {
            const capacity   = beatsPerMeasure();
            const measurePx  = capacity * NW;
            // Calcular x inicio del compás desde el índice del primer nota
            const xStart = firstNote.x - (NW / 2);
            const xEnd   = xStart + measurePx;

            ctx.save();
            ctx.fillStyle   = cssVar('--accent') || '#4A90D9';
            ctx.globalAlpha = 0.07;
            ctx.fillRect(
              xStart,
              sY(r, 0) - 4,
              xEnd - xStart,
              SS * 4 + 8
            );
            ctx.restore();
          }
        }
      }
    }
    // Cinco líneas horizontales
    ctx.lineWidth   = 0.8;
    ctx.strokeStyle = cssVar('--staff-line');
    for (let l = 0; l < 5; l++) {
      ctx.beginPath();
      ctx.moveTo(ML - 8, sY(r, l));
      ctx.lineTo(canvas.width - MR, sY(r, l));
      ctx.stroke();
    }

    // Clave de SOL
    ctx.fillStyle    = cssVar('--staff-clef');
    ctx.font         = 'bold 46px serif';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('𝄞', ML - 50, sY(r, 0) + 38);

    // Indicador de compás
    ctx.font         = `bold ${SS * 1.4}px sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(state.timeSignature.num), ML - 14, sY(r, 1) + 2);
    ctx.fillText(String(state.timeSignature.den), ML - 14, sY(r, 3) + 2);

    // Divisores de compás
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
    ctx.moveTo(canvas.width - MR, sY(r, 0));
    ctx.lineTo(canvas.width - MR, sY(r, 4));
    ctx.stroke();

    // ── Cursor de posición ─────────────────────────────────
    if (cursorX >= ML && cursorX <= canvas.width - MR && cursorRow === r) {
      ctx.save();
      ctx.strokeStyle = cssVar('--accent') || '#4A90D9';
      ctx.lineWidth   = 1;
      ctx.globalAlpha = 0.45;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(cursorX, sY(r, 0) - 8);
      ctx.lineTo(cursorX, sY(r, 4) + 8);
      ctx.stroke();
      ctx.restore();

      // Etiqueta de nota bajo la línea
      const noteAtCursor = yToNote(cursorY, r);
      if (noteAtCursor) {
        ctx.save();
        ctx.font         = `500 10px ${cssVar('--font-sans') || 'sans-serif'}`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle    = cssVar('--accent') || '#4A90D9';
        ctx.globalAlpha  = 0.7;
        ctx.fillText(NOTE_DISPLAY[noteAtCursor] || noteAtCursor, cursorX, sY(r, 4) + 14);
        ctx.restore();
      }
    }

  } // ← cierre del for
} // ← cierre de drawStaff

// ── Dibuja una nota (o silencio) ──────────────────────────────
function drawNote(n, x, row, sel, noteIdx) {
  const isActive  = (noteIdx === activeNoteIdx);
  const noteColor = isActive
    ? '#E05A00'                        // naranja: activa (tocando ahora)
    : sel
      ? cssVar('--note-selected')      // rojo: seleccionada por el usuario
      : (n.rest ? cssVar('--note-rest') : cssVar('--note-normal'));

  ctx.fillStyle   = noteColor;
  ctx.strokeStyle = noteColor;

  if (n.rest) {
    ctx.font         = '30px serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(
      { TT: '𝄻', DT: '𝄼', T: '𝄽', MT: '𝄾', CT: '𝄿' }[n.dur] || '𝄽',
      x, sY(row, 2) + 4
    );
    if (n.dotted) {
      ctx.beginPath(); ctx.arc(x + 14, sY(row, 2) - 4, 1.8, 0, Math.PI * 2); ctx.fill();
    }
    return;
  }

  const y     = noteToY(n.note, row);
  const t0    = sY(row, 0);
  const t4    = sY(row, 4);
  const slot  = NOTE_SLOT[n.note] !== undefined ? NOTE_SLOT[n.note] : 0;
  const stemUp = slot < 4;

  // Líneas auxiliares
  ctx.strokeStyle = cssVar('--ledger-line');
  ctx.lineWidth   = 0.8;
  if (y < t0 - SS / 2) {
    for (let ly = t0 - SS; ly >= y - SS / 2; ly -= SS) {
      ctx.beginPath(); ctx.moveTo(x - 8, ly); ctx.lineTo(x + 8, ly); ctx.stroke();
    }
  }
  if (y > t4 + SS / 2) {
    for (let ly = t4 + SS; ly <= y + SS / 2; ly += SS) {
      ctx.beginPath(); ctx.moveTo(x - 8, ly); ctx.lineTo(x + 8, ly); ctx.stroke();
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
      ctx.quadraticCurveTo(sx + 10 , sy2 + 9 * dir, sx + 4  , sy2 + 18 * dir);
      ctx.stroke();
      if (n.dur === 'CT') {
        ctx.beginPath();
        ctx.moveTo(sx, sy2 + 8 * dir );
        ctx.quadraticCurveTo(sx + 9 , sy2 + 16 * dir, sx + 2 , sy2 + 24 * dir);
        ctx.stroke();
      }
    }
  }

  if (n.dotted) {
    ctx.beginPath(); ctx.arc(x + 10, y - 2, 1.8, 0, Math.PI * 2); ctx.fill();
  }

  if (n.accidental === 'sharp' || n.accidental === 'flat') {
    ctx.fillStyle    = noteColor;
    ctx.font         = '11px serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(n.accidental === 'sharp' ? '♯' : '♭', x - 13, y);
  }

  ctx.font         = `600 11px ${cssVar('--font-sans') || 'sans-serif'}`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = isActive
    ? '#E05A00'
    : sel
      ? cssVar('--note-selected')
      : cssVar('--note-label');
  const accSuffix  = n.accidental === 'sharp' ? '#' : n.accidental === 'flat' ? 'b' : '';
  ctx.fillText(NOTE_DISPLAY[n.note] + accSuffix, x, sY(row, 4) + 35);

  ctx.lineWidth    = 0.8;
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'alphabetic';
}

// ── Hit-test: qué nota está en (cx, cy) ───────────────────────
function noteAt(cx, cy) {
  const layout    = buildLayout();
  const rowOffset = state.currentPage * RPP;

  for (const { note, x, row, noteIdx } of layout) {
    const pageRow = row - rowOffset;
    if (pageRow < 0 || pageRow >= RPP) continue;
    const y = note.rest ? sY(pageRow, 2) : noteToY(note.note, pageRow);
    if (Math.abs(cx - x) < NW / 2 && Math.abs(cy - y) < 14) return noteIdx;
  }
  return -1;
}

// ── Render principal ──────────────────────────────────────────
function render() {
  calcCanvas();
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = cssVar('--bg-score');
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const layout    = buildLayout();
  const maxRow    = layout.length > 0 ? Math.max(...layout.map(l => l.row)) : 0;
  const pg        = Math.max(1, Math.ceil((maxRow + 1) / RPP));

  if (pg !== state.pages) {
    state.pages = pg;
    if (state.currentPage >= pg) state.currentPage = pg - 1;
  }

  drawStaff();

  const rowOffset = state.currentPage * RPP;
  for (const { note, x, row, noteIdx } of layout) {
    const pageRow = row - rowOffset;
    if (pageRow < 0 || pageRow >= RPP) continue;
    drawNote(note, x, pageRow, noteIdx === state.selectedNote, noteIdx);
  }

  document.getElementById('page-ind').textContent =
    `Pág ${state.currentPage + 1}/${state.pages}`;

  if (typeof updateStatus   === 'function') updateStatus();
  if (typeof updateCodePanel === 'function') updateCodePanel();
}

render();