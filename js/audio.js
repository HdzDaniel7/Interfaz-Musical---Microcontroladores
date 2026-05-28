/* ============================================================
   audio.js — Reproducción con Web Audio API
   ============================================================ */

let isPlaying     = false;
let playAudioCtx  = null;
let activeNoteIdx = -1;
const _noteTimers = [];   // guardamos los setTimeout para cancelarlos con stop

function playScore() {
  if (isPlaying || !state.notes.length) return;

  const bpm     = parseFloat(document.getElementById('bpm').value) || 120;
  const beatSec = 60 / bpm;
  const msToSec = beatSec / 400;

  isPlaying     = true;
  activeNoteIdx = -1;
  _noteTimers.length = 0;

  playAudioCtx = new (window.AudioContext || window.webkitAudioContext)();

  const osc  = playAudioCtx.createOscillator();
  const gain = playAudioCtx.createGain();

  osc.connect(gain);
  gain.connect(playAudioCtx.destination);
  osc.type        = 'square';
  gain.gain.value = 0.07;
  osc.start();

  const startTime = playAudioCtx.currentTime;
  let t           = startTime;  // t = tiempo absoluto en el AudioContext

  state.notes.forEach((n, idx) => {
    const baseDur = DUR_MS[n.dur] * msToSec;
    const dur     = n.dotted ? baseDur * 1.5 : baseDur;

    // msFromNow = tiempo en ms desde AHORA hasta que empieza esta nota
    // t ya tiene el offset correcto acumulado antes de sumar dur
    const msFromNow = (t - startTime) * 1000;

    // Programar resaltado visual en el momento exacto de la nota
    const timer = setTimeout(() => {
      if (!isPlaying) return;
      activeNoteIdx = idx;
      render();
    }, msFromNow);
    _noteTimers.push(timer);

    if (n.rest) {
      gain.gain.setValueAtTime(0, t);
    } else {
      let baseName, octaveOff;
      if (n.note.endsWith('M'))      { baseName = n.note.slice(0, -1); octaveOff =  1; }
      else if (n.note.endsWith('m')) { baseName = n.note.slice(0, -1); octaveOff = -1; }
      else                           { baseName = n.note;              octaveOff =  0; }

      const enumName = codeNoteName(baseName, n.accidental);
      const freq     = noteFreq(enumName, state.z2, octaveOff);

      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.07, t);
      // Apagar 5% antes del fin para articular la nota
      gain.gain.setValueAtTime(0, t + dur * 0.95);
    }

    t += dur;
  });

  // Programar limpieza al terminar
  const totalMs = (t - startTime) * 1000;
  const endTimer = setTimeout(() => {
    isPlaying     = false;
    activeNoteIdx = -1;
    render();
  }, totalMs + 100);
  _noteTimers.push(endTimer);

  osc.stop(t + 0.05);
  osc.onended = () => {
    isPlaying     = false;
    activeNoteIdx = -1;
    render();
  };
}

function stopScore() {
  // Cancelar todos los setTimeout pendientes
  _noteTimers.forEach(id => clearTimeout(id));
  _noteTimers.length = 0;

  if (playAudioCtx) {
    try { playAudioCtx.close(); } catch (e) {}
    playAudioCtx = null;
  }

  isPlaying     = false;
  activeNoteIdx = -1;
  render();
}