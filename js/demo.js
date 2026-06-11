/* ============================================================
   demo.js — Canción de ejemplo: Himno de la Alegría (Beethoven)
   8 compases en 4/4. Se carga con el botón ✨ de la toolbar.
   ============================================================ */

const N = (note, dur, dotted = false) =>
  ({ note, dur, dotted, rest: false, accidental: 'none' });

export const DEMO_PROJECT = {
  version: 2,
  title: 'Himno_de_la_Alegria',
  z2: 5,
  bpm: 130,
  mcu: 'esp32',
  timeSignature: { num: 4, den: 4 },
  extraCode: {},
  notes: [
    // Compás 1
    N('MI', 'T'), N('MI', 'T'), N('FA', 'T'), N('SOL', 'T'),
    // Compás 2
    N('SOL', 'T'), N('FA', 'T'), N('MI', 'T'), N('RE', 'T'),
    // Compás 3
    N('DO', 'T'), N('DO', 'T'), N('RE', 'T'), N('MI', 'T'),
    // Compás 4
    N('MI', 'T', true), N('RE', 'MT'), N('RE', 'DT'),
    // Compás 5
    N('MI', 'T'), N('MI', 'T'), N('FA', 'T'), N('SOL', 'T'),
    // Compás 6
    N('SOL', 'T'), N('FA', 'T'), N('MI', 'T'), N('RE', 'T'),
    // Compás 7
    N('DO', 'T'), N('DO', 'T'), N('RE', 'T'), N('MI', 'T'),
    // Compás 8
    N('RE', 'T', true), N('DO', 'MT'), N('DO', 'DT'),
  ],
};
