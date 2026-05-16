/* ============================================================
   renderer.js — Dibujo del pentagrama y las notas en canvas
   ============================================================ */

const canvas = document.getElementById('score-canvas');
const ctx    = canvas.getContext('2d');

// ── Ajuste del tamaño del canvas al contenedor ────────────────
function calcCanvas() {
  const w = document.getElementById('score-container').clientWidth - 20;
  canvas.width  = Math.max(w, 380);
  canvas.height = RPP * RH + ST + 28;
}

// ── Dibuja un pentagrama completo para la fila `row` ─────────
function drawStaff(row) {
  const dark = window.matchMedia('(prefers-color-scheme:dark)').matches;

  // Cinco líneas horizontales
  ctx.lineWidth   = 0.8;
  ctx.strokeStyle = dark ? '#555' : '#bbb';
  for (let l = 0; l < 5; l++) {
    ctx.beginPath();
    ctx.moveTo(ML - 8, sY(row, l));
    ctx.lineTo(canvas.width - MR, sY(row, l));
    ctx.stroke();
  }

  // Clave de SOL
  ctx.fillStyle = dark ? '#aaa' : '#333';
  ctx.font = 'bold 46px serif';
  ctx.fillText('𝄞', ML - 50, sY(row, 0) + 38);

  // Líneas divisoras de compás (cada 4 notas)
  const bw = NW * 4;
  ctx.strokeStyle = dark ? '#555' : '#ccc';
  ctx.lineWidth   = 0.7;
  for (let b = 1; ; b++) {
    const bx = ML + b * bw;
    if (bx >= canvas.width - MR) break;
    ctx.beginPath();
    ctx.moveTo(bx, sY(row, 0));
    ctx.lineTo(bx, sY(row, 4));
    ctx.stroke();
  }

  // Línea de cierre del pentagrama
  ctx.strokeStyle = dark ? '#666' : '#999';
  ctx.lineWidth   = 1.4;
  ctx.beginPath();
  ctx.moveTo(canvas.width - MR, sY(row, 0));
  ctx.lineTo(canvas.width - MR, sY(row, 4));
  ctx.stroke();
}

// ── Dibuja una nota (o silencio) ──────────────────────────────
function drawNote(n, x, row, sel) {
  const col = sel ? '#E85D4A' : '#0F0F0F';

  // ── Silencio ─────────────────────────────────────────────
  if (n.rest) {
    ctx.fillStyle    = col;
    ctx.font         = '30px serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(
      { TT: '𝄻', DT: '𝄼', T: '𝄽', MT: '𝄾', CT: '𝄿' }[n.dur] || '𝄽',
      x,
      sY(row, 2) + 4
    );
    return;
  }

  const y  = noteToY(n.note, row);
  const t0 = sY(row, 0);
  const t4 = sY(row, 4);

  // ── Líneas auxiliares ────────────────────────────────────
  ctx.strokeStyle = col;
  ctx.lineWidth   = 0.7;
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

  // ── Cabeza de nota y plica ───────────────────────────────
  ctx.strokeStyle = col;
  ctx.fillStyle   = col;

  if (n.dur === 'TT') {
    ctx.beginPath(); ctx.ellipse(x, y, 6, 4, 0, 0, Math.PI * 2);
    ctx.lineWidth = 1.4; ctx.stroke();

  } else if (n.dur === 'DT') {
    ctx.beginPath(); ctx.ellipse(x, y, 6, 4, -0.2, 0, Math.PI * 2);
    ctx.lineWidth = 1.4; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 6, y); ctx.lineTo(x + 6, y - 25);
    ctx.lineWidth = 1.4; ctx.stroke();

  } else if (n.dur === 'T') {
    ctx.beginPath(); ctx.ellipse(x, y, 6, 4, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + 6, y); ctx.lineTo(x + 6, y - 25);
    ctx.lineWidth = 1.4; ctx.stroke();

  } else if (n.dur === 'MT') {
    ctx.beginPath(); ctx.ellipse(x, y, 6, 4, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + 6, y); ctx.lineTo(x + 7, y - 25);
    ctx.lineWidth = 1.4; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 6, y - 25);
    ctx.quadraticCurveTo(x + 17, y - 19, x + 9, y - 13); ctx.stroke();

  } else if (n.dur === 'CT') {
    ctx.beginPath(); ctx.ellipse(x, y, 6, 4, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + 6, y); ctx.lineTo(x + 7, y - 25);
    ctx.lineWidth = 1.4; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 6, y - 25);
    ctx.quadraticCurveTo(x + 17, y - 19, x + 9, y - 13); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 6, y - 19);
    ctx.quadraticCurveTo(x + 17, y - 13, x + 9, y - 7); ctx.stroke();
  }

  // ── Símbolo accidental ───────────────────────────────────
  if (n.accidental === 'sharp' || n.accidental === 'flat') {
    ctx.fillStyle    = col;
    ctx.font         = '11px serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(n.accidental === 'sharp' ? '♯' : '♭', x - 13, y);
  }

  // ── Etiqueta de nota debajo del pentagrama ───────────────
  ctx.font         = '600 11px sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle    = sel ? '#E85D4A' : '#4A90D9';
  const label = NOTE_DISPLAY[n.note] +
    (n.accidental === 'sharp' ? '#' : n.accidental === 'flat' ? 'b' : '');
  ctx.fillText(label, x, sY(row, 4) + 35);
}

// ── Detecta si un clic coincide con una nota existente ────────
function noteAt(cx, cy) {
  const npr = Math.floor((canvas.width - ML - MR) / NW);
  const s0  = state.currentPage * RPP * npr;

  for (let i = s0; i < state.notes.length; i++) {
    const li  = i - s0;
    const row = Math.floor(li / npr);
    if (row >= RPP) break;

    const x = ML + (li % npr) * NW + NW / 2;
    const n = state.notes[i];
    const y = n.rest ? sY(row, 2) : noteToY(n.note, row);

    if (Math.abs(cx - x) < NW / 2 && Math.abs(cy - y) < 13) return i;
  }
  return -1;
}

// ── Ciclo de renderizado completo ─────────────────────────────
function render() {
  calcCanvas();
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const npr       = Math.floor((canvas.width - ML - MR) / NW);
  const s0        = state.currentPage * RPP * npr;
  const totalRows = Math.max(1, Math.ceil(state.notes.length / npr) + 1);
  const pg        = Math.max(1, Math.ceil(totalRows / RPP));

  if (pg !== state.pages) {
    state.pages = pg;
    if (state.currentPage >= pg) state.currentPage = pg - 1;
  }

  // Pentagramas vacíos
  for (let r = 0; r < RPP; r++) drawStaff(r);

  // Notas de la página actual
  for (let i = s0; i < Math.min(s0 + RPP * npr, state.notes.length); i++) {
    const li  = i - s0;
    const row = Math.floor(li / npr);
    if (row < RPP) drawNote(state.notes[i], ML + (li % npr) * NW + NW / 2, row, i === state.selectedNote);
  }

  document.getElementById('page-ind').textContent =
    `Pág ${state.currentPage + 1}/${state.pages}`;

  updateStatus();
  updateCodePanel();
}
