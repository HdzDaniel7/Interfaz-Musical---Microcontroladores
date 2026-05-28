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

// ── Convierte una nota a línea de código ──────────────────────
function noteToCode(n) {
  if (n.rest) {
    const durStr = n.dotted ? `(${n.dur} * 3 / 2)` : n.dur;
    return `\t\tSILENCIO(${durStr});`;
  }

  let baseName = n.note;
  let octaveOffset;

  if (n.note.endsWith('M'))      { baseName = n.note.slice(0, -1); octaveOffset =  1; }
  else if (n.note.endsWith('m')) { baseName = n.note.slice(0, -1); octaveOffset = -1; }
  else                           { octaveOffset = 0; }

  const enumName = codeNoteName(baseName, n.accidental);
  const off      = octaveOffset;
  const offStr   = off === 0 ? '0' : off > 0 ? `+${off}` : String(off);
  const durStr   = n.dotted ? `(${n.dur} * 3 / 2)` : n.dur;

  // Silencio de 20ms después de cada PLAY para articulación
  return `\t\tPLAY(${enumName}, ${offStr}, ${durStr});\n\t\tSILENCIO(20);`;
}

// ── Bloque completo de código .ino ────────────────────────────
function generateInoCode(notes, z2, title) {
  const ts        = state.timeSignature;
  const mcu       = state.mcu || 'esp32';
  const measures  = analyzeMeasures();
  const hasDotted = notes.some(n => n.dotted);
  const isArduino = mcu === 'arduino' || mcu === 'atmega328p';

  // ── Notas agrupadas por compás ────────────────────────────
  const loopLines = measures.length === 0
    ? ['\t\t// Agrega notas en el pentagrama...']
    : measures.map((m, idx) => {
        const mn    = notes.slice(m.startIdx, m.endIdx);
        const lines = mn.map(n => noteToCode(n));
        return `\t\t// — Compás ${idx + 1} —\n${lines.join('\n')}`;
      });

  // ── Macros de puntillo ────────────────────────────────────
  const dotMacros = hasDotted
    ? `#define TT_P (TT*3/2)
#define DT_P (DT*3/2)
#define T_P  (T*3/2)
#define MT_P (MT*3/2)
#define CT_P (CT*3/2)\n`
    : '';

  // ═══════════════════════════════════════════════════════════
  // ATmega328P — C puro, sin Arduino framework
  // ═══════════════════════════════════════════════════════════
  if (isArduino) {
    return `\
/*
 * ${title || 'Mi_Cancion'}.c — ATmega328P
 * Compás: ${ts.num}/${ts.den}
 */

#define F_CPU 8000000UL
#include <avr/io.h>
#include <avr/interrupt.h>
#include <avr/sleep.h>
#include <util/delay.h>
#include <math.h>
#include <stdint.h>

/* ================= CONFIG ================================== */
int8_t          z2 = ${z2};
volatile int8_t z  = ${z2};

#define BUZZER_PIN DDB1

#define E  10
#define TT (E * 160)
#define DT (E * 80)
#define T  (E * 40)
#define MT (E * 20)
#define CT (E * 10)
${dotMacros}
/* ================= NOTAS ================================== */
#define DO0 16.3516
typedef enum { DO=0, DOs, RE, REs, MI, FA, FAs, SOL, SOLs, LA, LAs, SI } Nota;

/* ================= TABLA DE FRECUENCIAS =================== */
#define Z_MIN   3
#define Z_MAX   8
#define Z_RANGE (Z_MAX - Z_MIN + 1)

static uint16_t freqTable[Z_RANGE][12];

void buildFreqTable(void) {
    for (int8_t zi = 0; zi < Z_RANGE; zi++) {
        int8_t actualZ = Z_MIN + zi;
        for (uint8_t n = 0; n < 12; n++) {
            int16_t semi = ((int16_t)actualZ * 12) + n;
            freqTable[zi][n] = (uint16_t)(DO0 * pow(2.0, semi / 12.0));
        }
    }
}

static inline uint16_t getFreq(int8_t zTotal, Nota n) {
    int8_t zi = zTotal - Z_MIN;
    if (zi < 0)        zi = 0;
    if (zi >= Z_RANGE) zi = Z_RANGE - 1;
    return freqTable[(uint8_t)zi][(uint8_t)n];
}

/* ================= PWM (TIMER1) =========================== */
void setup_pwm(void) {
    TCCR1A = (1 << COM1A1) | (1 << WGM11);
    TCCR1B = (1 << WGM13)  | (1 << CS10);
    DDRB  |= (1 << BUZZER_PIN);
}

void set_pwm_frequency(uint16_t freq) {
    if (freq == 0) { OCR1A = 0; return; }
    uint32_t top = ((uint32_t)F_CPU / (2UL * freq)) - 1;
    if (top > 0xFFFF) top = 0xFFFF;
    ICR1  = (uint16_t)top;
    OCR1A = (uint16_t)(top / 2);
}

/* ================= MILLIS() con Timer0 ==================== */
#define OCR0A_1MS  ((uint8_t)((F_CPU / 64UL / 1000UL) - 1))

volatile uint32_t millis_count = 0;

ISR(TIMER0_COMPA_vect) { millis_count++; }

void setup_millis(void) {
    TCCR0A = (1 << WGM01);
    TCCR0B = (1 << CS01) | (1 << CS00);
    OCR0A  = OCR0A_1MS;
    TIMSK0|= (1 << OCIE0A);
}

static inline uint32_t millis(void) {
    uint32_t m;
    uint8_t  sreg = SREG;
    cli();
    m = millis_count;
    SREG = sreg;
    return m;
}

/* ================= PAUSA ================================== */
#define PIN_PAUSA_BIT  DDD4
#define PAUSE_CHECK    10

volatile uint8_t pausado = 0;

ISR(PCINT2_vect) {
    if (!(PIND & (1 << PIN_PAUSA_BIT))) {
        pausado = !pausado;
    }
}

void setup_pausa(void) {
    DDRD  &= ~(1 << PIN_PAUSA_BIT);
    PORTD |=  (1 << PIN_PAUSA_BIT);
    PCICR |=  (1 << PCIE2);
    PCMSK2|=  (1 << PCINT20);
}

/* ================= SLEEP_MS ================================ */
static void sleep_ms(uint16_t ms) {
    if (ms == 0) return;
    uint32_t inicio = millis();
    set_sleep_mode(SLEEP_MODE_IDLE);
    while ((millis() - inicio) < (uint32_t)ms) {
        sleep_mode();
    }
}

/* ================= ESPERAR REANUDACION ==================== */
void esperarReanudacion(void) {
    set_pwm_frequency(0);
    set_sleep_mode(SLEEP_MODE_IDLE);
    while (pausado) {
        sleep_mode();
    }
}

/* ================= PLAY =================================== */
void PLAY(Nota n, int8_t esc, uint16_t dur) {
    uint16_t freq = getFreq(z + esc, n);
    set_pwm_frequency(freq);

    uint32_t inicio = millis();
    while (1) {
        uint32_t elapsed = millis() - inicio;
        if (elapsed >= dur) break;

        if (pausado) {
            uint32_t restante = dur - elapsed;
            esperarReanudacion();
            set_pwm_frequency(freq);
            inicio = millis();
            dur    = (uint16_t)restante;
            continue;
        }

        uint32_t restante = dur - (millis() - inicio);
        uint16_t chunk = (restante < PAUSE_CHECK) ? (uint16_t)restante : PAUSE_CHECK;
        sleep_ms(chunk);
    }
    set_pwm_frequency(0);
}

void SILENCIO(uint16_t dur) {
    set_pwm_frequency(0);

    uint32_t inicio = millis();
    while (1) {
        uint32_t elapsed = millis() - inicio;
        if (elapsed >= dur) break;

        if (pausado) {
            esperarReanudacion();
            inicio = millis();
            continue;
        }

        uint32_t restante = dur - elapsed;
        uint16_t chunk = (restante < PAUSE_CHECK) ? (uint16_t)restante : PAUSE_CHECK;
        sleep_ms(chunk);
    }
}

/* ================= TEMPO ================================== */
uint16_t tempoFactor = 100;

void PLAY_T(Nota n, int8_t esc, uint16_t dur) {
    uint32_t durReal = ((uint32_t)dur * tempoFactor) / 100;
    PLAY(n, esc, (uint16_t)durReal);
    SILENCIO(20);
}

void SILENCIO_T(uint16_t dur) {
    uint32_t durReal = ((uint32_t)dur * tempoFactor) / 100;
    SILENCIO((uint16_t)durReal);
}

/* ================= ESCALAS (ISR) ========================== */
ISR(INT0_vect)   { z = z2 + 1; }
ISR(INT1_vect)   { z = z2 + 2; }

ISR(PCINT0_vect) {
    if (PINB & (1 << PINB0)) { z = z2 - 1; }
    if (PINB & (1 << PINB2)) { z = z2;     }
}

/* ================= INTERRUPCIONES ========================= */
void setup_interrupts(void) {
    DDRD  &= ~(1 << DDD2);
    PORTD |=  (1 << PORTD2);
    EICRA |=  (1 << ISC01) | (1 << ISC00);
    EIMSK |=  (1 << INT0);

    DDRD  &= ~(1 << DDD3);
    PORTD |=  (1 << PORTD3);
    EICRA |=  (1 << ISC11) | (1 << ISC10);
    EIMSK |=  (1 << INT1);

    DDRB  &= ~((1 << DDB0) | (1 << DDB2));
    PORTB |=   (1 << PORTB0) | (1 << PORTB2);
    PCICR |=  (1 << PCIE0);
    PCMSK0|=  (1 << PCINT0) | (1 << PCINT2);

    sei();
}

/* ================= PRR ==================================== */
void power_reduce(void) {
    PRR = (1 << PRADC)
        | (1 << PRSPI)
        | (1 << PRTWI)
        | (1 << PRUSART0);
}

/* ================= MAIN =================================== */
int main(void) {
    CLKPR = (1 << CLKPCE);
    CLKPR = 0x00;

    z = z2;

    power_reduce();
    setup_pwm();
    setup_millis();
    setup_interrupts();
    setup_pausa();

    sei();
    buildFreqTable();

    while (1) {
        if (pausado) esperarReanudacion();

${loopLines.join('\n\n')}

        set_pwm_frequency(0);
        sleep_ms(500);
    }
}`;
  }

  // ═══════════════════════════════════════════════════════════
  // ESP32 — Arduino framework
  // ═══════════════════════════════════════════════════════════
  return `\
#include <Arduino.h>
#include <math.h>
#include <esp_sleep.h>

/* ================= CONFIG ================================== */
int8_t          z2 = ${z2};
volatile int8_t z  = ${z2};

#define BUZZER_PIN 26

#define E  10
#define TT (E * 160)
#define DT (E * 80)
#define T  (E * 40)
#define MT (E * 20)
#define CT (E * 10)
${dotMacros}
/* Compás: ${ts.num}/${ts.den} */

int PIN1 = 13;
int PIN2 = 12;
int PIN3 = 14;
int PIN4 = 27;

#define DO0 16.3516

/* ================= NOTAS ================================== */
enum Nota { DO=0, DOs, RE, REs, MI, FA, FAs, SOL, SOLs, LA, LAs, SI };

/* ================= TABLA DE FRECUENCIAS =================== */
#define Z_MIN   3
#define Z_MAX   8
#define Z_RANGE (Z_MAX - Z_MIN + 1)

uint16_t freqTable[Z_RANGE][12];

void buildFreqTable() {
  for (int zi = 0; zi < Z_RANGE; zi++) {
    int actualZ = Z_MIN + zi;
    for (int n = 0; n < 12; n++) {
      int16_t semitonos = (actualZ * 12) + n;
      freqTable[zi][n] = (uint16_t)(DO0 * pow(2.0, semitonos / 12.0));
    }
  }
}

inline uint16_t getFreq(int8_t zTotal, Nota n) {
  int zi = constrain(zTotal - Z_MIN, 0, Z_RANGE - 1);
  return freqTable[zi][(int)n];
}

/* ================= PWM ===================================== */
void setup_pwm() {
  ledcAttach(BUZZER_PIN, 2000, 8);
}

/* ================= PAUSA =================================== */
#define PIN_PAUSA    33
#define PAUSE_CHECK  8

volatile bool pausado = false;

void IRAM_ATTR togglePausa() {
  pausado = !pausado;
}

void esperarReanudacion() {
  ledcWriteTone(BUZZER_PIN, 0);
  while (pausado) {
    esp_sleep_enable_timer_wakeup(50000ULL);
    esp_light_sleep_start();
  }
}

/* ================= PLAY =================================== */
void PLAY(Nota n, int8_t esc, uint16_t dur) {
  uint16_t freq = getFreq(z + esc, n);
  ledcWriteTone(BUZZER_PIN, freq);

  uint32_t inicio = millis();
  while ((millis() - inicio) < dur) {
    if (pausado) {
      uint32_t restante = dur - (millis() - inicio);
      esperarReanudacion();
      ledcWriteTone(BUZZER_PIN, freq);
      inicio = millis();
      dur    = restante;
    }
    delay(PAUSE_CHECK);
  }
  ledcWriteTone(BUZZER_PIN, 0);
}

void SILENCIO(uint16_t dur) {
  ledcWriteTone(BUZZER_PIN, 0);

  uint32_t inicio = millis();
  while ((millis() - inicio) < dur) {
    if (pausado) {
      esperarReanudacion();
      inicio = millis();
    }
    delay(PAUSE_CHECK);
  }
}

/* ================= TEMPO ================================== */
uint16_t tempoFactor = 100;

void PLAY_T(Nota n, int8_t esc, uint16_t dur) {
  uint32_t durReal = ((uint32_t)dur * tempoFactor) / 100;
  PLAY(n, esc, (uint16_t)durReal);
  SILENCIO(20);
}

void SILENCIO_T(uint16_t dur) {
  uint32_t durReal = ((uint32_t)dur * tempoFactor) / 100;
  SILENCIO((uint16_t)durReal);
}

/* ================= ESCALAS (ISR) =========================== */
void IRAM_ATTR escala1() { z = z2 + 1; }
void IRAM_ATTR escala2() { z = z2 + 2; }
void IRAM_ATTR escala3() { z = z2 - 1; }
void IRAM_ATTR escala0() { z = z2; }

/* ================= SETUP ================================== */
void setup() {
  setCpuFrequencyMhz(80);

  Serial.begin(115200);

  setup_pwm();
  buildFreqTable();

  pinMode(PIN1, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN1), escala1, RISING);
  pinMode(PIN2, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN2), escala2, RISING);
  pinMode(PIN3, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN3), escala3, RISING);
  pinMode(PIN4, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN4), escala0, RISING);

  pinMode(PIN_PAUSA, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN_PAUSA), togglePausa, FALLING);
}

void loop() {
  if (pausado) esperarReanudacion();

${loopLines.join('\n\n')}

  ledcWriteTone(BUZZER_PIN, 0);
  esp_sleep_enable_timer_wakeup(500000ULL);
  esp_light_sleep_start();
}`;
}