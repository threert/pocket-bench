// The side panel: the Tab5's screen up close, and under it the conversation with the coding agent, the project's
// code and its logs.
import AppKit
import SwiftUI

struct AgentPanel: View {
    @EnvironmentObject var model: Model
    @State private var tab = "chat"
    var body: some View {
        VStack(spacing: 0) {
            MirrorView().padding(10)
            HStack(spacing: 2) {
                ForEach([("chat", "对话"), ("code", "代码"), ("logs", "日志")], id: \.0) { item in
                    Button { tab = item.0 } label: {
                        HStack(spacing: 4) {
                            Text(item.1).font(.system(size: 12, weight: .semibold))
                            if item.0 == "logs" && (!model.problems.isEmpty || model.failure != nil) { Circle().fill(Theme.bad).frame(width: 6, height: 6) }
                        }
                        .foregroundStyle(tab == item.0 ? Theme.ink : Theme.dim)
                        .padding(.horizontal, 12).padding(.vertical, 6)
                        .background(RoundedRectangle(cornerRadius: 8).fill(tab == item.0 ? Color.white.opacity(0.1) : .clear))
                        .contentShape(Rectangle())
                    }.buttonStyle(.plain)
                }
                Spacer()
                AgentPicker()
            }
            .padding(.horizontal, 10).padding(.bottom, 6)
            Rectangle().fill(Theme.line).frame(height: 1)
            Group {
                switch tab {
                case "code": CodeView()
                case "logs": LogsView()
                default: ChatView()
                }
            }
            .frame(maxHeight: .infinity)
        }
        .frame(width: 372)
        .glass()
    }
}

/// The Tab5's screen: the same frames the room shows, large enough to read. A press on it is a touch.
struct MirrorView: View {
    @EnvironmentObject var model: Model
    @ObservedObject var mirror = Model.shared.mirror
    var body: some View {
        VStack(spacing: 6) {
            ZStack {
                RoundedRectangle(cornerRadius: 8).fill(Color.black)
                if let image = mirror.image, model.projectName != nil {
                    GeometryReader { geo in
                        Image(decorative: image, scale: 1).resizable().interpolation(.high)
                            .gesture(DragGesture(minimumDistance: 0)
                                .onChanged { value in
                                    let x = max(0, min(639, value.location.x / geo.size.width * 640)), y = max(0, min(359, value.location.y / geo.size.height * 360))
                                    model.send("screen.touch", ["x": Int(x), "y": Int(y)])
                                }
                                .onEnded { _ in model.send("screen.touch", ["up": true]) })
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                } else {
                    VStack(spacing: 6) {
                        Image(systemName: "ipad.landscape").font(.system(size: 22)).foregroundStyle(Theme.faint)
                        Text(model.projectName == nil ? "还没有应用在运行" : "启动中…").font(.system(size: 11)).foregroundStyle(Theme.faint)
                    }
                }
                if model.phase == "building" {
                    VStack { Spacer(); HStack { Spacer(); HStack(spacing: 5) { ProgressView().controlSize(.mini); Text("构建中").font(.system(size: 10.5, weight: .semibold)) }.padding(.horizontal, 8).padding(.vertical, 4).background(Capsule().fill(.black.opacity(0.7))).padding(6) } }
                }
            }
            .aspectRatio(16.0 / 9.0, contentMode: .fit)
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Theme.line))
            HStack(spacing: 6) {
                Text("Tab5 · 640×360").font(.system(size: 10, weight: .medium, design: .monospaced)).foregroundStyle(Theme.faint)
                Spacer()
                if model.buildMs > 0 { Text(String(format: "构建 %.1f s", Double(model.buildMs) / 1000)).font(.system(size: 10, design: .monospaced)).foregroundStyle(Theme.faint) }
                Button { model.send("project.build") } label: { Image(systemName: "arrow.clockwise").font(.system(size: 10, weight: .bold)) }.buttonStyle(.plain).foregroundStyle(Theme.dim).help("重新构建并重启")
                Button { model.room(do: "view", ["name": "screen"]) } label: { Image(systemName: "viewfinder").font(.system(size: 10, weight: .bold)) }.buttonStyle(.plain).foregroundStyle(Theme.dim).help("在房间里看屏幕")
            }
        }
    }
}

