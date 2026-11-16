// 测温枪: NCIR. Object temperature with a "hot drink" indicator; the mug reads about 62 °C.
import type { LessonDef } from "../../../sidecar/src/lessons/types.ts";

export default {
  id: "thermo", number: 9, title: "测温枪", units: ["ncir"], minutes: 10, level: 1,
  tagline: "不用碰就知道烫不烫：隔空量一量那杯咖啡。",
  story: "NCIR 模块靠『看』红外线来量温度：对着谁就量谁，完全不用碰。桌上正好有一杯刚泡好的咖啡，六十来度，拿它练练手。",
  steps: [
    {
      id: "plug",
      text: "把『红外测温』模块接到 Tab5 上",
      hint: "点一下盒子里的『红外测温』模块（NCIR），它会自己飞到底座上，小小的金属『眼睛』朝前。",
      check: { plugged: "ncir" },
    },
    {
      id: "app",
      text: "请 AI 做一把测温枪",
      hint: "点下面这句现成的话就行。现在它对着空气，读到的大概是室温。",
      prompt: "做一把测温枪：读取 NCIR 模块，用大数字显示它对准的物体温度（°C，保留一位小数），旁边用小字显示模块自己所在的环境温度。",
      check: { all: [{ changed: true }, { running: true }, { shows: "ncir.objectCelsius", tolerance: 0.6 }] },
    },
    {
      id: "mug",
      text: "把咖啡杯挪到测温模块前面",
      hint: "拖动杯子，让它正对着模块的『眼睛』。读数应该一路升到 62 °C 左右。",
      check: { all: [{ running: true }, { input: "ncir.objectCelsius", gt: 50 }, { shows: "ncir.objectCelsius", tolerance: 1.5 }] },
    },
    {
      id: "hot",
      text: "让 AI 加上『烫不烫』提示，再量一次咖啡",
      hint: "先让 AI 改好。杯子还在模块前面的话，提示应该马上就跳出来。",
      prompt: "加一个「烫不烫」指示：物体温度高于 50 °C 时用红色显示「小心烫」，40 到 50 °C 显示「正好喝」，低于 40 °C 显示「凉了」；再记下这次量到的最高温度。",
      check: { all: [{ running: true }, { input: "ncir.objectCelsius", gt: 50 }, { text: "烫" }] },
    },
    {
      id: "away",
      text: "把杯子拿开，提示应该变回『凉了』",
      hint: "把杯子拖回原来的位置。模块又对着空气了，读数会落回室温。",
      check: { all: [{ running: true }, { input: "ncir.objectCelsius", lt: 40, withinSeconds: 0 }, { text: "凉" }, { not: { text: "小心烫" } }] },
    },
  ],
  prompts: [
    "加一个「按住测量、松开锁定」的按钮，像真的额温枪那样。",
    "同时用摄氏度和华氏度显示温度。",
    "画出最近 30 秒的温度曲线，看看咖啡凉得有多快。",
  ],
} satisfies LessonDef;
