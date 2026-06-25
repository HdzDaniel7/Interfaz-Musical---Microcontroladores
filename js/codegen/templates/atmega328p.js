/* ============================================================
   codegen/templates/atmega328p.js — Plantilla ATmega328P
   C puro (avr-gcc), sin framework Arduino. Bare-metal:
   PWM Timer1, millis con Timer0, sleep IDLE, interrupciones.
   ============================================================ */

import {
  buildLoopBody, durationDefines, userCodeSection, safeFileName,
} from '../common.js';

export default {
  id:        'atmega328p',
  label:     'ATmega328P',
  extension: '.c',

  generate({ title, z2, bpm, timeSignature, notes, measures, repeats, extraCode, markers }) {
    const body = buildLoopBody(notes, measures, { markers, indent: '\t\t', repeats });

    return `\
/*
 * ${safeFileName(title)}.c — ATmega328P (bare-metal, avr-gcc)
 * Compás ${timeSignature.num}/${timeSignature.den} · ${bpm} BPM
 * Salida PWM (buzzer): PB1 = OC1A · pin físico 15 · Timer1  →  #define BUZZER_PIN DDB1
 * Generado por Editor Musical
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

/* ================= TEMPO ==================================== */
${durationDefines(bpm)}

/* ================= NOTAS ==================================== */
#define DO0 16.3516
typedef enum { DO=0, DOs, RE, REs, MI, FA, FAs, SOL, SOLs, LA, LAs, SI } Nota;

/* ================= TABLA DE FRECUENCIAS ===================== */
/* z ∈ [2,10] cubre z2 ∈ [3,8] con offsets de octava -1 … +2    */
#define Z_MIN   2
#define Z_MAX   10
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

/* ================= PWM (TIMER1) ============================= */
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

/* ================= MILLIS() con Timer0 ====================== */
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

/* ================= PAUSA ==================================== */
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

/* ================= SLEEP_MS ================================= */
static void sleep_ms(uint16_t ms) {
    if (ms == 0) return;
    uint32_t inicio = millis();
    set_sleep_mode(SLEEP_MODE_IDLE);
    while ((millis() - inicio) < (uint32_t)ms) {
        sleep_mode();
    }
}

/* ================= ESPERAR REANUDACION ====================== */
void esperarReanudacion(void) {
    set_pwm_frequency(0);
    set_sleep_mode(SLEEP_MODE_IDLE);
    while (pausado) {
        sleep_mode();
    }
}

/* ================= PLAY ===================================== */
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

/* ================= ESCALAS (ISR) ============================ */
ISR(INT0_vect)   { z = z2 + 1; }
ISR(INT1_vect)   { z = z2 + 2; }

ISR(PCINT0_vect) {
    if (PINB & (1 << PINB0)) { z = z2 - 1; }
    if (PINB & (1 << PINB2)) { z = z2;     }
}

/* ================= INTERRUPCIONES =========================== */
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

/* ================= PRR ====================================== */
void power_reduce(void) {
    PRR = (1 << PRADC)
        | (1 << PRSPI)
        | (1 << PRTWI)
        | (1 << PRUSART0);
}
${userCodeSection(extraCode)}
/* ================= MAIN ===================================== */
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

${body}

        set_pwm_frequency(0);
        sleep_ms(500);
    }
}`;
  },
};
