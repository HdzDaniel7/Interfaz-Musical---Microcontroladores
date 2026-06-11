/* ============================================================
   codegen/templates/esp32.js — Plantilla ESP32 (framework Arduino)
   PWM por LEDC + light sleep para bajo consumo.
   ============================================================ */

import {
  buildLoopBody, durationDefines, userCodeSection, safeFileName,
} from '../common.js';

export default {
  id:        'esp32',
  label:     'ESP32',
  extension: '.ino',

  generate({ title, z2, bpm, timeSignature, notes, measures, repeats, extraCode, markers }) {
    const body = buildLoopBody(notes, measures, { markers, indent: '\t', repeats });

    return `\
/*
 * ${safeFileName(title)}.ino — ESP32 (framework Arduino)
 * Compás ${timeSignature.num}/${timeSignature.den} · ${bpm} BPM
 * Generado por Editor Musical
 */

#include <Arduino.h>
#include <math.h>
#include <esp_sleep.h>

/* ================= CONFIG ================================== */
int8_t          z2 = ${z2};
volatile int8_t z  = ${z2};

#define BUZZER_PIN 26

/* ================= TEMPO ==================================== */
${durationDefines(bpm)}

int PIN1 = 13;
int PIN2 = 12;
int PIN3 = 14;
int PIN4 = 27;

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

/* ================= PWM ====================================== */
void setup_pwm() {
  ledcAttach(BUZZER_PIN, 2000, 8);
}

/* ================= PAUSA ==================================== */
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

/* ================= PLAY ===================================== */
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

/* ================= ESCALAS (ISR) ============================ */
void IRAM_ATTR escala1() { z = z2 + 1; }
void IRAM_ATTR escala2() { z = z2 + 2; }
void IRAM_ATTR escala3() { z = z2 - 1; }
void IRAM_ATTR escala0() { z = z2; }
${userCodeSection(extraCode)}
/* ================= SETUP ==================================== */
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

${body}

  ledcWriteTone(BUZZER_PIN, 0);
  esp_sleep_enable_timer_wakeup(500000ULL);
  esp_light_sleep_start();
}`;
  },
};
