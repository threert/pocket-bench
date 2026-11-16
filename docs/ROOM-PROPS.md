# What the room does to the Units

The room (`room/world.ts`) sets a plugged Unit's inputs from what the user does. Lessons and their playthroughs
assume these values.

| Unit | Input | What sets it in the room |
| --- | --- | --- |
| env3 | `celsius` | 24.6 at rest; the heat gun switched on within 36 cm raises the target up to +27 (51.6 right next to it); the sensor follows over seconds |
| env3 | `humidity` | 48 at rest; the mist sprayer (one click sprays for 2.5 s) within 40 cm raises it by up to 38; the heat gun lowers it by up to 22; clamped 8..96 |
| sonic | `millimetres` | Distance from the Unit's face along +Z (toward the viewer) to the nearest prop in front of it; 3584 (the far wall) when nothing is. The yellow block is the usual target: the user slides it between 20 and about 180 mm |
| ncir | `objectCelsius` | The temperature of the nearest prop in front of the Unit's face: the coffee mug 62, the heat gun 86 when on (31 off), anything else 24.6; 24.6 when nothing is there. `ambientCelsius` is 25.8 |
| dlight | `lux` | 582 with the room's lights on, 12 with them off (the wall switch, key L); the desk lamp adds 22 |
| rfid2 | `card` | `null`, or the card resting on the reader: 员工卡 `{uid:[0x04,0xA3,0x1B,0x7C], kind:"classic1k"}`, 访客卡 `{uid:[0x9E,0x12,0x55,0x0D], kind:"classic1k"}`, 钥匙扣 `{uid:[0x04,0x5F,0x2A,0x91,0x6C,0x33,0x80], kind:"ultralight"}` |
| scales | `grams` | The sum of what rests on the pan: weights 50, 100, 200; the mug 310; the block 85; a card 6; the fob 4 |
| scales | `button` | 1 for 0.18 s when the tare button is clicked |
| angle8 | `knobs` | Eight values 0..1; a knob follows a drag (a full sweep is about a third of the window). `switch` 0 or 1, toggled by a click |
| joystick2 | `x`, `y` | -1..1 while the stick is held and dragged (right and away from the user are positive), 0 when let go. `button` 1 for 0.18 s on a click |
| encoder | `steps` | Integer detents, changed by dragging the knob (about 60 across the window). `button` 1 for 0.18 s on a click |
| tab5 | `accel`, `gyro` | Gravity in the board's axes in g (at rest on its stand `[0, 0.97, 0.242]`), and degrees a second, while the user drags the Tab5's body to lean it (roll up to ±57°, pitch -40°..+52°); it springs back when let go |

Relay channels (4-Relay `relays[0..3]`): CH1 the desk lamp, CH2 the fan, CH3 the "ON AIR" sign, CH4 the amber
beacon. A click on a load switches it by hand; it is on when the relay and the hand disagree (a two-way switch).
