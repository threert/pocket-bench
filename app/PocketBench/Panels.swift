// The panels over the room: what to build (the quest), what is in the hand (a Unit), and the bar of views.
import AppKit
import SwiftUI

let KEY_LABELS: [String: String] = [
    "celsius": "温度", "humidity": "湿度", "pascals": "气压", "millimetres": "距离", "lux": "照度", "grams": "重量",
    "objectCelsius": "目标温度", "ambientCelsius": "环境温度", "knobs": "旋钮", "switch": "开关", "x": "摇杆 X", "y": "摇杆 Y",
    "button": "按键", "steps": "步数", "card": "卡片", "relays": "继电器", "leds": "灯", "led": "灯", "writes": "写卡次数", "sync": "灯随继电器",
]
let UNIT_NAMES: [String: String] = [
    "env3": "温湿度气压", "sonic": "超声波测距", "rfid2": "射频读卡", "angle8": "八旋钮", "joystick2": "摇杆", "dlight": "环境光",
    "relay4": "四路继电器", "scales": "电子秤", "ncir": "红外测温", "encoder": "旋转编码器",
]

let UNIT_USES: [String: String] = [
    "env3": "量温度、湿度和气压。做气象站、温室监控、舒适度提醒都靠它。",
    "sonic": "用超声波量前方的距离，2 厘米到 4.5 米。倒车雷达、身高尺、挥手开关。",
    "rfid2": "读写 13.56 MHz 的卡片和钥匙扣。门禁、打卡、给玩具认主人。",
    "angle8": "八个旋钮、一个拨动开关、九颗彩灯。调色台、调音台、参数面板。",
    "joystick2": "双轴摇杆带按键和彩灯。小游戏手柄、云台遥控。",
    "dlight": "量环境有多亮（勒克斯）。天黑自动开灯、屏幕自动调光。",
    "relay4": "四路开关，能通断真正的电器：这里接着台灯、风扇、灯牌和警示灯。",
    "scales": "小电子秤，带去皮按键和彩灯。厨房秤、数零件、咖啡手冲计重。",
    "ncir": "不接触就能量温度的红外传感器。测温枪、热饮提醒。",
    "encoder": "能一直转的旋钮，带按键和两颗彩灯。音量、菜单、定时器。",
]

func describe(_ value: Any?, unit: String = "") -> String {
    switch value {
    case let n as NSNumber:
        if CFGetTypeID(n) == CFBooleanGetTypeID() { return n.boolValue ? "开" : "关" }
        let d = n.doubleValue
        let text = abs(d) >= 1000 ? String(format: "%.0f", d) : d == d.rounded() ? String(format: "%.0f", d) : String(format: "%.1f", d)
        return unit.isEmpty ? text : "\(text) \(unit)"
    case let list as [Any]:
        if let numbers = list as? [NSNumber], numbers.count <= 8 { return numbers.map { describe($0) }.joined(separator: " ") }
        return "\(list.count) 项"
    case let object as JSON:
        if let uid = object["uid"] as? [Int] { return uid.map { String(format: "%02X", $0) }.joined(separator: " ") }
        return "…"
    case is NSNull, nil: return "—"
    default: return "\(value!)"
    }
}

struct TopBar: View {
    @EnvironmentObject var model: Model
    var body: some View {
        HStack(spacing: 10) {
            Text("Pocket Bench").font(.system(size: 13, weight: .bold)).foregroundStyle(Theme.ink)
            Rectangle().fill(Theme.line).frame(width: 1, height: 14)
            Button { model.showProjects = true } label: {
                HStack(spacing: 5) {
                    Text(model.projectTitle ?? "还没有工程").font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.ink).lineLimit(1)
                    Image(systemName: "chevron.down").font(.system(size: 8, weight: .bold)).foregroundStyle(Theme.faint)
                }
            }.buttonStyle(.plain)
            PhasePill()
        }
        .padding(.horizontal, 12).padding(.vertical, 7)
        .glass(12)
    }
}

