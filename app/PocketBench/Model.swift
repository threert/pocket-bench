// What the app knows: the bench's state as the sidecar reports it, the room, and the wires between the three
// (the room's game script, the sidecar, the panels).
import AppKit
import SwiftUI

struct Hover: Equatable {
    let id: String
    let title: String
    let subtitle: String
}

struct Toast: Equatable {
    let id: Int
    let text: String
    let tone: String
}

struct LogEntry: Identifiable {
    let id: Int
    let domain: String
    let level: String
    let text: String
    let at: Double
}

/// The Tab5's screen as the sidecar streams it, for the mirror in the side panel.
@MainActor
final class ScreenMirror: ObservableObject {
    @Published var image: CGImage?
    private var last = Date.distantPast

    func show(width: Int, height: Int, pixels: Data) {
        // The panel's copy need not be faster than 20 a second.
        guard Date().timeIntervalSince(last) > 0.05, let provider = CGDataProvider(data: pixels as CFData) else { return }
        last = Date()
        image = CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: width * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                        bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipLast.rawValue), provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent)
    }
}

@MainActor
final class Model: ObservableObject {
    static let shared = Model()

    // The sidecar and the renderer.
    @Published var connection = "starting"
    @Published var rendererReady = false
    @Published var rendererError: String?
    @Published var adapter = ""
    @Published var fps = 0.0
    @Published var gpuMs = 0.0
    @Published var renderScale = 1.0
    var shown = false

    // The bench.
    @Published var phase = "idle"
    @Published var projectName: String?
    @Published var projectTitle: String?
    @Published var projectPath: String?
    @Published var projects: [ProjectRow] = []
    @Published var templates: [String] = []
    @Published var plugged: [String] = []
    @Published var problems: [Problem] = []
    @Published var failure: String?
    @Published var buildMs = 0
    @Published var catalog: [String: UnitInfo] = [:]
    @Published var sim: [String: JSON] = [:]
    @Published var logs: [LogEntry] = []

    // The room.
    @Published var hover: Hover?
    @Published var selectedUnit: String?
    @Published var view = "bench"
    @Published var lightsOn = true
    @Published var toastMessage: Toast?

    // The agent.
    @Published var agents: [AgentInfo] = []
    @Published var agent = "claude"
    @Published var agentStatus = "idle"
    @Published var agentError: String?
    @Published var chat: [ChatItem] = []

    // Lessons.
    @Published var lessons: [Lesson] = []
    @Published var lesson: Lesson?
    @Published var showLessons = false
    @Published var showProjects = false

    // Files, for the code tab.
    @Published var files: [String] = []
    @Published var openFile: String?
    @Published var fileText = ""

    let room = RoomNSView(frame: .zero)
    let sidecar = Sidecar()
    let mirror = ScreenMirror()
    private var state: JSON = [:]
    private var logSeq = 0
    private var toastSeq = 0
    private var snapshotWaiters: [String: () -> Void] = [:]
    /// Messages of the sidecar the room's script listens for.
    private static let forRoom: Set<String> = ["state", "sim", "room.refused", "room.do"]

    func start() {
        room.onPosts = { [weak self] posts in self?.fromRoom(posts) }
        sidecar.onStatus = { [weak self] status in self?.connection = status }
        sidecar.onMessage = { [weak self] message in self?.fromSidecar(message) }
        sidecar.onFrame = { [weak self] width, height, pixels in
            guard let self else { return }
            pixels.withUnsafeBytes { self.room.stream("tab5", width: width, height: height, pixels: $0) }
            self.mirror.show(width: width, height: height, pixels: pixels)
        }
        sidecar.start()
    }

    func stop() {
        room.stop()
        sidecar.stop()
    }

    func send(_ t: String, _ more: JSON = [:]) {
        var message = more
        message["t"] = t
        sidecar.send(message)
    }

    // ----- the room's posts -----

    private func fromRoom(_ posts: [JSON]) {
        for post in posts {
            guard let t = post["t"] as? String else { continue }
            if t.hasPrefix("bench.") { renderer(t, post); continue }
            if t.hasPrefix("ui.") { ui(t, post); continue }
            sidecar.send(post)
        }
    }

