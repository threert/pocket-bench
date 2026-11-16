// 你好，Tab5: the first app. A greeting, a counter that a button raises, and
// a second button that gives the number another colour. No hardware: the
// template's worker keeps running beside it, unused.
import { createSignal } from "solid-js";
import { animate } from "@pocketjs/framework/animation";
import type { NodeMirror } from "@pocketjs/framework/components";
import { mount } from "@pocketjs/framework/solid";
import { View } from "@pocketjs/framework/components";
import { Button, Card, Chip, Col, Dot, Gauge, Header, Label, Row, Screen, theme } from "./ui";

/** The colours the number goes through. It starts white; 换颜色 moves to the next one. */
const COLOURS = [
  { name: "白色", hex: "" },
  { name: "红色", hex: "#ff5d5d" },
  { name: "绿色", hex: "#3ddc97" },
  { name: "蓝色", hex: "#4c9dff" },
  { name: "黄色", hex: "#ffd23f" },
];

/** What the screen says about the count. */
function cheer(count: number): string {
  if (count === 0) return "点一下右边的大按钮试试";
  if (count % 10 === 0) return `整整 ${count} 下，手速可以啊！`;
  if (count < 3) return "对，就是这样";
  if (count % 10 >= 7) return `再点 ${10 - count % 10} 下就凑满一圈`;
  return "再来，再来";
}

mount(() => {
  const [count, setCount] = createSignal(0);
  const [colour, setColour] = createSignal(0);
  const hex = () => COLOURS[colour()]!.hex || theme().text;
  let number: NodeMirror | undefined;

  const press = () => {
    setCount(count() + 1);
    // The number jumps a little with every press.
    if (number) {
      animate(number, "scale", 1.2, { dur: 70, easing: "out" });
      animate(number, "scale", 1, { dur: 200, delay: 70, easing: "out-back" });
    }
  };
  const repaint = () => setColour((colour() + 1) % COLOURS.length);
  // The ring fills once every ten presses; a full ring stays full until the next press.
  const ring = () => count() === 0 ? 0 : (count() % 10 || 10) / 10;

  return <Screen>
    <Header title="你好，Tab5" subtitle="我的第一个 App">
      <Chip color={hex()} dot>{COLOURS[colour()]!.name}</Chip>
    </Header>
    <Row gap={12} grow align="stretch">
      <Card title="点了多少次" grow align="center" justify="center" gap={10}>
        <Gauge value={ring()} size={176} thickness={12} sweep={300} color={hex()}>
          <View ref={(node: NodeMirror) => { number = node; }}>
            <Label size="5xl" bold color={hex()}>{count()}</Label>
          </View>
        </Gauge>
        <Label tone="muted">{cheer(count())}</Label>
      </Card>
      <Col w={212} gap={12}>
        <Button label="点我" tone="accent" h={148} size="2xl" onPress={press} />
        <Button label="换颜色" h={64} size="lg" onPress={repaint} />
        <Row gap={10} justify="center" grow>
          {COLOURS.map((item, index) => <Dot color={item.hex || theme().text} size={colour() === index ? 14 : 8} />)}
        </Row>
      </Col>
    </Row>
  </Screen>;
});
