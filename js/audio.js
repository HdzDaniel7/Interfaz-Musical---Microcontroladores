/* ============================================================
   audio.js — Reproducción con Web Audio API
   ============================================================ */

let isPlaying     = false;
let playAudioCtx  = null;
let activeNoteIdx = -1;
let activeGain    = null;
let currentVolume = 0.07;
const _noteTimers = [];

function getVolume() {
  return currentVolume;
}

function playScore() {
  if (isPlaying || !state.notes.length) return;

  const bpm     = parseFloat(document.getElementById('bpm').value) || 120;
  const beatSec = 60 / bpm;
  const msToSec = beatSec / 400;

  isPlaying     = true;
  activeNoteIdx = -1;
  _noteTimers.length = 0;

  playAudioCtx = new (window.AudioContext || window.webkitAudioContext)();

  const osc        = playAudioCtx.createOscillator();
  const gain       = playAudioCtx.createGain();   // articulación (0/1)
  const masterGain = playAudioCtx.createGain();   // volumen real
  activeGain       = masterGain;                  // ← apunta al master, no al gain

  osc.connect(gain);
  gain.connect(masterGain);
  masterGain.connect(playAudioCtx.destination);   // ← solo una salida, sin bypass

  osc.type              = 'square';
  gain.gain.value       = 1;
  masterGain.gain.value = getVolume();
  osc.start();

  const startTime = playAudioCtx.currentTime;
  let t           = startTime;

  state.notes.forEach((n, idx) => {
    const baseDur = DUR_MS[n.dur] * msToSec;
    const dur     = n.dotted ? baseDur * 1.5 : baseDur;

    const msFromNow = (t - startTime) * 1000;

    const timer = setTimeout(() => {
      if (!isPlaying) return;
      activeNoteIdx = idx;
      render();
    }, msFromNow);
    _noteTimers.push(timer);

    if (n.rest) {
      gain.gain.setValueAtTime(0, t);
      gain.gain.setValueAtTime(1, t + dur);
    } else {
      let baseName, octaveOff;
      if (n.note.endsWith('M'))      { baseName = n.note.slice(0, -1); octaveOff =  1; }
      else if (n.note.endsWith('m')) { baseName = n.note.slice(0, -1); octaveOff = -1; }
      else                           { baseName = n.note;              octaveOff =  0; }

      const enumName = codeNoteName(baseName, n.accidental);
      const freq     = noteFreq(enumName, state.z2, octaveOff);

      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(1, t);
      gain.gain.setValueAtTime(0, t + dur * 0.95);
      gain.gain.setValueAtTime(1, t + dur);
    }

    t += dur;
  });

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
  _noteTimers.forEach(id => clearTimeout(id));
  _noteTimers.length = 0;

  if (playAudioCtx) {
    try { playAudioCtx.close(); } catch (e) {}
    playAudioCtx = null;
  }

  isPlaying     = false;
  activeNoteIdx = -1;
  activeGain    = null;
  render();
}

document.addEventListener('DOMContentLoaded', () => {
  const slider = document.getElementById('volume-slider');
  const label  = document.getElementById('volume-label');
  if (!slider || !label) return;

  slider.addEventListener('input', () => {
    currentVolume = parseFloat(slider.value) / 1000;
    label.textContent = slider.value + '%';
    if (activeGain && playAudioCtx) {
      activeGain.gain.setValueAtTime(currentVolume, playAudioCtx.currentTime);
    }
  });
});