    /// What the room tells the panels.
    private func ui(_ t: String, _ post: JSON) {
        switch t {
        case "ui.hover":
            if let id = post["id"] as? String { hover = Hover(id: id, title: post["title"] as? String ?? "", subtitle: post["subtitle"] as? String ?? "") } else { hover = nil }
        case "ui.select": selectedUnit = post["unit"] as? String
        case "ui.view": view = post["name"] as? String ?? "bench"
        case "ui.lights": lightsOn = post["on"] as? Bool ?? true
        case "ui.toast": toast(post["text"] as? String ?? "", tone: post["tone"] as? String ?? "info")
        case "ui.quest": showLessons = true
        case "ui.sound": Sounds.play(post["name"] as? String ?? "")
        default: break
        }
    }

    func toast(_ text: String, tone: String = "info") {
        toastSeq += 1
        let id = toastSeq
        toastMessage = Toast(id: id, text: text, tone: tone)
        DispatchQueue.main.asyncAfter(deadline: .now() + 3.8) { [weak self] in
            if self?.toastMessage?.id == id { self?.toastMessage = nil }
        }
    }

    /// Asks the room's script to do something (`room.do`).
    func room(do action: String, _ more: JSON = [:]) {
        var message = more
        message["t"] = "room.do"
        message["do"] = action
        room.send(message)
    }

    private func renderer(_ t: String, _ post: JSON) {
        switch t {
        case "bench.ready":
            rendererReady = true
            adapter = post["adapter"] as? String ?? ""
            room.sendView()
            // The room missed what the sidecar said before it was up.
            if !state.isEmpty { room.send(state) }
        case "bench.fatal":
            rendererError = post["message"] as? String ?? "the renderer did not start"
        case "bench.stats":
            fps = post["fps"] as? Double ?? 0
            gpuMs = post["gpuMs"] as? Double ?? 0
            renderScale = post["scale"] as? Double ?? 1
            shown = post["shown"] as? Bool ?? false
        case "bench.error":
            append(domain: "room", level: "error", text: "\(post["where"] as? String ?? ""): \(post["message"] as? String ?? "")", at: 0)
        case "bench.snapshot":
            if let path = post["path"] as? String { snapshotWaiters.removeValue(forKey: path)?() }
        case "bench.reloaded":
            room.sendView()
            if !state.isEmpty { room.send(state) }
        default: break
        }
    }

    // ----- the sidecar's messages -----

