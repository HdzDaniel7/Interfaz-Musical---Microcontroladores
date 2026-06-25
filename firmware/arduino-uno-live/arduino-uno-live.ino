/*
 * arduino-uno-live.ino — Intérprete "en vivo" para Arduino UNO
 * ============================================================
 * SALIDA PWM (buzzer): pin digital 8 · tone()/Timer2  →  #define BUZZER_PIN 8
 * ============================================================
 * Firmware FIJO: se flashea UNA sola vez. No lleva ninguna canción;
 * escucha el puerto serial y toca, una a una, las figuras que la app
 * web le dicta en modo "live" por USB. Mismo protocolo que el ESP32.
 *
 * La PC envía las frecuencias ya calculadas con la afinación del
 * editor (DO0 = 16.3516 Hz), así el tono suena idéntico al navegador.
 *
 * Buzzer en el pin 8 (igual que la plantilla arduino-uno del editor).
 *
 * ------------------------------------------------------------
 * PROTOCOLO (115200 baud, líneas terminadas en '\n')
 *   PC → UNO:   H · T<freq>,<ms> · S<ms> · X
 *   UNO → PC:   B (boot) · OK (handshake) · D (figura terminada)
 * ============================================================
 */

#include <Arduino.h>

#define BUZZER_PIN  8
#define CHECK_MS    4      // cada cuánto se revisa el serial dentro de una figura

void setup() {
  Serial.begin(115200);
  pinMode(BUZZER_PIN, OUTPUT);
  noTone(BUZZER_PIN);
  Serial.println("B");     // avisa a la PC que está listo
}

/*
 * Toca `freq` Hz (0 = silencio) durante `ms`, revisando el serial:
 * si llega una 'X', corta al instante y aborta. Devuelve true si
 * terminó normal, false si fue interrumpida por un paro.
 */
bool sostener(uint16_t freq, uint32_t ms) {
  if (freq > 0) tone(BUZZER_PIN, freq);
  else          noTone(BUZZER_PIN);

  uint32_t inicio = millis();
  while (millis() - inicio < ms) {
    if (Serial.available() && Serial.peek() == 'X') {
      Serial.read();                 // consume la 'X'
      noTone(BUZZER_PIN);
      return false;                  // abortada → no se manda "D"
    }
    delay(CHECK_MS);
  }
  noTone(BUZZER_PIN);
  return true;
}

void loop() {
  if (!Serial.available()) return;

  String linea = Serial.readStringUntil('\n');
  linea.trim();
  if (linea.length() == 0) return;

  switch (linea.charAt(0)) {

    case 'H':                        // handshake
      Serial.println("OK");
      break;

    case 'X':                        // paro fuera de una figura
      noTone(BUZZER_PIN);
      break;

    case 'T': {                      // T<freq>,<ms>
      int coma = linea.indexOf(',');
      if (coma < 0) break;
      uint16_t freq = (uint16_t) linea.substring(1, coma).toInt();
      uint32_t ms   = (uint32_t) linea.substring(coma + 1).toInt();
      if (sostener(freq, ms)) Serial.println("D");
      break;
    }

    case 'S': {                      // S<ms>
      uint32_t ms = (uint32_t) linea.substring(1).toInt();
      if (sostener(0, ms)) Serial.println("D");
      break;
    }
  }
}
