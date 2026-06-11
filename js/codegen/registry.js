/* ============================================================
   codegen/registry.js — Registro de plantillas por MCU
   Para agregar un microcontrolador nuevo: crear su archivo en
   templates/ con { id, label, extension, generate } e importarlo
   aquí. El combobox de la UI se genera solo a partir de esta lista.
   ============================================================ */

import esp32      from './templates/esp32.js';
import arduinoUno from './templates/arduino-uno.js';
import atmega328p from './templates/atmega328p.js';

import { state } from '../state.js';
import { analyzeMeasures } from '../music.js';
import { stripMarkers, safeFileName } from './common.js';

export const TEMPLATES = [esp32, arduinoUno, atmega328p];

export function getTemplate(id) {
  return TEMPLATES.find(t => t.id === id) || TEMPLATES[0];
}

// ── Generación a partir del estado actual ─────────────────────
// markers=true inserta marcadores invisibles para que el panel
// pueda resaltar la línea de la nota seleccionada.
export function generateCode({ markers = false } = {}) {
  const tpl = getTemplate(state.mcu);
  const code = tpl.generate({
    title:         state.title,
    z2:            state.z2,
    bpm:           state.bpm,
    timeSignature: state.timeSignature,
    notes:         state.notes,
    measures:      analyzeMeasures(),
    extraCode:     state.extraCode[tpl.id] || '',
    markers,
  });
  return markers ? code : stripMarkers(code);
}

export function currentFileName() {
  const tpl = getTemplate(state.mcu);
  return safeFileName(state.title) + tpl.extension;
}
