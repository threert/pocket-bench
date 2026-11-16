# The Units on the bench

Every Unit is a real M5Stack product on **Port A** (I2C). A Unit is modelled as the chips that answer on the bus
(`sidecar/src/chips`), at the level of the bytes of each transaction, plus a `UnitType` (`sidecar/src/units`) that
takes what the room does to it (`set(key, value)`) and reports what it does to the room (`state()`). A ready driver
for each is in `kit/drivers` (see its README); `datasheet` of each `UnitType` is the register-level text an agent
gets.

Sizes are M5Stack's product sizes (width along the cable, depth, height).

| id | Product | SKU | Address | Size (mm) | Inputs: `set(key, value)` | `state()` keys | Props that act on it |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `env3` | Unit ENV III | U001-C | 0x44 SHT30, 0x70 QMP6988 | 32 x 24 x 8 | `celsius` -10..60 °C; `humidity` 5..98 %RH; `pascals` 87000..108000 Pa | `celsius`, `humidity`, `pascals`: what the sensors see after their lag | A hair dryer or a kettle's steam for heat and humidity; an open window; a lift or a sealed jar for pressure |
| `sonic` | Unit Ultrasonic-I2C | U098-B1 | 0x57 RCWL-9620 | 56 x 24 x 15 | `millimetres` 20..4500 mm (more = no echo) | `millimetres` | A box or a hand moved in front of the two transducers |
| `rfid2` | Unit RFID 2 | U031-B | 0x28 WS1850S | 48 x 24 x 8 | `card`: `null`, or `{ uid: number[4 or 7], kind: "classic1k" \| "ultralight", blocks?: Record<number, number[]> }` | `card`: the card now, with every block that differs from a blank one; `writes`: blocks or pages written; `field`: antenna on | Cards and key fobs held over the reader (within 20 mm) |
| `angle8` | Unit 8Angle | U154 | 0x43 STM32 | 128 x 24 x 23 | `knobs`: number[8], each 0..1; `switch`: 0 \| 1 | `knobs`, `switch`; `leds`: [r, g, b][9], 0..255, what the firmware drives each SK6812 with (LED 8 is by the switch) | Fingers on the eight knobs and the toggle |
| `joystick2` | Unit Joystick2 | U024-V2 | 0x63 STM32 | 40 x 24 x 23.9 | `x`, `y`: -1..1; `button`: 0 \| 1 | `x`, `y`, `button`; `led`: [r, g, b] 0..255 | A thumb on the stick |
| `encoder` | Unit Encoder | U135 | 0x40 STM32 | 32 x 24 x 25.4 | `steps`: integer, detents turned in all, clockwise positive; `button`: 0 \| 1 | `steps`, `button`; `leds`: [r, g, b][2] 0..255 | Fingers turning and pressing the knob |
| `dlight` | Unit DLight | U136 | 0x23 BH1750FVI | 32 x 24 x 8 | `lux` 0..65535 lx | `lux` | The desk lamp, a torch, a hand's shadow, the room's daylight |
| `ncir` | Unit NCIR | U028 | 0x5A MLX90614 | 32 x 24 x 8.6 | `objectCelsius` -40..300 °C; `ambientCelsius` -10..60 °C | `objectCelsius`, `ambientCelsius` after their lag | A mug of hot water, an ice pack, a hand, the soldering iron in its 90° cone |
| `scales` | Unit Mini Scales | U177 | 0x26 STM32 + HX711 | 40 x 24 x 18 | `grams` 0..5000 g; `button`: 0 \| 1 | `grams` (after the pan settles), `button`; `led`: [r, g, b] 0..255 | Weights, a cup, coins put on the pan; a finger on the button |
| `relay4` | Unit 4-Relay | U097 | 0x26 STM32 | 112 x 23 x 18 | none | `relays`: boolean[4] (coil on); `leds`: boolean[4]; `sync`: LED-follows-relay mode | Nothing acts on it; its contacts switch the lamp, fan or pump wired to them |

`scales` and `relay4` share 0x26: the bench refuses the second one.

Common to all: the first value a key is given is where the world already was (no lag); later values are followed
with the lag stated below. `state()` returns the lagged truth, not the sensor's noisy reading. Noise is
deterministic, so two runs read alike. In the catalogue an input carries `kind` (`"switch"`, `"numbers"`, `"card"`;
a plain number when absent), `integer` for whole numbers, and its `default`.

## What "unverified" means here

Facts come from the part's datasheet, M5Stack's documentation, its Arduino and UiFlow libraries and, where
published, the Unit's firmware source. No real Unit was on a bus while this was written. Where the firmware's
behaviour could not be read from a source, the model says so below instead of guessing silently.

## STM32 Units and the STOP rule

M5Stack's own Units carry an STM32 that implements an I2C slave in firmware. Two generations exist
(`chips/stm32.ts`), and they matter to whoever writes a driver:

