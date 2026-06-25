/*
 * atmega328p-live.c — Intérprete "en vivo" para ATmega328P
 * ============================================================
 * SALIDA PWM (buzzer): PB1 = OC1A · pin físico 15 · Timer1  →  #define BUZZER_PIN DDB1
 * ============================================================
 * Firmware FIJO (bare-metal, avr-gcc): se flashea UNA sola vez. No
 * lleva ninguna canción; escucha el USART y toca, una a una, las
 * figuras que la app web le dicta en modo "live". Mismo protocolo
 * que el ESP32 y el Arduino UNO.
 *
 * La PC envía las frecuencias ya calculadas con la afinación del
 * editor (DO0 = 16.3516 Hz): el firmware no calcula tonos, solo
 * los reproduce, así que suena idéntico al navegador.
 *
 * ------------------------------------------------------------
 * REQUISITOS DE HARDWARE
 *   · Cristal externo de 16 MHz (necesario para un USART fiable a
 *     115200; el oscilador interno de 8 MHz no da el error suficiente).
 *   · Adaptador USB-Serie (FTDI / CP2102 / CH340) conectado a
 *     RX = PD0, TX = PD1 y GND común.
 *   · Buzzer en PB1 (OC1A), igual que la plantilla atmega328p del editor.
 *
 * ------------------------------------------------------------
 * PROTOCOLO (115200 baud, líneas terminadas en '\n')
 *   PC → MCU:   H · T<freq>,<ms> · S<ms> · X
 *   MCU → PC:   B (boot) · OK (handshake) · D (figura terminada)
 * ============================================================
 */

#define F_CPU 16000000UL
#define BAUD  115200

#include <avr/io.h>
#include <avr/interrupt.h>
#include <util/delay.h>
#include <stdlib.h>
#include <stdint.h>

#define BUZZER_PIN  DDB1
#define CHECK_MS    4      /* cada cuánto se revisa el serial dentro de una figura */

/* ================= UART (USART0, 8N1, doble velocidad) ====== */
#define UBRR_VAL (F_CPU / 8UL / BAUD - 1)

void uart_init(void) {
  UBRR0H = (uint8_t)(UBRR_VAL >> 8);
  UBRR0L = (uint8_t)(UBRR_VAL);
  UCSR0A = (1 << U2X0);                       /* doble velocidad → menor error */
  UCSR0B = (1 << RXEN0) | (1 << TXEN0);
  UCSR0C = (1 << UCSZ01) | (1 << UCSZ00);     /* 8 bits, sin paridad, 1 stop */
}

static inline uint8_t uart_available(void) { return (UCSR0A & (1 << RXC0)) != 0; }
static inline uint8_t uart_read(void)      { while (!(UCSR0A & (1 << RXC0))) {} return UDR0; }
static void uart_write(char c)             { while (!(UCSR0A & (1 << UDRE0))) {} UDR0 = c; }
static void uart_print(const char *s)      { while (*s) uart_write(*s++); }

/* ================= PWM (Timer1, prescaler 8) =============== */
void setup_pwm(void) {
  TCCR1A = (1 << COM1A1) | (1 << WGM11);
  TCCR1B = (1 << WGM13)  | (1 << CS11);       /* fast/phase-correct, /8 */
  DDRB  |= (1 << BUZZER_PIN);
}

void set_pwm_frequency(uint16_t freq) {
  if (freq == 0) { OCR1A = 0; return; }
  uint32_t top = ((uint32_t)F_CPU / 8UL / (2UL * freq)) - 1;
  if (top > 0xFFFF) top = 0xFFFF;
  ICR1  = (uint16_t)top;
  OCR1A = (uint16_t)(top / 2);
}

/* ================= millis() con Timer0 ===================== */
#define OCR0A_1MS  ((uint8_t)((F_CPU / 64UL / 1000UL) - 1))

volatile uint32_t millis_count = 0;
ISR(TIMER0_COMPA_vect) { millis_count++; }

void setup_millis(void) {
  TCCR0A = (1 << WGM01);
  TCCR0B = (1 << CS01) | (1 << CS00);         /* prescaler 64 */
  OCR0A  = OCR0A_1MS;
  TIMSK0 |= (1 << OCIE0A);
}

static inline uint32_t millis(void) {
  uint32_t m;
  uint8_t  sreg = SREG;
  cli();
  m = millis_count;
  SREG = sreg;
  return m;
}

/*
 * Mantiene `freq` Hz (0 = silencio) durante `ms`, revisando el USART:
 * si llega una 'X', corta al instante y aborta. Devuelve 1 si terminó
 * normal, 0 si fue interrumpida por un paro.
 */
uint8_t sostener(uint16_t freq, uint16_t ms) {
  set_pwm_frequency(freq);
  uint32_t inicio = millis();
  while ((millis() - inicio) < (uint32_t)ms) {
    if (uart_available() && uart_read() == 'X') {
      set_pwm_frequency(0);
      return 0;
    }
    _delay_ms(CHECK_MS);
  }
  set_pwm_frequency(0);
  return 1;
}

/* ================= Procesar una línea de comando =========== */
void procesar(char *linea) {
  switch (linea[0]) {

    case 'H':                                 /* handshake */
      uart_print("OK\n");
      break;

    case 'X':                                 /* paro fuera de una figura */
      set_pwm_frequency(0);
      break;

    case 'T': {                               /* T<freq>,<ms> */
      char *p;
      uint16_t freq = (uint16_t) strtoul(linea + 1, &p, 10);
      uint16_t ms   = (*p == ',') ? (uint16_t) strtoul(p + 1, NULL, 10) : 0;
      if (sostener(freq, ms)) uart_print("D\n");
      break;
    }

    case 'S': {                               /* S<ms> */
      uint16_t ms = (uint16_t) strtoul(linea + 1, NULL, 10);
      if (sostener(0, ms)) uart_print("D\n");
      break;
    }
  }
}

int main(void) {
  CLKPR = (1 << CLKPCE);
  CLKPR = 0x00;                               /* reloj sin división (16 MHz) */

  uart_init();
  setup_pwm();
  setup_millis();
  sei();

  uart_print("B\n");                          /* boot: listo */

  char    linea[24];
  uint8_t li = 0;

  while (1) {
    if (uart_available()) {
      char c = uart_read();
      if (c == '\n' || c == '\r') {
        linea[li] = '\0';
        if (li > 0) procesar(linea);
        li = 0;
      } else if (li < (uint8_t)(sizeof(linea) - 1)) {
        linea[li++] = c;
      }
    }
  }
}
