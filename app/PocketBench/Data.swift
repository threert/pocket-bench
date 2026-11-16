// The bench's state as the sidecar sends it (JSON objects), read into what the panels show.
import Foundation

typealias JSON = [String: Any]

struct ChatItem: Identifiable, Equatable {
    struct Option: Equatable { let id: String; let label: String; let kind: String }
    struct Entry: Equatable { let text: String; let status: String }
    let id: String
    var turn = 0
    var kind = "text"
    var text = ""
    var title = ""
    var toolKind = ""
    var status = ""
    var path = ""
    var added = 0
    var removed = 0
    var options: [Option] = []
    var entries: [Entry] = []
    var done = false

    init(_ j: JSON) {
        id = j["id"] as? String ?? UUID().uuidString
        merge(j)
    }
    mutating func merge(_ j: JSON) {
        if let v = j["turn"] as? Int { turn = v }
        if let v = j["kind"] as? String { kind = v }
        if let v = j["text"] as? String { text = v }
        if let v = j["title"] as? String { title = v }
        if let v = j["toolKind"] as? String { toolKind = v }
        if let v = j["status"] as? String { status = v }
        if let v = j["path"] as? String { path = v }
        if let d = j["diff"] as? JSON { added = d["added"] as? Int ?? 0; removed = d["removed"] as? Int ?? 0; if path.isEmpty { path = d["path"] as? String ?? "" } }
        if let list = j["options"] as? [JSON] { options = list.map { Option(id: $0["id"] as? String ?? "", label: $0["label"] as? String ?? "", kind: $0["kind"] as? String ?? "") } }
        if let list = j["entries"] as? [JSON] { entries = list.map { Entry(text: $0["text"] as? String ?? "", status: $0["status"] as? String ?? "") } }
        if let v = j["done"] as? Bool { done = v }
    }
}

struct AgentInfo: Identifiable, Equatable {
    let id: String
    let name: String
    let installed: Bool
    let version: String
    let note: String
}

struct UnitInfo: Identifiable, Equatable {
    let id: String
    let name: String
    let sku: String
    let blurb: String
    let use: String
    let addresses: [Int]
    let inputs: [Input]
    struct Input: Equatable { let key: String; let label: String; let unit: String }

    init(_ j: JSON) {
        id = j["id"] as? String ?? ""
        name = j["name"] as? String ?? id
        sku = j["sku"] as? String ?? ""
        blurb = j["blurb"] as? String ?? ""
        use = j["use"] as? String ?? ""
        addresses = j["addresses"] as? [Int] ?? []
        inputs = (j["inputs"] as? [JSON] ?? []).map { Input(key: $0["key"] as? String ?? "", label: $0["label"] as? String ?? "", unit: $0["unit"] as? String ?? "") }
    }
}

struct LessonStep: Identifiable, Equatable {
    let id: String
    let text: String
    let hint: String
    let prompt: String
    let done: Bool
}

struct Lesson: Identifiable, Equatable {
    let id: String
    let number: Int
    let title: String
    let tagline: String
    let story: String
    let units: [String]
    let minutes: Int
    let level: Int
    let done: Bool
    let steps: [LessonStep]
    let prompts: [String]

    init(_ j: JSON) {
        id = j["id"] as? String ?? ""
        number = j["number"] as? Int ?? 0
        title = j["title"] as? String ?? ""
        tagline = j["tagline"] as? String ?? ""
        story = j["story"] as? String ?? ""
        units = j["units"] as? [String] ?? []
        minutes = j["minutes"] as? Int ?? 10
        level = j["level"] as? Int ?? 1
        done = j["done"] as? Bool ?? false
        steps = (j["steps"] as? [JSON] ?? []).map { LessonStep(id: $0["id"] as? String ?? "", text: $0["text"] as? String ?? "", hint: $0["hint"] as? String ?? "", prompt: $0["prompt"] as? String ?? "", done: $0["done"] as? Bool ?? false) }
        prompts = j["prompts"] as? [String] ?? []
    }
}

struct Problem: Identifiable, Equatable {
    let id: Int
    let file: String
    let line: Int
    let message: String
}

struct ProjectRow: Identifiable, Equatable {
    let id: String
    let title: String
    let lesson: String
}

extension Int {
    var hexAddress: String { String(format: "0x%02X", self) }
}
