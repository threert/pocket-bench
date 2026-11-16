// 你好，Tab5: the first app. A greeting, a counter that a button raises, and
// a second button that gives the number another colour. No hardware: the
// worker of the template keeps running beside it, unused.
import { createSignal } from "solid-js";
import { animate } from "@pocketjs/framework/animation";
import type { NodeMirror } from "@pocketjs/framework/components";
import { mount } from "@pocketjs/framework/solid";
import { Button, Card, Chip, Col, Dot, Header, Label, Row, Screen, theme } from "./ui";

/** The colours the number goes through. It starts white; the first press of 换颜色 makes it red. */
const COLOURS = [
  { name: "白色", hex: "" },
  { name: "红色", hex: "#ff5d5d" },
  { name: "绿色", hex: "#3ddc97" },
  { name: "蓝色", hex: "#4c9dff" },
  { name: "黄色", hex: "#ffd23f" },
];

/** What the screen says about the count. */
function cheer(count: number): string {
  if (count === 0) return "点一下右边的按钮试试";
  if (count % 10 === 0) return `整整 ${count} 下，手速可以啊！`;
  if (count < 3) return "对，就是这样";
  if (count < 10) return "再来再来";
  return "停不下来了是吧";
}

mount(() => {
  const [count, setCount] = createSignal(0);
  const [colour, setColour] = createSignal(0);
  const hex = () => COLOURS[colour()]!.hex || theme().text;
  let number: NodeMirror | undefined;

  const press = () => {
    setCount(count() + 1);
    // The number jumps a little with every press.
    if (number) { animate(number, "scale", 1.18, { dur: 70, easing: "out" }); animate(number, "scale", 1, { dur: 180, delay: 70, easing: "out-back" }); }
  };
  const repaint = () => setColour((colour() + 1) % COLOURS.length);

  return <Screen>
    <Header title="你好，Tab5" subtitle="我的第一个 App">
      <Chip color={hex()} dot>{COLOURS[colour()]!.name}</Chip>
    </Header>
    <Row gap={12} grow align="stretch">
      <Card title="点了多少次" grow align="center" justify="center" gap={4}>
        <Row gap={0} justify="center">
          <Col gap={0} align="center">
            <Label size="5xl" bold color={hex()} >{count()}</Label>
          </Col>
        </Row>
        <Label tone="muted">{cheer(count())}</Label>
      </Card>
      <Col w={220} gap={12} justify="between">
        <Button label="点我" tone="accent" h={132} size="2xl" onPress={press} />
        <Button label="换颜色" h={64} size="lg" onPress={repaint} />
        <Row gap={8} justify="center" h={44}>
          {COLOURS.map((item, index) => <Dot color={item.hex || theme().text} size={colour() === index ? 14 : 8} />)}
        </Row>
      </Col>
    </Row>
  </Screen>;
});
