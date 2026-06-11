# Editor Musical para Microcontroladores

Editor de partituras web que genera código C/C++ listo para compilar en
ESP32, Arduino UNO y ATmega328P. Sin dependencias ni build: HTML + CSS +
módulos ES nativos.

## Uso

La app usa módulos ES, así que necesita servirse por HTTP (no `file://`):

- VS Code: extensión **Live Server** (Go Live)
- O cualquier servidor estático: `python -m http.server` / `npx serve`
- O la página de GitHub Pages del proyecto

## Microcontroladores soportados

| Plantilla | Salida | Detalles |
|---|---|---|
| ESP32 | `.ino` | Framework Arduino, PWM por LEDC, light sleep |
| Arduino UNO | `.ino` | Framework Arduino, `tone()`, sleep IDLE |
| ATmega328P | `.c` | Bare-metal avr-gcc: PWM Timer1, millis Timer0, ISRs |

Todas comparten la misma API musical (`PLAY(nota, escala, duración)` /
`SILENCIO(duración)`), el tempo se integra como `#define BPM` y las tres
incluyen modo de bajo consumo (sleep) pensado para uso con baterías.

Para agregar un MCU nuevo: crear un archivo en `js/codegen/templates/`
con `{ id, label, extension, generate }` y registrarlo en
`js/codegen/registry.js`. El combobox de la UI se genera solo.

## Funciones

- Pentagrama interactivo con compases 2/4, 3/4, 4/4 y 6/8
- Rango de notas: SOL una octava abajo hasta RE dos octavas arriba (relativo a z2)
- Nota fantasma bajo el cursor y validación estricta de compás
- Reproducción con Web Audio (playhead animado, seguimiento de página)
- Generación de código en tiempo real con resaltado de sintaxis
- Sincronía partitura ↔ código (clic en una nota resalta su línea y viceversa)
- Código C adicional por MCU, inyectado en la plantilla y guardado con el proyecto
- Atajos de teclado (1-5 duraciones, R silencio, ↑↓ transponer, ←→ navegar, Espacio play)
- Exportar `.ino` / `.c`, MIDI (`.mid`) y proyecto (`.json`)
- Guardado automático en localStorage, tema claro/oscuro persistente

## Estructura

```
index.html
css/style.css
js/
  main.js          ← punto de entrada
  constants.js     ← datos musicales y constantes de dibujo
  music.js         ← alturas, accidentales, análisis de compases
  state.js         ← estado, historia (undo/redo), persistencia
  renderer.js      ← dibujo del pentagrama en canvas
  audio.js         ← reproducción Web Audio + playhead
  midi.js          ← exportación MIDI
  ui.js            ← eventos, atajos, panel de código, toasts
  codegen/
    registry.js    ← registro de plantillas por MCU
    common.js      ← utilidades compartidas de generación
    templates/     ← una plantilla por microcontrolador
```
