/* ============================================================
   ui.js — Controladores de interfaz de usuario
   ============================================================ */

// ── Panel de código ───────────────────────────────────────────
function updateCodePanel() {
  const code = generateInoCode(state.notes, state.z2, state.title);
  document.getElementById('code-output').textContent = code;
  document.getElementById('code-title').textContent =
    (state.title || 'sin_titulo').replace(/\s+/g, '_') + '.ino';
}

// ── Barra de estado inferior ──────────────────────────────────
function updateStatus() {
  const count = state.notes.length;
  document.getElementById('status-count').textContent =
    `${count} nota${count !== 1 ? 's' : ''}`;

  const measures = analyzeMeasures();
  document.getElementById('status-dur').textContent =
    `${measures.length} compás${measures.length !== 1 ? 'es' : ''}`;

  const ts = state.timeSignature;
  document.getElementById('status-timesig').textContent = `Compás: ${ts.num}/${ts.den}`;
  document.getElementById('status-mcu').textContent     = `MCU: ${(state.mcu || 'esp32').toUpperCase()}`;

  if (state.selectedNote >= 0 && state.notes[state.selectedNote]) {
    const sn  = state.notes[state.selectedNote];
    const acc = sn.accidental === 'sharp' ? '♯' : sn.accidental === 'flat' ? '♭' : '';
    const dot = sn.dotted ? '.' : '';
    document.getElementById('status-note').textContent =
      sn.rest
        ? `Silencio ${sn.dur}${dot}`
        : `${NOTE_DISPLAY[sn.note]}${acc}${dot} · ${sn.dur}`;
  } else {
    document.getElementById('status-note').textContent = 'Sin selección';
  }

  document.getElementById('prop-notes').textContent    = count;
  document.getElementById('prop-measures').textContent = measures.length;
  document.getElementById('prop-complete').textContent =
    measures.filter(m => !m.overflow && !m.underflow).length;

  // Actualizar estado visual de los botones de duración
  updateToolbarAvailability();
}

// ── Deshabilitar duraciones que no caben en el compás actual ──
function updateToolbarAvailability() {
  const avail = availableDurations();

  document.querySelectorAll('.tool-btn[data-dur]').forEach(btn => {
    const dur    = btn.dataset.dur;
    const rest   = btn.dataset.rest === '1';
    const dotted = state.activeTool.dotted;

    if (rest) {
      // Los silencios también consumen tiempo de compás
      const key = dotted ? dur + '_dot' : dur;
      const ok  = avail[key] !== false;
      btn.disabled = !ok;
      btn.classList.toggle('unavailable', !ok);
    } else {
      const key = dotted ? dur + '_dot' : dur;
      const ok  = avail[key] !== false;
      btn.disabled = !ok;
      btn.classList.toggle('unavailable', !ok);
    }
  });

  // El puntillo también puede hacer que la duración actual no quepa
  const dotBtn = document.getElementById('dot-btn');
  if (dotBtn) {
    const dur     = state.activeTool.dur;
    const withDot = avail[dur + '_dot'] !== false;
    dotBtn.classList.toggle('unavailable', !withDot && !state.activeTool.dotted);
  }
}

// ── Variables de cursor y arrastre ───────────────────────────
let _dragging = false;
let _dragIdx  = -1;

// ── Canvas: mousemove — cursor + arrastre ─────────────────────
canvas.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect();
  const cx   = e.clientX - rect.left;
  const cy   = e.clientY - rect.top;

  // Actualizar cursor siempre
  cursorX   = cx;
  cursorY   = cy;
  cursorRow = getRow(cy);

  // Arrastre de nota
  if (_dragging && _dragIdx >= 0) {
    const row = getRow(cy);
    if (row >= 0) {
      const newNote = yToNote(cy, row);
      if (state.notes[_dragIdx] && state.notes[_dragIdx].note !== newNote) {
        state.notes[_dragIdx] = { ...state.notes[_dragIdx], note: newNote };
        scheduleSave();
      }
    }
  }

  render();
});

// ── Canvas: mouseleave — limpiar cursor ───────────────────────
canvas.addEventListener('mouseleave', () => {
  _dragging = false;
  cursorX   = -1;
  cursorY   = -1;
  cursorRow = -1;
  render();
});

canvas.addEventListener('mouseup', () => { _dragging = false; _dragIdx = -1; });

// ── Canvas: mousedown — seleccionar o insertar nota ───────────
canvas.addEventListener('mousedown', e => {
  const rect = canvas.getBoundingClientRect();
  const cx   = e.clientX - rect.left;
  const cy   = e.clientY - rect.top;

  // Clic sobre nota existente → seleccionar e iniciar arrastre
  const hit = noteAt(cx, cy);
  if (hit >= 0) {
    state.selectedNote = hit;
    _dragging = true;
    _dragIdx  = hit;
    render();
    return;
  }

  state.selectedNote = -1;
  const row = getRow(cy);
  if (row < 0) { render(); return; }

  const t      = state.activeTool;
  const dur    = t.dur;
  const dotted = t.dotted || false;

  if (!fitsInCurrentMeasure(dur, dotted)) {
    render();
    return;
  }

  pushHistory();
  const naturalNote = yToNote(cy, row);
  const nn = {
    note:        naturalNote,
    dur,
    dotted,
    rest:        t.rest,
    accidental:  t.rest ? 'none' : state.activeAccidental,
    octaveOffset: 0,
  };

  state.notes.push(nn);
  state.selectedNote = state.notes.length - 1;
  render();
  scheduleSave();
});

canvas.addEventListener('mouseup',    () => { _dragging = false; _dragIdx = -1; });
canvas.addEventListener('mouseleave', () => { _dragging = false; });

