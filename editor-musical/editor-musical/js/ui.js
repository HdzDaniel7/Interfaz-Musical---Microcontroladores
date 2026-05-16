/* ============================================================
   ui.js — Controladores de interfaz de usuario
   ============================================================
   Maneja todos los eventos del DOM: toolbar, canvas, teclado,
   panel lateral, guardado y carga de archivos.
   ============================================================ */

// ── Panel de código ───────────────────────────────────────────
function updateCodePanel() {
  document.getElementById('code-output').textContent =
    generateInoCode(state.notes, state.z2, state.title);
}

// ── Barra de estado inferior ──────────────────────────────────
function updateStatus() {
  const count = state.notes.length;
  document.getElementById('status-count').textContent =
    `${count} nota${count !== 1 ? 's' : ''}`;

  const beats = state.notes.reduce((a, n) => a + (DUR_BEATS[n.dur] || 1), 0);
  document.getElementById('status-dur').textContent =
    `${(beats / 4).toFixed(1)} compases`;

  if (state.selectedNote >= 0 && state.notes[state.selectedNote]) {
    const sn = state.notes[state.selectedNote];
    const acc = sn.accidental === 'sharp' ? '♯'
      : sn.accidental === 'flat' ? '♭' : '';
    document.getElementById('status-note').textContent =
      sn.rest
        ? `Silencio ${sn.dur}`
        : `${NOTE_DISPLAY[sn.note]}${acc} · ${sn.dur}`;
  } else {
    document.getElementById('status-note').textContent = 'Sin selección';
  }
}

// ── Canvas: clic para insertar / seleccionar nota ─────────────
canvas.addEventListener('mousedown', e => {
  const rect = canvas.getBoundingClientRect();
  const cx = e.clientX - rect.left;
  const cy = e.clientY - rect.top;

  // ¿Se hizo clic sobre una nota existente?
  const hit = noteAt(cx, cy);
  if (hit >= 0) {
    state.selectedNote = hit;
    _dragging = true;
    _dragIdx = hit;
    render();
    return;
  }

  // Insertar nota nueva
  state.selectedNote = -1;
  const row = getRow(cy);
  if (row < 0) { render(); return; }

  pushHistory();
  const naturalNote = yToNote(cy, row);
  const t = state.activeTool;
  const nn = {
    note: naturalNote,
    dur: t.dur,
    rest: t.rest,
    accidental: t.rest ? 'none' : state.activeAccidental,
    octaveOffset: 0,
  };

  const npr = Math.floor((canvas.width - ML - MR) / NW);
  const s0 = state.currentPage * RPP * npr;
  const col = Math.floor((cx - ML) / NW);
  const idx = s0 + row * npr + col;

  state.notes.splice(Math.max(0, Math.min(idx, state.notes.length)), 0, nn);
  state.selectedNote = Math.max(0, Math.min(idx, state.notes.length - 1));
  render();
});

// ── Canvas: arrastre para mover nota ─────────────────────────
let _dragging = false;
let _dragIdx = -1;

canvas.addEventListener('mousemove', e => {
  if (!_dragging || _dragIdx < -3) return;
  const rect = canvas.getBoundingClientRect();
  const cy = e.clientY - rect.top;
  const row = getRow(cy);
  if (row >= -3) {
    state.notes[_dragIdx].note = yToNote(cy, row);
    render();
  }
});

canvas.addEventListener('mouseup', () => { _dragging = false; _dragIdx = -1; });
canvas.addEventListener('mouseleave', () => { _dragging = false; });

// ── Toolbar: notas ────────────────────────────────────────────
document.querySelectorAll('.tool-btn:not([data-rest])').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.activeTool = { dur: btn.dataset.dur, rest: false };
  });
});

// ── Toolbar: silencios ────────────────────────────────────────
document.querySelectorAll('.tool-btn[data-rest]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.activeTool = { dur: btn.dataset.dur, rest: true };
  });
});

