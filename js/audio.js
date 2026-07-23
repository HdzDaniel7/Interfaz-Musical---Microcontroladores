/* ============================================================
   audio.js — Reproducción con Web Audio API
   Oscilador cuadrado (timbre buzzer) + rampas anti-click,
   playhead animado con seguimiento de página y preview de notas.
   ============================================================ */

import { state } from './state.js';
import { noteFreq, buildSchedule, beatsPerMeasure } from './music.js';
import { RPP } from './constants.js';
import {
  render, setActiveNote, setPlayhead, buildLayout,
} from './renderer.js';

const statusNoteEl = document.getElementById('status-note');

let audioCtx      = null;  // contexto persistente (se reutiliza)
let masterGain    = null;  // volumen durante la reproducción actual
let currentOsc    = null;
let currentVolume = 0.07;
let _playing      = false;
let _rafId        = 0;
let _metronomeOn  = false;
let _clickOscs    = []; // osciladores del metrónomo de la reproducción actual
let _timbre       = 'square'; // solo monitoreo en PC — el hardware siempre es onda cuadrada

const RAMP = 0.004; // rampa anti-click (4 ms)

export function isPlaying() { return _playing; }

// ── Timbre (solo monitoreo en PC; el hardware siempre suena cuadrado) ──
export function setTimbre(t) { _timbre = t; }
export function getTimbre() { return _timbre; }

// ── Metrónomo ──────────────────────────────────────────────────
export function setMetronomeEnabled(v) { _metronomeOn = !!v; }
export function isMetronomeEnabled() { return _metronomeOn; }

// Click corto (~30 ms): 1000 Hz normal, 1500 Hz de acento en el beat 1.
function scheduleClick(ctx, time, accent) {
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type            = 'sine';
  osc.frequency.value = accent ? 1500 : 1000;
  gain.gain.value      = 0;

  osc.connect(gain);
  gain.connect(ctx.destination);

  const durMs = 30;
  const end   = time + durMs / 1000;
  const peak  = currentVolume * (accent ? 1.4 : 1);
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(peak, time + RAMP);
  gain.gain.setValueAtTime(peak, end - 0.006);
  gain.gain.linearRampToValueAtTime(0, end);

  osc.start(time);
  osc.stop(end + 0.01);
  osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  _clickOscs.push(osc);
}

function stopClicks() {
  for (const osc of _clickOscs) {
    try { osc.onended = null; osc.stop(); osc.disconnect(); } catch (e) { /* ya detenido */ }
  }
  _clickOscs = [];
}

function ensureCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// ── Volumen ───────────────────────────────────────────────────
export function setVolume(v) {
  currentVolume = v;
  if (masterGain && audioCtx) {
    masterGain.gain.setTargetAtTime(v, audioCtx.currentTime, 0.02);
  }
}

export function getVolume() { return currentVolume; }

// ── Preview corto de una nota (al insertar o arrastrar) ───────
export function previewNote(noteName, accidental, durMs = 150) {
  try {
    const ctx  = ensureCtx();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type            = _timbre;
    osc.frequency.value = noteFreq(noteName, accidental, state.z2);
    gain.gain.value     = 0;

    osc.connect(gain);
    gain.connect(ctx.destination);

    const t   = ctx.currentTime;
    const end = t + durMs / 1000;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(currentVolume, t + RAMP);
    gain.gain.setValueAtTime(currentVolume, end - 0.02);
    gain.gain.linearRampToValueAtTime(0, end);

    osc.start(t);
    osc.stop(end + 0.01);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  } catch (e) { /* audio no disponible — ignorar */ }
}

