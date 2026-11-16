import AppKit
import SwiftUI

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        Task { @MainActor in Model.shared.start() }
    }
    func applicationWillTerminate(_ notification: Notification) {
        MainActor.assumeIsolated { Model.shared.stop() }
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

@main
struct PocketBenchApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate
    @StateObject private var model = Model.shared

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
                .frame(minWidth: 1100, minHeight: 700)
                .preferredColorScheme(.dark)
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1440, height: 900)
    }
}

struct RootView: View {
    @EnvironmentObject var model: Model

    var body: some View {
        ZStack(alignment: .topLeading) {
            RoomView(view: model.room).ignoresSafeArea()
            VStack(alignment: .leading, spacing: 6) {
                Text("Pocket Bench").font(.system(size: 15, weight: .semibold))
                Text("\(model.connection) · \(model.phase) · \(model.projectTitle ?? "no project")").font(.system(size: 11)).foregroundStyle(.secondary)
                Text(String(format: "%.0f fps · GPU %.1f ms · scale %.2f · %@", model.fps, model.gpuMs, model.renderScale, model.adapter)).font(.system(size: 11, design: .monospaced)).foregroundStyle(.secondary)
                if let error = model.rendererError { Text(error).font(.system(size: 11)).foregroundStyle(.red) }
            }
            .padding(12)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 10))
            .padding(.top, 40).padding(.leading, 16)
        }
        .ignoresSafeArea()
    }
}
