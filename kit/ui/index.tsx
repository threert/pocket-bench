// Parts for 640 x 360 screens: one look, laid out with flexbox, sized for a
// finger. Each part is a few Views and Texts; read one before changing it.
// Examples with pictures: ui/README.md.
//
//   <Screen>
//     <Header title="Weather" subtitle="ENV III on Port A" status="live" tone="good" />
//     <Row gap={12} grow>
//       <Card title="TEMPERATURE" grow><Stat value="24.6" unit="°C" /></Card>
//       <Card title="LAST MINUTE" grow><Chart values={history()} h={96} /></Card>
//     </Row>
//     <Button label="Reset" onPress={reset} />
//   </Screen>
import { createEffect, createSignal, Index, Show, type Accessor, type JSX } from "solid-js";
import { animate, jump } from "@pocketjs/framework/animation";
import { after } from "@pocketjs/framework/clock";
import { AuxiliarySurface, Text, View, type NodeMirror } from "@pocketjs/framework/components";
import { deviceStatus, setSwitch } from "@pocketjs/framework/device";
import { createGesture } from "@pocketjs/framework/gesture";
import { onFrame } from "@pocketjs/framework/lifecycle";
import { worker } from "@pocketjs/framework/worker/channels";
import { alpha, FONT, radius, space, theme, toneColor, TOUCH, type Size, type Tone } from "./theme";

export * from "./theme";
export { commands, record, tail, type CommandCodec, type RecordCodec } from "./channel";

// ---- text --------------------------------------------------------------------

/** A class string is looked up as written, so every size and weight is a
 *  whole literal here: "text-" + size would find no font. Columns: regular,
 *  bold, then the same two growing to fill a row. Every size named here is
 *  baked into the app with every character it uses, so the three large sizes
 *  come in bold only and the smallest in regular only. */
const TEXT_CLASS: Record<Size, readonly [string, string, string, string]> = {
  "2xs": ["text-2xs", "text-2xs", "flex-1 text-2xs", "flex-1 text-2xs"],
  xs: ["text-xs", "text-xs font-bold", "flex-1 text-xs", "flex-1 text-xs font-bold"],
  sm: ["text-sm", "text-sm font-bold", "flex-1 text-sm", "flex-1 text-sm font-bold"],
  base: ["text-base", "text-base font-bold", "flex-1 text-base", "flex-1 text-base font-bold"],
  lg: ["text-lg", "text-lg font-bold", "flex-1 text-lg", "flex-1 text-lg font-bold"],
  xl: ["text-xl", "text-xl font-bold", "flex-1 text-xl", "flex-1 text-xl font-bold"],
  "2xl": ["text-2xl font-bold", "text-2xl font-bold", "flex-1 text-2xl font-bold", "flex-1 text-2xl font-bold"],
  "4xl": ["text-4xl font-bold", "text-4xl font-bold", "flex-1 text-4xl font-bold", "flex-1 text-4xl font-bold"],
  "5xl": ["text-5xl font-bold", "text-5xl font-bold", "flex-1 text-5xl font-bold", "flex-1 text-5xl font-bold"],
};
function textClass(size: Size | undefined, bold: boolean | undefined, grow = false): string {
  return TEXT_CLASS[size ?? "sm"][(bold ? 1 : 0) + (grow ? 2 : 0)]!;
}

export type Ink = Tone | "text" | "muted" | "faint" | "onAccent";
function ink(tone: Ink | undefined, color: string | undefined): string {
  if (color) return color;
  switch (tone) {
    case undefined: case "text": return theme().text;
    case "muted": case "neutral": return theme().muted;
    case "faint": return theme().faint;
    case "onAccent": return theme().onAccent;
    default: return toneColor(tone);
  }
}

/** One line of text. A text never wraps: write a second Label for a second line.
 *  `w` gives it a fixed width, which `align` needs. */
