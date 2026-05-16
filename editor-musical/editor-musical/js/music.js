/* ============================================================
   music.js — Lógica musical
   ============================================================
   Conversiones nota ↔ posición Y, generación de código .ino,
   cálculo de frecuencias para Web Audio.
   ============================================================ */

// ── Coordenada Y de una línea del pentagrama ──────────────────
// line 0 = línea superior, line 4 = línea inferior (MI natural)
function sY(row, line) {
  return ST + row * RH + line * SS;
}

// ── Y en canvas de una nota natural ──────────────────────────
// Referencia: MI (slot 0) = línea 4 (inferior) del pentagrama.
// Slots positivos suben en pantalla (Y decrece).
// Slots negativos bajan en pantalla (Y crece, líneas auxiliares inferiores).
//   slot  0 → MI  = sY(row, 4)          (línea 1 del pentagrama)
//   slot  2 → SOL = sY(row, 4) - SS     (línea 2)
//   slot  4 → SI  = sY(row, 4) - 2*SS   (línea 3)
//   slot -1 → RE  = sY(row, 4) + SS/2   (espacio bajo línea 1)
//   slot -2 → DO  = sY(row, 4) + SS     (1ª línea auxiliar inferior)
//   slot -3 → SIm = sY(row, 4) + 3*SS/2 (espacio 2ª línea aux. inf.)
function noteToY(naturalNote, row) {
  const slot = NOTE_SLOT[naturalNote] !== undefined ? NOTE_SLOT[naturalNote] : 0;
  return sY(row, 4) - slot * (SS / 2);
}

// ── Nota natural más cercana a un Y dado ─────────────────────
// Invierte noteToY: calcula el slot a partir de la distancia desde
// la línea inferior (sY(row,4)) y busca la nota más cercana.
function yToNote(y, row) {
  // distancia desde línea inferior; negativa si y está DEBAJO de ella
  const rel = sY(row, 4) - y;
  const slot = Math.round(rel / (SS / 2));
  // rango total de slots: -3 (SIm) … +11 (SIM)
  const clamped = Math.max(-3, Math.min(11, slot));

  // Coincidencia exacta primero
  for (const [name, s] of Object.entries(NOTE_SLOT)) {
    if (s === clamped) return name;
  }
  // Si no hay exacta (no debería ocurrir), la más cercana
  let best = 'MI', bestDist = Infinity;
  for (const [name, s] of Object.entries(NOTE_SLOT)) {
    const d = Math.abs(s - clamped);
    if (d < bestDist) { bestDist = d; best = name; }
  }
  return best;
}

// ── Fila del pentagrama que contiene el punto Y ───────────────
// El rango vertical de cada fila cubre:
//   arriba  → sY(row, 0) - margen (notas sobre línea 5)
//   abajo   → sY(row, 4) + margen (líneas auxiliares inferiores, slot -3)
// slot -3 = sY(row,4) + 3*(SS/2) = sY(row,4) + 15px
function getRow(y) {
  const margin = Math.ceil(3 * SS / 2) + 4;   // cubre hasta slot -3 + holgura
  for (let r = 0; r < RPP; r++) {
    const top = sY(r, -1) - SS;                 // holgura sobre línea superior
    const bot = sY(r, 4) + margin;             // hasta SIm inclusive
    if (y >= top && y <= bot) return r;
  }
  return -1;
}

// ── Nombre del enum C++ para nota + accidental ────────────────
function codeNoteName(naturalNote, accidental) {
  if (accidental === 'sharp') return SHARP_NAME[naturalNote] || naturalNote;
  if (accidental === 'flat') return FLAT_TO_SHARP[naturalNote] || naturalNote;
  return naturalNote;
}

// ── Nota a línea de código PLAY() o SILENCIO() ───────────────
function noteToCode(n) {
  if (n.rest) return `\t\tSILENCIO(${n.dur});`;

  let baseName = n.note;
  let octaveOffset;

  if (n.note.endsWith('M')) {
    baseName = n.note.slice(0, -1);   // DOM → DO, octava +1
    octaveOffset = 1;
  } else if (n.note.endsWith('m')) {
    baseName = n.note.slice(0, -1);   // SIm → SI, octava -1
    octaveOffset = -1;
  } else {
    octaveOffset = 0;
  }

  const name = codeNoteName(baseName, n.accidental);
  const offStr = octaveOffset === 0 ? '0'
    : octaveOffset > 0 ? `+${octaveOffset}`
      : String(octaveOffset);

  return `\t\tPLAY(${name}, ${offStr}, ${n.dur});`;
}

// ── Frecuencia en Hz para Web Audio ──────────────────────────
// DO0 = 16.3516 Hz (igual que en el firmware)
function noteFreq(enumName, z2val, octaveOff) {
  const semi = SEMITONE_IDX[enumName] || 0;
  return 16.3516 * Math.pow(2, ((z2val * 12) + semi + (octaveOff * 12)) / 12);
}

// ── Bloque completo de código .ino ───────────────────────────
function generateInoCode(notes, z2, title) {
  const songLines = notes.length
    ? notes.map(noteToCode).join('\n')
    : '\t\t// Agrega notas en el pentagrama...';

  return `\
#include <Arduino.h>
#include <math.h>

/* ================= CONFIG ================= */
int8_t z2 = ${z2}; // escala

int8_t z = z2;

#define BUZZER_PIN 26  // pin PWM

int PIN1 = 13;
int PIN2 = 12;
int PIN3 = 14;
int PIN4 = 27;

/* Duraciones */
#define E  10
#define TT E * 160
#define DT E * 80
#define T  E * 40
#define MT E * 20
#define CT E * 10

#define DO0 16.3516

/* ================= NOTAS ================= */

enum Nota {
  DO = 0, DOs, RE, REs, MI, FA, FAs, SOL, SOLs, LA, LAs, SI
};

/* ================= PWM ================= */

void setup_pwm() {
  ledcAttach(BUZZER_PIN, 2000, 8);
}

/* ================= FRECUENCIA ================= */

uint16_t nota_freq(Nota n, int8_t offset) {
  int16_t semitonos = (z * 12) + n + (offset * 12);
  double f = DO0 * pow(2.0, semitonos / 12.0);
  return (uint16_t)f;
}

/* ================= PLAY ================= */

void PLAY(Nota n, int8_t esc, uint16_t dur) {
  uint16_t freq = nota_freq(n, esc);
  ledcWriteTone(BUZZER_PIN, freq);
  delay(dur);
}

void SILENCIO(uint16_t dur) {
  ledcWriteTone(BUZZER_PIN, 0);
  delay(dur);
}

void IRAM_ATTR escala1() { z = z2 + 1; }
void IRAM_ATTR escala2() { z = z2 + 2; }
void IRAM_ATTR escala3() { z = z2 + 3; }
void IRAM_ATTR escala0() { z = z2; }

/* ================= MAIN ================= */

void setup() {
  setup_pwm();
  pinMode(PIN1, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN1), escala1, RISING);
  pinMode(PIN2, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN2), escala2, RISING);
  pinMode(PIN3, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN3), escala3, RISING);
  pinMode(PIN4, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN4), escala0, RISING);
}

void loop() {
${songLines}

  delay(500);
}`;
}
