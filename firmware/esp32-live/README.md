# Firmware "en vivo" para ESP32

Sketch **fijo** que convierte al ESP32 en un intérprete controlado por la app: escucha el
puerto USB y toca, una a una, las figuras que el Editor Musical le envía cuando activas el
modo **ESP32 / Ambos**. Se flashea **una sola vez**; después puedes tocar cualquier canción
sin volver a compilar (la partitura vive en la app, no en el chip).

> Es distinto al `.ino` que la app **exporta**: ese lleva la canción incrustada y la toca solo.
> Este no sabe ninguna canción; obedece a la PC. No reemplaza al firmware exportable, lo complementa.

## Flasheo (una vez)

1. Conecta el ESP32 por USB.
2. Abre `esp32-live.ino` en el **IDE de Arduino** (con el core ESP32 instalado) o PlatformIO.
3. Selecciona tu placa (p. ej. *ESP32 Dev Module*) y el puerto COM.
4. Pulsa **Subir**.
5. Buzzer en el **pin 26** (mismo pin que la plantilla `esp32` del editor).

## Uso

1. En la app: botón **Conectar ESP32** → elige el puerto.
2. Selector de salida → **ESP32** (solo hardware) o **Ambos** (PC + hardware).
3. **Reproducir**: la app envía la partitura por serial y el ESP32 la toca en vivo.

Requiere navegador **Chromium** (Chrome/Edge) por la Web Serial API, sobre `https://` o
`localhost`.

## Protocolo serial (115200 baud, líneas `\n`)

| Dir | Mensaje | Significado |
|-----|---------|-------------|
| PC → ESP32 | `H` | handshake → responde `OK` |
| PC → ESP32 | `T<freq>,<ms>` | toca `freq` Hz durante `ms` ms → responde `D` al terminar |
| PC → ESP32 | `S<ms>` | silencio de `ms` ms → responde `D` al terminar |
| PC → ESP32 | `X` | paro inmediato (corta aun a media nota) |
| ESP32 → PC | `B` / `OK` / `D` | boot / handshake ok / figura terminada |

La PC envía cada figura y espera el `D` antes de mandar la siguiente (control de flujo simple
que evita solapamientos). El tono se envía ya calculado con la afinación del editor
(`DO0 = 16.3516 Hz`), idéntico a lo que suena en el navegador.
