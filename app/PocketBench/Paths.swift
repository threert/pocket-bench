// Where the app's parts are: the repository for a build run from it, the bundle's Resources once it is packaged.
import Foundation

enum Paths {
    static let root: String = {
        if let env = ProcessInfo.processInfo.environment["POCKET_BENCH_ROOT"], !env.isEmpty { return env }
        if let plist = Bundle.main.object(forInfoDictionaryKey: "BenchRoot") as? String, !plist.isEmpty,
           FileManager.default.fileExists(atPath: plist + "/sidecar/src/main.ts") {
            return URL(fileURLWithPath: plist).standardizedFileURL.path
        }
        return (Bundle.main.resourcePath ?? ".") + "/bench"
    }()
    static var bun: String { root + "/vendor/bin/bun" }
    static var sidecar: String { root + "/sidecar/src/main.ts" }
    static var roomBundle: String { root + "/.build/room.js" }
    /// The room's assets resolve against the repository root (`assets/...`, `room/assets/...`).
    static var assets: String { root }
    static var presets: String { root + "/engine/presets" }
    static var scratch: String {
        let dir = NSTemporaryDirectory() + "pocket-bench"
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        return dir
    }
}
