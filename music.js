/* ============================================================
   music.js — Lógica musical
   ============================================================ */

// ── Coordenada Y de una línea del pentagrama ──────────────────
function sY(row, line) {
  return ST + row * RH + line * SS;
}

// ── Y en canvas de una nota natural ──────────────────────────
function noteToY(naturalNote, row) {
  const slot = NOTE_SLOT[naturalNote] !== undefined ? NOTE_SLOT[naturalNote] : 0;
  return sY(row, 4) - slot * (SS / 2);
}

// ── Nota natural más cercana a un Y dado ─────────────────────
function yToNote(y, row) {
  const rel     = sY(row, 4) - y;
  const slot    = Math.round(rel / (SS / 2));
  const clamped = Math.max(-3, Math.min(11, slot));

  for (const [name, s] of Object.entries(NOTE_SLOT)) {
    if (s === clamped) return name;
  }
  let best = 'MI', bestDist = Infinity;
  for (const [name, s] of Object.entries(NOTE_SLOT)) {
    const d = Math.abs(s - clamped);
    if (d < bestDist) { bestDist = d; best = name; }
  }
  return best;
}

// ── Fila del pentagrama que contiene el punto Y ───────────────
function getRow(y) {
  const margin = Math.ceil(3 * SS / 2) + 4;
  for (let r = 0; r < RPP; r++) {
    const top = sY(r, -1) - SS;
    const bot = sY(r, 4) + margin;
    if (y >= top && y <= bot) return r;
  }
  return -1;
}

// ── Nombre del enum C++ para nota + accidental ────────────────
function codeNoteName(naturalNote, accidental) {
  if (accidental === 'sharp') return SHARP_NAME[naturalNote] || naturalNote;
  if (accidental === 'flat')  return FLAT_TO_SHARP[naturalNote] || naturalNote;
  return naturalNote;
}

// ── Línea de código para una nota ────────────────────────────
function noteToCode(n) {
  let durStr = n.dur;
  if (n.dotted) durStr = `(${n.dur} * 3 / 2)`;

  if (n.rest) return `\t\tSILENCIO(${durStr});`;

  let baseName, octaveOffset;
  if (n.note.endsWith('M')) {
    baseName    = n.note.slice(0, -1);
    octaveOffset = 1;
  } else if (n.note.endsWith('m')) {
    baseName    = n.note.slice(0, -1);
    octaveOffset = -1;
  } else {
    baseName    = n.note;
    octaveOffset = 0;
  }

  const name   = codeNoteName(baseName, n.accidental);
  const offStr = octaveOffset === 0 ? '0'
    : octaveOffset > 0 ? `+${octaveOffset}`
    : String(octaveOffset);

  return `\t\tPLAY(${name}, ${offStr}, ${durStr});`;
}

// ── Frecuencia en Hz para Web Audio ──────────────────────────
function noteFreq(enumName, z2val, octaveOff) {
  const semi = SEMITONE_IDX[enumName] || 0;
  return 16.3516 * Math.pow(2, ((z2val * 12) + semi + (octaveOff * 12)) / 12);
}

// ── Bloque completo de código .ino ───────────────────────────
function generateInoCode(notes, z2, title) {
  const ts       = state.timeSignature;
  const mcu      = state.mcu || 'esp32';
  const measures = analyzeMeasures();
  const hasDotted = notes.some(n => n.dotted);

  // Agrupar notas por compás
  const loopLines = measures.length === 0
    ? ['\t\t// Agrega notas en el pentagrama...']
    : measures.map((m, idx) => {
        const mn    = notes.slice(m.startIdx, m.endIdx);
        const lines = mn.map(n => noteToCode(n));
        return `\t\t// — Compás ${idx + 1} —\n${lines.join('\n')}`;
      });

  // Bloque PWM según MCU
  const isArduino  = mcu === 'arduino' || mcu === 'atmega328p';
  const mcuCodeEl  = document.getElementById(`mcu-${mcu === 'atmega328p' ? 'atmega' : mcu}-code`);
  const extraCode  = mcuCodeEl ? mcuCodeEl.value.trim() : '';

  const pwmBlock = isArduino
    ? `/* ================= PWM — Arduino/ATmega ================= */
void setup_pwm() { /* tone() setup */ }
void PLAY(Nota n, int8_t esc, uint16_t dur) {
  uint16_t freq = nota_freq(n, esc);
  tone(9, freq, dur);
  delay(dur);
}
void SILENCIO(uint16_t dur) { noTone(9); delay(dur); }`
    : `/* ================= PWM — ESP32 ================= */
void setup_pwm() { ledcAttach(BUZZER_PIN, 2000, 8); }
void PLAY(Nota n, int8_t esc, uint16_t dur) {
  uint16_t freq = nota_freq(n, esc);
  ledcWriteTone(BUZZER_PIN, freq);
  delay(dur);
}
void SILENCIO(uint16_t dur) { ledcWriteTone(BUZZER_PIN, 0); delay(dur); }`;

  const setupCalls = isArduino
    ? `  setup_pwm();`
    : `  setup_pwm();
  pinMode(PIN1, INPUT_PULLUP); attachInterrupt(digitalPinToInterrupt(PIN1), escala1, RISING);
  pinMode(PIN2, INPUT_PULLUP); attachInterrupt(digitalPinToInterrupt(PIN2), escala2, RISING);
  pinMode(PIN3, INPUT_PULLUP); attachInterrupt(digitalPinToInterrupt(PIN3), escala3, RISING);
  pinMode(PIN4, INPUT_PULLUP); attachInterrupt(digitalPinToInterrupt(PIN4), escala0, RISING);`;

  const dotMacros = hasDotted
    ? `#define TT_P (TT*3/2)\n#define DT_P (DT*3/2)\n#define T_P  (T*3/2)\n#define MT_P (MT*3/2)\n#define CT_P (CT*3/2)\n`
    : '';

  const extraSection = extraCode
    ? `\n/* ================= CÓDIGO ADICIONAL ================= */\n${extraCode}\n`
    : '';

  return `\
#include <Arduino.h>
#include <math.h>

/* ================= CONFIG ================= */
int8_t z2 = ${z2};  // escala base
int8_t z  = z2;

#define BUZZER_PIN 26
#define E  10
#define TT (E*160)
#define DT (E*80)
#define T  (E*40)
#define MT (E*20)
#define CT (E*10)
${dotMacros}
/* Compás: ${ts.num}/${ts.den} */

int PIN1 = 13;
int PIN2 = 12;
int PIN3 = 14;
int PIN4 = 27;

#define DO0 16.3516

/* ================= NOTAS ================= */
enum Nota { DO=0, DOs, RE, REs, MI, FA, FAs, SOL, SOLs, LA, LAs, SI };

uint16_t nota_freq(Nota n, int8_t offset) {
  int16_t semitonos = (z * 12) + n + (offset * 12);
  double f = DO0 * pow(2.0, semitonos / 12.0);
  return (uint16_t)f;
}

void IRAM_ATTR escala1() { z = z2 + 1; }
void IRAM_ATTR escala2() { z = z2 + 2; }
void IRAM_ATTR escala3() { z = z2 + 3; }
void IRAM_ATTR escala0() { z = z2; }
${extraSection}
${pwmBlock}

void setup() {
${setupCalls}
}

void loop() {
${loopLines.join('\n\n')}

  delay(500);
}`;
}
