/* ============================================================
   audio.js — Reproducción con Web Audio API
   ============================================================
   Simula el buzzer PWM del ESP32 usando un oscilador cuadrado.
   ============================================================ */

let isPlaying    = false;
let playAudioCtx = null;

// ── Inicia reproducción de toda la partitura ──────────────────
function playScore() {
  if (isPlaying || !state.notes.length) return;

  isPlaying    = true;
  playAudioCtx = new (window.AudioContext || window.webkitAudioContext)();

  const osc  = playAudioCtx.createOscillator();
  const gain = playAudioCtx.createGain();

  osc.connect(gain);
  gain.connect(playAudioCtx.destination);
  osc.type         = 'square';
  gain.gain.value  = 0.07;
  osc.start();

  let t = playAudioCtx.currentTime;

  state.notes.forEach(n => {
    // DUR_MS / 500 para que suene al doble de velocidad que real-time
    // (ajusta a /1000 si quieres duración real)
    const dur = DUR_MS[n.dur] / 500;

    if (n.rest) {
      gain.gain.setValueAtTime(0, t);
    } else {
      // Determinar el nombre del enum y el offset de octava
      let baseName, octaveOff;
      if (n.note.endsWith('M')) {
        baseName  = n.note.slice(0, -1);
        octaveOff = 1;
      } else if (n.note.endsWith('m')) {
        baseName  = n.note.slice(0, -1);
        octaveOff = -1;
      } else {
        baseName  = n.note;
        octaveOff = 0;
      }

      const enumName = codeNoteName(baseName, n.accidental);
      const freq     = noteFreq(enumName, state.z2, octaveOff);

      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.07, t);
      gain.gain.setValueAtTime(0, t + dur * 0.88);  // pequeño silencio entre notas
    }

    t += dur;
  });

  osc.stop(t + 0.01);
  osc.onended = () => { isPlaying = false; };
}

// ── Detiene la reproducción inmediatamente ────────────────────
function stopScore() {
  if (playAudioCtx) {
    try { playAudioCtx.close(); } catch (e) { /* ignorar */ }
    playAudioCtx = null;
  }
  isPlaying = false;
}
