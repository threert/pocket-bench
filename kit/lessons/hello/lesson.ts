// 你好，Tab5: no Unit. Touch the screen, ask for a first change, touch again.
import type { LessonDef } from "../../../sidecar/src/lessons/types.ts";

/** A whole number of at least 3 that stands by itself: not the 5 of "Tab5", not the 3 of "0.3". */
const THREE_OR_MORE = "(^|[^0-9A-Za-z.])([3-9]|[1-9][0-9]+)($|[^0-9A-Za-z.])";

export default {
  id: "hello", number: 1, title: "你好，Tab5", units: [], minutes: 5, level: 1,
  tagline: "先和 Tab5 打个招呼：点点屏幕，再请 AI 帮你改出第一个 App。",
  story: "桌上这台 Tab5 已经开机了，屏幕上跑着一个最简单的 App。先伸手摸摸它，再请 AI 搭档动手改一改——你来说，它来写。",
  steps: [
    {
      id: "tap",
      text: "点一下 Tab5 屏幕上的蓝色按钮",
      hint: "直接用鼠标点房间里那块屏幕上的『Tap me』。每点一次，左边的大数字就加一。",
      check: { all: [{ running: true }, { text: "^[1-9][0-9]*$" }] },
    },
    {
      id: "greet",
      text: "请 AI 把它改成一个中文的打招呼 App",
      hint: "在对话框里说说你想要的样子，或者直接点下面这句现成的话。等它写完，Tab5 的屏幕会自己刷新。",
      prompt: "把这个 App 改成中文的：大标题写「你好，Tab5」，中间用大数字显示按钮被点了多少次，下面放一个「点我」按钮，每点一次数字加一。",
      check: { all: [{ changed: true }, { running: true }, { text: "你好" }] },
    },
    {
      id: "count",
      text: "在新的 App 里把按钮点上三下",
      hint: "新按钮也是真的能点的。点够三下，看看数字有没有老老实实跟上。",
      check: { all: [{ running: true }, { text: "你好" }, { text: THREE_OR_MORE }] },
    },
    {
      id: "colour",
      text: "再让 AI 加一个『换颜色』按钮，然后点它一下",
      hint: "想改什么，接着跟 AI 说就行，它记得刚才做到哪儿了。按钮出现以后点一下，数字就该换身新衣服。",
      prompt: "再加一个「换颜色」按钮：每点一次，大数字就换一种颜色（红色、绿色、蓝色、黄色轮流），并在数字下面写出现在是什么颜色。一开始是「白色」。",
      check: { all: [{ running: true }, { text: "换颜色" }, { text: "红色|绿色|蓝色|黄色|橙色|紫色|粉色|青色" }] },
    },
  ],
  prompts: [
    "加一个「归零」按钮，把计数清零。",
    "每点满 10 次，就在屏幕上夸我一句。",
    "把整个界面换成浅色主题。",
  ],
} satisfies LessonDef;
