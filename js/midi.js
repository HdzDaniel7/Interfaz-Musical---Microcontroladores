/* ============================================================
   midi.js — Generación de archivo MIDI desde la partitura
   MIDI formato 0 (single track), sin dependencias externas.
   ============================================================ */

import { state } from './state.js';
import {
  resolvePitch, expandedNoteIndices, computeTieChains,
  analyzeMeasures, buildNoteKeyMap,
} from './music.js';
import { DUR_BEATS, NOTE_SLOT, Z2_MIN, Z2_MAX } from './constants.js';
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
function noteToMidi(noteName, accidental, z2val, ks) {
  const { pc, octave } = resolvePitch(noteName, accidental, ks);
  const midiNote = 12 * (z2val + octave) + pc;
  return Math.max(0, Math.min(127, midiNote));
}

// ── Duración en ticks MIDI (480 ticks por negra, PPQ estándar) ─
const PPQ = 480;

function noteTicks(n) {
  let ticks = (DUR_BEATS[n.dur] || 1) * PPQ;
  if (n.dotted)  ticks *= 1.5;
  if (n.triplet) ticks = ticks * 2 / 3;
  return Math.round(ticks);
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

  // Orden de reproducción con repeticiones expandidas y ligaduras.
  // Armadura efectiva por compás (respeta los cambios de tonalidad).
  const keyMap = buildNoteKeyMap(analyzeMeasures());
  const { chains, consumed, legato } = computeTieChains(state.notes, idx => keyMap[idx]);

  // Meta-eventos de armadura (FF 59): uno al inicio y uno en cada cambio.
  // keyMap ya está indexado por nota original, así que un mismo compás
  // repetido (state.repeats) siempre reporta la misma armadura — no hace
  // falta distinguir "primera pasada" de "repetición".
  let lastKeySig = null;

  expandedNoteIndices().forEach(idx => {
    if (consumed.has(idx)) return;

    const ks = keyMap[idx] ?? 0;
    if (ks !== lastKeySig) {
      events.push({ tick: currentTick, type: 'keysig', ks });
      lastKeySig = ks;
    }

    const n       = notes[idx];
    const members = chains.get(idx) || [idx];
    const ticks   = members.reduce((s, k) => s + noteTicks(notes[k]), 0);

    if (!n.rest) {
      const midiNote  = noteToMidi(n.note, n.accidental, z2val, keyMap[idx]);
      const legatoOut = legato.has(members[members.length - 1]);
      events.push({ tick: currentTick, type: 'on', note: midiNote, vel: 80 });
      // Legato: dura completo; normal: articulación 5%
      const offAt = legatoOut ? ticks : Math.floor(ticks * 0.95);
      events.push({ tick: currentTick + offAt, type: 'off', note: midiNote, vel: 0 });
    }

    currentTick += ticks;
  });

  // Ordenar por tick; a igual tick, primero armadura, luego Note Off, luego Note On.
  const TYPE_RANK = { keysig: 0, off: 1, on: 2 };
  events.sort((a, b) => a.tick - b.tick || TYPE_RANK[a.type] - TYPE_RANK[b.type]);

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
    } else if (ev.type === 'off') {
      writeByte(track, 0x80); // Note Off canal 0
      writeByte(track, ev.note);
      writeByte(track, 0);
    } else { // Key Signature meta-evento
      writeByte(track, 0xFF);
      writeByte(track, 0x59);
      writeByte(track, 0x02);
      writeByte(track, ev.ks); // sf: sostenidos(+)/bemoles(−), complemento a dos vía & 0xFF
      writeByte(track, 0x00); // mi: todas las armaduras de esta app son mayores
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

// ══════════════════════════════════════════════════════════════
// IMPORTACIÓN MIDI → partitura
// Extrae la melodía (pista con más notas, voz superior), la
// cuantiza a semicorcheas y elige el z2 que mejor cubre el rango.
// ══════════════════════════════════════════════════════════════

// Semitono → nota natural + accidental
const PC_TO_NOTE = [
  ['DO', 'none'], ['DO', 'sharp'], ['RE', 'none'], ['RE', 'sharp'],
  ['MI', 'none'], ['FA', 'none'], ['FA', 'sharp'], ['SOL', 'none'],
  ['SOL', 'sharp'], ['LA', 'none'], ['LA', 'sharp'], ['SI', 'none'],
];

// Unidades de semicorchea → figuras (de mayor a menor)
const UNITS_TO_FIG = [
  [24, 'TT', true], [16, 'TT', false], [12, 'DT', true], [8, 'DT', false],
  [6, 'T', true], [4, 'T', false], [3, 'MT', true], [2, 'MT', false],
  [1, 'CT', false],
];

function unitsToFigures(units, rest, pitch) {
  const out = [];
  while (units > 0) {
    const fig = UNITS_TO_FIG.find(([u]) => u <= units) || UNITS_TO_FIG.at(-1);
    out.push({
      note:       pitch ? pitch.note : 'SI',
      dur:        fig[1],
      dotted:     fig[2],
      rest,
      accidental: pitch ? pitch.accidental : 'none',
    });
    units -= fig[0];
  }
  return out;
}

// Parser binario de .mid (formato 0 y 1, división PPQ)
function parseMidiFile(buffer) {
  const data = new DataView(buffer);
  let pos = 0;

  const u32 = () => { const v = data.getUint32(pos); pos += 4; return v; };
  const u16 = () => { const v = data.getUint16(pos); pos += 2; return v; };
  const u8  = () => data.getUint8(pos++);
  const vlq = () => {
    let v = 0, b;
    do { b = u8(); v = (v << 7) | (b & 0x7F); } while (b & 0x80);
    return v;
  };
  const str4 = () => {
    const s = String.fromCharCode(u8(), u8(), u8(), u8());
    return s;
  };

  if (str4() !== 'MThd') throw new Error('No es un archivo MIDI');
  if (u32() !== 6) throw new Error('Cabecera MIDI inválida');
  u16(); // formato (0/1/2)
  const ntrks    = u16();
  const division = u16();
  if (division & 0x8000) throw new Error('División SMPTE no soportada');

  let bpm = null;
  let timeSig = null;
  const tracks = [];

  for (let t = 0; t < ntrks; t++) {
    if (str4() !== 'MTrk') throw new Error('Chunk de pista inválido');
    const end = pos + u32();
    const open  = new Map(); // midi → tick de inicio
    const notes = [];
    let tick = 0, running = 0;

    while (pos < end) {
      tick += vlq();
      let status = u8();
      if (status < 0x80) { pos--; status = running; } // running status
      else if (status < 0xF0) running = status;

      const type = status & 0xF0;
      if (type === 0x90 || type === 0x80) {
        const midi = u8(), vel = u8();
        if (type === 0x90 && vel > 0) {
          if (!open.has(midi)) open.set(midi, tick);
        } else if (open.has(midi)) {
          notes.push({ midi, start: open.get(midi), end: tick });
          open.delete(midi);
        }
      } else if (type === 0xA0 || type === 0xB0 || type === 0xE0) {
        pos += 2;
      } else if (type === 0xC0 || type === 0xD0) {
        pos += 1;
      } else if (status === 0xFF) {
        const meta = u8(), len = vlq(), at = pos;
        if (meta === 0x51 && bpm === null) {
          const us = (u8() << 16) | (u8() << 8) | u8();
          bpm = Math.round(60000000 / us);
        } else if (meta === 0x58 && timeSig === null) {
          const nn = u8(), dd = u8();
          timeSig = { num: nn, den: 2 ** dd };
        }
        pos = at + len;
      } else { // SysEx F0/F7
        pos += vlq();
      }
    }
    pos = end;
    tracks.push(notes);
  }

  return { tracks, division, bpm, timeSig };
}

// Importa un ArrayBuffer .mid y devuelve { notes, bpm, timeSig, info }
export function midiToProject(buffer) {
  const { tracks, division, bpm, timeSig } = parseMidiFile(buffer);

  // Pista con más notas = la melodía (heurística habitual)
  const track = tracks.reduce((a, b) => (b.length > a.length ? b : a), []);
  if (!track.length) throw new Error('El MIDI no contiene notas');

  // Monofónico: en acordes gana la voz superior; sin solapamientos
  track.sort((a, b) => a.start - b.start || b.midi - a.midi);
  const mono = [];
  for (const n of track) {
    const last = mono[mono.length - 1];
    if (last && n.start === last.start) continue;          // acorde → ya tomamos la superior
    if (last && n.start < last.end) last.end = n.start;    // solapado → recortar anterior
    mono.push({ ...n });
  }

  // Mejor z2: el que deja más notas dentro del rango SOL(z2-1)…RE(z2+2)
  let bestZ2 = 5, bestHits = -1;
  for (let z2 = Z2_MIN; z2 <= Z2_MAX; z2++) {
    const lo = 12 * (z2 - 1) + 7, hi = 12 * (z2 + 2) + 2;
    const hits = mono.filter(n => n.midi >= lo && n.midi <= hi).length;
    if (hits > bestHits) { bestHits = hits; bestZ2 = z2; }
  }
  const lo = 12 * (bestZ2 - 1) + 7, hi = 12 * (bestZ2 + 2) + 2;

  // Cuantizar a semicorcheas y construir la partitura
  const unit = division / 4;
  const SUFFIX = { '-1': 'm', 0: '', 1: 'M', 2: 'MM' };
  const notes = [];
  let cursor = 0, ajustadas = 0;

  for (const n of mono) {
    const qStart = Math.round(n.start / unit);
    const qEnd   = Math.max(qStart + 1, Math.round(n.end / unit));

    if (qStart > cursor) notes.push(...unitsToFigures(qStart - cursor, true, null));

    let midi = n.midi;
    if (midi < lo || midi > hi) {
      while (midi < lo) midi += 12;
      while (midi > hi) midi -= 12;
      ajustadas++;
    }

    const [base, accidental] = PC_TO_NOTE[midi % 12];
    const rel  = Math.floor(midi / 12) - bestZ2;
    const name = base + (SUFFIX[rel] ?? '');
    if (NOTE_SLOT[name] === undefined) continue; // fuera de rango tras ajuste (no debería ocurrir)

    notes.push(...unitsToFigures(qEnd - qStart, false, { note: name, accidental }));
    cursor = qEnd;
  }

  return {
    notes,
    z2:  bestZ2,
    bpm: bpm ? Math.max(40, Math.min(300, bpm)) : null,
    timeSig,
    info: { total: mono.length, ajustadas },
  };
}
