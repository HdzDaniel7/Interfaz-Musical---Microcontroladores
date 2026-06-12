/* ============================================================
   codegen/common.js — Utilidades compartidas por las plantillas
   ============================================================ */

import { resolvePitch, computeTieChains } from '../music.js';

// Marcadores invisibles para sincronizar nota ↔ línea de código
// en el panel (se eliminan antes de copiar/exportar).
export const MARK_OPEN  = '\x01'; // \x01<noteIdx>\x02 … código … \x03
export const MARK_SEP   = '\x02';
export const MARK_CLOSE = '\x03';

export function stripMarkers(code) {
  return code.replace(/\x01\d+\x02/g, '').replace(/\x03/g, '');
}

// ── Expresión de duración (con puntillo o tresillo si aplica) ─
export function durExpr(n) {
  if (n.triplet) return n.dotted ? n.dur : `(${n.dur} * 2 / 3)`;
  return n.dotted ? `(${n.dur} * 3 / 2)` : n.dur;
}

// ── Una nota → línea(s) de código C ───────────────────────────
// durOverride: duración combinada de una cadena de ligadura.
// legato: omite el silencio de articulación hacia la siguiente.
export function noteToCode(n, indent, { durOverride = null, legato = false } = {}) {
  if (n.rest) return `${indent}SILENCIO(${durExpr(n)});`;

  const { enumName, octave } = resolvePitch(n.note, n.accidental);
  const offStr = octave === 0 ? '0' : octave > 0 ? `+${octave}` : String(octave);
  const dur    = durOverride || durExpr(n);

  // ART: silencio corto de articulación entre notas consecutivas
  const art = legato ? '' : `\n${indent}SILENCIO(ART);`;
  return `${indent}PLAY(${enumName}, ${offStr}, ${dur});${art}`;
}

// ── Cuerpo del loop agrupado por compases ─────────────────────
// Los rangos en `repeats` ([{from, to, times}]) se envuelven en un
// bucle for: las notas se escriben una sola vez y suenan ×N veces
// (ahorra memoria flash en el microcontrolador).
export function buildLoopBody(notes, measures, { markers = false, indent = '\t\t', repeats = [] } = {}) {
  if (!measures.length) return `${indent}// Agrega notas en el pentagrama...`;

  // Ligaduras: las notas absorbidas por una cadena no se emiten;
  // la cabeza suena con la duración sumada.
  const { chains, consumed, legato } = computeTieChains(notes);

  const measureBlock = (mi, ind) => {
    const m = measures[mi];
    const lines = [];
    for (let i = m.startIdx; i < m.endIdx; i++) {
      if (consumed.has(i)) continue;
      const members = chains.get(i);
      const durOverride = members
        ? `(${members.map(k => durExpr(notes[k])).join(' + ')})`
        : null;
      const tail = members ? members[members.length - 1] : i;
      let code = noteToCode(notes[i], ind, { durOverride, legato: legato.has(tail) });
      if (markers) code = `${MARK_OPEN}${i}${MARK_SEP}${code}${MARK_CLOSE}`;
      lines.push(code);
    }
    if (!lines.length) return `${ind}// — Compás ${mi + 1} (ligado al anterior) —`;
    return `${ind}// — Compás ${mi + 1} —\n${lines.join('\n')}`;
  };

  const blocks = [];
  let mi = 0, repN = 0;
  while (mi < measures.length) {
    const rep = repeats.find(r => r.from === mi);
    if (rep) {
      repN++;
      const inner = [];
      for (let m = rep.from; m <= rep.to; m++) inner.push(measureBlock(m, indent + '\t'));
      blocks.push(
        `${indent}// ═══ Repetición ×${rep.times} (compases ${rep.from + 1}–${rep.to + 1}) ═══\n` +
        `${indent}for (uint8_t rep${repN} = 0; rep${repN} < ${rep.times}; rep${repN}++) {\n` +
        `${inner.join('\n\n')}\n${indent}}`
      );
      mi = rep.to + 1;
    } else {
      blocks.push(measureBlock(mi, indent));
      mi++;
    }
  }

  return blocks.join('\n\n');
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
