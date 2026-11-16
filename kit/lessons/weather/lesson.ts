// 桌面气象站: ENV III. Big temperature, humidity, pressure, a chart; the heat
// gun raises the temperature (an alert above 30 °C), the mist sprayer the humidity.
import type { LessonDef } from "../../../sidecar/src/lessons/types.ts";

export default {
  id: "weather", number: 2, title: "桌面气象站", units: ["env3"], minutes: 10, level: 1,
  tagline: "插上温湿度气压模块，做一块会看天气脸色的小屏幕。",
  story: "ENV III 模块里住着两颗小芯片，能闻出空气的温度、湿度和气压。把它接到 Tab5 上做个气象站，再拿热风枪和喷雾瓶逗逗它。",
  steps: [
    {
      id: "plug",
      text: "把『温湿度气压』模块接到 Tab5 上",
      hint: "点一下盒子里的『温湿度气压』模块（ENV III），它会自己飞到绿色底座上并接好线。",
      check: { plugged: "env3" },
    },
    {
      id: "app",
      text: "请 AI 做一个气象站界面",
      hint: "点下面这句现成的话就行。AI 会去读模块的驱动、写代码、自己截图检查，大概要一两分钟。",
      prompt: "做一个桌面气象站：读取 ENV III 模块，用大数字显示温度（°C），旁边显示湿度（%）和气压（hPa），再画一条最近一分钟的温度曲线。没插模块的时候提示「请插上 ENV III 模块」。",
      check: {
        all: [
          { changed: true }, { running: true },
          { shows: "env3.celsius", tolerance: 0.6 },
          { shows: "env3.humidity", tolerance: 2 },
          { any: [{ shows: "env3.pascals", scale: 0.01, tolerance: 2 }, { shows: "env3.pascals", scale: 0.001, tolerance: 0.2 }] },
        ],
      },
    },
    {
      id: "heat",
      text: "打开热风枪，对着模块吹一会儿",
      hint: "拿起桌上的热风枪，凑近模块再打开开关。真的传感器升温要几秒钟，盯着大数字看它一点点往上爬，曲线也会跟着抬头。",
      check: { all: [{ running: true }, { input: "env3.celsius", gt: 28 }, { shows: "env3.celsius", tolerance: 1.5 }] },
    },
    {
      id: "alert",
      text: "让 AI 加一个高温提醒，再把模块吹到 30 °C 以上",
      hint: "先让 AI 改好，再继续吹。过了 30 °C，屏幕应该变脸给你看。",
      prompt: "温度超过 30 °C 的时候，把温度数字变成红色，并在屏幕上显示醒目的「太热了」；降回 30 °C 以下就恢复正常。",
      check: { all: [{ running: true }, { input: "env3.celsius", gt: 30 }, { text: "太热|高温|过热|好热|警报|警告" }] },
    },
    {
      id: "mist",
      text: "关掉热风枪，换喷雾瓶朝模块喷两下",
      hint: "湿度会一下子蹿上去，温度则慢慢回落。看看屏幕上的湿度是不是也跟着涨了。",
      check: { all: [{ running: true }, { input: "env3.humidity", gt: 65 }, { shows: "env3.humidity", tolerance: 3 }] },
    },
  ],
  prompts: [
    "再算出露点温度，显示在气压旁边。",
    "让我点一下曲线，就能在温度和湿度之间切换。",
    "湿度超过 70% 的时候提醒我「该开窗了」。",
  ],
} satisfies LessonDef;