// ── Toolbar: accidentales ─────────────────────────────────────
['acc-none', 'acc-sharp', 'acc-flat'].forEach(id => {
  document.getElementById(id).addEventListener('click', () => {
    document.querySelectorAll('.acc-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    state.activeAccidental = id.replace('acc-', '');
  });
});
document.getElementById('acc-none').classList.add('active');

// ── Toolbar: escala z2 ────────────────────────────────────────
document.getElementById('z2-val').addEventListener('change', e => {
  state.z2 = parseInt(e.target.value) || 5;
  document.getElementById('z2-prop').value = state.z2;
  updateCodePanel();
});
document.getElementById('z2-prop').addEventListener('change', e => {
  state.z2 = parseInt(e.target.value) || 5;
  document.getElementById('z2-val').value = state.z2;
  updateCodePanel();
});

// ── Propiedades ───────────────────────────────────────────────
document.getElementById('title-prop').addEventListener('input', e => {
  state.title = e.target.value;
  updateCodePanel();
});
document.getElementById('bpm-prop').addEventListener('change', e => {
  state.bpm = parseInt(e.target.value) || 120;
});

// ── Acciones: deshacer / rehacer / borrar ─────────────────────
document.getElementById('btn-undo').addEventListener('click', () => { if (undo()) render(); });
document.getElementById('btn-redo').addEventListener('click', () => { if (redo()) render(); });
document.getElementById('btn-delete').addEventListener('click', () => { if (deleteSelected()) render(); });

// ── Atajos de teclado ─────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.key === 'z') { e.preventDefault(); if (undo()) render(); }
  if (e.ctrlKey && e.key === 'y') { e.preventDefault(); if (redo()) render(); }
  if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedNote >= 0) {
    e.preventDefault();
    if (deleteSelected()) render();
  }
});

// ── Paginación ────────────────────────────────────────────────
document.getElementById('btn-prev-page').addEventListener('click', () => {
  if (state.currentPage > 0) { state.currentPage--; render(); }
});
document.getElementById('btn-next-page').addEventListener('click', () => {
  if (state.currentPage < state.pages - 1) { state.currentPage++; render(); }
});

// ── Panel lateral: tabs ───────────────────────────────────────
document.querySelectorAll('.side-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.side-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
  });
});

// ── Limpiar partitura ─────────────────────────────────────────
document.getElementById('btn-clear').addEventListener('click', () => {
  if (clearAll()) render();
});

// ── Audio: reproducir / detener ───────────────────────────────
document.getElementById('btn-play').addEventListener('click', playScore);
document.getElementById('btn-stop').addEventListener('click', stopScore);

// ── Guardar proyecto (JSON) ───────────────────────────────────
document.getElementById('btn-save').addEventListener('click', () => {
  const blob = new Blob([exportProject()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (state.title || 'proyecto').replace(/\s+/g, '_') + '.json';
  a.click();
});

// ── Cargar proyecto (JSON) ────────────────────────────────────
document.getElementById('btn-load').addEventListener('click', () => {
  document.getElementById('file-input').click();
});

document.getElementById('file-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      importProject(ev.target.result);
      // Sincronizar inputs con el estado cargado
      document.getElementById('z2-val').value = state.z2;
      document.getElementById('z2-prop').value = state.z2;
      document.getElementById('title-prop').value = state.title;
      document.getElementById('bpm-prop').value = state.bpm;
      render();
    } catch {
      alert('Error al cargar el archivo. Verifica que sea un proyecto válido.');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

// ── Exportar .ino ─────────────────────────────────────────────
document.getElementById('btn-export').addEventListener('click', () => {
  const code = document.getElementById('code-output').textContent;
  const blob = new Blob([code], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (state.title || 'cancion').replace(/\s+/g, '_') + '.ino';
  a.click();
});

// ── Redimensión de ventana ────────────────────────────────────
window.addEventListener('resize', render);