- **8Angle, Encoder (and, taken to be the same, 4-Relay)**: STM32F030 on the HAL's listen mode. The bytes of a
  write reach the firmware **when the transaction ends with STOP**; it then prepares a reply of a fixed length.
  M5Stack's libraries always send the register, STOP, then read. In the model a read after a **repeated START
  fails** (status `failed`), because the firmware source shows the register byte unprocessed and the slave not
  transmitting at that point. Unverified on hardware: whether the real Unit stretches the clock until the
  controller times out (what the HAL code suggests), and whether it then needs its power cycled. A PocketJS
  `read(register, ...)` step, and a `write` followed by a `receive` in one script, are repeated STARTs: use two
  scripts (`Device.select` of the kit).
- **Joystick2 (and, taken to be the same, Mini Scales)**: STM32G030 / F030 on an LL interrupt handler. The bytes
  are handed over at STOP or at the next address match, so both ways of reading work, as M5Stack's libraries for
  these two use a repeated START. The reply is a ring.
- Reading more bytes than the reply holds: the HAL generation returns 0xFF for the rest here (unverified); the LL
  generation starts over (from its source). A register the firmware does not know leaves the previous reply.
- Writing register 0xFF changes the Unit's I2C address in flash on the real Units. Not simulated: the address
  register reads back, a write to it is ignored. The bootloader (0xFD) is not simulated.

## Per Unit

### env3: ENV III (SHT30 + QMP6988)

Simulated: SHT30 single-shot commands with their conversion times (the read is not acknowledged until the
conversion is done), status, heater, soft reset, periodic mode, CRC-8 on every word; QMP6988 chip id, 25 OTP
bytes, forced and normal mode with conversion time by oversampling, raw words produced by inverting the
datasheet's compensation polynomials for one fixed set of coefficients. Temperature follows the air with a 5 s
time constant (8 s for the QMP6988, which reads 0.3 °C warmer), humidity 6 s, pressure 0.4 s. Not simulated: the
QMP6988's IIR filter (the register is stored), SHT30 alert limits and clock stretching, condensation.

### sonic: Ultrasonic I2C (RCWL-9620)

Simulated: the trigger byte 0x01, the echo's flight time (5.8 µs a millimetre there and back, plus the burst)
before the three-byte result is valid, noise of 0.2 % of the distance, the maximum reading beyond 4500 mm. A read
before the echo is back returns 0. Not simulated: the beam's width and angle to the target, soft or small targets
that return no echo, the blind zone below 20 mm (the model reports the distance it is given).

### rfid2: RFID 2 (WS1850S)

Simulated: the MFRC522 register set as drivers use it: 64-byte FIFO with overflow, Idle / CalcCRC / Transmit /
Transceive / MFAuthent / SoftReset, ComIrq and DivIrq with their set-and-clear writes, ErrorReg, the CRC
coprocessor with ModeReg's preset, TxCRCEn / RxCRCEn, the timer started by a transmission (TPrescaler, TReload),
the antenna drivers, MFCrypto1On, RxLastBits, frame times at 106 kbit/s. The card is a full ISO 14443-3A state
machine (IDLE / READY / ACTIVE / HALT, REQA, WUPA, anticollision with known UID bytes, SELECT through two cascade
levels, HLTA; a halted card answers WUPA only; a field cycle returns it to IDLE; it needs 5 ms of field first)
with MIFARE Classic 1K (key A / key B authentication per sector from the keys in the sector trailers, READ, the
two-part WRITE, read-only block 0, key A never readable) and MIFARE Ultralight (READ with roll-over, WRITE,
COMPATIBILITY WRITE, lock and OTP bits that only set). pocket-m5's Unit Swap driver and an Arduino-MFRC522-style
sequence run against it unmodified (`sidecar/test/units`). A card taken away and held over the reader again keeps
what was written while the Unit stays plugged; give `state().card.blocks` back as `blocks` to restore one later.

Not simulated: the Crypto1 cipher itself (the model tracks whether reader and card are in the same encrypted
session; frames are plaintext in the FIFO either way), Classic access bits beyond "an authenticated sector reads
and writes", value blocks (NAK), more than one card in the field (so never a collision), bit-oriented
anticollision frames, ISO 14443-4 and Type B, NTAG's extra commands, read range and antenna tuning, the IRQ pin.
Reset values are the MFRC522's. VersionReg reads 0x15, the value M5Stack's own library expects from the part
(M5Unit-RFID `unit_WS1850S.cpp`); the WS1850S has no public register-level datasheet, so any deviation of the
real part from the MFRC522 is not in the model.

### angle8: 8Angle

