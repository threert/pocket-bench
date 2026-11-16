// 倒车雷达: Ultrasonic. Distance bars with colour zones and a "太近了" warning
// under 10 cm; the yellow target block is slid in front of the Unit.
import type { Check, LessonDef } from "../../../sidecar/src/lessons/types.ts";

/** The distance on the screen in centimetres, millimetres or metres. */
const SHOWS_DISTANCE = (tolerance: number): Check => ({
  any: [
    { shows: "sonic.millimetres", scale: 0.1, tolerance },
    { shows: "sonic.millimetres", tolerance: tolerance * 10 },
    { shows: "sonic.millimetres", scale: 0.001, tolerance: tolerance / 100 },
  ],
});

export default {
  id: "radar", number: 3, title: "倒车雷达", units: ["sonic"], minutes: 10, level: 1,
  tagline: "用超声波量距离：越近越红，太近了就喊停。",
  story: "超声波模块像只小蝙蝠：喊一声，听回声，就知道前面的东西有多远。拿它给 Tab5 装一套倒车雷达，再用黄色方块当『车屁股』试一试。",
  steps: [
    {
      id: "plug",
      text: "把『超声波』模块接到 Tab5 上",
      hint: "点一下盒子里的『超声波』模块，它会自己飞到底座上，两只圆圆的『眼睛』朝着桌子另一头。",
      check: { plugged: "sonic" },
    },
    {
      id: "app",
      text: "请 AI 做一个倒车雷达界面",
      hint: "点下面这句现成的话，或者用你自己的话描述。",
      prompt: "做一个倒车雷达：读取超声波模块，用大数字显示距离（厘米），再画一排由远到近的距离条：远的时候是绿色，50 厘米以内变黄，20 厘米以内变红。",
      check: { all: [{ changed: true }, { running: true }, SHOWS_DISTANCE(1.5)] },
    },
    {
      id: "near",
      text: "把黄色方块慢慢推近模块，停在 30 厘米以内",
      hint: "按住桌上的黄色方块拖动它。屏幕上的数字和颜色应该一路跟着变。",
      check: { all: [{ running: true }, { input: "sonic.millimetres", lt: 300 }, SHOWS_DISTANCE(2)] },
    },
    {
      id: "warn",
      text: "让 AI 加上『太近了』警告，再把方块推到 10 厘米以内",
      hint: "先让 AI 改好，再接着往前推。贴得够近，屏幕就该急了。",
      prompt: "距离小于 10 厘米的时候，把整个屏幕变成红色，并用大字显示「太近了」；退回 10 厘米以外就恢复正常。",
      check: { all: [{ running: true }, { input: "sonic.millimetres", lt: 100 }, { text: "太近了" }] },
    },
    {
      id: "back",
      text: "把方块拉回 50 厘米以外，警告应该自己消失",
      hint: "往回拖方块。数字变大，颜色变绿，『太近了』也该收起来了。",
      check: { all: [{ running: true }, { input: "sonic.millimetres", gt: 500, withinSeconds: 0 }, { not: { text: "太近了" } }] },
    },
  ],
  prompts: [
    "距离越近，让屏幕上的提示闪得越快。",
    "记下这次倒车的最近距离，再加一个「重置」按钮。",
    "加一个开关，让单位在厘米和英寸之间切换。",
  ],
} satisfies LessonDef;
