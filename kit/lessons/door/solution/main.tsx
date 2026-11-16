// 门禁打卡, the UI. On the left the reader: 请刷卡 with a reader that pulses
// while it waits, then a green 欢迎回来 or a red 未登记的卡 with the card's
// number, and the two lights the relays switch. On the right the last five
// swipes, the newest on top.
import { createEffect, createMemo, createSignal, Index, Match, Show, Switch } from "solid-js";
import { animate, jump } from "@pocketjs/framework/animation";
import { View, type NodeMirror } from "@pocketjs/framework/components";
import { onFrame } from "@pocketjs/framework/lifecycle";
import { mount } from "@pocketjs/framework/solid";
import { BEACON_SECONDS, SIGN_SECONDS, State, Verdict, Who } from "./protocol";
import { Bar, Card, Chip, Col, Dot, Header, Label, Notice, Row, Screen, Spacer, mix, theme, toneColor, useChannel, type Tone } from "./ui";

/** The names of the cards. A card the door has never heard of is 未知卡. */
const NAMES: Record<number, string> = { [Who.staff]: "员工卡", [Who.visitor]: "访客卡", [Who.unknown]: "未知卡" };

/** "04 A3 1B 7C": the way the number is printed on a card. */
const uidText = (uid: readonly number[], bytes: number) => uid.slice(0, bytes).map(value => value.toString(16).toUpperCase().padStart(2, "0")).join(" ");

/** How long ago, in words. */
function ago(seconds: number): string {
  if (seconds < 5) return "刚刚";
  if (seconds < 60) return `${Math.floor(seconds)} 秒前`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  return `${Math.floor(seconds / 3600)} 小时前`;
}

/** The reader while it waits for a card: a pad with three waves that light up one after the other. */
function Waiting() {
  const [wave, setWave] = createSignal(0);
  let frames = 0;
  onFrame(() => { if (++frames % 9 === 0) setWave((wave() + 1) % 4); });
  const SIZE = 96, CX = 22, CY = SIZE / 2;
  return <View class="relative" style={{ width: SIZE, height: SIZE, radius: 22, bgColor: theme().raised }}>
    <View class="absolute" style={{ insetL: CX - 7, insetT: CY - 7, width: 14, height: 14, radius: 7, bgColor: theme().accent }} />
    {[0, 1, 2].map(index => {
      const outer = 22 + index * 18;
      // A square node drawn as a ring segment: 0 degrees is 12 o'clock, so 90 points to the right.
      return <View class="absolute" style={{ insetL: CX - outer, insetT: CY - outer, width: outer * 2, height: outer * 2, bgColor: wave() > index ? theme().accent : theme().line, arcStart: 48, arcSweep: 84, arcWidth: 8 }} />;
    })}
  </View>;
}

/** One of the two lights the relays switch, as the room has them. */
function Light(props: { name: string; on: boolean; tone: Tone; missing: boolean }) {
  return <View class="flex-row items-center flex-1" style={{ height: 30, radius: 15, paddingL: 12, paddingR: 12, gap: 8, bgColor: props.on ? mix(theme().panel, toneColor(props.tone), 0.3) : theme().raised }}>
    <Dot color={props.on ? toneColor(props.tone) : theme().faint} size={10} pulse={props.on} />
    <Label size="xs" bold color={props.on ? theme().text : props.missing ? theme().faint : theme().muted}>{props.name}</Label>
    <Spacer />
    <Label size="xs" color={props.on ? toneColor(props.tone) : theme().faint}>{props.missing ? "未接" : props.on ? "亮" : "灭"}</Label>
  </View>;
}

