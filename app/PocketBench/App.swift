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
                .frame(minWidth: 1180, minHeight: 720)
                .preferredColorScheme(.dark)
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1440, height: 900)
    }
}

struct RootView: View {
    @EnvironmentObject var model: Model
    @StateObject private var pointer = PointerTracker()

    var body: some View {
        ZStack {
            RoomView(view: model.room).ignoresSafeArea()
            // Left: where you are and what to do.
            VStack(alignment: .leading, spacing: 10) {
                TopBar().padding(.leading, 70)
                QuestCard()
                Spacer(minLength: 0)
                if let unit = model.selectedUnit, !unit.isEmpty { UnitCard(id: unit).transition(.move(edge: .leading).combined(with: .opacity)) }
            }
            .padding(.leading, 14).padding(.top, 10).padding(.bottom, 14)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .animation(.easeOut(duration: 0.18), value: model.selectedUnit)
            // Right: the Tab5's screen and the agent.
            AgentPanel()
                .padding(.trailing, 12).padding(.top, 12).padding(.bottom, 12)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .trailing)
            // Bottom: views.
            ViewBar()
                .padding(.bottom, 14).padding(.trailing, 384)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
            if let toast = model.toastMessage {
                ToastView(toast: toast).padding(.top, 16).padding(.trailing, 384)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
            if let hover = model.hover {
                HoverTip(hover: hover)
                    .position(x: min(max(pointer.location.x + 18, 120), 1040), y: max(pointer.location.y - 30, 40))
                    .allowsHitTesting(false)
            }
            if let error = model.rendererError {
                Text(error).font(.system(size: 12)).foregroundStyle(Theme.bad).padding().glass()
            }
        }
        .ignoresSafeArea()
        .animation(.easeOut(duration: 0.2), value: model.toastMessage)
        .sheet(isPresented: $model.showLessons) { LessonsSheet().environmentObject(model) }
        .sheet(isPresented: $model.showProjects) { ProjectsSheet().environmentObject(model) }
    }
}
