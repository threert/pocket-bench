// 厨房秤: Mini Scales. Weight with tare (the Unit's button and one on the
// screen) and a target-weight game. Props: brass weights 50, 100 and 200 g, a 310 g mug.
import type { LessonDef } from "../../../sidecar/src/lessons/types.ts";

/** A reading in grams, as a scale writes it: "0.0 g", "-0.1克", or the bare number. */
const GRAMS = "(-?[0-9]+(?:\\.[0-9]+)?)\\s*(?:g|克)?";

export default {
  id: "scale", number: 7, title: "厨房秤", units: ["scales"], minutes: 10, level: 2,
  tagline: "称一称、去个皮，再玩一把『凑重量』。",
  story: "Mini Scales 里有一片会『弯腰』的金属：压得越重，弯得越多。给它配上屏幕就是一台厨房秤，还能拿桌上的砝码玩凑数游戏。",
  steps: [
    {
      id: "plug",
      text: "把『迷你秤』模块接到 Tab5 上",
      hint: "点一下盒子里的『迷你秤』模块（Mini Scales），它会自己飞到底座上，秤盘朝上。",
      check: { plugged: "scales" },
    },
    {
      id: "weigh",
      text: "请 AI 做一台厨房秤，再放一个 100 克的砝码上去",
      hint: "等 AI 写完，把中间那个 100 克的黄铜砝码拖到秤盘上。读数应该稳稳停在 100 左右。",
      prompt: "做一台厨房秤：读取 Mini Scales 模块，用大数字显示重量（克，保留一位小数），下面放一个「去皮」按钮，点一下就把当前读数归零；按模块自己的按钮也一样去皮。",
      check: { all: [{ changed: true }, { running: true }, { input: "scales.grams", between: [95, 105] }, { shows: "scales.grams", tolerance: 2 }] },
    },
    {
      id: "tare",
      text: "换咖啡杯上去，点『去皮』，让读数回到 0",
      hint: "先拿走砝码，把咖啡杯放上秤盘（它有 310 克）。再点屏幕上的『去皮』，或者按一下模块侧面的小按钮。",
      check: { all: [{ running: true }, { input: "scales.grams", gt: 250 }, { shows: 0, tolerance: 1.5, pattern: GRAMS }] },
    },
    {
      id: "game",
      text: "让 AI 加上『凑出 250 g』小游戏，再用砝码把它凑出来",
      hint: "先拿走杯子，空盘去一次皮。砝码有 50、100、200 克三种——哪两个加起来刚好？",
      prompt: "加一个凑重量小游戏：屏幕上显示目标「凑出 250 g」，用一条进度条表示现在离目标还有多远；误差在 5 克以内就显示「成功！」，并把模块上的 LED 变成绿色，否则 LED 是红色。",
      check: {
        all: [
          { running: true }, { text: "250" }, { text: "成功" },
          { any: [{ input: "scales.grams", between: [244, 256] }, { input: "scales.grams", between: [554, 566] }] },
          { output: "scales.led", dominant: "g" },
        ],
      },
    },
  ],
  prompts: [
    "每次成功以后换一个新的目标（50 到 350 克之间、用砝码凑得出来的数）。",
    "加一个开关，让单位在克和盎司之间切换。",
    "杯子去皮以后，做一个「倒 15 克咖啡豆」的进度环。",
  ],
} satisfies LessonDef;