From the firmware source (m5stack/M5Unit-8Angle-Internal-FW, version 1): the 12-bit and 8-bit knob registers (one
value a read), the switch register (the pin's level), LED writes of four bytes R, G, B, brightness (0..100) driven
at `colour * brightness / 1000`, so the largest value in `leds` is 25, a tenth of full scale as on the real Unit;
single-byte LED writes that set one channel unscaled; bytes a short write did not carry taken from the previous
write, as the firmware's buffer leaves them. Knobs carry a count or two of ADC noise and a 10 ms lag.

Unverified: which way of a knob reads 0, and which switch position reads 1 (the model passes `knobs` and `switch`
straight through). The LED registers are write-only in firmware v1 although M5Stack's protocol sheet marks them
R/W. Not simulated: the firmware's automatic stretching of the ADC range to the largest value seen.

### joystick2: Joystick2

From the firmware source (m5stack/M5Unit-Joystick2-Internal-FW, version 1): raw 16-bit and 8-bit axis registers,
the calibrated int16 and int8 registers computed with the firmware's `map()` from the calibration words, the dead
band that makes rest exactly 0, the calibration registers (kept across a power cycle), the LED register (blue,
green, red, unused), button level (0 pressed), version and address registers, reads from inside a register group.
The model places full deflection at the ends of the default calibration, so `x = 1` reads 4095. Stick lag 8 ms,
noise about 14 of 65535 counts.

Unverified: which physical direction is +x and +y. Not simulated: the Hall sensor's non-linearity and the
circular limit of a real stick (the model lets x and y both reach 1).

### encoder: Encoder

From the disassembly of M5UnitEncoder_Firmware v1.1 (no source is published): mode 0 reads a timer in quadrature
mode (four counts a cycle of the two signals), mode 1 counts rising edges of one signal upwards only; the counter
register is readable and writable; 0x40 zeroes it; a mode change zeroes it; the switch register is the pin's
level (0 pressed; M5Stack's protocol PDF says the opposite, its example and UiFlow library agree with the
firmware); LED index 1 or 2 addresses one LED and any other index both.

Unverified: counts a detent. The knob has 30 detents a turn; the model takes 15 signal cycles a turn, the usual
part, which makes **2 counts a detent** in mode 0. If the real knob gives 30 cycles a turn it is 4. Also
unverified: that clockwise counts up. Not simulated: contact bounce and missed counts when turned fast.

### dlight: DLight (BH1750FVI)

Simulated from the datasheet: power down / power on / reset, continuous and one-time modes in high resolution
(1 lx, 120 ms), high resolution 2 (0.5 lx) and low resolution (4 lx, 16 ms), the measurement-time register
(31..254) scaling both time and sensitivity, one-time modes returning to power-down with the result kept, the data
register reading 0 until the first conversion ends, saturation at 65535 counts (54612 lx in the default mode),
0.4 % noise. Conversions take the typical 120 ms / 16 ms; a driver should wait the maximum, 180 ms / 24 ms.
Not simulated: spectral response, the angle of the light, flicker of mains lamps. `lux` above 54612 saturates
unless the driver shortens the measurement time.

### ncir: NCIR (MLX90614)

Simulated: SMBus read word with PEC for RAM (0x06 ambient, 0x07 object) and EEPROM cells; a STOP between the
command and the read ends the transaction (the read then returns 0xFF bytes: unverified what the real part sends);
EEPROM writes with PEC (kept across power cycles); the sleep command, after which the part is silent until its
supply cycles; 0.02 K resolution; object lag 0.12 s, package lag 3 s. Not simulated: emissivity (the EEPROM cell
is stored but the reading is the surface temperature it is given), the field of view (the room decides what fills
the cone and sets `objectCelsius`), the PWM output, the dependence of the object reading on the package's own
temperature gradient, the erase-before-write rule of the EEPROM, the 0.25 s after power-on before data is valid.

### scales: Mini Scales

Register map from M5Stack's protocol sheet (v3) and libraries; **the firmware is not published**. Simulated: raw
HX711 counts (a 1 mV/V, 5 kg cell at gain 128: 429.5 counts a gram, on a zero of 87300), sampled 80 times a
second, weight as float, as integer x100 and as text, gap (kept across power cycles) and offset, tare by writing 1
to 0x50, button level (0 pressed), LED, filter registers, version and address. The pan settles with a 0.1 s time
constant (95 % in 0.3 s); noise is a few hundredths of a gram and shrinks with the averaging and EMA settings.
Negative weights are reported (firmware v4 behaviour; the version register reads 4).

Unverified: that the offset is taken at power-on (the older Unit Scales firmware does; the model does, so a load
on the pan when the Unit powers up reads 0); whether the button tares by itself in the firmware (in the model it
only reads; the app tares); the format of the text register (the model uses two decimals); the HX711's rate; the
filters' real step response (their registers only scale the noise); the factory gap. The I2C slave is taken to be
the Joystick2's generation because M5Stack's libraries read this Unit after a repeated START.

### relay4: 4-Relay

Register map from M5Stack's documentation and libraries; **the firmware is not published**. Simulated: mode
register 0x10 (bit 0: LEDs follow the relays), control register 0x11 (relays in bits 0..3, LEDs in bits 4..7),
read-back of both, power-on state all off in manual mode. `leds` in `state()` are the relays in sync mode and the
LED bits otherwise.

Unverified: bit order. M5Stack's Arduino and UiFlow libraries put relay 1 in bit 0 and LED 1 in bit 4 (the model
follows them); the table in M5Stack's documentation lists them the other way round. Also unverified: what the LED
bits read back in sync mode (the model returns what was written), the I2C slave generation (taken to be the
8Angle's, the STM32F030 firmware of that time), the power-on mode. Not simulated: the relays' operate time
(about 10 ms), contact bounce, the load on the contacts.
