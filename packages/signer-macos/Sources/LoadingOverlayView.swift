import SwiftUI

struct LoadingOverlayView: View {
    let status: String
    let progress: Double?
    
    var body: some View {
        ZStack {
            Color.black.opacity(0.4)
                .ignoresSafeArea()
            
            VStack(spacing: 24) {
                ZStack {
                    Circle()
                        .stroke(Color.white.opacity(0.2), lineWidth: 4)
                        .frame(width: 80, height: 80)
                    
                    Circle()
                        .trim(from: 0, to: 0.7)
                        .stroke(
                            LinearGradient(colors: [.blue, .cyan], startPoint: .topLeading, endPoint: .bottomTrailing),
                            style: StrokeStyle(lineWidth: 4, lineCap: .round)
                        )
                        .frame(width: 80, height: 80)
                        .rotationEffect(.degrees(360))
                        .animation(.linear(duration: 1).repeatForever(autoreverses: false), value: true)
                    
                    Image(systemName: "contact.sensor.pass")
                        .font(.system(size: 30))
                        .foregroundColor(.white)
                        .symbolEffect(.pulse, options: .repeating)
                }
                
                VStack(spacing: 8) {
                    Text(status)
                        .font(.headline)
                        .foregroundColor(.white)
                    
                    Text("Keep the card near the reader")
                        .font(.caption)
                        .foregroundColor(.white.opacity(0.7))
                }
            }
            .padding(40)
            .background(
                RoundedRectangle(cornerRadius: 24)
                    .fill(Color(NSColor.windowBackgroundColor).opacity(0.8))
                    .overlay(
                        RoundedRectangle(cornerRadius: 24)
                            .stroke(Color.white.opacity(0.2), lineWidth: 1)
                    )
            )
            .shadow(radius: 20)
        }
    }
}