export function Label(props: {
  children?: JSX.Element; size?: Size; bold?: boolean; tone?: Ink; color?: string;
  align?: "left" | "center" | "right"; w?: number; grow?: boolean;
}) {
  const align = () => props.align === "center" ? 1 : props.align === "right" ? 2 : 0;
  return <Show when={props.w !== undefined} fallback={
    <Text class={textClass(props.size, props.bold, props.grow)} style={{ textColor: ink(props.tone, props.color), textAlign: align() }}>{props.children}</Text>}>
    <Text class={textClass(props.size, props.bold)} style={{ textColor: ink(props.tone, props.color), textAlign: align(), width: props.w ?? 0 }}>{props.children}</Text>
  </Show>;
}

// ---- layout ------------------------------------------------------------------

type Justify = "start" | "center" | "end" | "between" | "around";
type Align = "start" | "center" | "end" | "stretch";

function rowClass(justify: Justify, align: Align, grow: boolean): string {
  // Every combination a screen needs, each a whole literal.
  if (grow) {
    if (align === "stretch") return justify === "between" ? "flex-row flex-1 items-stretch justify-between" : justify === "center" ? "flex-row flex-1 items-stretch justify-center" : justify === "end" ? "flex-row flex-1 items-stretch justify-end" : justify === "around" ? "flex-row flex-1 items-stretch justify-around" : "flex-row flex-1 items-stretch justify-start";
    if (align === "start") return justify === "between" ? "flex-row flex-1 items-start justify-between" : justify === "center" ? "flex-row flex-1 items-start justify-center" : justify === "end" ? "flex-row flex-1 items-start justify-end" : justify === "around" ? "flex-row flex-1 items-start justify-around" : "flex-row flex-1 items-start justify-start";
    if (align === "end") return justify === "between" ? "flex-row flex-1 items-end justify-between" : justify === "center" ? "flex-row flex-1 items-end justify-center" : justify === "end" ? "flex-row flex-1 items-end justify-end" : justify === "around" ? "flex-row flex-1 items-end justify-around" : "flex-row flex-1 items-end justify-start";
    return justify === "between" ? "flex-row flex-1 items-center justify-between" : justify === "center" ? "flex-row flex-1 items-center justify-center" : justify === "end" ? "flex-row flex-1 items-center justify-end" : justify === "around" ? "flex-row flex-1 items-center justify-around" : "flex-row flex-1 items-center justify-start";
  }
  if (align === "stretch") return justify === "between" ? "flex-row items-stretch justify-between" : justify === "center" ? "flex-row items-stretch justify-center" : justify === "end" ? "flex-row items-stretch justify-end" : justify === "around" ? "flex-row items-stretch justify-around" : "flex-row items-stretch justify-start";
  if (align === "start") return justify === "between" ? "flex-row items-start justify-between" : justify === "center" ? "flex-row items-start justify-center" : justify === "end" ? "flex-row items-start justify-end" : justify === "around" ? "flex-row items-start justify-around" : "flex-row items-start justify-start";
  if (align === "end") return justify === "between" ? "flex-row items-end justify-between" : justify === "center" ? "flex-row items-end justify-center" : justify === "end" ? "flex-row items-end justify-end" : justify === "around" ? "flex-row items-end justify-around" : "flex-row items-end justify-start";
  return justify === "between" ? "flex-row items-center justify-between" : justify === "center" ? "flex-row items-center justify-center" : justify === "end" ? "flex-row items-center justify-end" : justify === "around" ? "flex-row items-center justify-around" : "flex-row items-center justify-start";
}
function colClass(justify: Justify, align: Align, grow: boolean): string {
  if (grow) {
    if (align === "center") return justify === "between" ? "flex-col flex-1 items-center justify-between" : justify === "center" ? "flex-col flex-1 items-center justify-center" : justify === "end" ? "flex-col flex-1 items-center justify-end" : justify === "around" ? "flex-col flex-1 items-center justify-around" : "flex-col flex-1 items-center justify-start";
    if (align === "start") return justify === "between" ? "flex-col flex-1 items-start justify-between" : justify === "center" ? "flex-col flex-1 items-start justify-center" : justify === "end" ? "flex-col flex-1 items-start justify-end" : justify === "around" ? "flex-col flex-1 items-start justify-around" : "flex-col flex-1 items-start justify-start";
    if (align === "end") return justify === "between" ? "flex-col flex-1 items-end justify-between" : justify === "center" ? "flex-col flex-1 items-end justify-center" : justify === "end" ? "flex-col flex-1 items-end justify-end" : justify === "around" ? "flex-col flex-1 items-end justify-around" : "flex-col flex-1 items-end justify-start";
    return justify === "between" ? "flex-col flex-1 items-stretch justify-between" : justify === "center" ? "flex-col flex-1 items-stretch justify-center" : justify === "end" ? "flex-col flex-1 items-stretch justify-end" : justify === "around" ? "flex-col flex-1 items-stretch justify-around" : "flex-col flex-1 items-stretch justify-start";
  }
  if (align === "center") return justify === "between" ? "flex-col items-center justify-between" : justify === "center" ? "flex-col items-center justify-center" : justify === "end" ? "flex-col items-center justify-end" : justify === "around" ? "flex-col items-center justify-around" : "flex-col items-center justify-start";
  if (align === "start") return justify === "between" ? "flex-col items-start justify-between" : justify === "center" ? "flex-col items-start justify-center" : justify === "end" ? "flex-col items-start justify-end" : justify === "around" ? "flex-col items-start justify-around" : "flex-col items-start justify-start";
  if (align === "end") return justify === "between" ? "flex-col items-end justify-between" : justify === "center" ? "flex-col items-end justify-center" : justify === "end" ? "flex-col items-end justify-end" : justify === "around" ? "flex-col items-end justify-around" : "flex-col items-end justify-start";
  return justify === "between" ? "flex-col items-stretch justify-between" : justify === "center" ? "flex-col items-stretch justify-center" : justify === "end" ? "flex-col items-stretch justify-end" : justify === "around" ? "flex-col items-stretch justify-around" : "flex-col items-stretch justify-start";
}

