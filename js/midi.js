/* ============================================================
   midi.js — Generación de archivo MIDI desde la partitura
   ============================================================
   MIDI formato 0 (single track), sin dependencias externas.
   ============================================================ */

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
// MIDI: DO4 = 60, cada semitono = +1
// En tu sistema: z2=5 es la octava base
// DO en octava z=5 → MIDI 60 + (5-4)*12 = 72 (DO5)
// Ajustamos para que z2=5 suene en rango natural de piano

const ENUM_TO_SEMITONE = {
  DO: 0, DOs: 1, RE: 2, REs: 3, MI: 4, FA: 5,
  FAs: 6, SOL: 7, SOLs: 8, LA: 9, LAs: 10, SI: 11,
};

function noteToMidi(noteName, accidental, z2val, octaveOff) {
  // Obtener nombre base sin sufijo de octava
  let base = noteName;
  let oct  = octaveOff || 0;

  if (noteName.endsWith('M')) { base = noteName.slice(0, -1); oct += 1; }
  if (noteName.endsWith('m')) { base = noteName.slice(0, -1); oct -= 1; }

  // Resolver accidental → nombre del enum
  let enumName = base;
  if (accidental === 'sharp' && SHARP_NAME && SHARP_NAME[base]) {
    enumName = SHARP_NAME[base];
  } else if (accidental === 'flat' && FLAT_TO_SHARP && FLAT_TO_SHARP[base]) {
    enumName = FLAT_TO_SHARP[base];
  }

  const semi = ENUM_TO_SEMITONE[enumName] ?? 0;

  // MIDI note = 12 * (octava + 1) + semitono
  // z2=5 → octava MIDI 5 → DO5 = 72
  // Restamos 1 para alinear con rango de piano estándar
  const midiNote = 12 * (z2val + oct) + semi;
  return Math.max(0, Math.min(127, midiNote));
}

// ── Duración en ticks MIDI ────────────────────────────────────
// Usamos 480 ticks por negra (PPQ estándar)
const PPQ = 480;

const DUR_TICKS = {
  TT: PPQ * 4,    // redonda
  DT: PPQ * 2,    // blanca
  T:  PPQ,        // negra
  MT: PPQ / 2,    // corchea
  CT: PPQ / 4,    // semicorchea
};

function noteTicks(dur, dotted) {
  const base = DUR_TICKS[dur] || PPQ;
  return dotted ? Math.floor(base * 1.5) : base;
}

// ── Generar archivo MIDI ──────────────────────────────────────
function exportMidi() {
  const notes  = state.notes;
  const bpm    = parseInt(document.getElementById('bpm').value) || 120;
  const z2val  = state.z2;

  if (!notes.length) {
    alert('No hay notas en la partitura.');
    return;
  }

  // Microsegundos por negra = 60,000,000 / BPM
  const tempo = Math.floor(60000000 / bpm);

  const track = [];

  // ── Evento de tempo ───────────────────────────────────────
  // Delta 0, meta event FF 51 03, tempo en 3 bytes
  writeVLQ(track, 0);
  writeByte(track, 0xFF); // meta event
  writeByte(track, 0x51); // tempo
  writeByte(track, 0x03); // longitud 3 bytes
  writeByte(track, (tempo >> 16) & 0xFF);
  writeByte(track, (tempo >>  8) & 0xFF);
  writeByte(track, tempo & 0xFF);

  // ── Evento de nombre de pista ─────────────────────────────
  const trackName  = (state.title || 'Mi_Cancion').slice(0, 32);
  const nameBytes  = Array.from(trackName).map(c => c.charCodeAt(0));
  writeVLQ(track, 0);
  writeByte(track, 0xFF);
  writeByte(track, 0x03);
  writeVLQ(track, nameBytes.length);
  nameBytes.forEach(b => writeByte(track, b));

  // ── Programa: piano acústico (program 0, canal 0) ─────────
  writeVLQ(track, 0);
  writeByte(track, 0xC0); // program change canal 0
  writeByte(track, 0);    // piano acústico

  // ── Notas ─────────────────────────────────────────────────
  // MIDI necesita Note On y Note Off separados con delta times
  // Construimos una lista de eventos y los ordenamos por tick

  const events = [];
  let currentTick = 0;

  notes.forEach(n => {
    const ticks = noteTicks(n.dur, n.dotted);

    if (!n.rest) {
      const midiNote = noteToMidi(n.note, n.accidental, z2val, n.octaveOffset || 0);
      // Note On al inicio
      events.push({ tick: currentTick,         type: 'on',  note: midiNote, vel: 80 });
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
  [0x4D,0x54,0x68,0x64].forEach(b => writeByte(header, b)); // "MThd"
  writeUint32(header, 6);     // longitud del header = 6
  writeUint16(header, 0);     // formato 0 (single track)
  writeUint16(header, 1);     // número de tracks
  writeUint16(header, PPQ);   // ticks por negra

  // MTrk — track chunk
  const trackHeader = [];
  [0x4D,0x54,0x72,0x6B].forEach(b => writeByte(trackHeader, b)); // "MTrk"
  writeUint32(trackHeader, track.length);

  const midi = new Uint8Array([
    ...header,
    ...trackHeader,
    ...track,
  ]);

  // ── Descargar ─────────────────────────────────────────────
  const blob = new Blob([midi], { type: 'audio/midi' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = (state.title || 'cancion').replace(/\s+/g, '_') + '.mid';
  a.click();
  URL.revokeObjectURL(a.href);
}