struct PhasePill: View {
    @EnvironmentObject var model: Model
    var body: some View {
        let (text, tint): (String, Color) = {
            if model.connection != "connected" { return ("连接中", Theme.warn) }
            if !model.problems.isEmpty { return ("编译有错", Theme.bad) }
            switch model.phase {
            case "building": return ("构建中", Theme.warn)
            case "running": return ("运行中", Theme.accent)
            case "failed": return ("出错了", Theme.bad)
            default: return ("空闲", Theme.dim)
            }
        }()
        HStack(spacing: 5) {
            Circle().fill(tint).frame(width: 6, height: 6)
            Text(text).font(.system(size: 10.5, weight: .semibold)).foregroundStyle(tint)
        }
    }
}

/// The quest: what the current lesson asks for, step by step.
struct QuestCard: View {
    @EnvironmentObject var model: Model
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let lesson = model.lesson {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(String(format: "%02d", lesson.number)).font(.system(size: 11, weight: .heavy, design: .monospaced)).foregroundStyle(Color.black.opacity(0.85))
                        .padding(.horizontal, 6).padding(.vertical, 2).background(RoundedRectangle(cornerRadius: 5).fill(Theme.accent))
                    Text(lesson.title).font(.system(size: 15, weight: .bold)).foregroundStyle(Theme.ink)
                    Spacer()
                    Menu {
                        Button("全部任务卡") { model.showLessons = true }
                        Button("看参考答案") { model.send("lesson.solution") }
                        Button("重新开始这一关") { model.send("lesson.reset") }
                        Divider()
                        Button("退出任务，自由创作") { model.send("lesson.stop") }
                    } label: { Image(systemName: "ellipsis.circle").font(.system(size: 12)).foregroundStyle(Theme.dim) }
                    .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
                }
                Text(lesson.story).font(.system(size: 11.5)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true).lineSpacing(2)
                VStack(alignment: .leading, spacing: 7) {
                    let current = lesson.steps.first(where: { !$0.done })?.id
                    ForEach(lesson.steps) { step in
                        StepRow(step: step, current: step.id == current)
                    }
                }
                if lesson.steps.allSatisfy(\.done) && !lesson.steps.isEmpty {
                    HStack(spacing: 6) {
                        Image(systemName: "star.fill").foregroundStyle(Theme.warn)
                        Text("完成！换下一个任务试试").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.ink)
                        Spacer()
                        Button("下一个") { model.showLessons = true }.buttonStyle(QuietButton(prominent: true))
                    }.padding(.top, 2)
                }
            } else {
                HStack {
                    Text("今天做点什么？").font(.system(size: 15, weight: .bold)).foregroundStyle(Theme.ink)
                    Spacer()
                }
                Text("从任务卡开始，一步步把模块接到 Tab5 上，让 Agent 帮你写出带界面的应用。也可以直接在右边说出你的想法。")
                    .font(.system(size: 11.5)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true).lineSpacing(2)
                Button { model.showLessons = true } label: { Label("挑一张任务卡", systemImage: "list.clipboard") }.buttonStyle(QuietButton(prominent: true))
            }
        }
        .padding(14)
        .frame(width: 292, alignment: .leading)
        .glass()
    }
}

struct StepRow: View {
    @EnvironmentObject var model: Model
    let step: LessonStep
    let current: Bool
    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            ZStack {
                Circle().strokeBorder(step.done ? Theme.accent : current ? Theme.ink.opacity(0.7) : Theme.faint, lineWidth: 1.5).frame(width: 15, height: 15)
                if step.done { Circle().fill(Theme.accent).frame(width: 15, height: 15); Image(systemName: "checkmark").font(.system(size: 8, weight: .black)).foregroundStyle(.black.opacity(0.8)) }
            }.padding(.top, 1)
            VStack(alignment: .leading, spacing: 4) {
                Text(step.text).font(.system(size: 12, weight: current ? .semibold : .regular)).foregroundStyle(step.done ? Theme.dim : Theme.ink)
                    .strikethrough(step.done, color: Theme.faint).fixedSize(horizontal: false, vertical: true)
                if current && !step.hint.isEmpty { Text(step.hint).font(.system(size: 11)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true) }
                if current && !step.prompt.isEmpty {
                    Button { model.prompt(step.prompt) } label: {
                        HStack(alignment: .top, spacing: 5) {
                            Image(systemName: "sparkles").font(.system(size: 10)).padding(.top, 1.5)
                            Text(step.prompt).font(.system(size: 11)).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                        }
                        .foregroundStyle(Theme.accent).padding(.horizontal, 8).padding(.vertical, 6)
                        .background(RoundedRectangle(cornerRadius: 8).fill(Theme.accent.opacity(0.1)))
                        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Theme.accent.opacity(0.25)))
                    }.buttonStyle(.plain).help("发给 Agent")
                }
            }
        }
    }
}

