// 摇杆小游戏: Joystick2. A tiny catch game on the Tab5, a score, the Unit's LED flashes on a catch.
import type { LessonDef } from "../../../sidecar/src/lessons/types.ts";

/** The score as "得分：3" (or 分数, SCORE), read as the number right after the word. */
const SCORE = (digits: string) => `(?:得分|分数|score)[^0-9]{0,4}${digits}(?![0-9])`;

export default {
  id: "game", number: 8, title: "摇杆小游戏", units: ["joystick2"], minutes: 15, level: 3,
  tagline: "接上摇杆，让 AI 现场给你做一款小游戏。",
  story: "Joystick2 是个能上下左右推、还能按下去的小摇杆，肚子里藏着一颗彩灯。有了它，Tab5 就是一台掌机——游戏嘛，让 AI 现做一个。",
  steps: [
    {
      id: "plug",
      text: "把『摇杆』模块接到 Tab5 上",
      hint: "点一下盒子里的『摇杆』模块（Joystick2），它会自己飞到底座上并接好线。",
      check: { plugged: "joystick2" },
    },
    {
      id: "app",
      text: "请 AI 做一个『接星星』小游戏",
      hint: "点下面这句现成的话。游戏比前面几课的界面复杂一些，AI 可能要多写一会儿。",
      prompt: "做一个接星星小游戏：屏幕下方有一个小托盘，用摇杆左右移动；星星从上面掉下来，接到一颗加 1 分，漏掉 3 颗游戏结束。左上角显示「得分：N」，右上角显示还剩几条命；游戏结束后显示「游戏结束」，按下摇杆重新开始。",
      check: { all: [{ changed: true }, { running: true }, { text: SCORE("[0-9]+") }] },
    },
    {
      id: "play",
      text: "推动摇杆，接住至少 3 颗星星",
      hint: "按住摇杆帽往左右拖，托盘就跟着跑。松手它会自己弹回中间。",
      check: { all: [{ running: true }, { text: SCORE("(?:[3-9]|[1-9][0-9]+)") }] },
    },
    {
      id: "flash",
      text: "让 AI 把摇杆上的小灯也用起来，再去接一颗星星",
      hint: "先让 AI 改好再玩。接到星星的那一下，留意摇杆底下闪没闪绿光。",
      prompt: "接到星星的时候让摇杆上的 LED 闪一下绿色，漏掉的时候闪一下红色，平时不亮。",
      check: { all: [{ running: true }, { output: "joystick2.led", dominant: "g" }] },
    },
  ],
  prompts: [
    "星星越掉越快：每得 5 分提一次速。",
    "加一种要躲开的「炸弹」，碰到就扣一条命。",
    "把最高分记下来，显示在屏幕上。",
  ],
} satisfies LessonDef;
