// 番茄钟: Encoder. Turn to set minutes, press to start and pause, the Unit's LEDs show progress, the Tab5 shows a ring.
import type { LessonDef } from "../../../sidecar/src/lessons/types.ts";

export default {
  id: "timer", number: 10, title: "番茄钟", units: ["encoder"], minutes: 15, level: 3,
  tagline: "转一转定时间，按一下就开工：做一个桌面番茄钟。",
  story: "Encoder 是一个能一直转下去、还能按下去的旋钮，身上带着两颗彩灯。拿它当番茄钟的表冠再合适不过：转动定时间，按下去开工。",
  steps: [
    {
      id: "plug",
      text: "把『旋转编码器』模块接到 Tab5 上",
      hint: "点一下盒子里的『旋转编码器』模块（Encoder），它会自己飞到底座上并接好线。",
      check: { plugged: "encoder" },
    },
    {
      id: "app",
      text: "请 AI 做一个番茄钟",
      hint: "点下面这句现成的话就行。做好以后屏幕中间会有一个圆环，写着 25:00。",
      prompt: "做一个番茄钟：转动 Encoder 旋钮设定分钟数（1 到 60，默认 25），屏幕中间用一个圆环和大字显示剩余时间（mm:ss）；按一下旋钮开始倒计时，再按一下暂停。用「准备」「专注中」「已暂停」表示现在的状态。",
      check: { all: [{ changed: true }, { running: true }, { text: "25:00" }] },
    },
    {
      id: "set",
      text: "转动旋钮，把时间调成 5 分钟",
      hint: "按住旋钮转圈：顺时针加，逆时针减，『咔』一格是一分钟。从 25 往回转 20 格。",
      check: { all: [{ running: true }, { input: "encoder.steps", ne: 0 }, { text: "(^|[^0-9])0?5:00" }] },
    },
    {
      id: "start",
      text: "按一下旋钮，开始倒计时",
      hint: "点一下旋钮帽就是按下去。时间开始一秒一秒往下走，圆环也跟着变短。",
      check: { all: [{ running: true }, { text: "(^|[^0-9])0?4:[0-5][0-9]" }] },
    },
    {
      id: "leds",
      text: "让 AI 把旋钮上的灯也接进来，再按一下旋钮暂停",
      hint: "先让 AI 改好。专注的时候灯是绿的；按一下暂停，灯变黄，屏幕写着『已暂停』。",
      prompt: "用旋钮上的两颗 LED 显示状态：专注时亮绿色，剩的时间越少越暗；暂停时变成黄色；时间到了红色闪烁，屏幕显示「休息一下」。",
      check: {
        then: [
          { all: [{ running: true }, { output: "encoder.leds", dominant: "g" }] },
          { all: [{ running: true }, { text: "暂停" }, { output: "encoder.leds", lit: true }, { not: { output: "encoder.leds", dominant: "g", withinSeconds: 0 } }] },
        ],
      },
    },
  ],
  prompts: [
    "时间到了以后，自动接着倒数 5 分钟的休息时间。",
    "在屏幕下面用小圆点记录今天完成了几个番茄。",
    "长按旋钮 2 秒，把计时归零。",
  ],
} satisfies LessonDef;
