/* ============================================================
   codegen/common.js — Utilidades compartidas por las plantillas
   ============================================================ */

import { resolvePitch } from '../music.js';

// Marcadores invisibles para sincronizar nota ↔ línea de código
// en el panel (se eliminan antes de copiar/exportar).
export const MARK_OPEN  = '\x01'; // \x01<noteIdx>\x02 … código … \x03
export const MARK_SEP   = '\x02';
export const MARK_CLOSE = '\x03';

export function stripMarkers(code) {
  return code.replace(/\x01\d+\x02/g, '').replace(/\x03/g, '');
}

// ── Expresión de duración (con puntillo si aplica) ────────────
export function durExpr(n) {
  return n.dotted ? `(${n.dur} * 3 / 2)` : n.dur;
}

// ── Una nota → línea(s) de código C ───────────────────────────
export function noteToCode(n, indent) {
  if (n.rest) return `${indent}SILENCIO(${durExpr(n)});`;

  const { enumName, octave } = resolvePitch(n.note, n.accidental);
  const offStr = octave === 0 ? '0' : octave > 0 ? `+${octave}` : String(octave);

  // ART: silencio corto de articulación entre notas consecutivas
  return `${indent}PLAY(${enumName}, ${offStr}, ${durExpr(n)});\n${indent}SILENCIO(ART);`;
}

// ── Cuerpo del loop agrupado por compases ─────────────────────
export function buildLoopBody(notes, measures, { markers = false, indent = '\t\t' } = {}) {
  if (!measures.length) return `${indent}// Agrega notas en el pentagrama...`;

  return measures.map((m, idx) => {
    const lines = [];
    for (let i = m.startIdx; i < m.endIdx; i++) {
      let code = noteToCode(notes[i], indent);
      if (markers) code = `${MARK_OPEN}${i}${MARK_SEP}${code}${MARK_CLOSE}`;
      lines.push(code);
    }
    return `${indent}// — Compás ${idx + 1} —\n${lines.join('\n')}`;
  }).join('\n\n');
}

// ── Macros de tiempo derivadas del BPM ────────────────────────
// El tempo elegido en el editor queda integrado en el firmware:
//   T (negra) = 60000 / BPM milisegundos.
export function durationDefines(bpm) {
  return `#define BPM ${bpm}
#define T   (60000UL / BPM)   /* negra        */
#define TT  (T * 4)           /* redonda      */
#define DT  (T * 2)           /* blanca       */
#define MT  (T / 2)           /* corchea      */
#define CT  (T / 4)           /* semicorchea  */
#define ART 20                /* articulación entre notas (ms) */`;
}

// ── Sección de código adicional del usuario ───────────────────
export function userCodeSection(extraCode) {
  const trimmed = (extraCode || '').trim();
  if (!trimmed) return '';
  return `
/* ============ CÓDIGO ADICIONAL DEL USUARIO ================== */
${trimmed}
`;
}

// ── Nombre de archivo seguro ──────────────────────────────────
export function safeFileName(title) {
  return (title || 'Mi_Cancion').trim().replace(/\s+/g, '_') || 'Mi_Cancion';
}