interface BoxProps {
  children?: JSX.Element;
  /** Pixels between the children (default 8). */
  gap?: number;
  justify?: Justify;
  align?: Align;
  /** Takes the room that is left in its parent. */
  grow?: boolean;
  w?: number;
  h?: number;
}
/** Sizes are set only when given: a style key that is absent leaves the layout to flexbox. */
function sized(props: { w?: number; h?: number }, base: Record<string, number | string>): Record<string, number | string> {
  if (props.w !== undefined) base.width = props.w;
  if (props.h !== undefined) base.height = props.h;
  return base;
}

/** Children side by side, centred vertically. */
export function Row(props: BoxProps) {
  return <View class={rowClass(props.justify ?? "start", props.align ?? "center", props.grow ?? false)}
    style={sized(props, { gap: props.gap ?? space.sm })}>{props.children}</View>;
}
/** Children one under the other, as wide as the column. */
export function Col(props: BoxProps) {
  return <View class={colClass(props.justify ?? "start", props.align ?? "stretch", props.grow ?? false)}
    style={sized(props, { gap: props.gap ?? space.sm })}>{props.children}</View>;
}
/** Pushes what follows to the far end of a Row or Col. */
export function Spacer() {
  return <View class="flex-1" />;
}

/** Port A's Units are fed from the EXT 5V rail, which is off after a boot:
 *  without it nothing answers on the bus. `Screen` calls this. */
export function powerPortA(on = true): boolean {
  const now = deviceStatus()?.switches.find(item => item.id === "ext-5v")?.on;
  return now === on ? true : setSwitch("ext-5v", on);
}

/** The whole 640 x 360 screen: a column with padding. Everything an app
 *  draws goes inside one Screen. It switches Port A's power on unless
 *  `portA={false}`, and shows the toasts of `toast()`. */
export function Screen(props: { children?: JSX.Element; pad?: number; gap?: number; portA?: boolean; color?: string }) {
  if (props.portA ?? true) powerPortA();
  return <AuxiliarySurface>
    <View class="w-full h-full flex-col" style={{ bgColor: props.color ?? theme().bg, paddingT: props.pad ?? space.md, paddingB: props.pad ?? space.md, paddingL: props.pad ?? space.lg, paddingR: props.pad ?? space.lg, gap: props.gap ?? space.md }}>
      {props.children}
    </View>
    <Toast />
  </AuxiliarySurface>;
}