mount(() => {
  const state = useChannel("state", State);
  const granted = () => state().verdict === Verdict.granted;
  const refused = () => state().verdict === Verdict.refused;
  const tone = (): Tone => granted() ? "good" : "bad";
  /** How much of the light's time is left, 1..0: the bar under the verdict runs down with it. */
  const left = () => Math.max(0, 1 - (state().now - state().at) / (granted() ? SIGN_SECONDS : BEACON_SECONDS));

  // Every new swipe makes the badge pop. (The memo changes only with the count: the record itself is
  // new ten times a second.)
  let badge: NodeMirror | undefined;
  const swipes = createMemo(() => state().swipes);
  createEffect(() => {
    if (swipes() === 0 || !badge) return;
    jump(badge, "scale", 0.5);
    animate(badge, "scale", 1, { dur: 260, easing: "out-back" });
  });

  const rows = () => Array.from({ length: state().logged }, (_, index) => ({ who: state().logWho[index]!, verdict: state().logVerdict[index]!, at: state().logAt[index]! }));

  return <Screen>
    <Header title="门禁打卡" subtitle="RFID 2 + 4-Relay · Port A"
      status={!state().reader ? "未连接" : granted() ? "已放行" : refused() ? "已拦下" : "等待刷卡"}
      tone={!state().reader ? "neutral" : granted() ? "good" : refused() ? "bad" : "accent"} />
    <Row gap={12} grow align="stretch">
      <Show when={state().reader} fallback={
        <Notice title="请插上 RFID 模块" lines={["把『RFID』模块接到 Port A（红色接口），", state().relay ? "四路继电器已经接好，就等读卡器了。" : "再把『四路继电器』也接上，刷卡才能亮灯。"]} />}>
        <Card grow justify="between" pad={14}
          color={state().verdict === Verdict.none ? undefined : mix(theme().panel, toneColor(tone()), 0.14)}
          border={state().verdict === Verdict.none ? undefined : toneColor(tone())}>
          <Switch>
            <Match when={state().verdict === Verdict.none}>
              <Col gap={10} align="center" justify="center" grow>
                <Waiting />
                <Label size="2xl" bold>请刷卡</Label>
                <Label size="sm" tone="muted">把卡片贴到 RFID 模块上面</Label>
              </Col>
            </Match>
            <Match when={true}>
              <Col gap={6} align="center" justify="center" grow>
                <Row gap={14}>
                  <View ref={(node: NodeMirror) => { badge = node; }} class="flex-row items-center justify-center" style={{ width: 52, height: 52, radius: 26, bgColor: toneColor(tone()) }}>
                    <Label size="4xl" bold tone="onAccent">{granted() ? "✓" : "✗"}</Label>
                  </View>
                  <Col gap={0} align="start">
                    <Label size="4xl" bold tone={tone()}>{granted() ? "欢迎回来" : "未登记的卡"}</Label>
                    <Label size="sm" tone="muted">{NAMES[state().who]}{granted() ? " · 门已打开" : " · 不能进门"}</Label>
                  </Col>
                </Row>
                <View class="flex-col items-center" style={{ paddingT: 6, gap: 2 }}>
                  <Label size="xs" bold tone="muted">卡号 UID</Label>
                  <Show when={state().uidBytes <= 4} fallback={<Label size="2xl" bold>{uidText(state().uid, state().uidBytes)}</Label>}>
                    <Label size="4xl" bold>{uidText(state().uid, state().uidBytes)}</Label>
                  </Show>
                </View>
              </Col>
              <Bar value={left()} tone={tone()} h={4} />
            </Match>
          </Switch>
          <Row gap={8}>
            <Light name="ON AIR 灯牌" on={state().sign} tone="good" missing={!state().relay} />
            <Light name="警示灯" on={state().beacon} tone="warn" missing={!state().relay} />
          </Row>
        </Card>
      </Show>
      <Card title="打卡记录" w={232} gap={6}>
        <Show when={state().logged > 0} fallback={
          <Col grow align="center" justify="center" gap={4}>
            <Label size="sm" tone="muted">还没有人刷卡</Label>
            <Label size="xs" tone="faint">最近 5 次会记在这里</Label>
          </Col>}>
          <Index each={rows()}>{(row, index) =>
            <View class="flex-row items-center" style={{ height: 40, radius: 10, paddingL: 10, paddingR: 8, gap: 8, bgColor: index === 0 ? theme().raised : theme().bg }}>
              <Dot tone={row().verdict === Verdict.granted ? "good" : "bad"} size={8} />
              <Col gap={0}>
                <Label size="sm" bold>{NAMES[row().who]}</Label>
                <Label size="xs" tone="faint">{ago(state().now - row().at)}</Label>
              </Col>
              <Spacer />
              <Chip tone={row().verdict === Verdict.granted ? "good" : "bad"}>{row().verdict === Verdict.granted ? "放行" : "拒绝"}</Chip>
            </View>}
          </Index>
        </Show>
      </Card>
    </Row>
  </Screen>;
});
