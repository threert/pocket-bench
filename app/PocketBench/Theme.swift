// The app's look: dark glass panels over the room, one green for what is live or done, amber for what needs a look.
import SwiftUI

enum Theme {
    static let accent = Color(red: 0.24, green: 0.86, blue: 0.59)
    static let warn = Color(red: 1.0, green: 0.72, blue: 0.25)
    static let bad = Color(red: 1.0, green: 0.42, blue: 0.38)
    static let ink = Color.white.opacity(0.92)
    static let dim = Color.white.opacity(0.58)
    static let faint = Color.white.opacity(0.32)
    static let line = Color.white.opacity(0.09)
    static let fill = Color.white.opacity(0.06)
    static let panel = Color(red: 0.07, green: 0.08, blue: 0.09).opacity(0.78)
    static let radius: CGFloat = 16
}

/// A panel: blurred room behind dark glass, a hairline edge.
struct Glass: ViewModifier {
    var radius: CGFloat = Theme.radius
    func body(content: Content) -> some View {
        content
            .background {
                RoundedRectangle(cornerRadius: radius, style: .continuous).fill(.ultraThinMaterial)
                RoundedRectangle(cornerRadius: radius, style: .continuous).fill(Theme.panel)
            }
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(Theme.line, lineWidth: 1))
            .shadow(color: .black.opacity(0.35), radius: 18, y: 8)
    }
}

extension View {
    func glass(_ radius: CGFloat = Theme.radius) -> some View { modifier(Glass(radius: radius)) }
}

/// A small label in a capsule: a state, an address, a count.
struct Chip: View {
    let text: String
    var tint: Color = Theme.dim
    var filled = false
    var mono = false
    var body: some View {
        Text(text)
            .font(.system(size: 10.5, weight: .semibold, design: mono ? .monospaced : .default))
            .foregroundStyle(filled ? Color.black.opacity(0.85) : tint)
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(Capsule().fill(filled ? tint : tint.opacity(0.14)))
    }
}

struct QuietButton: ButtonStyle {
    var tint: Color = Theme.ink
    var prominent = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(prominent ? Color.black.opacity(0.88) : tint)
            .padding(.horizontal, 11).padding(.vertical, 6)
            .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(prominent ? Theme.accent : Color.white.opacity(configuration.isPressed ? 0.16 : 0.08)))
            .opacity(configuration.isPressed ? 0.8 : 1)
            .contentShape(Rectangle())
    }
}
