/* ============================================================
   serial.js — Reproducción en vivo por USB (Web Serial API)
   Envía la partitura, figura por figura, a un ESP32 con el
   firmware firmware/esp32-live. Protocolo (115200 baud, '\n'):
     PC → ESP32:  H · T<freq>,<ms> · S<ms> · X
     ESP32 → PC:  B · OK · D
   La PC manda una figura y espera el 'D' (done) antes de la
   siguiente: control de flujo simple, sin solapamientos.
   ============================================================ */

import { state } from './state.js';
import { buildSchedule } from './music.js';

let port           = null;
let reader         = null;
let writer         = null;
let readableClosed = null;
let writableClosed = null;
let connected      = false;

let serialPlaying  = false;
let stopFlag       = false;

let statusCb       = null;   // notifica cambios de conexión a la UI
let ackResolvers   = [];     // promesas esperando un 'D' del ESP32

// ── Soporte y estado ──────────────────────────────────────────
export function isSerialSupported() { return 'serial' in navigator; }
export function isSerialConnected() { return connected; }
export function isSerialPlaying()   { return serialPlaying; }
export function onSerialStatus(cb)  { statusCb = cb; }

function notify() { if (statusCb) statusCb({ connected, playing: serialPlaying }); }

// ── Conexión ──────────────────────────────────────────────────
export async function serialConnect() {
  if (!isSerialSupported()) {
    throw new Error('Web Serial no está disponible (usa Chrome o Edge sobre https/localhost)');
  }
  if (connected) return true;

  port = await navigator.serial.requestPort();      // requiere gesto del usuario
  await port.open({ baudRate: 115200 });

  // Lectura: bytes → texto → líneas
  const decoder  = new TextDecoderStream();
  readableClosed = port.readable.pipeTo(decoder.writable).catch(() => {});
  reader         = decoder.readable.getReader();

  // Escritura: texto → bytes
  const encoder  = new TextEncoderStream();
  writableClosed = encoder.readable.pipeTo(port.writable).catch(() => {});
  writer         = encoder.writable.getWriter();

  connected = true;
  readLoop();                 // no se espera: corre en segundo plano
  navigator.serial.addEventListener('disconnect', onPhysicalDisconnect);

  try { await send('H\n'); } catch (e) { /* handshake opcional */ }
  notify();
  return true;
}

export async function serialDisconnect() {
  serialStop();
  connected = false;
  try { navigator.serial.removeEventListener('disconnect', onPhysicalDisconnect); } catch (e) {}
  try { await writer?.close(); }   catch (e) {}
  try { await writableClosed; }    catch (e) {}
  try { await reader?.cancel(); }  catch (e) {}
  try { await readableClosed; }    catch (e) {}
  try { await port?.close(); }     catch (e) {}
  port = reader = writer = readableClosed = writableClosed = null;
  notify();
}

// Desconexión física (cable retirado / placa reiniciada)
function onPhysicalDisconnect(e) {
  if (e.target !== port) return;
  connected = false;
  stopFlag = true;
  ackResolvers.forEach(r => r(false));
  ackResolvers = [];
  serialPlaying = false;
  port = reader = writer = null;
  notify();
}

// ── Lectura de líneas del ESP32 ───────────────────────────────
async function readLoop() {
  let buf = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '').trim();
        buf = buf.slice(nl + 1);
        if (line) handleLine(line);
      }
    }
  } catch (e) { /* puerto cerrado */ }
}

function handleLine(line) {
  // 'D' = figura terminada → libera la espera de la nota en curso
  if (line === 'D' && ackResolvers.length) ackResolvers.shift()(true);
}

// ── Escritura ─────────────────────────────────────────────────
async function send(str) {
  if (!writer) return;
  try { await writer.write(str); } catch (e) { /* desconectado */ }
}

// Espera el 'D' de la figura en curso, con red de seguridad por
// si el acuse se pierde: pasado el timeout, continúa igual.
function waitAck(timeoutMs) {
  return new Promise(resolve => {
    const done = ok => { clearTimeout(timer); resolve(ok); };
    ackResolvers.push(done);
    const timer = setTimeout(() => {
      const i = ackResolvers.indexOf(done);
      if (i >= 0) ackResolvers.splice(i, 1);
      resolve(false);
    }, timeoutMs);
  });
}

// ── Reproducción en vivo ──────────────────────────────────────
// Recorre la misma agenda que Web Audio y la envía figura a figura.
// onNote(idx) permite a la UI animar la nota activa (-1 al terminar).
//
// H1 (pipeline de 1 evento): la figura N+1 se manda de inmediato,
// SIN esperar el 'D' de la figura N — así, cuando el firmware termina
// de sonar N, la N+1 ya está en su buffer de entrada lista para tocar
// sin pagar otra ida y vuelta USB (el firmware ya la deja en cola en
// vez de descartarla). El orden de los 'D' sigue siendo 1:1 con el
// orden de envío, así que waitAck() (FIFO) no necesita cambios.
export async function serialPlay(fromIdx = 0, { onNote = null } = {}) {
  if (!connected || serialPlaying) return;

  const events  = buildSchedule(fromIdx);
  if (!events.length) return;
  const beatSec = 60 / (state.bpm || 120);

  const cmds = events.map(ev => {
    const ms = Math.max(1, Math.round(ev.durBeats * beatSec * 1000));
    return { ms, str: ev.rest ? `S${ms}\n` : `T${Math.round(ev.freq)},${ms}\n` };
  });

  serialPlaying = true;
  stopFlag      = false;
  notify();

  if (onNote) onNote(events[0].idx);
  await send(cmds[0].str);

  for (let i = 0; i < events.length && !stopFlag; i++) {
    if (i + 1 < events.length) await send(cmds[i + 1].str); // adelanta la siguiente
    await waitAck(cmds[i].ms + 500);   // espera el 'D' de la actual (o el timeout)
    if (stopFlag) break;
    if (i + 1 < events.length && onNote) onNote(events[i + 1].idx);
  }

  serialPlaying = false;
  if (onNote) onNote(-1);
  notify();
}

export function serialStop() {
  if (!serialPlaying && !ackResolvers.length) return;
  stopFlag = true;
  ackResolvers.forEach(r => r(false));   // libera la espera en curso
  ackResolvers = [];
  serialPlaying = false;
  send('X\n');                            // corta la nota en el ESP32
  notify();
}
