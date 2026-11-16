// 智能台灯: DLight + 4-Relay. The desk lamp (relay CH1) goes on when the room
// is dark (the room's light switch), with hysteresis and a manual override.
import type { LessonDef } from "../../../sidecar/src/lessons/types.ts";

export default {
  id: "lamp", number: 6, title: "智能台灯", units: ["dlight", "relay4"], minutes: 15, level: 2,
  tagline: "天黑了自己亮：教台灯学会看天色。",
  story: "DLight 是一只小小的『眼睛』，量得出周围有多亮。让它盯着房间里的光线：天一黑，就通过继电器替你把台灯打开。",
  steps: [
    {
      id: "plug",
      text: "把『环境光』和『四路继电器』两个模块都接上",
      hint: "先点盒子里的『环境光』模块（DLight），再点『四路继电器』。台灯的插头已经接在继电器的第 1 路上了。",
      check: { all: [{ plugged: "dlight" }, { plugged: "relay4" }] },
    },
    {
      id: "app",
      text: "请 AI 做一个能看亮度、能开关台灯的界面",
      hint: "点下面这句现成的话就行。",
      prompt: "做一个智能台灯：用 DLight 模块读取环境亮度，用大数字显示（单位 lx），并画出最近一分钟的亮度曲线；再放一个大大的开关，可以手动控制继电器第 1 路上的台灯。",
      check: { all: [{ changed: true }, { running: true }, { shows: "dlight.lux", tolerance: 8, percent: 5 }] },
    },
    {
      id: "manual",
      text: "点一下屏幕上的开关，亲手把台灯点亮",
      hint: "继电器会『咔哒』一声，桌上的台灯跟着亮起来。再点一下就关掉。",
      check: { all: [{ running: true }, { output: "relay4.relays[0]", on: true }] },
    },
    {
      id: "auto",
      text: "让 AI 加上自动模式，然后把房间的灯关掉",
      hint: "先让 AI 改好，再点墙上的电灯开关。房间暗下来以后，台灯应该不用你动手就自己亮了。",
      prompt: "加上自动模式：亮度低于 50 lx 时自动开灯，高于 150 lx 才关灯（两个数字之间留出回差，免得灯一明一暗地抖）。屏幕上显示现在是「自动」还是「手动」，手动点了开关就切到手动，再加一个按钮切回自动。",
      check: { all: [{ running: true }, { text: "自动" }, { input: "dlight.lux", lt: 50 }, { output: "relay4.relays[0]", on: true }] },
    },
    {
      id: "morning",
      text: "再把房间的灯打开，台灯应该自己关掉",
      hint: "再点一下墙上的开关。天亮了，台灯也该下班了。",
      check: { all: [{ running: true }, { input: "dlight.lux", gt: 150, withinSeconds: 0 }, { output: "relay4.relays[0]", on: false, withinSeconds: 0 }] },
    },
  ],
  prompts: [
    "天黑开灯的时候，让「ON AIR」灯牌（第 3 路）也一起亮。",
    "把开灯和关灯的两个亮度做成屏幕上的两个滑块，让我自己调。",
    "统计一下台灯今天一共亮了多久。",
  ],
} satisfies LessonDef;
