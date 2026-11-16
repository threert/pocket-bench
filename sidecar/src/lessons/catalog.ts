// The ten lessons, in the order the app shows them. Each is the default
// export of kit/lessons/<id>/lesson.ts.
import hello from "../../../kit/lessons/hello/lesson.ts";
import weather from "../../../kit/lessons/weather/lesson.ts";
import radar from "../../../kit/lessons/radar/lesson.ts";
import mixer from "../../../kit/lessons/mixer/lesson.ts";
import door from "../../../kit/lessons/door/lesson.ts";
import lamp from "../../../kit/lessons/lamp/lesson.ts";
import scale from "../../../kit/lessons/scale/lesson.ts";
import game from "../../../kit/lessons/game/lesson.ts";
import thermo from "../../../kit/lessons/thermo/lesson.ts";
import timer from "../../../kit/lessons/timer/lesson.ts";
import type { LessonDef } from "./types.ts";

export const LESSONS: LessonDef[] = [hello, weather, radar, mixer, door, lamp, scale, game, thermo, timer];
