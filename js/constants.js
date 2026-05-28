/* ============================================================
   constants.js — Datos musicales y constantes de configuración
   ============================================================ */

// ── Notas naturales disponibles en el pentagrama ─────────────
// Notación:
//   SIm … SI  → octava baja  (offset -1)
//   DO  … SI  → octava media (offset  0)
//   DOM … SIM → octava alta  (offset +1)
const NATURAL_NOTES = [
  'SIm',
  'DO', 'RE', 'MI', 'FA', 'SOL', 'LA', 'SI',
  'DOM', 'REM', 'MIM', 'FAM', 'SOLM', 'LAM', 'SIM'
];

// ── Slot visual de cada nota (referencia: MI = 0, línea inferior) ──
// Positivo = sube en el pentagrama, negativo = baja
const NOTE_SLOT = {
  SIm: -3,
  DO:  -2, RE: -1, MI: 0, FA: 1, SOL: 2, LA: 3, SI: 4,
  DOM:  5, REM: 6, MIM: 7, FAM: 8, SOLM: 9, LAM: 10, SIM: 11
};

// ── Traducción de nota+accidental → nombre del enum C++ ──────
// Los bemoles se convierten a su sostenido enarmónico equivalente.

const SHARP_NAME = {
  DO: 'DOs',   RE: 'REs',   MI: 'MI',    FA: 'SOL',
  SOL: 'SOLs', LA: 'LAs',   SI: 'DO',
  DOM: 'DOMs', REM: 'REMs', MIM: 'MIM',  FAM: 'FAMs',
  SOLM: 'SOLMs', LAM: 'LAMs', SIM: 'SIM'
};

const FLAT_TO_SHARP = {
  DO: 'SIm',   RE: 'DOs',   MI: 'REs',   FA: 'MIs',
  SOL: 'FA',   LA: 'SOLs',  SI: 'LAs',
  DOM: 'SIs',  REM: 'DOMs', MIM: 'REMs', FAM: 'MIM',
  SOLM: 'FAMs', LAM: 'SOLMs', SIM: 'LAMs'
};

// ── Etiqueta visual de cada nota ──────────────────────────────
const NOTE_DISPLAY = {
  SIm: 'SI_m',
  DO: 'DO',   RE: 'RE',   MI: 'MI',   FA: 'FA',   SOL: 'SOL', LA: 'LA',  SI: 'SI',
  DOM: 'DO_M', REM: 'RE_M', MIM: 'MI_M', FAM: 'FA_M',
  SOLM: 'SOL_M', LAM: 'LA_M', SIM: 'SI_M'
};

// ── Índice de semitono para reproducción Web Audio ────────────
const SEMITONE_IDX = {
  SIm: -1,
  DO: 0, DOs: 1, RE: 2, REs: 3, MI: 4, FA: 5, FAs: 6,
  SOL: 7, SOLs: 8, LA: 9, LAs: 10, SI: 11,
  DOM: 0, DOMs: 1, REM: 2, REMs: 3, MIM: 4, FAM: 5, FAMs: 6,
  SOLM: 7, SOLMs: 8, LAM: 9, LAMs: 10, SIM: 11
};

// ── Duraciones ────────────────────────────────────────────────
const DUR_BEATS = { TT: 4, DT: 2, T: 1, MT: 0.5, CT: 0.25 };
const DUR_MS    = { TT: 1600, DT: 800, T: 400, MT: 200, CT: 100 };

// ── Constantes de dibujo del pentagrama ──────────────────────
const SS  = 10;   // Separación entre líneas (px)
const ST  = 50;   // Top margin antes del primer pentagrama (px)
const NW  = 48;   // Ancho de slot por nota (px)
const ML  = 58;   // Margen izquierdo (px)
const MR  = 18;   // Margen derecho (px)
const RPP = 4;    // Filas de pentagrama por página
const RH  = 115;  // Altura de cada fila de pentagrama (px)

const canvas = document.getElementById('score-canvas');
const ctx    = canvas.getContext('2d');

// ── Función de frecuencia para Web Audio API ──────────────────
// Equivalente a nota_freq() del firmware
// DO0 = 16.3516 Hz, misma referencia que el microcontrolador
function noteFreq(enumName, z2val, octaveOff) {
  const semi = SEMITONE_IDX[enumName] ?? 0;
  return 16.3516 * Math.pow(2, ((z2val * 12) + semi + ((octaveOff || 0) * 12)) / 12);
}

// ── Traducción nota+accidental → nombre del enum ─────────────
// Usada por audio.js y midi.js
function codeNoteName(baseName, accidental) {
  if (accidental === 'sharp') return SHARP_NAME[baseName]    || baseName;
  if (accidental === 'flat')  return FLAT_TO_SHARP[baseName] || baseName;
  return baseName;
}