/** The top line of a screen: what it is, one line about it, and its state at the right. */
export function Header(props: { title: string; subtitle?: string; status?: string; tone?: Tone; children?: JSX.Element }) {
  return <View class="flex-row items-center justify-between" style={{ height: 32, gap: space.md }}>
    <View class="flex-row items-end flex-1" style={{ gap: space.sm + 2 }}>
      <Label size="xl" bold>{props.title}</Label>
      <Show when={props.subtitle}><View style={{ paddingB: 2 }}><Label size="sm" tone="muted">{props.subtitle}</Label></View></Show>
    </View>
    {props.children}
    <Show when={props.status}><Chip tone={props.tone ?? "neutral"} dot>{props.status}</Chip></Show>
  </View>;
}

/** A panel that groups one idea: a caption (`title`) and a column of
 *  children, which `justify` and `align` place. With `onPress` the whole card
 *  is a button. */
export function Card(props: BoxProps & { title?: string; pad?: number; color?: string; border?: string; onPress?: () => void }) {
  const style = () => sized(props, {
    bgColor: props.color ?? theme().panel, radius: radius.lg, gap: space.sm,
    paddingT: props.pad ?? space.md, paddingB: props.pad ?? space.md, paddingL: props.pad ?? 14, paddingR: props.pad ?? 14,
    borderColor: props.border ?? "#00000000", borderWidth: props.border ? 2 : 0,
  });
  const inner = () => <>
    <Show when={props.title}><Label size="xs" bold tone="muted">{props.title}</Label></Show>
    <View class={colClass(props.justify ?? "start", props.align ?? "stretch", true)} style={{ gap: props.gap ?? space.sm }}>{props.children}</View>
  </>;
  return <Show when={props.onPress} fallback={
    <View class={props.grow ? "flex-col flex-1" : "flex-col"} style={style()}>{inner()}</View>}>
    <View focusable onPress={props.onPress} class={props.grow ? "flex-col flex-1 active:opacity-70" : "flex-col active:opacity-70"} style={style()}>{inner()}</View>
  </Show>;
}

// ---- values ------------------------------------------------------------------

/** A big number with its unit and a caption: the thing the screen is about.
 *  `size` lg is 54 px (one or two a screen), md 36 px, sm 24 px. */
export function Stat(props: { value: string | number; unit?: string; label?: string; size?: "lg" | "md" | "sm"; tone?: Ink; color?: string; w?: number; align?: "left" | "right" }) {
  const size = (): Size => props.size === "sm" ? "2xl" : props.size === "md" ? "4xl" : "5xl";
  const unitSize = (): Size => props.size === "sm" ? "sm" : props.size === "md" ? "lg" : "xl";
  // The unit sits on the number's baseline: the line boxes differ by this much.
  const lift = () => props.size === "sm" ? 3 : props.size === "md" ? 6 : 10;
  return <View class={props.align === "right" ? "flex-col items-end" : "flex-col items-start"} style={sized(props, { gap: 0 })}>
    <Show when={props.label}><Label size="xs" bold tone="muted">{props.label}</Label></Show>
    <View class="flex-row items-end" style={{ gap: 6 }}>
      <Label size={size()} bold tone={props.tone} color={props.color}>{props.value}</Label>
      <Show when={props.unit}><View style={{ paddingB: lift() }}><Label size={unitSize()} tone="muted">{props.unit}</Label></View></Show>
    </View>
  </View>;
}

/** A name at the left and its value at the right: a line of a list. */
export function Field(props: { label: string; value?: string | number; tone?: Ink; children?: JSX.Element }) {
  return <View class="flex-row items-center justify-between" style={{ gap: space.md, minH: 24 }}>
    <Label size="sm" tone="muted">{props.label}</Label>
    <Show when={props.children} fallback={<Label size="sm" bold tone={props.tone}>{props.value ?? ""}</Label>}>{props.children}</Show>
  </View>;
}

