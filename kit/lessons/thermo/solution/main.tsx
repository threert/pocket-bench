// 测温枪, the UI: the temperature of what the NCIR looks at in the middle of
// a dial from 0 to 100 °C, and beside it the 烫不烫 verdict for a hot drink
// (凉了 below 40 °C, 正好喝 up to 50 °C, 小心烫 above), the Unit's own
// temperature and the highest reading so far.
import { Match, Switch, type JSX } from "solid-js";
import { View } from "@pocketjs/framework/components";
import { mount } from "@pocketjs/framework/solid";
import { Command, HOT, State, Status, WARM } from "./protocol";
import { Button, Card, Col, Field, Header, Label, Notice, Row, Screen, mix, send, theme, useChannel } from "./ui";

/** The dial: 0 °C at the lower left, 100 °C at the lower right, 270 degrees between them, 50 °C at the top. */
const LOW = 0, HIGH = 100, SWEEP = 270;
/** Its size, the width of its ring and of the thin band of the three zones inside it. */
const SIZE = 240, RING = 18, BAND = 4, INNER = SIZE - 2 * (RING + 7);

type Zone = "cool" | "warm" | "hot";
const zoneOf = (celsius: number): Zone => celsius > HOT ? "hot" : celsius >= WARM ? "warm" : "cool";
const zoneColour = (zone: Zone) => zone === "hot" ? theme().bad : zone === "warm" ? theme().good : theme().info;
/** Where a temperature is on the dial, in degrees (0 at 12 o'clock, clockwise). */
const angle = (celsius: number) => -SWEEP / 2 + Math.max(0, Math.min(1, (celsius - LOW) / (HIGH - LOW))) * SWEEP;

/** A ring filled up to the temperature in its zone's colour. Inside it a
 *  thin band marks the three zones; the one the reading is in is lit. */
function Dial(props: { celsius: number; children?: JSX.Element }) {
  const zone = () => zoneOf(props.celsius);
  const band = (from: number, to: number, name: Zone) =>
    <View class="absolute" style={{
      insetL: (SIZE - INNER) / 2, insetT: (SIZE - INNER) / 2, width: INNER, height: INNER, arcWidth: BAND,
      // Two degrees off each end, so the three bands do not touch.
      arcStart: angle(from) + 2, arcSweep: angle(to) - angle(from) - 4,
      bgColor: zone() === name ? zoneColour(name) : mix(theme().panel, zoneColour(name), 0.38),
    }} />;
  return <View class="relative" style={{ width: SIZE, height: SIZE }}>
    <View class="absolute left-0 top-0" style={{ width: SIZE, height: SIZE, bgColor: theme().line, arcStart: -SWEEP / 2, arcSweep: SWEEP, arcWidth: RING }} />
    <View class="absolute left-0 top-0" style={{ width: SIZE, height: SIZE, bgColor: zoneColour(zone()), arcStart: -SWEEP / 2, arcSweep: Math.max(0.01, angle(props.celsius) + SWEEP / 2), arcWidth: RING }} />
    {band(LOW, WARM, "cool")}
    {band(WARM, HOT, "warm")}
    {band(HOT, HIGH, "hot")}
    <View class="absolute left-0 top-0 flex-col items-center justify-center" style={{ width: SIZE, height: SIZE }}>{props.children}</View>
    {/* The ends of the scale, under the ends of the ring. */}
    <View class="absolute flex-row justify-between" style={{ insetL: 36, insetT: SIZE - 20, width: SIZE - 72 }}>
      <Label size="xs" tone="faint">{LOW}°</Label>
      <Label size="xs" tone="faint">{HIGH}°</Label>
    </View>
  </View>;
}

mount(() => {
  const state = useChannel("state", State);
  const live = () => state().status === Status.live;
  const zone = () => zoneOf(state().object);
  const colour = () => zoneColour(zone());
  const verdict = () => zone() === "hot" ? "小心烫" : zone() === "warm" ? "正好喝" : "凉了";
  const advice = () => zone() === "hot" ? `超过 ${HOT} °C，晾一会儿再喝` : zone() === "warm" ? `${WARM} 到 ${HOT} °C，趁热喝` : `不到 ${WARM} °C，可以放心拿`;
  /** One of the three lamps under the verdict. */
  const lamp = (name: Zone) => <View class="flex-1" style={{ height: 8, radius: 4, bgColor: zone() === name ? zoneColour(name) : theme().line }} />;

  return <Screen>
    <Header title="测温枪" subtitle="NCIR · Port A"
      status={live() ? "实时" : state().status === Status.fault ? "读数出错" : "未连接"}
      tone={live() ? "good" : state().status === Status.fault ? "bad" : "neutral"} />
    <Switch>
      <Match when={state().status === Status.missing}>
        <Notice title="请插上 NCIR 模块" lines={["把『红外测温』模块接到 Port A（红色接口），", "让它的小『眼睛』对准要量的东西。"]} />
      </Match>
      <Match when={state().status === Status.fault}>
        <Notice title="传感器读数出错" tone="bad" lines={["模块有回应，但数据校验没通过。", "把它拔下来重新插一次试试。"]} />
      </Match>
      <Match when={live()}>
        <Row gap={12} grow align="stretch">
          <Card grow align="center" justify="center">
            <Dial celsius={state().object}>
              <Label size="xs" bold tone="muted">物体温度</Label>
              <Label size="5xl" bold color={zone() === "hot" ? theme().bad : theme().text}>{state().object.toFixed(1)}</Label>
              <Label size="lg" tone="muted">°C</Label>
            </Dial>
          </Card>
          <Col w={240} gap={12}>
            <Card title="热饮" grow justify="between" color={mix(theme().panel, colour(), zone() === "hot" ? 0.16 : 0.07)} border={zone() === "hot" ? theme().bad : undefined}>
              <Col gap={2}>
                <Label size="2xl" bold color={colour()}>{verdict()}</Label>
                <Label size="xs" tone="muted">{advice()}</Label>
              </Col>
              {/* Three lamps, one for each verdict, and the two temperatures between them. */}
              <Col gap={4}>
                <Row gap={6}>{lamp("cool")}{lamp("warm")}{lamp("hot")}</Row>
                <Row gap={0}>
                  <View style={{ width: 51 }} />
                  <Label size="xs" tone="faint" w={40} align="center">{WARM}°</Label>
                  <View style={{ width: 31 }} />
                  <Label size="xs" tone="faint" w={40} align="center">{HOT}°</Label>
                </Row>
              </Col>
            </Card>
            <Card gap={6}>
              <Field label="环境温度" value={`${state().ambient.toFixed(1)} °C`} />
              <Field label="最高温度" value={`${state().peak.toFixed(1)} °C`} tone={zoneOf(state().peak) === "hot" ? "bad" : "text"} />
              <Button label="重新记录最高温度" size="sm" onPress={() => send("commands", Command.encode("resetPeak"))} />
            </Card>
          </Col>
        </Row>
      </Match>
    </Switch>
  </Screen>;
});