/// The Unit in hand: what it is, where it answers, and what its sensors see right now.
struct UnitCard: View {
    @EnvironmentObject var model: Model
    let id: String
    var body: some View {
        let info = model.catalog[id]
        let plugged = model.plugged.contains(id)
        let values = model.sim["\(id)-1"] ?? [:]
        VStack(alignment: .leading, spacing: 9) {
            HStack(alignment: .firstTextBaseline) {
                Text(UNIT_NAMES[id] ?? id).font(.system(size: 14, weight: .bold)).foregroundStyle(Theme.ink)
                Text(info?.name ?? "").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.dim)
                Spacer()
                Button { model.room(do: "select", ["unit": ""]) } label: { Image(systemName: "xmark").font(.system(size: 9, weight: .bold)) }.buttonStyle(.plain).foregroundStyle(Theme.faint)
            }
            HStack(spacing: 5) {
                Chip(text: plugged ? "已接入 Port A" : "在盒子里", tint: plugged ? Theme.accent : Theme.dim)
                ForEach(info?.addresses ?? [], id: \.self) { Chip(text: $0.hexAddress, mono: true) }
                if let sku = info?.sku, !sku.isEmpty { Chip(text: sku, tint: Theme.faint, mono: true) }
            }
            if let use = UNIT_USES[id] ?? info?.use, !use.isEmpty { Text(use).font(.system(size: 11)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true).lineSpacing(2) }
            if plugged && !values.isEmpty {
                VStack(spacing: 4) {
                    ForEach(values.keys.sorted(), id: \.self) { key in
                        HStack {
                            Text(KEY_LABELS[key] ?? key).font(.system(size: 11)).foregroundStyle(Theme.dim)
                            Spacer()
                            Text(describe(values[key], unit: info?.inputs.first(where: { $0.key == key })?.unit ?? "")).font(.system(size: 11.5, weight: .semibold, design: .monospaced)).foregroundStyle(Theme.ink).lineLimit(1)
                        }
                    }
                }
                .padding(9).background(RoundedRectangle(cornerRadius: 9).fill(Theme.fill))
            }
            HStack {
                if plugged { Button("拔下") { model.room(do: "unplug", ["unit": id]) }.buttonStyle(QuietButton()) }
                else { Button("接到 Tab5") { model.room(do: "plug", ["unit": id]) }.buttonStyle(QuietButton(prominent: true)) }
                Spacer()
                Button { model.prompt("我接上了 \(info?.name ?? id)，帮我在 Tab5 上把它的读数显示出来，界面做得好看一点。") } label: { Label("让 Agent 用它", systemImage: "sparkles") }.buttonStyle(QuietButton(tint: Theme.accent))
            }
        }
        .padding(14)
        .frame(width: 292, alignment: .leading)
        .glass()
    }
}

