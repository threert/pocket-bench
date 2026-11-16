// 门禁打卡: RFID 2 + 4-Relay. A known card is welcomed and lights the sign
// through a relay, an unknown one is refused; a visit log.
// Cards in the room: 员工卡 04 A3 1B 7C, 访客卡 9E 12 55 0D (both MIFARE Classic 1K), a key fob (NTAG).
// Relays: CH1 desk lamp, CH2 fan, CH3 "ON AIR" sign, CH4 amber beacon.
import type { LessonDef } from "../../../sidecar/src/lessons/types.ts";

export default {
  id: "door", number: 5, title: "门禁打卡", units: ["rfid2", "relay4"], minutes: 15, level: 2,
  tagline: "刷卡、亮灯、记一笔：给工作室装一套小门禁。",
  story: "RFID 模块能认出贴近它的卡片，继电器模块能替你按下四个真正的开关。两个凑到一起就是一套门禁：熟人亮灯放行，生人亮灯谢客。",
  steps: [
    {
      id: "plug",
      text: "把『RFID』和『四路继电器』两个模块都接上",
      hint: "先点盒子里的『RFID』模块，再点『四路继电器』。它们共用同一根 I2C 线，可以一起接在 Port A 上。",
      check: { all: [{ plugged: "rfid2" }, { plugged: "relay4" }] },
    },
    {
      id: "read",
      text: "请 AI 做出读卡界面，再把『员工卡』放到读卡器上",
      hint: "等 AI 写完，从卡架上拿起蓝色的员工卡，拖到 RFID 模块上面放下。屏幕上应该出现它的卡号 04 A3 1B 7C。",
      prompt: "做一个门禁 App：用 RFID 模块读卡，把卡号（UID，十六进制）用大字显示在屏幕上；没有卡的时候显示「请刷卡」。",
      check: { all: [{ changed: true }, { running: true }, { input: "rfid2.card", uid: "04 A3 1B 7C" }, { text: "04[ :.-]?A3[ :.-]?1B[ :.-]?7C" }] },
    },
    {
      id: "welcome",
      text: "让 AI 加上放行规则，然后重新刷一次员工卡",
      hint: "卡要先拿开再放回去，才算重新刷一次。刷对了，墙上的『ON AIR』灯牌会亮起来。",
      prompt: "加上门禁规则：员工卡（UID 04 A3 1B 7C）刷卡时显示「欢迎回来」，并用继电器把「ON AIR」灯牌（第 3 路）点亮 3 秒；别的卡显示「未登记的卡」，让警示灯（第 4 路）亮 2 秒。",
      check: { all: [{ running: true }, { input: "rfid2.card", uid: "04 A3 1B 7C" }, { text: "欢迎" }, { output: "relay4.relays", on: true }] },
    },
    {
      id: "refuse",
      text: "换『访客卡』刷一下，看它会不会被拦下",
      hint: "把员工卡放回卡架，拿起橙色的访客卡贴到读卡器上。这回亮的应该是那盏黄色警示灯。",
      check: { all: [{ running: true }, { input: "rfid2.card", uid: "9E 12 55 0D" }, { text: "未登记|拒绝|谢绝|不认识|陌生|无效" }] },
    },
    {
      id: "log",
      text: "让 AI 加一份打卡记录，再把两张卡各刷一次",
      hint: "记录写好以后，员工卡、访客卡轮流刷一下，两条记录都该出现在屏幕上。",
      prompt: "在屏幕右边加一份打卡记录：列出最近 5 次刷卡，每条写上卡名（员工卡 / 访客卡 / 未知卡）和结果（放行 / 拒绝），最新的排在最上面。",
      check: { all: [{ running: true }, { text: "员工卡" }, { text: "访客卡" }, { text: "放行" }, { text: "拒绝" }] },
    },
  ],
  prompts: [
    "把钥匙扣也登记成熟人，给它起名叫「备用钥匙」。",
    "连续刷错 3 次，就让警示灯一直闪，直到刷对为止。",
    "员工卡刷第一次算「上班」，再刷一次算「下班」，屏幕上显示今天在岗多久。",
  ],
} satisfies LessonDef;
