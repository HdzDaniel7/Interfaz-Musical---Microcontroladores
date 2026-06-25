# Firmware "en vivo" para ATmega328P (bare-metal)

Programa C **fijo** (avr-gcc, sin framework Arduino) que convierte al ATmega328P en un intérprete
controlado por la app: escucha el USART y toca, una a una, las figuras que el Editor Musical envía
en modo **En vivo / Ambos**. Se flashea **una sola vez**.

> Es distinto al `.c` que la app **exporta** (ese lleva la canción incrustada y la toca solo).

## Requisitos de hardware

- **Cristal externo de 16 MHz** (el USART a 115200 no es fiable con el oscilador interno de 8 MHz).
- **Adaptador USB-Serie** (FTDI / CP2102 / CH340): `RX → PD0`, `TX → PD1`, `GND` común.
- **Buzzer en PB1** (OC1A), igual que la plantilla `atmega328p` del editor.

> Si prefieres no cablear un adaptador ni poner cristal, usa una placa **Arduino UNO** (que ya es
> un ATmega328P con USB-serie y cristal) con el firmware `arduino-uno-live`.

## Compilar y flashear (avr-gcc + avrdude)

```bash
avr-gcc -mmcu=atmega328p -DF_CPU=16000000UL -Os -o atmega328p-live.elf atmega328p-live.c
avr-objcopy -O ihex -R .eeprom atmega328p-live.elf atmega328p-live.hex
# Ajusta -c y -P a tu programador/puerto:
avrdude -c arduino -p m328p -P COM3 -b 115200 -U flash:w:atmega328p-live.hex:i
```

Asegúrate de tener los **fuses** para cristal externo de 16 MHz.

## Uso

En la app (Chrome/Edge): **Conectar** → elige el puerto del adaptador → Salida **En vivo** o
**Ambos** → **Reproducir**.

## Protocolo serial (115200 baud, líneas `\n`)

| Dir | Mensaje | Significado |
|-----|---------|-------------|
| PC → MCU | `H` | handshake → responde `OK` |
| PC → MCU | `T<freq>,<ms>` | toca `freq` Hz durante `ms` ms → responde `D` |
| PC → MCU | `S<ms>` | silencio de `ms` ms → responde `D` |
| PC → MCU | `X` | paro inmediato (corta aun a media nota) |
| MCU → PC | `B` / `OK` / `D` | boot / handshake ok / figura terminada |
