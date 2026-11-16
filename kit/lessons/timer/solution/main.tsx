// 番茄钟, the UI: a big ring with the time left in it. While the timer is
// ready the ring is a 60-minute dial that follows the knob; once it runs,
// the ring is the session and empties clockwise. Beside it: what the knob
// does, the Unit's two LEDs as the worker lit them, and the same controls
// for a finger.
import { createSignal, Match, Switch } from "solid-js";
import { View } from "@pocketjs/framework/components";
import { onFrame } from "@pocketjs/framework/lifecycle";
import { mount } from "@pocketjs/framework/solid";
import { Command, MAX_MINUTES, Phase, State, Status } from "./protocol";
import { Button, Card, Col, Field, Header, Label, Notice, Row, Screen, mix, send, theme, useChannel } from "./ui";

/** The ring's size and the width of its line. */
const SIZE = 248, RING = 16;

/** Seconds as mm:ss. A second that has begun still shows: 04:59 is on from 299.99 s down to 299 s. */
function clock(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds - 0.001));
  const two = (value: number) => value < 10 ? `0${value}` : `${value}`;
  return `${two(Math.floor(whole / 60))}:${two(whole % 60)}`;
}

/** An LED's colour for the screen: its hue at full strength, on the panel, more of it the brighter the LED is. */
function glow(r: number, g: number, b: number): string {
  const peak = Math.max(r, g, b);
  if (peak === 0) return theme().line;
  const hex = (value: number) => Math.round(value / peak * 255).toString(16).padStart(2, "0");
  return mix(theme().line, `#${hex(r)}${hex(g)}${hex(b)}`, 0.35 + 0.65 * Math.min(1, peak / 200));
}

mount(() => {
  const state = useChannel("state", State);
  const phase = () => state().phase;
  const colour = () => phase() === Phase.focus ? theme().good : phase() === Phase.paused ? theme().warn : phase() === Phase.done ? theme().bad : theme().accent;
  const word = () => phase() === Phase.focus ? "专注中" : phase() === Phase.paused ? "已暂停" : phase() === Phase.done ? "休息一下" : "准备";
  const hint = () => phase() === Phase.focus ? `这一轮 ${state().minutes} 分钟` : phase() === Phase.paused ? "按一下旋钮继续" : phase() === Phase.done ? "时间到，按一下旋钮再来" : "转动旋钮设定时间";
  const action = () => phase() === Phase.focus ? "暂停" : phase() === Phase.paused ? "继续" : phase() === Phase.done ? "再来一个" : "开始专注";

  // How full the ring is: the minutes on a 60-minute dial while the timer is
  // ready, what is left of the session once it runs, all of it when the time is up.
  const share = () => phase() === Phase.ready ? state().minutes / MAX_MINUTES
    : phase() === Phase.done ? 1 : state().remaining / (state().minutes * 60);
  // The ring glides to where it should be instead of jumping there.
  const [shown, setShown] = createSignal(0);
  onFrame(() => {
    const gap = share() - shown();
    if (gap !== 0) setShown(Math.abs(gap) < 0.002 ? share() : shown() + gap * 0.25);
  });

  return <Screen>
    <Header title="番茄钟" subtitle="Encoder · Port A" status={state().status === Status.live ? "实时" : "未连接"} tone={state().status === Status.live ? "good" : "neutral"} />
    <Switch>
      <Match when={state().status === Status.missing}>
        <Notice title="请插上 Encoder 模块" lines={phase() === Phase.paused
          ? ["把『旋转编码器』模块接回 Port A（红色接口）。", `计时已暂停，还剩 ${clock(state().remaining)}。`]
          : ["把『旋转编码器』模块接到 Port A（红色接口），", "转动旋钮定时间，按一下开始。"]} />
      </Match>
      <Match when={state().status === Status.live}>
        <Row gap={12} grow align="stretch">
          <Card grow align="center" justify="center" pad={10}>
            <View class="relative" style={{ width: SIZE, height: SIZE }}>
              <View class="absolute left-0 top-0" style={{ width: SIZE, height: SIZE, bgColor: theme().line, arcStart: 0, arcSweep: 360, arcWidth: RING }} />
              {/* What is left starts where the elapsed part ends and reaches round to 12 o'clock. */}
              <View class={phase() === Phase.done ? "absolute left-0 top-0 animate-pulse" : "absolute left-0 top-0"} style={{
                width: SIZE, height: SIZE, bgColor: colour(), arcWidth: RING, opacity: shown() > 0 ? 1 : 0,
                arcStart: phase() === Phase.ready ? 0 : 360 * (1 - shown()), arcSweep: Math.max(0.01, 360 * shown()),
              }} />
              <View class="absolute left-0 top-0 flex-col items-center justify-center" style={{ width: SIZE, height: SIZE, gap: 2 }}>
                <Label size="lg" bold color={colour()}>{word()}</Label>
                <Label size="5xl" bold>{clock(state().remaining)}</Label>
                <Label size="xs" tone="muted">{hint()}</Label>
              </View>
            </View>
          </Card>
          <Col w={220} gap={12}>
            <Card title="旋钮" grow justify="between">
              <Col gap={4}>
                <Field label="转动" value="设定 1 到 60 分钟" />
                <Field label="按下" value="开始 / 暂停" />
              </Col>
              <Field label="指示灯">
                <Row gap={8}>
                  <View style={{ width: 28, height: 14, radius: 7, bgColor: glow(state().leds[0]!, state().leds[1]!, state().leds[2]!) }} />
                  <View style={{ width: 28, height: 14, radius: 7, bgColor: glow(state().leds[3]!, state().leds[4]!, state().leds[5]!) }} />
                </Row>
              </Field>
            </Card>
            <Button label={action()} tone={phase() === Phase.focus ? "warn" : "accent"} h={56} size="lg" onPress={() => send("commands", Command.encode("press"))} />
            <Button label="重置" disabled={phase() === Phase.ready} onPress={() => send("commands", Command.encode("reset"))} />
          </Col>
        </Row>
      </Match>
    </Switch>
  </Screen>;
});
