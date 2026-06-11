/* ============================================================
   audio.js — Reproducción con Web Audio API
   Oscilador cuadrado (timbre buzzer) + rampas anti-click,
   playhead animado con seguimiento de página y preview de notas.
   ============================================================ */

import { state } from './state.js';
import {
  noteFreq, noteDurationBeats, expandedNoteIndices, computeTieChains,
} from './music.js';
import { RPP } from './constants.js';
import {
  render, setActiveNote, setPlayhead, buildLayout,
} from './renderer.js';

let audioCtx      = null;  // contexto persistente (se reutiliza)
let masterGain    = null;  // volumen durante la reproducción actual
let currentOsc    = null;
let currentVolume = 0.07;
let _playing      = false;
let _rafId        = 0;

const RAMP = 0.004; // rampa anti-click (4 ms)

export function isPlaying() { return _playing; }

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

    osc.type            = 'square';
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

  osc.type              = 'square';
  gain.gain.value       = 0;
  masterGain.gain.value = currentVolume;

  // ── Programar todas las notas + construir agenda visual ────
  // El orden expande las repeticiones (el playhead salta atrás).
  // Las ligaduras suman duraciones y el legato omite el corte.
  const order    = expandedNoteIndices();
  const startPos = fromIdx > 0 ? Math.max(0, order.indexOf(fromIdx)) : 0;
  const { chains, consumed, legato } = computeTieChains();

  const t0       = ctx.currentTime + 0.06;
  const schedule = [];
  let t = t0;
  let prevLegato = false;

  order.slice(startPos).forEach(idx => {
    if (consumed.has(idx)) return; // absorbida por una ligadura
    const n = state.notes[idx];

    const members = chains.get(idx) || [idx];
    const dur = members.reduce((s, k) => s + noteDurationBeats(state.notes[k]), 0) * beatSec;
    const legatoOut = legato.has(members[members.length - 1]);

    if (n.rest) {
      gain.gain.setValueAtTime(0, t);
      prevLegato = false;
    } else {
      const freq  = noteFreq(n.note, n.accidental, state.z2);
      const durOn = legatoOut ? dur : Math.max(dur * 0.95, 0.03);

      osc.frequency.setValueAtTime(freq, t);
      if (prevLegato) {
        gain.gain.setValueAtTime(1, t);          // sin re-ataque
      } else {
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(1, t + RAMP);
      }
      if (!legatoOut) {
        gain.gain.setValueAtTime(1, Math.max(t + RAMP, t + durOn - RAMP));
        gain.gain.linearRampToValueAtTime(0, t + durOn);
      }
      prevLegato = legatoOut;
    }

    schedule.push({ idx, start: t, end: t + dur });
    t += dur;
  });

  osc.start(t0);
  osc.stop(t + 0.05);

  // ── Playhead animado + seguimiento de página ───────────────
  const { items } = buildLayout(); // snapshot (las notas no cambian al reproducir)
  const byIdx = new Map(items.map(it => [it.noteIdx, it]));
  let cursor = 0;

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
  finishPlayback();
}
