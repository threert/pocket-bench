// 接星星, the UI and the game. Stars fall from the night sky; the tray at the
// bottom follows the Joystick2's stick. A catch is a point and a green flash
// of the Unit's LED, a miss costs one of three lives and flashes it red.
// After 游戏结束 a press of the stick starts again.
//
// The game runs here, in `onFrame`, 30 times a second: the worker only says
// where the stick is (worker.ts). What moves is moved with transforms
// (`jump` and `animate` on a node), which cost no layout.
// The two sprites: star.png (32 x 64: the star, with the trail of its fall
// above it) and heart.png (16 x 16). A picture's sides are powers of two.
import { createSignal, Show } from "solid-js";
import { animate, jump } from "@pocketjs/framework/animation";
import { Image, Text, View, type NodeMirror } from "@pocketjs/framework/components";
import { onFrame } from "@pocketjs/framework/lifecycle";
import { mount } from "@pocketjs/framework/solid";
import { Command, State, Status } from "./protocol";
import { Button, Label, Notice, Screen, dark, send, setTheme, useChannel } from "./ui";

/** The screen. */
const W = 640, H = 360;
/** The tray: its size, the height of its top edge, and how far its middle goes from the middle of the screen. */
const TRAY_W = 96, TRAY_H = 20, TRAY_Y = 310, REACH = (W - TRAY_W) / 2 - 12;
/** The star: its size, its sprite's height with the trail, and how many can be on the screen at once. */
const STAR = 32, SPRITE_H = 64, POOL = 8;
const LIVES = 3;
/** Pixels a frame: the stars of the opening, and the middle speed of the ones after it. */
const OPENING_SPEED = 5.4, SPEED = 5;
/** Where the first stars of every round fall, from -1 (the tray's left end) to 1: a warm-up before the
 *  stars come at random. The first SOLO of them come one at a time. (The lesson's playthrough knows these.) */
const OPENING = [-0.55, 0.5, -0.2, 0.35], SOLO = 3;

const SKY_TOP = "#0a1030", SKY_BOTTOM = "#2b1d55", GOLD = "#ffd95e";
/** The parts of ui/ in the colours of this night: the panel of a Notice, the muted texts. */
const NIGHT = { ...dark, bg: SKY_TOP, panel: "#1c1b4b", raised: "#2a2866", line: "#3a3780", muted: "#a9a8d6", faint: "#6f6da8" };

type Mode = "ready" | "playing" | "over";
interface Star { falling: boolean; x: number; y: number; speed: number; /** Frames until its place is free again. */ rest: number }

/** The far stars of the sky: fixed, small and faint. */
const SKY = Array.from({ length: 28 }, (_, index) => {
  const at = (index * 2654435761) >>> 0;
  return { x: at % 631 + 4, y: (at >>> 10) % 262 + 6, size: index % 5 === 0 ? 3 : 2, opacity: 0.15 + (index % 4) * 0.1 };
});