    private func fromSidecar(_ message: JSON) {
        guard let t = message["t"] as? String else { return }
        if Model.forRoom.contains(t) { room.send(message) }
        switch t {
        case "state": apply(message)
        case "catalog":
            var next: [String: UnitInfo] = [:]
            for item in message["units"] as? [JSON] ?? [] { let unit = UnitInfo(item); next[unit.id] = unit }
            catalog = next
        case "sim":
            sim = message["units"] as? [String: JSON] ?? [:]
        case "logs":
            for line in message["lines"] as? [JSON] ?? [] {
                append(domain: line["domain"] as? String ?? "", level: line["level"] as? String ?? "log", text: line["text"] as? String ?? "", at: (line["at"] as? Double ?? 0) / 1e6)
            }
        case "agent.item":
            if let item = message["item"] as? JSON, let id = item["id"] as? String {
                if let index = chat.firstIndex(where: { $0.id == id }) { chat[index].merge(item) } else { chat.append(ChatItem(item)) }
            }
        case "agent.delta":
            if let id = message["id"] as? String, let text = message["text"] as? String, let index = chat.firstIndex(where: { $0.id == id }) { chat[index].text += text }
        case "agent.history":
            chat = (message["items"] as? [JSON] ?? []).map(ChatItem.init)
        case "project.files":
            files = (message["files"] as? [JSON] ?? []).compactMap { $0["path"] as? String }.filter { !$0.hasPrefix("drivers/") && !$0.hasPrefix("ui/") } + (message["files"] as? [JSON] ?? []).compactMap { $0["path"] as? String }.filter { $0.hasPrefix("drivers/") || $0.hasPrefix("ui/") }
            if openFile == nil || !files.contains(openFile!) { open(file: files.first(where: { $0 == "main.tsx" }) ?? files.first) }
        case "project.file":
            if message["path"] as? String == openFile { fileText = message["text"] as? String ?? "" }
        case "room.refused":
            break
        case "error":
            toast(message["message"] as? String ?? "", tone: "warn")
        case "app.reload-room":
            room.reload(message["bundle"] as? String ?? Paths.roomBundle)
        case "app.shot": shot(message)
        case "app.status":
            answer(message, ["ok": true, "rendererReady": rendererReady, "rendererError": rendererError ?? "", "fps": fps, "gpuMs": gpuMs, "scale": renderScale,
                             "adapter": adapter, "shown": shown, "connection": connection, "phase": phase,
                             "window": [Double(room.bounds.width), Double(room.bounds.height)],
                             "hover": hover.map { ["id": $0.id, "title": $0.title, "subtitle": $0.subtitle] } ?? [:], "selected": selectedUnit ?? "", "view": view,
                             "toast": toastMessage?.text ?? "", "chat": chat.count, "agent": agentStatus])
        case "app.pointer":
            // A test's pointer: {u, v, button?, down?}; "click": true is down and up a few frames apart.
            let u = message["u"] as? Double ?? 0.5, v = message["v"] as? Double ?? 0.5
            if message["click"] as? Bool == true {
                room.pointer(u: u, v: v)
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) { self.room.pointer(u: u, v: v, button: 0, down: true) }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { self.room.pointer(u: u, v: v, button: 0, down: false) }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { self.answer(message, ["ok": true]) }
            } else {
                room.pointer(u: u, v: v, button: message["button"] as? Int, down: message["down"] as? Bool ?? false)
                if let wheel = message["wheel"] as? Double { room.wheel(wheel) }
                answer(message, ["ok": true])
            }
        case "app.key":
            let name = message["key"] as? String ?? ""
            room.key(name, down: true)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) { self.room.key(name, down: false); self.answer(message, ["ok": true]) }
        case "app.room":
            // A message for the room's script, from a tool.
            if let inner = message["message"] as? JSON { room.send(inner) }
            answer(message, ["ok": true])
        case "app.ui":
            // A test opens or closes a sheet, or types a prompt.
            if let lessons = message["lessons"] as? Bool { showLessons = lessons }
            if let projects = message["projects"] as? Bool { showProjects = projects }
            answer(message, ["ok": true])
        default: break
        }
    }

    private func apply(_ message: JSON) {
        state = message
        phase = message["phase"] as? String ?? "idle"
        let project = message["project"] as? JSON
        let name = project?["name"] as? String
        if name != projectName { files = []; openFile = nil; fileText = ""; if name != nil { send("project.files") } }
        projectName = name
        projectTitle = project?["title"] as? String
        projectPath = project?["path"] as? String
        projects = (message["projects"] as? [JSON] ?? []).map { ProjectRow(id: $0["name"] as? String ?? "", title: $0["title"] as? String ?? "", lesson: $0["lesson"] as? String ?? "") }
        templates = message["templates"] as? [String] ?? []
        plugged = (message["units"] as? [JSON] ?? []).compactMap { $0["type"] as? String }
        problems = (message["problems"] as? [JSON] ?? []).enumerated().map { Problem(id: $0.offset, file: (($0.element["file"] as? String ?? "") as NSString).lastPathComponent, line: $0.element["line"] as? Int ?? 0, message: $0.element["message"] as? String ?? "") }
        if let f = message["failure"] as? JSON { failure = "\(f["domain"] as? String ?? ""): \(f["message"] as? String ?? "")" } else { failure = nil }
        buildMs = message["buildMs"] as? Int ?? 0
        if let a = message["agent"] as? JSON {
            agent = a["selected"] as? String ?? agent
            agentStatus = a["status"] as? String ?? "idle"
            agentError = a["error"] as? String
            agents = (a["agents"] as? [JSON] ?? []).map { AgentInfo(id: $0["id"] as? String ?? "", name: $0["name"] as? String ?? "", installed: $0["installed"] as? Bool ?? false, version: $0["version"] as? String ?? "", note: $0["note"] as? String ?? "") }
        }
        lessons = (message["lessons"] as? [JSON] ?? []).map(Lesson.init)
        lesson = (message["lesson"] as? JSON).map(Lesson.init)
    }

    func open(file: String?) {
        openFile = file
        fileText = ""
        if let file { send("project.read", ["path": file]) }
    }

    func prompt(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        var message: JSON = ["text": trimmed]
        if let lesson { message["context"] = "The user is doing the lesson \"\(lesson.title)\": \(lesson.story)" }
        send("agent.prompt", message)
    }

    private func append(domain: String, level: String, text: String, at: Double) {
        logSeq += 1
        logs.append(LogEntry(id: logSeq, domain: domain, level: level, text: text, at: at))
        if logs.count > 600 { logs.removeFirst(logs.count - 400) }
    }

    private func answer(_ request: JSON, _ body: JSON) {
        guard let id = request["request"] else { return }
        var message = body
        message["t"] = "answer"
        message["request"] = id
        sidecar.send(message)
    }

    // ----- screenshots, for tests and for the agent -----

    /// The window as a PNG: the room's next traced frame, and the panels drawn over it.
    private func shot(_ request: JSON) {
        let path = request["path"] as? String ?? Paths.scratch + "/shot.png"
        let roomPath = Paths.scratch + "/room-\(UUID().uuidString.prefix(8)).png"
        let overlay = request["panels"] as? Bool ?? true
        snapshotWaiters[roomPath] = { [weak self] in
            guard let self else { return }
            let ok = Shots.compose(room: roomPath, view: self.room, panels: overlay, to: path)
            try? FileManager.default.removeItem(atPath: roomPath)
            self.answer(request, ["ok": ok, "path": path])
        }
        room.snapshot(to: roomPath)
        DispatchQueue.main.asyncAfter(deadline: .now() + 6) { [weak self] in
            if self?.snapshotWaiters.removeValue(forKey: roomPath) != nil { self?.answer(request, ["ok": false, "error": "the renderer drew no frame"]) }
        }
    }
}