/** A small round light. */
export function Dot(props: { tone?: Tone; color?: string; size?: number; pulse?: boolean }) {
  const size = () => props.size ?? 8;
  return <View class={props.pulse ? "animate-pulse" : "opacity-100"} style={{ width: size(), height: size(), radius: size() / 2, bgColor: props.color ?? toneColor(props.tone) }} />;
}

/** A short word in a pill: a state, a tag. */
export function Chip(props: { children?: JSX.Element; tone?: Tone; color?: string; dot?: boolean; solid?: boolean }) {
  const color = () => props.color ?? (props.tone === undefined || props.tone === "neutral" ? theme().muted : toneColor(props.tone));
  return <View class="flex-row items-center" style={{ height: 24, radius: 12, paddingL: 10, paddingR: 10, gap: 6, bgColor: props.solid ? color() : alpha(color(), 0.16) }}>
    <Show when={props.dot}><Dot color={props.solid ? theme().onAccent : color()} size={6} /></Show>
    <Label size="xs" bold color={props.solid ? theme().onAccent : color()}>{props.children}</Label>
  </View>;
}

/** What a screen shows instead of its values: no Unit on the port, a sensor that stopped answering. */
export function Notice(props: { title: string; lines?: string[]; tone?: Tone; children?: JSX.Element }) {
  return <View class="flex-col flex-1 items-center justify-center" style={{ gap: space.sm, bgColor: theme().panel, radius: radius.lg, paddingL: space.xl, paddingR: space.xl }}>
    <Dot tone={props.tone ?? "warn"} size={12} pulse />
    <Label size="xl" bold>{props.title}</Label>
    <View class="flex-col items-center" style={{ gap: 2 }}>
      <Index each={props.lines ?? []}>{line => <Label size="sm" tone="muted">{line()}</Label>}</Index>
    </View>
    {props.children}
  </View>;
}

// ---- controls ----------------------------------------------------------------

/** A button a finger can hit: 44 px high unless `h` says otherwise. */
export function Button(props: {
  label: string; onPress: () => void; tone?: Tone | "ghost"; w?: number; h?: number; grow?: boolean; disabled?: boolean; size?: Size;
}) {
  const fill = () => props.tone === "ghost" ? "#00000000" : props.tone === undefined || props.tone === "neutral" ? theme().raised : toneColor(props.tone);
  const text = () => props.tone === undefined || props.tone === "neutral" ? theme().text : props.tone === "ghost" ? theme().accent : theme().onAccent;
  return <View focusable onPress={() => { if (!props.disabled) props.onPress(); }}
    class={props.grow ? "flex-row flex-1 items-center justify-center active:opacity-60" : "flex-row items-center justify-center active:opacity-60"}
    style={sized({ w: props.w }, {
      height: props.h ?? TOUCH, minW: TOUCH, radius: radius.md, paddingL: space.lg, paddingR: space.lg, bgColor: fill(),
      borderColor: props.tone === "ghost" ? theme().line : "#00000000", borderWidth: props.tone === "ghost" ? 1 : 0, opacity: props.disabled ? 0.4 : 1,
    })}>
    <Label size={props.size ?? "base"} bold color={text()}>{props.label}</Label>
  </View>;
}

/** An on/off switch with its name at the left. The whole line takes the touch. */
export function Toggle(props: { label?: string; value: boolean; onChange: (value: boolean) => void; tone?: Tone }) {
  let knob: NodeMirror | undefined;
  let first = true;
  createEffect(() => {
    const x = props.value ? 22 : 0;
    if (!knob) return;
    if (first) { first = false; jump(knob, "translateX", x); } else animate(knob, "translateX", x, { dur: 140, easing: "out" });
  });
  return <View focusable onPress={() => props.onChange(!props.value)} class="flex-row items-center justify-between active:opacity-70" style={{ height: TOUCH, gap: space.md }}>
    <Show when={props.label}><Label size="base">{props.label}</Label></Show>
    <View class="flex-row items-center" style={{ width: 52, height: 30, radius: 15, paddingL: 3, bgColor: props.value ? toneColor(props.tone ?? "accent") : theme().line }}>
      <View ref={(node: NodeMirror) => { knob = node; }} style={{ width: 24, height: 24, radius: 12, bgColor: "#ffffff" }} />
    </View>
  </View>;
}

