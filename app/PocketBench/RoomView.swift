// The room: a CAMetalLayer the renderer (core/) draws into, and the pointer and keys it reads.
import AppKit
import QuartzCore
import SwiftUI

final class RoomNSView: NSView {
    let metal = CAMetalLayer()
    var handle: OpaquePointer?
    var onPosts: (([[String: Any]]) -> Void)?
    private var timer: Timer?
    private var tracking: NSTrackingArea?
    private var lastSize = CGSize.zero

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer = metal
        metal.isOpaque = true
        metal.backgroundColor = NSColor.black.cgColor
        metal.framebufferOnly = true
    }
    required init?(coder: NSCoder) { fatalError() }

    override var acceptsFirstResponder: Bool { true }
    override var isFlipped: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    private var scale: CGFloat { window?.backingScaleFactor ?? NSScreen.main?.backingScaleFactor ?? 2 }
    private var pixels: (UInt32, UInt32) {
        (UInt32(max(1, (bounds.width * scale).rounded())), UInt32(max(1, (bounds.height * scale).rounded())))
    }

    func start() {
        guard handle == nil, bounds.width > 8, bounds.height > 8 else { return }
        metal.contentsScale = scale
        let (w, h) = pixels
        lastSize = bounds.size
        handle = bench_create(Unmanaged.passUnretained(metal).toOpaque(), w, h, Float(scale), Paths.roomBundle, Paths.assets, Paths.presets)
        let t = Timer(timeInterval: 1.0 / 60, repeats: true) { [weak self] _ in self?.poll() }
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    func stop() {
        timer?.invalidate()
        if let handle { bench_destroy(handle) }
        handle = nil
    }

    private func poll() {
        guard let handle, let text = bench_poll(handle) else { return }
        defer { bench_free(text) }
        guard let data = String(cString: text).data(using: .utf8),
              let list = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return }
        onPosts?(list)
    }

    override func layout() {
        super.layout()
        if handle == nil { start(); return }
        guard bounds.size != lastSize, bounds.width > 8, bounds.height > 8 else { return }
        lastSize = bounds.size
        metal.contentsScale = scale
        let (w, h) = pixels
        bench_resize(handle, w, h, Float(scale))
    }

    override func viewDidChangeBackingProperties() {
        super.viewDidChangeBackingProperties()
        lastSize = .zero
        needsLayout = true
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        let area = NSTrackingArea(rect: bounds, options: [.mouseMoved, .activeInKeyWindow, .inVisibleRect, .mouseEnteredAndExited], owner: self)
        addTrackingArea(area)
        tracking = area
    }

    // ----- input -----

    func send(_ message: [String: Any]) {
        guard let handle, let data = try? JSONSerialization.data(withJSONObject: message), let text = String(data: data, encoding: .utf8) else { return }
        bench_send(handle, text)
    }
    func sendRaw(_ json: String) { if let handle { bench_send(handle, json) } }

    private func point(_ event: NSEvent) {
        guard let handle else { return }
        let p = convert(event.locationInWindow, from: nil)
        bench_pointer(handle, Float(p.x / max(bounds.width, 1)), Float(p.y / max(bounds.height, 1)))
    }
    override func mouseMoved(with event: NSEvent) { point(event) }
    override func mouseDragged(with event: NSEvent) { point(event) }
    override func rightMouseDragged(with event: NSEvent) { point(event) }
    override func otherMouseDragged(with event: NSEvent) { point(event) }
    override func mouseDown(with event: NSEvent) { window?.makeFirstResponder(self); point(event); bench_button(handle, 0, true) }
    override func mouseUp(with event: NSEvent) { point(event); bench_button(handle, 0, false) }
    override func rightMouseDown(with event: NSEvent) { point(event); bench_button(handle, 2, true) }
    override func rightMouseUp(with event: NSEvent) { point(event); bench_button(handle, 2, false) }
    override func otherMouseDown(with event: NSEvent) { point(event); bench_button(handle, 1, true) }
    override func otherMouseUp(with event: NSEvent) { point(event); bench_button(handle, 1, false) }
    override func scrollWheel(with event: NSEvent) {
        // A wheel's line is a notch; a trackpad's points are a fortieth of one.
        let dy = event.hasPreciseScrollingDeltas ? Float(event.scrollingDeltaY) / 40 : Float(event.scrollingDeltaY)
        if dy != 0 { bench_wheel(handle, dy) }
    }
    override func magnify(with event: NSEvent) { bench_wheel(handle, Float(event.magnification) * 6) }

    private static let named: [UInt16: String] = [
        49: "Space", 53: "Escape", 36: "Enter", 48: "Tab", 51: "Backspace", 123: "Left", 124: "Right", 125: "Down", 126: "Up",
    ]
    private func key(_ event: NSEvent, down: Bool) {
        guard let handle else { return }
        var name = RoomNSView.named[event.keyCode]
        if name == nil, let c = event.charactersIgnoringModifiers?.uppercased(), c.count == 1, let ch = c.unicodeScalars.first,
           (ch.value >= 65 && ch.value <= 90) || (ch.value >= 48 && ch.value <= 57) { name = c }
        guard let name else { return }
        let code = name.count == 1 ? (name.first!.isNumber ? "Digit\(name)" : "Key\(name)") : name
        bench_key(handle, code, name, down)
    }
    override func keyDown(with event: NSEvent) { if !event.isARepeat { key(event, down: true) } }
    override func keyUp(with event: NSEvent) { key(event, down: false) }

    func stream(_ name: String, width: Int, height: Int, pixels: UnsafeRawBufferPointer) {
        guard let handle, let base = pixels.baseAddress else { return }
        bench_stream(handle, name, UInt32(width), UInt32(height), base.assumingMemoryBound(to: UInt8.self), pixels.count)
    }
    func snapshot(to path: String) { if let handle { bench_snapshot(handle, path) } }
    func reload(_ bundle: String) { if let handle { bench_reload(handle, bundle) } }
}

struct RoomView: NSViewRepresentable {
    let view: RoomNSView
    func makeNSView(context: Context) -> RoomNSView { view }
    func updateNSView(_ nsView: RoomNSView, context: Context) {}
}