/// The bar of views and room controls.
struct ViewBar: View {
    @EnvironmentObject var model: Model
    private let views: [(String, String, String)] = [("room", "全景", "house"), ("bench", "工作台", "rectangle.3.group"), ("work", "设备", "ipad.landscape"), ("screen", "屏幕", "hand.tap"), ("parts", "零件", "shippingbox")]
    var body: some View {
        HStack(spacing: 4) {
            ForEach(views, id: \.0) { view in
                Button { model.room(do: "view", ["name": view.0]) } label: {
                    HStack(spacing: 5) {
                        Image(systemName: view.2).font(.system(size: 10.5))
                        Text(view.1).font(.system(size: 11.5, weight: .semibold))
                    }
                    .foregroundStyle(model.view == view.0 ? Color.black.opacity(0.85) : Theme.ink)
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(model.view == view.0 ? Theme.accent : Color.clear))
                    .contentShape(Rectangle())
                }.buttonStyle(.plain)
            }
            Rectangle().fill(Theme.line).frame(width: 1, height: 16).padding(.horizontal, 4)
            Button { model.room(do: "lights") } label: {
                Image(systemName: model.lightsOn ? "lightbulb.fill" : "lightbulb").font(.system(size: 12)).foregroundStyle(model.lightsOn ? Theme.warn : Theme.dim).frame(width: 26, height: 24)
            }.buttonStyle(.plain).help("房间灯 (L)")
            Button { model.room(do: "reset") } label: {
                Image(systemName: "arrow.counterclockwise").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.dim).frame(width: 26, height: 24)
            }.buttonStyle(.plain).help("道具归位")
            Text(String(format: "%.0f fps", model.fps)).font(.system(size: 10, design: .monospaced)).foregroundStyle(Theme.faint).padding(.leading, 2).padding(.trailing, 6)
        }
        .padding(5)
        .glass(12)
    }
}

struct HoverTip: View {
    let hover: Hover
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(hover.title).font(.system(size: 12, weight: .bold)).foregroundStyle(Theme.ink)
            if !hover.subtitle.isEmpty { Text(hover.subtitle).font(.system(size: 11)).foregroundStyle(Theme.dim) }
        }
        .padding(.horizontal, 10).padding(.vertical, 7)
        .glass(10)
        .fixedSize()
    }
}

struct ToastView: View {
    let toast: Toast
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: toast.tone == "warn" ? "exclamationmark.triangle.fill" : "info.circle.fill").foregroundStyle(toast.tone == "warn" ? Theme.warn : Theme.accent)
            Text(toast.text).font(.system(size: 12.5, weight: .medium)).foregroundStyle(Theme.ink).fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .frame(maxWidth: 460)
        .glass(12)
    }
}

/// Where the pointer is in the window, for the tip that follows it.
final class PointerTracker: ObservableObject {
    @Published var location = CGPoint.zero
    private var monitor: Any?
    init() {
        monitor = NSEvent.addLocalMonitorForEvents(matching: [.mouseMoved, .leftMouseDragged]) { [weak self] event in
            if let window = event.window, let content = window.contentView {
                let p = event.locationInWindow
                self?.location = CGPoint(x: p.x, y: content.bounds.height - p.y)
            }
            return event
        }
    }
    deinit { if let monitor { NSEvent.removeMonitor(monitor) } }
}

/// The task cards: pick what to build.
struct LessonsSheet: View {
    @EnvironmentObject var model: Model
    private let columns = [GridItem(.adaptive(minimum: 230, maximum: 280), spacing: 14)]
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("任务卡").font(.system(size: 22, weight: .bold)).foregroundStyle(Theme.ink)
                    Text("每张卡片是一个能跑起来的小作品：接上模块，说出想法，看它在 Tab5 上亮起来。").font(.system(size: 12.5)).foregroundStyle(Theme.dim)
                }
                Spacer()
                Button { model.showLessons = false } label: { Image(systemName: "xmark").font(.system(size: 12, weight: .bold)) }.buttonStyle(QuietButton())
            }
            ScrollView {
                LazyVGrid(columns: columns, alignment: .leading, spacing: 14) {
                    ForEach(model.lessons) { lesson in
                        Button {
                            model.send("lesson.start", ["id": lesson.id])
                            model.showLessons = false
                        } label: { LessonTile(lesson: lesson, active: model.lesson?.id == lesson.id) }.buttonStyle(.plain)
                    }
                }.padding(2)
            }
        }
        .padding(24)
        .frame(width: 860, height: 600)
        .background(Color(red: 0.08, green: 0.09, blue: 0.1))
        .preferredColorScheme(.dark)
    }
}