const SLIDER_CELLS = 20;
/** A value set by dragging or touching the track. `w` is the track's width in pixels (default 240). */
export function Slider(props: {
  value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number; w?: number; tone?: Tone; color?: string;
}) {
  const min = () => props.min ?? 0, max = () => props.max ?? 1, width = () => props.w ?? 240;
  const fraction = () => Math.max(0, Math.min(1, (props.value - min()) / (max() - min() || 1)));
  const color = () => props.color ?? toneColor(props.tone ?? "accent");
  const thumb = 24;
  let track: NodeMirror | undefined;
  const cells: NodeMirror[] = [];
  let base = 0;
  const set = (next: number) => {
    let value = min() + Math.max(0, Math.min(1, next)) * (max() - min());
    if (props.step) value = Math.round(value / props.step) * props.step;
    if (value !== props.value) props.onChange(value);
  };
  createGesture({
    surface: "auxiliary", region: { node: () => track }, axis: "x", panSlop: 3,
    // The touch lands on one of the cells under the track: that says where
    // along the track it is, so the thumb jumps there and then follows.
    onDown(contact) {
      const cell = cells.findIndex(node => node.id === contact.hit);
      base = cell >= 0 ? ((cell + 0.5) / SLIDER_CELLS * width() - thumb / 2) / (width() - thumb) : fraction();
      if (cell >= 0) set(base);
    },
    onPanMove(contact) { set(base + contact.dx / (width() - thumb)); },
  });
  return <View ref={(node: NodeMirror) => { track = node; }} class="relative" style={{ width: width(), height: TOUCH }}>
    <View class="absolute left-0 top-0 w-full h-full flex-row">
      {Array.from({ length: SLIDER_CELLS }, (_, index) => <View ref={(node: NodeMirror) => { cells[index] = node; }} class="flex-1 h-full" />)}
    </View>
    <View class="absolute" style={{ insetL: 0, insetT: TOUCH / 2 - 3, width: width(), height: 6, radius: 3, bgColor: theme().line, hitPass: 1 }} />
    <View class="absolute" style={{ insetL: 0, insetT: TOUCH / 2 - 3, width: thumb / 2 + fraction() * (width() - thumb), height: 6, radius: 3, bgColor: color(), hitPass: 1 }} />
    <View class="absolute" style={{ insetL: fraction() * (width() - thumb), insetT: TOUCH / 2 - thumb / 2, width: thumb, height: thumb, radius: thumb / 2, bgColor: "#ffffff", borderColor: color(), borderWidth: 3, hitPass: 1 }} />
  </View>;
}

// ---- meters ------------------------------------------------------------------

/** A horizontal bar filled to `value` (0..1). It is as wide as its parent unless `w` is given. */
export function Bar(props: { value: number; tone?: Tone; color?: string; h?: number; w?: number }) {
  const value = () => Math.max(0, Math.min(1, Number.isFinite(props.value) ? props.value : 0));
  const h = () => props.h ?? 10;
  return <View class="flex-row overflow-hidden" style={sized({ w: props.w }, { height: h(), radius: h() / 2, bgColor: theme().line })}>
    <View class="h-full" style={{ grow: value(), basis: 0, radius: h() / 2, bgColor: props.color ?? toneColor(props.tone ?? "accent") }} />
    <View class="h-full" style={{ grow: 1 - value(), basis: 0 }} />
  </View>;
}