// ── Reproducción de la partitura (opcionalmente desde un índice) ──
export function playScore(fromIdx = 0) {
  if (_playing || !state.notes.length) return;
  if (fromIdx < 0 || fromIdx >= state.notes.length) fromIdx = 0;

  const ctx     = ensureCtx();
  const beatSec = 60 / (state.bpm || 120);

  _playing = true;

  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();      // articulación (envolvente por nota)
  masterGain = ctx.createGain();      // volumen del usuario
  currentOsc = osc;

  osc.connect(gain);
  gain.connect(masterGain);
  masterGain.connect(ctx.destination);

  osc.type              = _timbre;
  gain.gain.value       = 0;
  masterGain.gain.value = currentVolume;

  // ── Programar todas las notas + construir agenda visual ────
  // buildSchedule() ya expande repeticiones y resuelve ligaduras;
  // aquí solo se traduce cada evento a la envolvente del oscilador.
  const events   = buildSchedule(fromIdx);
  const t0       = ctx.currentTime + 0.06;
  const schedule = [];
  let t = t0;
  let prevLegato = false;

  events.forEach(ev => {
    const dur = ev.durBeats * beatSec;

    if (ev.rest) {
      gain.gain.setValueAtTime(0, t);
      prevLegato = false;
    } else {
      const durOn = ev.legato ? dur : Math.max(dur * 0.95, 0.03);

      osc.frequency.setValueAtTime(ev.freq, t);
      if (prevLegato) {
        gain.gain.setValueAtTime(1, t);          // sin re-ataque
      } else {
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(1, t + RAMP);
      }
      if (!ev.legato) {
        gain.gain.setValueAtTime(1, Math.max(t + RAMP, t + durOn - RAMP));
        gain.gain.linearRampToValueAtTime(0, t + durOn);
      }
      prevLegato = ev.legato;
    }

    schedule.push({ idx: ev.idx, start: t, end: t + dur });
    t += dur;
  });

  osc.start(t0);
  osc.stop(t + 0.05);

  // ── Playhead animado + seguimiento de página ───────────────
  const { items } = buildLayout(); // snapshot (las notas no cambian al reproducir)
  const byIdx = new Map(items.map(it => [it.noteIdx, it]));
  const beatDen = Math.round(beatsPerMeasure()); // capacidad del compás (snapshot)
  let cursor = 0;

  // ── Metrónomo: un click por beat, acento en el beat 1 de cada compás ──
  _clickOscs = [];
  if (_metronomeOn) {
    let beatIdx = 0;
    for (let tc = t0; tc < t - 0.001; tc += beatSec) {
      scheduleClick(ctx, tc, beatIdx % beatDen === 0);
      beatIdx++;
    }
  }

  const tick = () => {
    if (!_playing) return;
    const now = ctx.currentTime;

    if (now >= t) { finishPlayback(); return; }

    while (cursor < schedule.length - 1 && now >= schedule[cursor].end) cursor++;
    const ev = schedule[cursor];

    if (ev && now >= ev.start) {
      const item = byIdx.get(ev.idx);
      if (item) {
        setActiveNote(ev.idx);

        // Seguir la página de la nota activa
        const page = Math.floor(item.row / RPP);
        if (page !== state.currentPage && page < state.pages) {
          state.currentPage = page;
        }

        const frac = Math.min(1, (now - ev.start) / (ev.end - ev.start));
        setPlayhead({ x: item.x - item.w / 2 + frac * item.w, row: item.row });

        // Compás/beat en la statusbar: escritura directa y barata (sin
        // analyzeMeasures()) — updateStatus() (ui.js) se abstiene de
        // tocar #status-note mientras se reproduce, para no pisarlo.
        const beatNum = Math.floor(item.beatStart) + 1;
        statusNoteEl.textContent = `Compás ${item.measureIdx + 1} · beat ${beatNum}/${beatDen}`;
      }
      render();
    }

    _rafId = requestAnimationFrame(tick);
  };

  osc.onended = () => { if (_playing) finishPlayback(); };
  _rafId = requestAnimationFrame(tick);
}

function finishPlayback() {
  cancelAnimationFrame(_rafId);
  _playing   = false;
  currentOsc = null;
  masterGain = null;
  _clickOscs = [];
  setActiveNote(-1);
  setPlayhead(null);
  render();
}

export function stopScore() {
  if (!_playing) {
    setActiveNote(-1);
    setPlayhead(null);
    render();
    return;
  }
  try {
    if (currentOsc) {
      currentOsc.onended = null;
      currentOsc.stop();
      currentOsc.disconnect();
    }
    if (masterGain) masterGain.disconnect();
  } catch (e) { /* ya detenido */ }
  stopClicks();
  finishPlayback();
}