struct AgentPicker: View {
    @EnvironmentObject var model: Model
    var body: some View {
        Menu {
            ForEach(model.agents) { agent in
                Button { model.send("agent.select", ["agent": agent.id]) } label: {
                    Text(agent.installed ? "\(agent.name)  \(agent.version)" : "\(agent.name)（未安装）")
                    if agent.id == model.agent { Image(systemName: "checkmark") }
                }.disabled(!agent.installed)
            }
            Divider()
            Button("开始新对话") { model.send("agent.new"); model.chat = [] }
        } label: {
            HStack(spacing: 4) {
                Circle().fill(model.agentStatus == "error" ? Theme.bad : model.agentStatus == "idle" ? Theme.dim : Theme.accent).frame(width: 6, height: 6)
                Text(model.agents.first(where: { $0.id == model.agent })?.name ?? (model.agent == "codex" ? "Codex" : "Claude Code")).font(.system(size: 11, weight: .semibold))
                Image(systemName: "chevron.down").font(.system(size: 7, weight: .bold))
            }.foregroundStyle(Theme.dim)
        }
        .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
    }
}

struct ChatView: View {
    @EnvironmentObject var model: Model
    @State private var draft = ""
    @FocusState private var focused: Bool
    private var suggestions: [String] {
        if let lesson = model.lesson, !lesson.prompts.isEmpty { return lesson.prompts }
        return ["做一个大字时钟，点屏幕切换颜色", "把接上的模块读数用仪表盘显示出来", "屏幕上现在显示的是什么？帮我改得更好看"]
    }
    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 9) {
                        if model.chat.isEmpty { Welcome(suggestions: suggestions) { model.prompt($0) } }
                        ForEach(model.chat) { item in ChatRow(item: item).id(item.id) }
                        if model.agentStatus == "working" || model.agentStatus == "starting" {
                            HStack(spacing: 6) { ProgressView().controlSize(.mini); Text(model.agentStatus == "starting" ? "正在唤起 Agent…" : "Agent 在干活…").font(.system(size: 11)).foregroundStyle(Theme.dim) }.id("busy")
                        }
                        if let error = model.agentError, model.agentStatus == "error" {
                            Text(error).font(.system(size: 11)).foregroundStyle(Theme.bad).fixedSize(horizontal: false, vertical: true)
                        }
                        Color.clear.frame(height: 1).id("end")
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .onChange(of: model.chat.count) { _, _ in withAnimation(.easeOut(duration: 0.15)) { proxy.scrollTo("end", anchor: .bottom) } }
                .onChange(of: model.chat.last?.text.count ?? 0) { _, _ in proxy.scrollTo("end", anchor: .bottom) }
            }
            if model.failure != nil || !model.problems.isEmpty {
                HStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Theme.warn).font(.system(size: 11))
                    Text(model.problems.first?.message ?? model.failure ?? "").font(.system(size: 11)).foregroundStyle(Theme.ink).lineLimit(2)
                    Spacer()
                    Button("让它修") { model.prompt("应用现在有问题，请运行 bench check 看一下报错并修好：\(model.problems.first.map { "\($0.file):\($0.line) \($0.message)" } ?? model.failure ?? "")") }.buttonStyle(QuietButton(tint: Theme.warn))
                }
                .padding(.horizontal, 12).padding(.vertical, 8).background(Theme.warn.opacity(0.08))
            }
            Rectangle().fill(Theme.line).frame(height: 1)
            HStack(alignment: .bottom, spacing: 8) {
                TextField(model.projectName == nil ? "先挑一张任务卡，或新建工程" : "想让 Tab5 做什么？说给 Agent 听…", text: $draft, axis: .vertical)
                    .textFieldStyle(.plain).font(.system(size: 13)).lineLimit(1...6).focused($focused)
                    .onSubmit { submit() }
                    .disabled(model.projectName == nil)
                if model.agentStatus == "working" || model.agentStatus == "waiting" {
                    Button { model.send("agent.cancel") } label: { Image(systemName: "stop.fill").font(.system(size: 11)).frame(width: 26, height: 26).background(Circle().fill(Color.white.opacity(0.12))) }.buttonStyle(.plain).foregroundStyle(Theme.ink).help("停下")
                } else {
                    Button { submit() } label: { Image(systemName: "arrow.up").font(.system(size: 12, weight: .bold)).frame(width: 26, height: 26).background(Circle().fill(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? Color.white.opacity(0.1) : Theme.accent)) }
                        .buttonStyle(.plain).foregroundStyle(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? Theme.faint : .black)
                        .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
        }
    }
    private func submit() {
        model.prompt(draft)
        draft = ""
    }
}

