/* ============================================================
   midi.js — Generación de archivo MIDI desde la partitura
   MIDI formato 0 (single track), sin dependencias externas.
   ============================================================ */

import { state } from './state.js';
import { resolvePitch } from './music.js';
import { DUR_BEATS } from './constants.js';
import { safeFileName } from './codegen/common.js';

// ── Helpers para escribir bytes MIDI ─────────────────────────

function writeByte(arr, byte) {
  arr.push(byte & 0xFF);
}

function writeUint16(arr, val) {
  arr.push((val >> 8) & 0xFF);
  arr.push(val & 0xFF);
}

function writeUint32(arr, val) {
  arr.push((val >> 24) & 0xFF);
  arr.push((val >> 16) & 0xFF);
  arr.push((val >>  8) & 0xFF);
  arr.push(val & 0xFF);
}

// Variable-length quantity — formato MIDI para tiempos delta
function writeVLQ(arr, val) {
  const bytes = [];
  bytes.push(val & 0x7F);
  val >>= 7;
  while (val > 0) {
    bytes.push((val & 0x7F) | 0x80);
    val >>= 7;
  }
  bytes.reverse();
  bytes.forEach(b => arr.push(b));
}

// ── Conversión nota → número MIDI ─────────────────────────────
// resolvePitch ya maneja accidentales y cambios de octava
// (SI♯ → DO octava arriba, DO♭ → SI octava abajo, etc.)
function noteToMidi(noteName, accidental, z2val) {
  const { pc, octave } = resolvePitch(noteName, accidental);
  const midiNote = 12 * (z2val + octave) + pc;
  return Math.max(0, Math.min(127, midiNote));
}

// ── Duración en ticks MIDI (480 ticks por negra, PPQ estándar) ─
const PPQ = 480;

function noteTicks(dur, dotted) {
  const beats = DUR_BEATS[dur] || 1;
  const ticks = beats * PPQ;
  return dotted ? Math.floor(ticks * 1.5) : ticks;
}

// ── Generar archivo MIDI ──────────────────────────────────────
// Retorna true si exportó, false si no había notas.
export function exportMidi() {
  const notes = state.notes;
  const bpm   = state.bpm || 120;
  const z2val = state.z2;

  if (!notes.length) return false;

  // Microsegundos por negra = 60,000,000 / BPM
  const tempo = Math.floor(60000000 / bpm);

  const track = [];

  // ── Evento de tempo ───────────────────────────────────────
  writeVLQ(track, 0);
  writeByte(track, 0xFF); // meta event
  writeByte(track, 0x51); // tempo
  writeByte(track, 0x03); // longitud 3 bytes
  writeByte(track, (tempo >> 16) & 0xFF);
  writeByte(track, (tempo >>  8) & 0xFF);
  writeByte(track, tempo & 0xFF);

  // ── Evento de nombre de pista ─────────────────────────────
  const trackName = (state.title || 'Mi_Cancion').slice(0, 32);
  const nameBytes = Array.from(trackName).map(c => c.charCodeAt(0) & 0x7F);
  writeVLQ(track, 0);
  writeByte(track, 0xFF);
  writeByte(track, 0x03);
  writeVLQ(track, nameBytes.length);
  nameBytes.forEach(b => writeByte(track, b));

  // ── Programa: piano acústico (program 0, canal 0) ─────────
  writeVLQ(track, 0);
  writeByte(track, 0xC0); // program change canal 0
  writeByte(track, 0);    // piano acústico

  // ── Notas: eventos Note On / Note Off ordenados por tick ──
  const events = [];
  let currentTick = 0;

  notes.forEach(n => {
    const ticks = noteTicks(n.dur, n.dotted);

    if (!n.rest) {
      const midiNote = noteToMidi(n.note, n.accidental, z2val);
      events.push({ tick: currentTick, type: 'on', note: midiNote, vel: 80 });
      // Note Off antes del siguiente (articulación 5%)
      events.push({ tick: currentTick + Math.floor(ticks * 0.95), type: 'off', note: midiNote, vel: 0 });
    }

    currentTick += ticks;
  });

  // Ordenar por tick, Note Off antes de Note On si mismo tick
  events.sort((a, b) => {
    if (a.tick !== b.tick) return a.tick - b.tick;
    if (a.type === 'off' && b.type === 'on') return -1;
    if (a.type === 'on' && b.type === 'off') return 1;
    return 0;
  });

  // Escribir eventos con delta times
  let lastTick = 0;
  events.forEach(ev => {
    const delta = ev.tick - lastTick;
    lastTick    = ev.tick;
    writeVLQ(track, delta);
    if (ev.type === 'on') {
      writeByte(track, 0x90); // Note On canal 0
      writeByte(track, ev.note);
      writeByte(track, ev.vel);
    } else {
      writeByte(track, 0x80); // Note Off canal 0
      writeByte(track, ev.note);
      writeByte(track, 0);
    }
  });

  // End of track
  writeVLQ(track, 0);
  writeByte(track, 0xFF);
  writeByte(track, 0x2F);
  writeByte(track, 0x00);

  // ── Ensamblar archivo MIDI completo ───────────────────────
  const header = [];

  // MThd — header chunk
  [0x4D, 0x54, 0x68, 0x64].forEach(b => writeByte(header, b)); // "MThd"
  writeUint32(header, 6);     // longitud del header = 6
  writeUint16(header, 0);     // formato 0 (single track)
  writeUint16(header, 1);     // número de tracks
  writeUint16(header, PPQ);   // ticks por negra

  // MTrk — track chunk
  const trackHeader = [];
  [0x4D, 0x54, 0x72, 0x6B].forEach(b => writeByte(trackHeader, b)); // "MTrk"
  writeUint32(trackHeader, track.length);

  const midi = new Uint8Array([...header, ...trackHeader, ...track]);

  // ── Descargar ─────────────────────────────────────────────
  const blob = new Blob([midi], { type: 'audio/midi' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = safeFileName(state.title) + '.mid';
  a.click();
  URL.revokeObjectURL(a.href);
  return true;
}
