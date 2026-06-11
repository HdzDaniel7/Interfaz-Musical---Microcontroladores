/* ============================================================
   constants.js — Datos musicales y constantes de configuración
   Módulo puro: sin acceso al DOM.
   ============================================================ */

// ── Notas naturales disponibles en el pentagrama ─────────────
// Notación de sufijos de octava (relativa a la octava base z2):
//   m  → octava -1     (SOLm, LAm, SIm)
//   ∅  → octava  0     (DO … SI)
//   M  → octava +1     (DOM … SIM)
//   MM → octava +2     (DOMM, REMM)
// Rango total: SOL(z2-1) … RE(z2+2)
export const NATURAL_NOTES = [
  'SOLm', 'LAm', 'SIm',
  'DO', 'RE', 'MI', 'FA', 'SOL', 'LA', 'SI',
  'DOM', 'REM', 'MIM', 'FAM', 'SOLM', 'LAM', 'SIM',
  'DOMM', 'REMM',
];

// ── Slot visual de cada nota (referencia: MI = 0, línea inferior) ──
// Positivo = sube en el pentagrama, negativo = baja
export const NOTE_SLOT = {
  SOLm: -5, LAm: -4, SIm: -3,
  DO: -2, RE: -1, MI: 0, FA: 1, SOL: 2, LA: 3, SI: 4,
  DOM: 5, REM: 6, MIM: 7, FAM: 8, SOLM: 9, LAM: 10, SIM: 11,
  DOMM: 12, REMM: 13,
};

export const SLOT_MIN = -5;
export const SLOT_MAX = 13;

// Slot → nombre de nota (inverso de NOTE_SLOT)
export const SLOT_TO_NOTE = Object.fromEntries(
  Object.entries(NOTE_SLOT).map(([name, slot]) => [slot, name])
);

// ── Etiqueta visual de cada nota ──────────────────────────────
export const NOTE_DISPLAY = {
  SOLm: 'SOL₋', LAm: 'LA₋', SIm: 'SI₋',
  DO: 'DO', RE: 'RE', MI: 'MI', FA: 'FA', SOL: 'SOL', LA: 'LA', SI: 'SI',
  DOM: 'DO⁺', REM: 'RE⁺', MIM: 'MI⁺', FAM: 'FA⁺',
  SOLM: 'SOL⁺', LAM: 'LA⁺', SIM: 'SI⁺',
  DOMM: 'DO⁺²', REMM: 'RE⁺²',
};

// ── Clase de semitono de cada nota natural (DO = 0) ───────────
export const PITCH_CLASS = { DO: 0, RE: 2, MI: 4, FA: 5, SOL: 7, LA: 9, SI: 11 };

// ── Nombres del enum C++ por semitono (0-11) ──────────────────
export const ENUM_NAMES = [
  'DO', 'DOs', 'RE', 'REs', 'MI', 'FA',
  'FAs', 'SOL', 'SOLs', 'LA', 'LAs', 'SI',
];

// ── Duraciones ────────────────────────────────────────────────
export const DUR_BEATS = { TT: 4, DT: 2, T: 1, MT: 0.5, CT: 0.25 };

export const DUR_NAMES = {
  TT: 'Redonda', DT: 'Blanca', T: 'Negra', MT: 'Corchea', CT: 'Semicorchea',
};

export const REST_GLYPHS = { TT: '𝄻', DT: '𝄼', T: '𝄽', MT: '𝄾', CT: '𝄿' };

// ── Constantes de dibujo del pentagrama ──────────────────────
export const SS  = 10;   // Separación entre líneas (px)
export const ST  = 56;   // Top margin antes del primer pentagrama (px)
export const NW  = 48;   // Ancho de slot por beat de negra (px)
export const ML  = 58;   // Margen izquierdo (px)
export const MR  = 18;   // Margen derecho (px)
export const RPP = 4;    // Filas de pentagrama por página
export const RH  = 132;  // Altura de cada fila de pentagrama (px)

// ── Afinación de referencia (DO octava 0) ─────────────────────
// Misma referencia que el firmware de los microcontroladores.
export const DO0_FREQ = 16.3516;

// ── Rango de z2 permitido en la UI ────────────────────────────
// El firmware genera tabla de frecuencias para z ∈ [2, 10]:
// con esc ∈ [-1, +2], z2 ∈ [3, 8] siempre cae dentro de la tabla.
export const Z2_MIN = 3;
export const Z2_MAX = 8;