struct Welcome: View {
    let suggestions: [String]
    let pick: (String) -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("说出想法，Agent 来写").font(.system(size: 14, weight: .bold)).foregroundStyle(Theme.ink)
            Text("它用 TypeScript 写 PocketJS 应用：界面跑在 Tab5 上，驱动在 worker 里读写 I2C。改完自动编译，左边房间里的屏幕马上就变。")
                .font(.system(size: 11.5)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true).lineSpacing(2)
            ForEach(suggestions, id: \.self) { text in
                Button { pick(text) } label: {
                    HStack(alignment: .top, spacing: 6) {
                        Image(systemName: "sparkles").font(.system(size: 10)).padding(.top, 2)
                        Text(text).font(.system(size: 11.5)).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                    }
                    .foregroundStyle(Theme.ink).padding(.horizontal, 10).padding(.vertical, 8)
                    .background(RoundedRectangle(cornerRadius: 10).fill(Theme.fill))
                    .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.line))
                    .contentShape(Rectangle())
                }.buttonStyle(.plain)
            }
        }
        .padding(.bottom, 4)
    }
}

struct ChatRow: View {
    @EnvironmentObject var model: Model
    let item: ChatItem
    var body: some View {
        switch item.kind {
        case "user":
            HStack { Spacer(minLength: 40); Text(item.text).font(.system(size: 12.5)).foregroundStyle(Theme.ink).textSelection(.enabled)
                .padding(.horizontal, 11).padding(.vertical, 8).background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.accent.opacity(0.2))) }
        case "thought":
            Text(item.text.trimmingCharacters(in: .whitespacesAndNewlines)).font(.system(size: 11).italic()).foregroundStyle(Theme.faint).lineLimit(3)
        case "tool":
            HStack(spacing: 7) {
                Image(systemName: icon).font(.system(size: 10.5)).foregroundStyle(Theme.dim).frame(width: 14)
                Text(item.title.isEmpty ? item.toolKind : item.title).font(.system(size: 11.5)).foregroundStyle(Theme.ink.opacity(0.85)).lineLimit(1).truncationMode(.middle)
                if item.added + item.removed > 0 {
                    Text("+\(item.added)").font(.system(size: 10, weight: .semibold, design: .monospaced)).foregroundStyle(Theme.accent)
                    Text("−\(item.removed)").font(.system(size: 10, weight: .semibold, design: .monospaced)).foregroundStyle(Theme.bad)
                }
                Spacer(minLength: 0)
                switch item.status {
                case "done": Image(systemName: "checkmark").font(.system(size: 9, weight: .bold)).foregroundStyle(Theme.accent)
                case "failed": Image(systemName: "xmark").font(.system(size: 9, weight: .bold)).foregroundStyle(Theme.bad)
                default: ProgressView().controlSize(.mini).scaleEffect(0.7)
                }
            }
            .padding(.horizontal, 9).padding(.vertical, 5.5)
            .background(RoundedRectangle(cornerRadius: 8).fill(Theme.fill))
        case "plan":
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(item.entries.enumerated()), id: \.offset) { _, entry in
                    HStack(alignment: .top, spacing: 6) {
                        Image(systemName: entry.status == "completed" ? "checkmark.circle.fill" : entry.status == "in_progress" ? "circle.dotted" : "circle").font(.system(size: 10)).foregroundStyle(entry.status == "completed" ? Theme.accent : Theme.dim).padding(.top, 1.5)
                        Text(entry.text).font(.system(size: 11.5)).foregroundStyle(entry.status == "completed" ? Theme.dim : Theme.ink).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .padding(9).frame(maxWidth: .infinity, alignment: .leading).background(RoundedRectangle(cornerRadius: 8).strokeBorder(Theme.line))
        case "permission":
            VStack(alignment: .leading, spacing: 7) {
                HStack(spacing: 6) { Image(systemName: "hand.raised.fill").font(.system(size: 10)).foregroundStyle(Theme.warn); Text(item.title.isEmpty ? "需要你的许可" : item.title).font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.ink) }
                if !item.text.isEmpty { Text(item.text).font(.system(size: 11, design: .monospaced)).foregroundStyle(Theme.dim).lineLimit(4) }
                if !item.done {
                    HStack(spacing: 6) {
                        ForEach(item.options, id: \.id) { option in
                            Button(option.label) { model.send("agent.permission", ["id": item.id, "optionId": option.id]) }
                                .buttonStyle(QuietButton(tint: option.kind.hasPrefix("reject") ? Theme.bad : Theme.ink, prominent: option.kind == "allow_once"))
                        }
                    }
                }
            }
            .padding(10).frame(maxWidth: .infinity, alignment: .leading).background(RoundedRectangle(cornerRadius: 10).fill(Theme.warn.opacity(0.08))).overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.warn.opacity(0.3)))
        case "error":
            Text(item.text).font(.system(size: 11.5)).foregroundStyle(Theme.bad).fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
        case "notice":
            Text(item.text).font(.system(size: 11)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true)
        default:
            Markdown(text: item.text)
        }
    }
    private var icon: String {
        switch item.toolKind {
        case "read": return "doc.text"
        case "edit": return "pencil"
        case "execute": return "terminal"
        case "search": return "magnifyingglass"
        case "fetch": return "globe"
        case "think": return "brain"
        default: return "wrench.and.screwdriver"
        }
    }
}