struct LessonTile: View {
    let lesson: Lesson
    let active: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(String(format: "%02d", lesson.number)).font(.system(size: 11, weight: .heavy, design: .monospaced)).foregroundStyle(lesson.done ? Color.black.opacity(0.85) : Theme.ink)
                    .padding(.horizontal, 6).padding(.vertical, 2).background(RoundedRectangle(cornerRadius: 5).fill(lesson.done ? Theme.accent : Color.white.opacity(0.12)))
                Spacer()
                HStack(spacing: 2) { ForEach(0..<3, id: \.self) { i in Circle().fill(i < lesson.level ? Theme.warn : Color.white.opacity(0.12)).frame(width: 5, height: 5) } }
                Text("\(lesson.minutes) 分钟").font(.system(size: 10.5)).foregroundStyle(Theme.faint)
            }
            Text(lesson.title).font(.system(size: 16, weight: .bold)).foregroundStyle(Theme.ink)
            Text(lesson.tagline).font(.system(size: 11.5)).foregroundStyle(Theme.dim).lineLimit(3).fixedSize(horizontal: false, vertical: true).frame(minHeight: 42, alignment: .topLeading)
            HStack(spacing: 5) {
                if lesson.units.isEmpty { Chip(text: "只用 Tab5", tint: Theme.dim) }
                ForEach(lesson.units, id: \.self) { Chip(text: UNIT_NAMES[$0] ?? $0, tint: Theme.accent) }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white.opacity(active ? 0.1 : 0.05)))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(active ? Theme.accent.opacity(0.7) : Theme.line))
        .contentShape(Rectangle())
    }
}

struct ProjectsSheet: View {
    @EnvironmentObject var model: Model
    @State private var name = ""
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("工程").font(.system(size: 20, weight: .bold)).foregroundStyle(Theme.ink)
                Spacer()
                Button { model.showProjects = false } label: { Image(systemName: "xmark").font(.system(size: 12, weight: .bold)) }.buttonStyle(QuietButton())
            }
            HStack {
                TextField("新工程的名字，比如 my-clock", text: $name).textFieldStyle(.roundedBorder)
                Button("新建") {
                    let slug = name.lowercased().replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression).trimmingCharacters(in: CharacterSet(charactersIn: "-"))
                    model.send("project.new", ["template": "blank", "name": slug.isEmpty ? "my-app" : slug, "title": name.isEmpty ? "My App" : name])
                    model.showProjects = false
                }.buttonStyle(QuietButton(prominent: true))
            }
            ScrollView {
                VStack(spacing: 6) {
                    ForEach(model.projects) { project in
                        Button {
                            model.send("project.open", ["name": project.id])
                            model.showProjects = false
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(project.title).font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.ink)
                                    Text(project.id).font(.system(size: 11, design: .monospaced)).foregroundStyle(Theme.faint)
                                }
                                Spacer()
                                if project.id == model.projectName { Chip(text: "打开着", tint: Theme.accent) }
                            }
                            .padding(10).background(RoundedRectangle(cornerRadius: 10).fill(Theme.fill)).contentShape(Rectangle())
                        }.buttonStyle(.plain)
                    }
                }
            }
            if let path = model.projectPath {
                HStack {
                    Text(path).font(.system(size: 10.5, design: .monospaced)).foregroundStyle(Theme.faint).lineLimit(1).truncationMode(.middle)
                    Spacer()
                    Button("在访达中显示") { NSWorkspace.shared.selectFile(nil, inFileViewerRootedAtPath: path) }.buttonStyle(QuietButton())
                }
            }
        }
        .padding(22)
        .frame(width: 520, height: 460)
        .background(Color(red: 0.08, green: 0.09, blue: 0.1))
        .preferredColorScheme(.dark)
    }
}