/** A ring filled clockwise to `value` (0..1), with whatever is given inside it (a Stat, a Label). */
export function Gauge(props: { value: number; size?: number; thickness?: number; tone?: Tone; color?: string; sweep?: number; children?: JSX.Element }) {
  const size = () => props.size ?? 120, thickness = () => props.thickness ?? 10;
  const sweep = () => props.sweep ?? 270;
  const value = () => Math.max(0, Math.min(1, Number.isFinite(props.value) ? props.value : 0));
  return <View class="relative" style={{ width: size(), height: size() }}>
    <View class="absolute left-0 top-0" style={{ width: size(), height: size(), bgColor: theme().line, arcStart: -sweep() / 2, arcSweep: sweep(), arcWidth: thickness() }} />
    <View class="absolute left-0 top-0" style={{ width: size(), height: size(), bgColor: props.color ?? toneColor(props.tone ?? "accent"), arcStart: -sweep() / 2, arcSweep: Math.max(0.01, sweep() * value()), arcWidth: thickness(), opacity: value() > 0 ? 1 : 0 }} />
    <View class="absolute left-0 top-0 flex-col items-center justify-center" style={{ width: size(), height: size() }}>{props.children}</View>
  </View>;
}

/** The history of a value, oldest at the left: one column for each entry of
 *  `values`. NaN or undefined is a gap. The range follows the data unless
 *  `min` and `max` are given. `mark` draws a line at a level (a limit). */
export function Chart(props: {
  values: readonly (number | undefined)[]; h?: number; w?: number; grow?: boolean; tone?: Tone; color?: string;
  min?: number; max?: number; kind?: "area" | "bars" | "line"; labels?: boolean; digits?: number; unit?: string;
  mark?: number; markColor?: string;
}) {
  const h = () => props.h ?? 72;
  const color = () => props.color ?? toneColor(props.tone ?? "accent");
  const real = () => props.values.filter((value): value is number => value !== undefined && Number.isFinite(value));
  const range = () => {
    const values = real();
    let low = props.min ?? (values.length ? Math.min(...values) : 0), high = props.max ?? (values.length ? Math.max(...values) : 1);
    if (props.mark !== undefined && props.min === undefined && props.max === undefined) { low = Math.min(low, props.mark); high = Math.max(high, props.mark); }
    if (high - low < 1e-9) { low -= 0.5; high += 0.5; }
    // A little air above and below a range that follows the data.
    const air = (high - low) * 0.12;
    return { low: props.min ?? low - air, high: props.max ?? high + air };
  };
  const level = (value: number) => { const { low, high } = range(); return Math.max(0, Math.min(1, (value - low) / (high - low))); };
  const inner = () => h() - 8;
  const text = (value: number) => `${value.toFixed(props.digits ?? 1)}${props.unit ?? ""}`;
  const kind = () => props.kind ?? "area";
  return <View class={props.grow ? "relative overflow-hidden flex-1" : "relative overflow-hidden"} style={sized({ w: props.w }, { height: h(), radius: radius.sm, bgColor: theme().bg })}>
    <View class="absolute left-0 top-0 w-full h-full flex-row items-end" style={{ paddingT: 4, paddingB: 4, gap: kind() === "bars" ? 2 : 0 }}>
      <Index each={props.values}>{value => {
        const on = () => value() !== undefined && Number.isFinite(value()!);
        const top = () => on() ? Math.max(2, Math.round(level(value()!) * inner())) : 0;
        return <View class="flex-1 h-full flex-col justify-end">
          <View style={{ height: on() ? (kind() === "bars" ? top() : 2) : 0, bgColor: color(), radius: kind() === "bars" ? 2 : 0 }} />
          <View style={{ height: on() && kind() === "area" ? Math.max(0, top() - 2) : 0, bgColor: alpha(color(), 0.22) }} />
          <View style={{ height: on() && kind() === "line" ? Math.max(0, top() - 2) : 0 }} />
        </View>;
      }}</Index>
    </View>
    <Show when={props.mark !== undefined}>
      <View class="absolute left-0 w-full" style={{ insetT: 4 + Math.round((1 - level(props.mark ?? 0)) * inner()), height: 1, bgColor: props.markColor ?? theme().warn, opacity: 0.8 }} />
    </Show>
    <Show when={(props.labels ?? true) && real().length > 0}>
      <Text class="absolute text-2xs" style={{ insetL: 6, insetT: 3, textColor: theme().faint }}>{text(Math.max(...real()))}</Text>
      <Text class="absolute text-2xs" style={{ insetL: 6, insetT: h() - FONT["2xs"].line - 3, textColor: theme().faint }}>{text(Math.min(...real()))}</Text>
    </Show>
  </View>;
}