/// The agent's prose: paragraphs with inline Markdown, fenced code as blocks.
struct Markdown: View {
    let text: String
    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                if block.code {
                    ScrollView(.horizontal, showsIndicators: false) {
                        Text(block.text).font(.system(size: 11, design: .monospaced)).foregroundStyle(Theme.ink.opacity(0.9)).textSelection(.enabled).padding(9)
                    }
                    .background(RoundedRectangle(cornerRadius: 8).fill(Color.black.opacity(0.35)))
                } else {
                    Text(inline(block.text)).font(.system(size: 12.5)).foregroundStyle(Theme.ink).lineSpacing(2.5).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }
    private var blocks: [(code: Bool, text: String)] {
        var out: [(Bool, String)] = []
        var code = false
        var current: [String] = []
        for line in text.components(separatedBy: "\n") {
            if line.trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                let joined = current.joined(separator: "\n").trimmingCharacters(in: .newlines)
                if !joined.isEmpty { out.append((code, joined)) }
                current = []
                code.toggle()
            } else { current.append(line) }
        }
        let joined = current.joined(separator: "\n").trimmingCharacters(in: .newlines)
        if !joined.isEmpty { out.append((code, joined)) }
        return out.map { (code: $0.0, text: $0.1) }
    }
    private func inline(_ source: String) -> AttributedString {
        (try? AttributedString(markdown: source, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(source)
    }
}

struct CodeView: View {
    @EnvironmentObject var model: Model
    var body: some View {
        VStack(spacing: 0) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 4) {
                    ForEach(model.files, id: \.self) { file in
                        Button { model.open(file: file) } label: {
                            Text(file).font(.system(size: 10.5, weight: .medium, design: .monospaced)).foregroundStyle(file == model.openFile ? Theme.ink : Theme.dim)
                                .padding(.horizontal, 8).padding(.vertical, 4).background(RoundedRectangle(cornerRadius: 6).fill(file == model.openFile ? Color.white.opacity(0.12) : Theme.fill))
                        }.buttonStyle(.plain)
                    }
                }.padding(.horizontal, 10).padding(.vertical, 8)
            }
            Rectangle().fill(Theme.line).frame(height: 1)
            ScrollView([.vertical, .horizontal]) {
                Text(model.fileText.isEmpty ? " " : model.fileText).font(.system(size: 11, design: .monospaced)).foregroundStyle(Theme.ink.opacity(0.88)).textSelection(.enabled)
                    .padding(12).frame(maxWidth: .infinity, alignment: .topLeading)
            }
            if model.files.isEmpty { Text("打开一个工程后，这里是它的 TypeScript 源码。").font(.system(size: 11.5)).foregroundStyle(Theme.faint).padding() }
        }
        .onAppear { model.send("project.files"); if let file = model.openFile { model.open(file: file) } }
        .onChange(of: model.buildMs) { _, _ in model.send("project.files"); if let file = model.openFile { model.send("project.read", ["path": file]) } }
    }
}

struct LogsView: View {
    @EnvironmentObject var model: Model
    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 3) {
                    ForEach(model.problems) { problem in
                        Text("\(problem.file):\(problem.line)  \(problem.message)").font(.system(size: 10.5, design: .monospaced)).foregroundStyle(Theme.bad).fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
                    }
                    if let failure = model.failure { Text(failure).font(.system(size: 10.5, design: .monospaced)).foregroundStyle(Theme.bad).fixedSize(horizontal: false, vertical: true).textSelection(.enabled) }
                    ForEach(model.logs) { line in
                        HStack(alignment: .top, spacing: 6) {
                            Text(line.domain).font(.system(size: 9.5, weight: .bold, design: .monospaced)).foregroundStyle(line.domain == "worker" ? Theme.accent : line.domain == "ui" ? Color.cyan : Theme.faint).frame(width: 38, alignment: .leading)
                            Text(line.text).font(.system(size: 10.5, design: .monospaced)).foregroundStyle(line.level == "error" ? Theme.bad : line.level == "warn" ? Theme.warn : Theme.ink.opacity(0.82)).fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
                        }.id(line.id)
                    }
                    Color.clear.frame(height: 1).id("end")
                }
                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
            }
            .onChange(of: model.logs.count) { _, _ in proxy.scrollTo("end", anchor: .bottom) }
            .onAppear { proxy.scrollTo("end", anchor: .bottom) }
        }
    }
}
