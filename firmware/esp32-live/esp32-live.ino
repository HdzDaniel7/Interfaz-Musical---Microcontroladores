/*
 * esp32-live.ino — Intérprete "en vivo" para ESP32
 * ============================================================
 * SALIDA PWM (buzzer): GPIO 26 · canal LEDC  →  #define BUZZER_PIN 26
 * ============================================================
 * Firmware FIJO: se flashea UNA sola vez. A diferencia del .ino
 * que exporta el Editor Musical (que lleva una canción incrustada
 * y la toca sola), este sketch no sabe ninguna canción: se queda
 * escuchando el puerto serial y toca, una a una, las figuras que
 * la PC le va dictando desde la app web (modo "live" por USB).
 *
 * La PC calcula las frecuencias con la misma afinación del editor
 * (DO0 = 16.3516 Hz) y las envía ya listas, así que el tono suena
 * idéntico al navegador sin que el firmware tenga que calcular nada.
 *
 * ------------------------------------------------------------
 * PROTOCOLO (115200 baud, líneas terminadas en '\n')
 *
 *   PC → ESP32:
 *     H              handshake / ping        → responde "OK"
 *     T<freq>,<ms>   toca <freq> Hz, <ms> ms → responde "D" al terminar
 *     L<freq>,<ms>   = T, pero LIGADA: no corta el tono al terminar (la
 *                    siguiente figura cambia la frecuencia sin re-atacar,
 *                    igual que el legato de Web Audio)
 *     S<ms>          silencio de <ms> ms     → responde "D" al terminar
 *     X              paro inmediato (calla el buzzer ya, aun a media nota)
 *
 *   ESP32 → PC:
 *     B    boot: el firmware arrancó y está listo
 *     OK   respuesta al handshake
 *     D    done: la figura terminó, listo para la siguiente
 *
 * La PC puede mandar la figura N+1 mientras N todavía suena (pipeline
 * de 1 evento): como sostener() solo consume bytes cuando son 'X', el
 * resto queda intacto en el buffer de Serial y se procesa apenas
 * termina la figura actual, sin otra ida y vuelta USB.
 * ============================================================
 */

#include <Arduino.h>

#define BUZZER_PIN  26     // mismo pin que la plantilla esp32 del editor (LEDC)
#define PWM_FREQ    2000   // frecuencia base del canal LEDC
#define PWM_RES     8      // resolución del LEDC (bits)
#define CHECK_MS    4      // cada cuánto se revisa el serial DENTRO de una figura

void setup() {
  Serial.begin(115200);
  ledcAttach(BUZZER_PIN, PWM_FREQ, PWM_RES);
  ledcWriteTone(BUZZER_PIN, 0);   // buzzer en silencio al arrancar
  Serial.println("B");            // avisa a la PC que está listo
}

/*
 * Mantiene el buzzer en `freq` (0 = silencio) durante `ms`, pero
 * revisa el serial cada CHECK_MS: si llega una 'X', corta al
 * instante y aborta. Devuelve true si terminó normal, false si
 * fue interrumpida por un paro. `cortarAlFinal=false` (comando 'L')
 * deja el buzzer sonando al terminar — la próxima figura cambia la
 * frecuencia sin pasar por silencio, para que la ligadura no re-ataque.
 */
bool sostener(uint16_t freq, uint32_t ms, bool cortarAlFinal = true) {
  ledcWriteTone(BUZZER_PIN, freq);
  uint32_t inicio = millis();
  while (millis() - inicio < ms) {
    if (Serial.available() && Serial.peek() == 'X') {
      Serial.read();                 // consume la 'X'
      // Descarta cualquier figura que la PC ya haya adelantado (pipeline
      // de 1 evento, H1): un paro es total, no debe sonar la siguiente.
      while (Serial.available()) Serial.read();
      ledcWriteTone(BUZZER_PIN, 0);
      return false;                  // abortada → no se manda "D"
    }
    delay(CHECK_MS);
  }
  if (cortarAlFinal) ledcWriteTone(BUZZER_PIN, 0);
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

    case 'X':                        // paro fuera de una figura: nada que cortar
      ledcWriteTone(BUZZER_PIN, 0);
      break;

    case 'T': {                      // T<freq>,<ms>
      int coma = linea.indexOf(',');
      if (coma < 0) break;
      uint16_t freq = (uint16_t) linea.substring(1, coma).toInt();
      uint32_t ms   = (uint32_t) linea.substring(coma + 1).toInt();
      if (sostener(freq, ms)) Serial.println("D");
      break;
    }

    case 'L': {                      // L<freq>,<ms> — como T, pero ligada (sin re-ataque)
      int coma = linea.indexOf(',');
      if (coma < 0) break;
      uint16_t freq = (uint16_t) linea.substring(1, coma).toInt();
      uint32_t ms   = (uint32_t) linea.substring(coma + 1).toInt();
      if (sostener(freq, ms, false)) Serial.println("D");
      break;
    }

    case 'S': {                      // S<ms>
      uint32_t ms = (uint32_t) linea.substring(1).toInt();
      if (sostener(0, ms)) Serial.println("D");
      break;
    }
  }
}