/** A Chart with nothing but its line: a trend beside a number. */
export function Sparkline(props: { values: readonly (number | undefined)[]; h?: number; w?: number; grow?: boolean; tone?: Tone; color?: string }) {
  return <Chart values={props.values} h={props.h ?? 28} w={props.w} grow={props.grow} tone={props.tone} color={props.color} kind="line" labels={false} />;
}

// ---- toast -------------------------------------------------------------------

const [toastState, setToastState] = createSignal<{ text: string; tone: Tone; id: number } | undefined>();
let toastId = 0;
/** Shows a line at the top of the screen for a few seconds. A touch dismisses it. */
export function toast(text: string, tone: Tone = "neutral", seconds = 2.5): void {
  const id = ++toastId;
  setToastState({ text, tone, id });
  after(seconds, () => { if (toastState()?.id === id) setToastState(undefined); });
}
/** Where toasts show. `Screen` holds one. */
export function Toast() {
  const rise = (node: NodeMirror) => {
    jump(node, "translateY", -24); jump(node, "opacity", 0);
    animate(node, "translateY", 0, { dur: 220, easing: "out" }); animate(node, "opacity", 1, { dur: 160, easing: "out" });
  };
  return <Show when={toastState()} keyed>{state =>
    <View class="absolute left-0 w-full flex-row justify-center" style={{ insetT: 8, hitPass: 1 }}>
      <View ref={rise} focusable onPress={() => setToastState(undefined)} class="flex-row items-center"
        style={{ height: 40, radius: 20, paddingL: space.lg, paddingR: space.lg, gap: space.sm, bgColor: theme().raised, borderColor: state.tone === "neutral" ? theme().line : toneColor(state.tone), borderWidth: 1 }}>
        <Show when={state.tone !== "neutral"}><Dot tone={state.tone} /></Show>
        <Label size="sm" bold>{state.text}</Label>
      </View>
    </View>}
  </Show>;
}

// ---- the worker's channels -----------------------------------------------------

interface Decoder<T> { decode(bytes: Uint8Array): T; empty?(): T }

/** The newest record of a snapshot channel, decoded, as a signal. It is
 *  `initial` (or the codec's empty record) until the worker publishes. */
export function useChannel<T>(name: string, codec: Decoder<T>, initial?: T): Accessor<T> {
  const channel = worker.channel(name);
  const [value, setValue] = createSignal<T>(initial ?? codec.empty?.() as T);
  let last: Uint8Array | undefined;
  onFrame(() => {
    // The snapshot is handed over again every frame: decode only new bytes.
    for (const view of channel.observe()) {
      const bytes = view.copy();
      if (last && last.length === bytes.length && last.every((byte, index) => byte === bytes[index])) continue;
      last = bytes;
      setValue(() => codec.decode(bytes));
    }
  });
  return value;
}

/** Every record of a ring channel (events from the worker), as they arrive. */
export function onChannel<T>(name: string, codec: Decoder<T>, handler: (record: T) => void): void {
  const channel = worker.channel(name);
  onFrame(() => { for (const view of channel.observe()) handler(codec.decode(view.copy())); });
}

/** Sends one record to the worker. False when the ring is full: the worker has not read the last ones yet. */
export function send(name: string, bytes: Uint8Array): boolean {
  let channel = outgoing.get(name);
  if (!channel) outgoing.set(name, channel = worker.channel(name));
  return channel.publish(bytes);
}
const outgoing = new Map<string, ReturnType<typeof worker.channel>>();

/** A counter that goes up once a second of the app's own time, for clocks and timeouts. */
export function useSeconds(): Accessor<number> {
  const [seconds, setSeconds] = createSignal(0);
  let frames = 0;
  onFrame(() => { if (++frames % 30 === 0) setSeconds(frames / 30); });
  return seconds;
}