enum Shots {
    /// The room's PNG under the window's other views (the panels), as one picture of the window's content.
    @MainActor
    static func compose(room roomPath: String, view: RoomNSView, panels: Bool, to path: String) -> Bool {
        guard let content = view.window?.contentView, let roomImage = NSImage(contentsOfFile: roomPath),
              let roomCG = roomImage.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return false }
        let size = content.bounds.size
        let scale = view.window?.backingScaleFactor ?? 2
        guard let ctx = CGContext(data: nil, width: Int(size.width * scale), height: Int(size.height * scale), bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
        ctx.scaleBy(x: scale, y: scale)
        let frame = view.convert(view.bounds, to: content)
        // (The content view is flipped or not by its own rule; CG's origin is the bottom left.)
        let y = content.isFlipped ? size.height - frame.maxY : frame.minY
        ctx.interpolationQuality = .high
        ctx.draw(roomCG, in: CGRect(x: frame.minX, y: y, width: frame.width, height: frame.height))
        if panels {
            view.isHidden = true
            if let rep = content.bitmapImageRepForCachingDisplay(in: content.bounds) {
                content.cacheDisplay(in: content.bounds, to: rep)
                if let cg = rep.cgImage { ctx.draw(cg, in: CGRect(origin: .zero, size: size)) }
            }
            view.isHidden = false
        }
        guard let out = ctx.makeImage() else { return false }
        let rep = NSBitmapImageRep(cgImage: out)
        guard let data = rep.representation(using: .png, properties: [:]) else { return false }
        return (try? data.write(to: URL(fileURLWithPath: path))) != nil
    }
}

/// The room's small sounds: system sounds for now.
enum Sounds {
    private static let names: [String: String] = ["plug": "Pop", "lift": "Tink", "switch": "Tink", "tick": "Tink", "tap": "Pop", "relay": "Tink", "spray": "Blow"]
    static var enabled = true
    static func play(_ name: String) {
        guard enabled, let system = names[name], let sound = NSSound(named: system) else { return }
        sound.volume = name == "plug" ? 0.35 : 0.18
        sound.stop()
        sound.play()
    }
}
