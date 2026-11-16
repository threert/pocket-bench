// What the app knows: the bench's state as the sidecar reports it, the room, and the wires between the three
// (the room's game script, the sidecar, the panels).
import AppKit
import SwiftUI

struct LogEntry: Identifiable {
    let id: Int
    let domain: String
    let level: String
    let text: String
    let at: Double
}

@MainActor
final class Model: ObservableObject {
    static let shared = Model()

    @Published var connection = "starting"
    @Published var phase = "idle"
    @Published var projectName: String?
    @Published var projectTitle: String?
    @Published var rendererReady = false
    @Published var rendererError: String?
    @Published var adapter = ""
    @Published var fps = 0.0
    @Published var gpuMs = 0.0
    @Published var renderScale = 1.0
    /// The room has a surface to draw on (the window is on a display that is awake).
    var shown = false
    @Published var logs: [LogEntry] = []
    @Published var state: [String: Any] = [:]

    let room = RoomNSView(frame: .zero)
    let sidecar = Sidecar()
    private var logSeq = 0
    private var snapshotWaiters: [String: () -> Void] = [:]
    /// Messages of the sidecar the room's script listens for.
    private static let forRoom: Set<String> = ["state", "sim", "catalog", "room.refused", "room.do", "lesson"]

    func start() {
        room.onPosts = { [weak self] posts in self?.fromRoom(posts) }
        sidecar.onStatus = { [weak self] status in self?.connection = status }
        sidecar.onMessage = { [weak self] message in self?.fromSidecar(message) }
        sidecar.onFrame = { [weak self] width, height, pixels in
            pixels.withUnsafeBytes { self?.room.stream("tab5", width: width, height: height, pixels: $0) }
        }
        sidecar.start()
    }

    func stop() {
        room.stop()
        sidecar.stop()
    }

    // ----- the room's posts -----

    private func fromRoom(_ posts: [[String: Any]]) {
        for post in posts {
            guard let t = post["t"] as? String else { continue }
            if t.hasPrefix("bench.") { renderer(t, post); continue }
            if t.hasPrefix("ui.") { continue }
            sidecar.send(post)
        }
    }

    private func renderer(_ t: String, _ post: [String: Any]) {
        switch t {
        case "bench.ready":
            rendererReady = true
            adapter = post["adapter"] as? String ?? ""
            // The room missed what the sidecar said before it was up.
            if !state.isEmpty { room.send(state) }
            sidecar.send(["t": "hello", "client": "room"])
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
            if !state.isEmpty { room.send(state) }
            sidecar.send(["t": "hello", "client": "room"])
        default: break
        }
    }

    // ----- the sidecar's messages -----

    private func fromSidecar(_ message: [String: Any]) {
        guard let t = message["t"] as? String else { return }
        if Model.forRoom.contains(t) { room.send(message) }
        switch t {
        case "state":
            state = message
            phase = message["phase"] as? String ?? "idle"
            let project = message["project"] as? [String: Any]
            projectName = project?["name"] as? String
            projectTitle = project?["title"] as? String
        case "logs":
            for line in message["lines"] as? [[String: Any]] ?? [] {
                append(domain: line["domain"] as? String ?? "", level: line["level"] as? String ?? "log", text: line["text"] as? String ?? "", at: (line["at"] as? Double ?? 0) / 1e6)
            }
        case "app.reload-room":
            room.reload(message["bundle"] as? String ?? Paths.roomBundle)
        case "app.shot":
            shot(message)
        case "app.status":
            answer(message, ["ok": true, "rendererReady": rendererReady, "rendererError": rendererError ?? "", "fps": fps, "gpuMs": gpuMs, "scale": renderScale,
                             "adapter": adapter, "shown": shown, "connection": connection, "phase": phase,
                             "window": [Double(room.bounds.width), Double(room.bounds.height)]])
        case "app.room":
            // A message for the room's script, from a tool.
            if let inner = message["message"] as? [String: Any] { room.send(inner) }
            answer(message, ["ok": true])
        default: break
        }
    }

    private func append(domain: String, level: String, text: String, at: Double) {
        logSeq += 1
        logs.append(LogEntry(id: logSeq, domain: domain, level: level, text: text, at: at))
        if logs.count > 600 { logs.removeFirst(logs.count - 400) }
    }

    private func answer(_ request: [String: Any], _ body: [String: Any]) {
        guard let id = request["request"] else { return }
        var message = body
        message["t"] = "answer"
        message["request"] = id
        sidecar.send(message)
    }

    // ----- screenshots, for tests and for the agent -----

    /// The window as a PNG: the room's next traced frame, and the panels drawn over it.
    private func shot(_ request: [String: Any]) {
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