mount(() => {
  setTheme(NIGHT);
  const state = useChannel("state", State);
  const live = () => state().status === Status.live;

  // What the screen writes as text is in signals; the rest of the game is plain variables, changed every frame.
  const [mode, setMode] = createSignal<Mode>("ready");
  const [score, setScore] = createSignal(0);
  const [lives, setLives] = createSignal(LIVES);
  const stars: Star[] = Array.from({ length: POOL }, () => ({ falling: false, x: 0, y: 0, speed: 0, rest: 0 }));
  /** The middle of the tray; stars sent down this round; frames until the next one; frames since the app started. */
  let trayX = W / 2, sent = 0, wait = 0, frames = 0;
  /** The worker's count of presses when it was last looked at. */
  let presses = -1;
  let seed = 1;
  /** 0..1, the same sequence for the same seed. */
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x1_0000_0000; };

  // The nodes that move.
  let tray: NodeMirror | undefined, glow: NodeMirror | undefined, ground: NodeMirror | undefined;
  const sprites: NodeMirror[] = [], pluses: NodeMirror[] = [];
  let nextPlus = 0;

  const flash = (r: number, g: number, b: number) => send("commands", Command.encode("flash", { r, g, b }));

  /** Clears the sky. */
  function clear(): void {
    stars.forEach((star, index) => { star.falling = false; star.rest = 0; if (sprites[index]) jump(sprites[index]!, "opacity", 0); });
  }
  /** A new round: three lives, no points, the opening stars again. */
  function restart(): void {
    clear();
    setScore(0); setLives(LIVES);
    sent = 0; wait = 20; seed = frames | 1;
    setMode("playing");
  }
  /** The stick is gone in the middle of a round: the round waits, with its score. */
  function pause(): void {
    // A star of the opening that was in the air comes again.
    if (sent <= SOLO && stars.some(star => star.falling)) --sent;
    clear();
    setMode("ready");
  }

  /** Sends the next star down. */
  function drop(): void {
    const index = stars.findIndex(star => !star.falling && star.rest === 0);
    if (index < 0) return;
    const star = stars[index]!, sprite = sprites[index];
    star.x = W / 2 + (sent < OPENING.length ? OPENING[sent]! : random() * 2 - 1) * REACH;
    star.y = -STAR / 2;
    star.speed = sent < SOLO ? OPENING_SPEED : SPEED * (0.85 + random() * 0.5);
    star.falling = true;
    ++sent;
    if (sprite) { jump(sprite, "scale", 1); jump(sprite, "opacity", 1); }
  }

  function caught(star: Star, index: number): void {
    star.falling = false; star.rest = 8;
    setScore(score() + 1);
    flash(0, 255, 40);
    // The star bursts, the tray lights up, a "+1" rises from where it landed.
    const sprite = sprites[index];
    if (sprite) { animate(sprite, "scale", 1.7, { dur: 200, easing: "out" }); animate(sprite, "opacity", 0, { dur: 200, easing: "out" }); }
    if (glow) { jump(glow, "opacity", 1); animate(glow, "opacity", 0, { dur: 320, easing: "out" }); }
    const plus = pluses[nextPlus++ % pluses.length];
    if (plus) {
      jump(plus, "translateX", star.x - 12); jump(plus, "translateY", TRAY_Y - 34); jump(plus, "opacity", 1);
      animate(plus, "translateY", TRAY_Y - 74, { dur: 520, easing: "out" }); animate(plus, "opacity", 0, { dur: 520, easing: "in" });
    }
  }

  function missed(star: Star, index: number): void {
    star.falling = false;
    if (sprites[index]) jump(sprites[index]!, "opacity", 0);
    flash(255, 0, 0);
    if (ground) { jump(ground, "opacity", 0.9); animate(ground, "opacity", 0, { dur: 420, easing: "out" }); }
    setLives(lives() - 1);
    if (lives() > 0) return;
    // The last life: the stars still in the air fade away.
    stars.forEach((other, at) => { if (other.falling && sprites[at]) animate(sprites[at]!, "opacity", 0, { dur: 300, easing: "out" }); other.falling = false; });
    setMode("over");
  }

  /** One frame of a round. */
  function play(): void {
    // The opening comes one star at a time; after it, the more points the closer together.
    if (sent < SOLO) { if (!stars.some(star => star.falling) && --wait <= 0) drop(); }
    else if (--wait <= 0) { drop(); wait = Math.max(13, 34 - score() * 0.6); }

    stars.forEach((star, index) => {
      if (star.rest > 0) --star.rest;
      if (!star.falling) return;
      star.y += star.speed;
      // Caught while its lower half is inside the tray; missed when it reaches the ground.
      const over = Math.abs(star.x - trayX) <= TRAY_W / 2 + 8;
      if (over && star.y + 10 >= TRAY_Y && star.y <= TRAY_Y + TRAY_H) { caught(star, index); if (sent <= SOLO) wait = 10; return; }
      if (star.y >= H - 6) { missed(star, index); if (sent <= SOLO) wait = 10; return; }
      const sprite = sprites[index];
      if (sprite) { jump(sprite, "translateX", star.x - STAR / 2); jump(sprite, "translateY", star.y - SPRITE_H + STAR / 2); }
    });
  }

  onFrame(() => {
    ++frames;
    const now = state();
    const pressed = presses >= 0 && now.presses !== presses;
    presses = now.presses;
    if (now.status !== Status.live) { if (mode() === "playing") pause(); return; }

    // The tray goes where the stick points, and gets there smoothly: 40 % of the way every frame.
    trayX += (W / 2 + Math.max(-1, Math.min(1, now.x)) * REACH - trayX) * 0.4;
    if (tray) jump(tray, "translateX", trayX - TRAY_W / 2);

    if (mode() === "playing") play();
    else if (mode() === "over") { if (pressed) restart(); }
    // Ready: the first push of the stick (or a press) starts the round, or takes up the one that waited.
    else if (pressed || Math.abs(now.x) > 0.25 || Math.abs(now.y) > 0.25) { wait = 20; seed = frames | 1; setMode("playing"); }
  });

  /** A round that waits with points or lost lives is one the stick left in the middle. */
  const waiting = () => score() > 0 || lives() < LIVES;

  return <Screen pad={0} gap={0} color={SKY_TOP}>
    <View class="relative w-full h-full overflow-hidden bg-gradient-to-b" style={{ gradFrom: SKY_TOP, gradTo: SKY_BOTTOM }}>
      {SKY.map(dot => <View class="absolute" style={{ insetL: dot.x, insetT: dot.y, width: dot.size, height: dot.size, radius: dot.size / 2, bgColor: "#ffffff", opacity: dot.opacity }} />)}

      {/* The ground lights up red when a star gets through. */}
      <View class="absolute" style={{ insetL: 0, insetT: H - 14, width: W, height: 14, bgColor: "#1a1238" }} />
      <View ref={(node: NodeMirror) => { ground = node; }} class="absolute bg-gradient-to-t" style={{ insetL: 0, insetT: H - 60, width: W, height: 60, gradFrom: "#ff5d5d", gradTo: "#ff5d5d00", opacity: 0 }} />

      {/* The falling stars: POOL sprites, each one shown while its star is in the air. */}
      {stars.map((_, index) => <Image ref={(node: NodeMirror) => { sprites[index] = node; }} src="star.png" class="absolute left-0 top-0" style={{ width: STAR, height: SPRITE_H, opacity: 0 }} />)}

      {/* The tray: a bar with two raised ends, and the same shape in white over it, shown for the moment of a catch. */}
      <View ref={(node: NodeMirror) => { tray = node; }} class="absolute left-0" style={{ insetT: TRAY_Y, width: TRAY_W, height: TRAY_H }}>
        <View class="absolute bg-gradient-to-b" style={{ insetL: 0, insetT: 8, width: TRAY_W, height: 12, radius: 6, gradFrom: "#9bdcff", gradTo: "#3f8cf0" }} />
        <View class="absolute" style={{ insetL: 0, insetT: 0, width: 10, height: 16, radius: 5, bgColor: "#9bdcff" }} />
        <View class="absolute" style={{ insetL: TRAY_W - 10, insetT: 0, width: 10, height: 16, radius: 5, bgColor: "#9bdcff" }} />
        <View ref={(node: NodeMirror) => { glow = node; }} class="absolute left-0 top-0" style={{ width: TRAY_W, height: TRAY_H, opacity: 0 }}>
          <View class="absolute" style={{ insetL: 0, insetT: 8, width: TRAY_W, height: 12, radius: 6, bgColor: "#fff6cf" }} />
          <View class="absolute" style={{ insetL: 0, insetT: 0, width: 10, height: 16, radius: 5, bgColor: "#fff6cf" }} />
          <View class="absolute" style={{ insetL: TRAY_W - 10, insetT: 0, width: 10, height: 16, radius: 5, bgColor: "#fff6cf" }} />
        </View>
      </View>
      {[0, 1, 2].map(index => <Text ref={(node: NodeMirror) => { pluses[index] = node; }} class="absolute left-0 top-0 text-xl font-bold" style={{ textColor: GOLD, opacity: 0 }}>+1</Text>)}

      {/* The score at the top left, the lives at the top right. */}
      <View class="absolute flex-row items-center justify-between" style={{ insetL: 0, insetT: 0, width: W, height: 48, paddingL: 16, paddingR: 16 }}>
        <Label size="2xl" bold>得分：{score()}</Label>
        <View class="flex-row items-center" style={{ gap: 6 }}>
          <Label size="sm" tone="muted">生命</Label>
          {[0, 1, 2].map(index => <Image src="heart.png" style={{ width: 16, height: 16, opacity: index < lives() ? 1 : 0.18 }} />)}
        </View>
      </View>

      <Show when={live() && mode() === "ready"}>
        <View class="absolute flex-col items-center" style={{ insetL: 0, insetT: 92, width: W, gap: 8 }}>
          <Label size="4xl" bold>接星星</Label>
          <Label size="xl" bold color={GOLD}>{waiting() ? "推动摇杆继续" : "推动摇杆开始"}</Label>
          <Label size="xs" tone="muted">左右推摇杆移动托盘 · 接到一颗加 1 分 · 漏掉 3 颗游戏结束</Label>
        </View>
      </Show>
      <Show when={live() && mode() === "over"}>
        <View class="absolute flex-col items-center" style={{ insetL: 0, insetT: 76, width: W, gap: 8 }}>
          <Label size="4xl" bold color="#ff7a7a">游戏结束</Label>
          <Label size="xl" bold color={GOLD}>接住了 {score()} 颗星星</Label>
          <Label size="sm" tone="muted">按下摇杆重新开始</Label>
          <Button label="再来一局" tone="accent" w={168} h={48} onPress={restart} />
        </View>
      </Show>

      {/* Without the stick there is no game: say which Unit, and where it goes. */}
      <Show when={!live()}>
        <View class="absolute left-0 top-0 w-full h-full flex-col" style={{ paddingT: 56, paddingB: 16, paddingL: 16, paddingR: 16 }}>
          <Notice title="请插上摇杆模块" lines={["把『摇杆』模块（Joystick2）接到 Port A（红色接口），", waiting() ? "这一局等着你回来。" : "推一下摇杆，星星就开始掉。"]} />
        </View>
      </Show>
    </View>
  </Screen>;
});