// ── Toolbar: botones de nota/silencio ─────────────────────────
document.querySelectorAll('.tool-btn[data-dur]').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    const dur  = btn.dataset.dur;
    const rest = btn.dataset.rest === '1';
    state.activeTool = { ...state.activeTool, dur, rest };
    document.querySelectorAll('.tool-btn[data-dur]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    updateToolbarAvailability();
  });
});

// ── Puntillo ─────────────────────────────────────────────────
document.getElementById('dot-btn').addEventListener('click', () => {
  state.activeTool.dotted = !state.activeTool.dotted;
  document.getElementById('dot-btn').classList.toggle('active', state.activeTool.dotted);
  updateToolbarAvailability();
});

// ── Accidentales ─────────────────────────────────────────────
document.querySelectorAll('.acc-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    state.activeAccidental = btn.dataset.acc;
    document.querySelectorAll('.acc-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// ── Título ───────────────────────────────────────────────────
document.getElementById('title-input').addEventListener('input', e => {
  state.title = e.target.value;
  updateCodePanel();
  scheduleSave(); 
});

// ── z2 ───────────────────────────────────────────────────────
document.getElementById('z2-val').addEventListener('change', e => {
  state.z2 = parseInt(e.target.value) || 5;
  updateCodePanel();
  scheduleSave(); 
});

// ── Compás ────────────────────────────────────────────────────
document.getElementById('time-sig-sel').addEventListener('change', e => {
  const parts = e.target.value.split('/').map(Number);
  state.timeSignature = { num: parts[0], den: parts[1] };
  render();
  scheduleSave(); 
});

// ── MCU ───────────────────────────────────────────────────────
document.getElementById('mcu-sel').addEventListener('change', e => {
  state.mcu = e.target.value;
  const mcuKey = e.target.value === 'atmega328p' ? 'atmega' : e.target.value;
  ['esp32', 'arduino', 'atmega'].forEach(k => {
    const el = document.getElementById(`mcu-${k}-block`);
    if (el) el.style.display = k === mcuKey ? 'flex' : 'none';
  });
  render();
});

['esp32', 'arduino', 'atmega'].forEach(k => {
  const el = document.getElementById(`mcu-${k}-code`);
  if (el) el.addEventListener('input', () => updateCodePanel());
});

// ── Acciones ─────────────────────────────────────────────────
document.getElementById('btn-undo').addEventListener('click', () => { if (undo()) render(); scheduleSave(); });
document.getElementById('btn-redo').addEventListener('click', () => { if (redo()) render(); scheduleSave(); });
document.getElementById('btn-delete').addEventListener('click', () => { if (deleteSelected()) render(); scheduleSave(); });

document.getElementById('btn-clear').addEventListener('click', () => {
  if (confirm('¿Limpiar toda la partitura?')) { if (clearAll()) render(); scheduleSave(); }
});

document.getElementById('btn-play').addEventListener('click', playScore);
document.getElementById('btn-stop').addEventListener('click', stopScore);

document.getElementById('btn-save').addEventListener('click', () => {
  const blob = new Blob([exportProject()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (state.title || 'proyecto').replace(/\s+/g, '_') + '.json';
  a.click();
});

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
      document.getElementById('title-input').value = state.title;
      document.getElementById('z2-val').value       = state.z2;
      document.getElementById('bpm').value     = state.bpm;
      const tsSel = document.getElementById('time-sig-sel');
      const tsVal = `${state.timeSignature.num}/${state.timeSignature.den}`;
      if ([...tsSel.options].some(o => o.value === tsVal)) tsSel.value = tsVal;
      document.getElementById('mcu-sel').value = state.mcu || 'esp32';
      document.getElementById('mcu-sel').dispatchEvent(new Event('change'));
      render();
      scheduleSave(); 
    } catch { alert('Error al cargar el archivo.'); }
  };
  reader.readAsText(file);
  e.target.value = '';
});

document.getElementById('btn-export').addEventListener('click', () => {
  const code = document.getElementById('code-output').textContent;
  const blob = new Blob([code], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (state.title || 'cancion').replace(/\s+/g, '_') + '.ino';
  a.click();
});

document.getElementById('btn-export-midi').addEventListener('click', exportMidi);

document.getElementById('btn-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(document.getElementById('code-output').textContent);
    const btn = document.getElementById('btn-copy');
    btn.textContent = '✓ Copiado';
    setTimeout(() => btn.textContent = 'Copiar', 1500);
  } catch { alert('No se pudo copiar al portapapeles.'); }
});

document.getElementById('btn-prev-page').addEventListener('click', () => {
  if (state.currentPage > 0) { state.currentPage--; render(); }
});
document.getElementById('btn-next-page').addEventListener('click', () => {
  if (state.currentPage < state.pages - 1) { state.currentPage++; render(); }
});

document.getElementById('btn-theme').addEventListener('click', () => {
  const root   = document.documentElement;
  const isDark = root.getAttribute('data-theme') === 'dark';
  root.setAttribute('data-theme', isDark ? 'light' : 'dark');
  render();
});

document.querySelectorAll('.tab[data-tab]').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab[data-tab]').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-code').style.display  = tab.dataset.tab === 'code'  ? 'flex' : 'none';
    document.getElementById('tab-props').style.display = tab.dataset.tab === 'props' ? 'flex' : 'none';
  });
});

document.getElementById('bpm').addEventListener('change', e => {
  state.bpm = parseInt(e.target.value) || 120;
});

document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.key === 'z') { e.preventDefault(); if (undo()) render(); }
  if (e.ctrlKey && e.key === 'y') { e.preventDefault(); if (redo()) render(); }
  if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedNote >= 0) {
    e.preventDefault();
    if (deleteSelected()) render();
  }
});

window.addEventListener('resize', render);
