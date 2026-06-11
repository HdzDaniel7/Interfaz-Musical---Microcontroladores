/* ============================================================
   codegen/templates/arduino-uno.js — Plantilla Arduino UNO
   Framework Arduino + tone() (Timer2) + sleep IDLE.
   Misma API musical que las demás: PLAY(nota, esc, dur).
   ============================================================ */

import {
  buildLoopBody, durationDefines, userCodeSection, safeFileName,
} from '../common.js';

export default {
  id:        'arduino-uno',
  label:     'Arduino UNO',
  extension: '.ino',

  generate({ title, z2, bpm, timeSignature, notes, measures, repeats, extraCode, markers }) {
    const body = buildLoopBody(notes, measures, { markers, indent: '\t', repeats });

    return `\
/*
 * ${safeFileName(title)}.ino — Arduino UNO (ATmega328P @ 16 MHz)
 * Compás ${timeSignature.num}/${timeSignature.den} · ${bpm} BPM
 * tone() para el buzzer + SLEEP_MODE_IDLE entre ticks para
 * reducir consumo (ideal para alimentación por batería).
 * Generado por Editor Musical
 */

#include <Arduino.h>
#include <avr/sleep.h>
#include <avr/power.h>
#include <math.h>

/* ================= CONFIG ================================== */
int8_t          z2 = ${z2};
volatile int8_t z  = ${z2};

#define BUZZER_PIN 8

/* ================= TEMPO ==================================== */
${durationDefines(bpm)}

/* Botones de escala (pull-up interno, activos en LOW) */
#define PIN_ESC_UP1   4   /* z = z2 + 1 */
#define PIN_ESC_UP2   5   /* z = z2 + 2 */
#define PIN_ESC_DOWN  6   /* z = z2 - 1 */
#define PIN_ESC_BASE  7   /* z = z2     */

/* Botón de pausa: D2 = INT0, despierta del sleep */
#define PIN_PAUSA     2
#define PAUSE_CHECK   10

#define DO0 16.3516

/* ================= NOTAS ==================================== */
enum Nota { DO=0, DOs, RE, REs, MI, FA, FAs, SOL, SOLs, LA, LAs, SI };

/* ================= TABLA DE FRECUENCIAS ===================== */
/* z ∈ [2,10] cubre z2 ∈ [3,8] con offsets de octava -1 … +2    */
#define Z_MIN   2
#define Z_MAX   10
#define Z_RANGE (Z_MAX - Z_MIN + 1)

uint16_t freqTable[Z_RANGE][12];

void buildFreqTable() {
  for (int8_t zi = 0; zi < Z_RANGE; zi++) {
    int8_t actualZ = Z_MIN + zi;
    for (uint8_t n = 0; n < 12; n++) {
      int16_t semitonos = ((int16_t)actualZ * 12) + n;
      freqTable[zi][n] = (uint16_t)(DO0 * pow(2.0, semitonos / 12.0));
    }
  }
}

uint16_t getFreq(int8_t zTotal, Nota n) {
  int8_t zi = constrain(zTotal - Z_MIN, 0, Z_RANGE - 1);
  return freqTable[zi][(uint8_t)n];
}

/* ================= PAUSA ==================================== */
volatile bool pausado = false;

void togglePausa() {
  pausado = !pausado;
}

void esperarReanudacion() {
  noTone(BUZZER_PIN);
  set_sleep_mode(SLEEP_MODE_IDLE);
  while (pausado) {
    sleep_mode();   /* despierta con INT0 (pausa) o Timer0 */
  }
}

/* ================= SLEEP ENTRE TICKS ======================== */
/* IDLE mantiene vivos Timer0 (millis) y Timer2 (tone) pero     */
/* apaga el núcleo de CPU mientras no hay nada que hacer.       */
void sleepDelay(uint16_t ms) {
  if (ms == 0) return;
  uint32_t inicio = millis();
  set_sleep_mode(SLEEP_MODE_IDLE);
  while ((millis() - inicio) < ms) {
    sleep_mode();
  }
}

/* ================= ESCALAS (sondeo) ========================= */
/* El UNO solo tiene 2 interrupciones externas (D2, D3); D2 se  */
/* usa para pausa, así que las escalas se leen por sondeo en    */
/* cada tick (cada PAUSE_CHECK ms, imperceptible al oído).      */
void leerEscalas() {
  if      (!digitalRead(PIN_ESC_UP1))  z = z2 + 1;
  else if (!digitalRead(PIN_ESC_UP2))  z = z2 + 2;
  else if (!digitalRead(PIN_ESC_DOWN)) z = z2 - 1;
  else if (!digitalRead(PIN_ESC_BASE)) z = z2;
}

/* ================= PLAY ===================================== */
void PLAY(Nota n, int8_t esc, uint16_t dur) {
  uint16_t freq = getFreq(z + esc, n);
  tone(BUZZER_PIN, freq);

  uint32_t inicio = millis();
  while ((millis() - inicio) < dur) {
    if (pausado) {
      uint16_t restante = dur - (uint16_t)(millis() - inicio);
      esperarReanudacion();
      tone(BUZZER_PIN, freq);
      inicio = millis();
      dur    = restante;
    }
    leerEscalas();
    sleepDelay(PAUSE_CHECK);
  }
  noTone(BUZZER_PIN);
}

void SILENCIO(uint16_t dur) {
  noTone(BUZZER_PIN);

  uint32_t inicio = millis();
  while ((millis() - inicio) < dur) {
    if (pausado) {
      esperarReanudacion();
      inicio = millis();
    }
    leerEscalas();
    sleepDelay(PAUSE_CHECK);
  }
}
${userCodeSection(extraCode)}
/* ================= SETUP ==================================== */
void setup() {
  /* Apagar periféricos que no se usan → menos consumo */
  power_adc_disable();
  power_spi_disable();
  power_twi_disable();
  power_usart0_disable();

  buildFreqTable();

  pinMode(PIN_ESC_UP1,  INPUT_PULLUP);
  pinMode(PIN_ESC_UP2,  INPUT_PULLUP);
  pinMode(PIN_ESC_DOWN, INPUT_PULLUP);
  pinMode(PIN_ESC_BASE, INPUT_PULLUP);

  pinMode(PIN_PAUSA, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN_PAUSA), togglePausa, FALLING);
}

void loop() {
  if (pausado) esperarReanudacion();

${body}

  noTone(BUZZER_PIN);
  sleepDelay(500);
}`;
  },
};
