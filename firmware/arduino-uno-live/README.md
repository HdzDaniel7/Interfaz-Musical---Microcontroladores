# Firmware "en vivo" para Arduino UNO

Sketch **fijo** que convierte al Arduino UNO en un intérprete controlado por la app: escucha el
puerto USB y toca, una a una, las figuras que el Editor Musical envía en modo **En vivo / Ambos**.
Se flashea **una sola vez**; luego puedes tocar cualquier canción sin recompilar.

> Es distinto al `.ino` que la app **exporta** (ese lleva la canción incrustada y la toca solo).
> No lo reemplaza, lo complementa.

## Flasheo (una vez)

1. Conecta el Arduino UNO por USB.
2. Abre `arduino-uno-live.ino` en el **IDE de Arduino**.
3. Placa: **Arduino UNO**. Selecciona el puerto COM.
4. Pulsa **Subir**.
5. Buzzer en el **pin 8** (mismo pin que la plantilla `arduino-uno` del editor).

## Uso

En la app (Chrome/Edge): **Conectar** → elige el puerto → Salida **En vivo** o **Ambos** →
**Reproducir**.

## Protocolo serial (115200 baud, líneas `\n`)

| Dir | Mensaje | Significado |
|-----|---------|-------------|
| PC → UNO | `H` | handshake → responde `OK` |
| PC → UNO | `T<freq>,<ms>` | toca `freq` Hz durante `ms` ms → responde `D` |
| PC → UNO | `S<ms>` | silencio de `ms` ms → responde `D` |
| PC → UNO | `X` | paro inmediato (corta aun a media nota) |
| UNO → PC | `B` / `OK` / `D` | boot / handshake ok / figura terminada |
