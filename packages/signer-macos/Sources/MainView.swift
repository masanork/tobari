import SwiftUI

struct MainView: View {
    @EnvironmentObject var state: AppState
    @State private var pin: String = ""
    
    var body: some View {
        ZStack {
            VisualEffectView(material: .hudWindow, blendingMode: .behindWindow)
                .ignoresSafeArea()
            
            VStack(spacing: 20) {
                // Header
                HStack {
                    Image(systemName: state.isCardPresent ? "shield.authconfig.fill" : "shield.slash.fill")
                        .font(.largeTitle)
                        .foregroundColor(state.isCardPresent ? .blue : .secondary)
                    Text("Tobari Signer")
                        .font(.headline)
                        .tracking(1.0)
                }
                .padding(.top, 30)
                
                Divider()
                
                if let data = state.cardData {
                    IdentityResultView(data: data)
                    
                    Button("Read Another Card") {
                        state.cardData = nil
                    }
                    .buttonStyle(.bordered)
                } else if state.isCardPresent {
                    CardMenuView()
                } else {
                    CardInteractionView()
                }
                
                Spacer()
                
                // Status Bar
                VStack(spacing: 8) {
                    if state.isReading {
                        ProgressView()
                            .scaleEffect(0.8)
                    }
                    
                    Text(state.status)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .padding(.bottom, 20)
            }
        }
        .sheet(isPresented: $state.showPinEntry) {
            PinEntryView(pin: $pin) {
                state.showPinEntry = false
                Task {
                    await state.readMyNumber(pin: pin)
                    pin = ""
                }
            }
        }
    }
}

struct CardInteractionView: View {
    @EnvironmentObject var state: AppState
    
    var body: some View {
        VStack(spacing: 30) {
            Image(systemName: "contact.sensor.pass.fill")
                .font(.system(size: 60))
                .symbolEffect(.pulse, options: .repeating)
                .foregroundColor(.blue.opacity(0.8))
            
            Text("Hold your card near the reader")
                .font(.subheadline)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 50)
            
            if let error = state.error {
                Text(error)
                    .font(.caption)
                    .foregroundColor(.red)
                    .padding()
                    .background(RoundedRectangle(cornerRadius: 8).fill(Color.red.opacity(0.1)))
            }
        }
        .padding(.vertical, 40)
    }
}

struct CardMenuView: View {
    @EnvironmentObject var state: AppState
    
    var body: some View {
        VStack(spacing: 15) {
            Text("Select Card Type")
                .font(.subheadline)
                .foregroundColor(.secondary)
            
            ActionBtn(title: "My Number Card", icon: "person.badge.shield.fill") {
                state.pinPrompt = "Enter 4-digit PIN"
                state.showPinEntry = true
            }
            
            ActionBtn(title: "Passport", icon: "globe.europe.africa.fill", color: .green) {
                // To be implemented
            }
            
            ActionBtn(title: "Driver's License", icon: "car.fill", color: .orange) {
                // To be implemented
            }
        }
        .padding()
    }
}

struct ActionBtn: View {
    let title: String
    let icon: String
    var color: Color = .blue
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            HStack {
                Image(systemName: icon)
                Text(title)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .opacity(0.5)
            }
            .frame(maxWidth: 250)
            .padding()
            .background(RoundedRectangle(cornerRadius: 12).fill(color.opacity(0.15)))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(color.opacity(0.3), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

struct IdentityResultView: View {
    let data: AppState.IdentityData
    
    var body: some View {
        VStack(spacing: 15) {
            if let photo = data.facePhoto {
                Image(nsImage: photo)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: 120, height: 150)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .shadow(radius: 5)
            }
            
            VStack(alignment: .leading, spacing: 8) {
                Text(data.type.uppercased())
                    .font(.caption2)
                    .fontWeight(.bold)
                    .foregroundColor(.blue)
                
                ForEach(data.fields.sorted(by: { $0.key < $1.key }), id: \.key) { key, value in
                    HStack {
                        Text(key)
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .frame(width: 80, alignment: .leading)
                        Text(value)
                            .font(.system(.body, design: .monospaced))
                    }
                }
            }
            .padding()
            .background(RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.05)))
        }
        .padding()
    }
}

struct PinEntryView: View {
    @Binding var pin: String
    let onCommit: () -> Void
    
    var body: some View {
        VStack(spacing: 20) {
            Text("Security Verification")
                .font(.headline)
            
            SecureField("Enter PIN", text: $pin)
                .textFieldStyle(.roundedBorder)
                .multilineTextAlignment(.center)
                .font(.title)
                .frame(width: 200)
            
            HStack {
                Button("Cancel") { pin = "" }
                Button("Unlock") { onCommit() }
                    .buttonStyle(.borderedProminent)
                    .disabled(pin.isEmpty)
            }
        }
        .padding(30)
        .frame(width: 300)
    }
}

struct VisualEffectView: NSViewRepresentable {
    let material: NSVisualEffectView.Material
    let blendingMode: NSVisualEffectView.BlendingMode
    
    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = material
        view.blendingMode = blendingMode
        view.state = .active
        return view
    }
    
    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {
        nsView.material = material
        nsView.blendingMode = blendingMode
    }
}