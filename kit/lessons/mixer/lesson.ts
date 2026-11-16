// 调光台: 8Angle. Knobs mix a colour on the Unit's own LEDs and on the
// screen; the toggle switch is a blackout.
import type { LessonDef } from "../../../sidecar/src/lessons/types.ts";

export default {
  id: "mixer", number: 4, title: "调光台", units: ["angle8"], minutes: 15, level: 2,
  tagline: "八个旋钮、九颗彩灯：拧一拧，调出你自己的颜色。",
  story: "8Angle 上排着八个旋钮，每个旋钮脚下藏着一颗彩灯，最边上还有个小拨动开关。把它变成一张迷你调光台：手上拧，灯上亮，屏幕上看。",
  steps: [
    {
      id: "plug",
      text: "把『八旋钮』模块接到 Tab5 上",
      hint: "点一下盒子里那条长长的『八旋钮』模块（8Angle），它会自己飞到底座上并接好线。",
      check: { plugged: "angle8" },
    },
    {
      id: "app",
      text: "请 AI 做一张调光台",
      hint: "点下面这句现成的话就行。写好以后，模块上的小灯会先亮起来。",
      prompt: "做一张调光台：读取 8Angle 模块，前三个旋钮分别控制红、绿、蓝三个通道（0–255），屏幕上用三条彩色进度条和数字显示，并画一个混合出来的颜色块；同时把混出的颜色点亮到模块自己的 8 颗 LED 上。",
      check: {
        all: [
          { changed: true }, { running: true }, { output: "angle8.leds", lit: true },
          { any: [{ shows: "angle8.knobs[0]", scale: 255, tolerance: 4 }, { shows: "angle8.knobs[0]", scale: 100, tolerance: 2 }] },
        ],
      },
    },
    {
      id: "red",
      text: "把第一个旋钮拧到头，另外两个拧到底，调出一片红",
      hint: "按住旋钮左右拖就能转。第一个往右拧满，第二、第三个往左拧到最小——模块上的灯和屏幕上的色块应该一起变红。",
      check: {
        all: [
          { running: true },
          { input: "angle8.knobs[0]", gt: 0.8 }, { input: "angle8.knobs[1]", lt: 0.25 }, { input: "angle8.knobs[2]", lt: 0.25 },
          { output: "angle8.leds", dominant: "r" },
        ],
      },
    },
    {
      id: "blackout",
      text: "让 AI 接上总开关，然后拨一下模块上的小开关，再拨回来",
      hint: "先让 AI 改好。拨动开关在旋钮旁边，点一下就拨过去：灯全灭；再点一下拨回来：颜色原样回来。",
      prompt: "把模块上的拨动开关做成总开关：拨过去的时候所有 LED 熄灭，屏幕显示「已熄灯」；拨回来的时候恢复刚才的颜色。",
      check: {
        then: [
          { all: [{ running: true }, { input: "angle8.switch", eq: 1, withinSeconds: 0 }, { output: "angle8.leds", lit: false, withinSeconds: 0 }, { text: "熄灯|关闭|已关|全灭" }] },
          { all: [{ running: true }, { input: "angle8.switch", eq: 0, withinSeconds: 0 }, { output: "angle8.leds", lit: true, withinSeconds: 0 }] },
        ],
      },
    },
  ],
  prompts: [
    "让第四个旋钮控制总亮度。",
    "加一个「彩虹」模式：八颗灯各亮一种颜色，第八个旋钮控制流动的速度。",
    "把现在调出的颜色存成预设，点屏幕上的色块就能叫回来。",
  ],
} satisfies LessonDef;
