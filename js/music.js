/* ============================================================
   music.js — Lógica musical pura
   Resolución de alturas (nota + accidental → semitono absoluto),
   frecuencias y análisis de compases.
   ============================================================ */

import {
  PITCH_CLASS, ENUM_NAMES, DUR_BEATS, DO0_FREQ,
} from './constants.js';
import { state } from './state.js';

// ── Parseo del nombre de nota ─────────────────────────────────
// 'SOLm' → { base:'SOL', octave:-1 }   'REMM' → { base:'RE', octave:+2 }
export function parseNoteName(name) {
  if (name.endsWith('MM')) return { base: name.slice(0, -2), octave: 2 };
  if (name.endsWith('M'))  return { base: name.slice(0, -1), octave: 1 };
  if (name.endsWith('m'))  return { base: name.slice(0, -1), octave: -1 };
  return { base: name, octave: 0 };
}

// ── Resolución de altura ──────────────────────────────────────
// Convierte nota + accidental a { enumName, pc, octave } trabajando
// en semitonos absolutos. Así los enarmónicos salen siempre bien:
//   FA♯  → FAs        MI♯ → FA         SI♯ → DO (octava +1)
//   DO♭  → SI (octava -1)              SOL♭ → FAs
export function resolvePitch(noteName, accidental) {
  const { base, octave } = parseNoteName(noteName);
  const acc   = accidental === 'sharp' ? 1 : accidental === 'flat' ? -1 : 0;
  const total = (PITCH_CLASS[base] ?? 0) + acc + octave * 12;
  const pc    = ((total % 12) + 12) % 12;
  const oct   = Math.floor(total / 12);
  return { enumName: ENUM_NAMES[pc], pc, octave: oct };
}

// ── Frecuencia para Web Audio API ─────────────────────────────
// Equivalente a getFreq() del firmware: DO0 = 16.3516 Hz.
export function noteFreq(noteName, accidental, z2) {
  const { pc, octave } = resolvePitch(noteName, accidental);
  return DO0_FREQ * Math.pow(2, ((z2 + octave) * 12 + pc) / 12);
}

// ══════════════════════════════════════════════════════════════
// LÓGICA DE COMPÁS
// ══════════════════════════════════════════════════════════════

// Devuelve cuántos beats de negra caben en un compás.
//   4/4 → 4   3/4 → 3   2/4 → 2   6/8 → 3 (6 corcheas = 3 negras)
export function beatsPerMeasure() {
  const { num, den } = state.timeSignature;
  return num / (den / 4);
}

// Duración en beats de negra de una nota
export function noteDurationBeats(note) {
  const base = DUR_BEATS[note.dur] || 1;
  return note.dotted ? base * 1.5 : base;
}

// ── Analiza las notas y devuelve grupos por compás ─────────────
export function analyzeMeasures() {
  const capacity = beatsPerMeasure();
  const measures = [];
  let i = 0, startIdx = 0, beats = 0;

  while (i <= state.notes.length) {
    // Fin del array → cerrar compás incompleto
    if (i === state.notes.length) {
      if (i > startIdx || beats > 0) {
        measures.push({
          startIdx, endIdx: i, beats, capacity,
          overflow:  beats > capacity + 0.001,
          underflow: beats < capacity - 0.001,
        });
      }
      break;
    }

    const nb = noteDurationBeats(state.notes[i]);

    // La nota desborda → cerrar compás anterior primero
    if (beats + nb > capacity + 0.001) {
      if (i > startIdx || beats > 0) {
        measures.push({
          startIdx, endIdx: i, beats, capacity,
          overflow:  false,
          underflow: beats < capacity - 0.001,
        });
        startIdx = i;
        beats    = 0;
      }
    }

    beats += nb;

    // Compás exactamente lleno → cerrarlo
    if (Math.abs(beats - capacity) < 0.001) {
      measures.push({
        startIdx, endIdx: i + 1, beats, capacity,
        overflow: false, underflow: false,
      });
      startIdx = i + 1;
      beats    = 0;
    }

    i++;
  }

  return measures;
}

// ── Beats usados en el compás actualmente abierto ─────────────
export function usedBeatsInOpenMeasure() {
  const capacity = beatsPerMeasure();
  let beats = 0;
  for (let i = state.notes.length - 1; i >= 0; i--) {
    beats += noteDurationBeats(state.notes[i]);
    if (Math.abs(beats - capacity) < 0.001) return 0; // límite de compás anterior
    if (beats > capacity + 0.001) return beats - capacity; // datos externos inválidos
  }
  return beats;
}

// ── ¿Cabe la nota en el compás actualmente abierto? ───────────
// Modo ESTRICTO: bloquea si la nota no cabe.
export function fitsInCurrentMeasure(dur, dotted) {
  const capacity = beatsPerMeasure();
  const used     = usedBeatsInOpenMeasure();
  const newBeats = (DUR_BEATS[dur] || 1) * (dotted ? 1.5 : 1);
  return newBeats <= capacity - used + 0.001;
}

// ══════════════════════════════════════════════════════════════
// REPETICIONES
// ══════════════════════════════════════════════════════════════

// Repeticiones válidas para un total de compases dado:
// dentro de rango, ordenadas y sin solapamientos.
export function sanitizedRepeats(measureCount) {
  const valid = (state.repeats || [])
    .filter(r => r.from >= 0 && r.to >= r.from && r.to < measureCount && r.times >= 2)
    .sort((a, b) => a.from - b.from);
  const out = [];
  let lastEnd = -1;
  for (const r of valid) {
    if (r.from > lastEnd) { out.push(r); lastEnd = r.to; }
  }
  return out;
}

// Índices de nota en orden de reproducción, con las repeticiones
// expandidas. Lo usan el audio y la exportación MIDI.
export function expandedNoteIndices() {
  const measures = analyzeMeasures();
  const reps     = sanitizedRepeats(measures.length);
  const out      = [];
  let mi = 0;
  while (mi < measures.length) {
    const rep = reps.find(r => r.from === mi);
    if (rep) {
      for (let t = 0; t < rep.times; t++) {
        for (let m = rep.from; m <= rep.to; m++) {
          for (let i = measures[m].startIdx; i < measures[m].endIdx; i++) out.push(i);
        }
      }
      mi = rep.to + 1;
    } else {
      for (let i = measures[mi].startIdx; i < measures[mi].endIdx; i++) out.push(i);
      mi++;
    }
  }
  return out;
}

// ── ¿Se puede insertar la figura en el índice dado? ──────────
// Al final: chequeo estricto del compás abierto. En medio: se
// permite siempre — la música refluye y los compases incompletos
// quedan marcados en ámbar para guiar al usuario.
export function fitsAtIndex(idx, dur, dotted) {
  if (idx >= state.notes.length) return fitsInCurrentMeasure(dur, dotted);
  return true;
}

// ── Duraciones disponibles para el compás actual ─────────────
// Devuelve { TT: bool, …, TT_dot: bool, … }
export function availableDurations() {
  const capacity  = beatsPerMeasure();
  const used      = usedBeatsInOpenMeasure();
  const remaining = capacity - used;
  const result    = {};
  for (const [dur, beats] of Object.entries(DUR_BEATS)) {
    result[dur]          = beats       <= remaining + 0.001;
    result[dur + '_dot'] = beats * 1.5 <= remaining + 0.001;
  }
  return result;
}
