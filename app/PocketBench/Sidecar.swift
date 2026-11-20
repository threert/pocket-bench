// The sidecar (sidecar/src/main.ts, run by Bun): the simulated Tab5, the project's builds and the coding agent.
// The app starts it, finds its port on its first line of output and holds one WebSocket to it: JSON messages both
// ways, and the Tab5's frames as binary messages.
import Foundation

final class Sidecar: NSObject, URLSessionWebSocketDelegate {
    var onMessage: (([String: Any]) -> Void)?
    /// Called off the main thread, for every frame.
    var onFrame: ((Int, Int, Data) -> Void)?
    var onStatus: ((String) -> Void)?
    private var process: Process?
    private var stdinPipe: Pipe?
    private var socket: URLSessionWebSocketTask?
    /// Messages arrive on a queue of their own: a second of frames is 27 MB, and the main thread has panels to draw.
    private let queue: OperationQueue = { let q = OperationQueue(); q.maxConcurrentOperationCount = 1; q.qualityOfService = .userInteractive; return q }()
    private lazy var session = URLSession(configuration: .default, delegate: self, delegateQueue: queue)
    private var url: URL?
    private var closed = false
    private var buffer = Data()

    func start() {
        let env = ProcessInfo.processInfo.environment
        // (POCKET_BENCH_SIDECAR=ws://127.0.0.1:<port>/app?role=app&token=<token>: a sidecar started by hand.)
        if let existing = env["POCKET_BENCH_SIDECAR"], let url = URL(string: existing) {
            self.url = url
            connect()
            return
        }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: Paths.bun)
        process.arguments = [Paths.sidecar, "--with-parent"]
        process.currentDirectoryURL = URL(fileURLWithPath: Paths.root + "/sidecar")
        var environment = env
        environment["POCKET_BENCH_ROOT"] = Paths.root
        environment["PATH"] = Sidecar.shellPath(fallback: env["PATH"] ?? "/usr/bin:/bin")
        process.environment = environment
        let out = Pipe(), input = Pipe()
        process.standardOutput = out
        process.standardInput = input
        process.standardError = FileHandle.standardError
        stdinPipe = input
        out.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            DispatchQueue.main.async { self?.output(data) }
        }
        process.terminationHandler = { [weak self] p in
            DispatchQueue.main.async { self?.onStatus?("the sidecar stopped (\(p.terminationStatus))") }
        }
        do {
            try process.run()
            self.process = process
            onStatus?("starting")
        } catch {
            onStatus?("the sidecar did not start: \(error.localizedDescription)")
        }
    }

    /// The PATH of the user's login shell: where `claude`, `codex`, `node` and `npx` are for a coding agent.
    private static func shellPath(fallback: String) -> String {
        let shell = ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh"
        let p = Process()
        p.executableURL = URL(fileURLWithPath: shell)
        p.arguments = ["-lic", "printf '%s' \"$PATH\""]
        let out = Pipe()
        p.standardOutput = out
        p.standardError = FileHandle.nullDevice
        p.standardInput = FileHandle.nullDevice
        do {
            try p.run()
            let deadline = Date().addingTimeInterval(3)
            while p.isRunning && Date() < deadline { usleep(20_000) }
            if p.isRunning { p.terminate(); return fallback }
            let text = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
            let path = text.split(separator: "\n").last.map(String.init) ?? ""
            return path.contains("/") ? path + ":" + fallback : fallback
        } catch { return fallback }
    }

    private func output(_ data: Data) {
        buffer.append(data)
        while let newline = buffer.firstIndex(of: 10) {
            let line = buffer.subdata(in: buffer.startIndex..<newline)
            buffer.removeSubrange(buffer.startIndex...newline)
            guard let object = try? JSONSerialization.jsonObject(with: line) as? [String: Any] else {
                if let text = String(data: line, encoding: .utf8) { FileHandle.standardError.write(("sidecar: " + text + "\n").data(using: .utf8)!) }
                continue
            }
            if object["t"] as? String == "listening", let port = object["port"] as? Int, let token = object["token"] as? String, url == nil {
                url = URL(string: "ws://127.0.0.1:\(port)/app?role=app&token=\(token)")
                connect()
            }
        }
    }

    private func connect() {
        guard let url, !closed else { return }
        let task = session.webSocketTask(with: url)
        task.maximumMessageSize = 64 << 20
        socket = task
        task.resume()
        receive(task)
    }

    private func receive(_ task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            guard let self, self.socket === task else { return }
            switch result {
            case .failure:
                task.cancel(with: .goingAway, reason: nil)
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                    guard let self, self.socket === task else { return }
                    self.onStatus?("reconnecting")
                    self.connect()
                }
                return
            case .success(let message):
                switch message {
                case .string(let text):
                    if let data = text.data(using: .utf8), let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                        DispatchQueue.main.async { self.onMessage?(object) }
                    }
                case .data(let data):
                    if data.count > 16, data.prefix(4) == Data([0x50, 0x42, 0x46, 0x31]) {
                        let width = Int(data[data.startIndex + 4]) | Int(data[data.startIndex + 5]) << 8
                        let height = Int(data[data.startIndex + 6]) | Int(data[data.startIndex + 7]) << 8
                        if data.count == 16 + width * height * 4 {
                            let pixels = data.subdata(in: (data.startIndex + 16)..<data.endIndex)
                            self.onFrame?(width, height, pixels)
                        }
                    }
                @unknown default: break
                }
                self.receive(task)
            }
        }
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        DispatchQueue.main.async { self.onStatus?("connected") }
        send(["t": "hello", "client": "app"])
    }

    func send(_ message: [String: Any]) {
        guard let socket, let data = try? JSONSerialization.data(withJSONObject: message), let text = String(data: data, encoding: .utf8) else { return }
        socket.send(.string(text)) { _ in }
    }

    func stop() {
        closed = true
        socket?.cancel(with: .goingAway, reason: nil)
        try? stdinPipe?.fileHandleForWriting.close()
        process?.terminate()
    }
}
