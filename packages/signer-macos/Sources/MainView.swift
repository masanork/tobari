import SwiftUI
import AppKit

struct MainView: View {
    @EnvironmentObject var state: AppState
    @State private var pin: String = ""
    @State private var pin2: String = ""
    @State private var mrz: String = ""
    @State private var entryMode: EntryMode = .none
    @State private var showScanner: Bool = false

    enum EntryMode {
        case none, jpki, passport, license, wallet
    }

    var body: some View {
        ZStack {
            VisualEffectView(material: .hudWindow, blendingMode: .behindWindow)
                .ignoresSafeArea()
                .allowsHitTesting(false)
            
            VStack(spacing: 20) {
                // Header
                HStack {
                    Image(systemName: state.isCardPresent ? "shield.authconfig.fill" : "shield.slash.fill")
                        .font(.largeTitle)
                        .foregroundColor(state.isCardPresent ? .blue : .secondary)
                    Text("Tobari Wallet")
                        .font(.headline)
                        .tracking(1.0)
                }
                .padding(.top, 30)
                
                Divider()
                
                if let data = state.cardData {
                    IdentityResultView(data: data)
                    
                    Button("Return to Wallet") {
                        state.cardData = nil
                        entryMode = .wallet
                    }
                    .buttonStyle(.bordered)
                } else if entryMode == .wallet {
                    WalletView()
                        .transition(.move(edge: .leading))
                    
                    Button("Read New Card") {
                        withAnimation {
                            entryMode = .none
                        }
                    }
                    .buttonStyle(.plain)
                    .foregroundColor(.blue)
                    .padding(.bottom)
                } else if entryMode != .none {
                    EntryView(mode: $entryMode, pin: $pin, pin2: $pin2, mrz: $mrz, showScanner: $showScanner)
                } else {
                    CardMenuView(entryMode: $entryMode)
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
        .sheet(isPresented: $showScanner) {
            ScannerView(isPresented: $showScanner, mrzResult: $mrz)
                .frame(width: 500, height: 400)
        }
        .onAppear {
            // Ensure directory structure exists
            StorageManager.shared.ensureDirectoryStructure()
            
            // Set initial mode to wallet
            if entryMode == .none {
                entryMode = .wallet
            }

            // Activate the application when the view appears
            // This ensures keyboard input goes to the app window, not the terminal
            NSApplication.shared.activate(ignoringOtherApps: true)

            // Also make sure the window becomes key
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                if let window = NSApplication.shared.windows.first {
                    window.makeKey()
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
                    .font(.caption2)
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
    @Binding var entryMode: MainView.EntryMode
    
    var body: some View {
        VStack(spacing: 20) {
            if !state.isCardPresent {
                VStack(spacing: 12) {
                    Image(systemName: "contact.sensor.pass")
                        .font(.system(size: 40))
                        .symbolEffect(.pulse, options: .repeating)
                        .foregroundColor(.secondary)
                    Text("Insert card or select type for OCR")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
                .padding(.bottom, 10)
            } else if state.detectedCardType == .unknown {
                HStack {
                    ProgressView().scaleEffect(0.5)
                    Text("Identifying card...")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }

            VStack(spacing: 15) {
                ActionBtn(
                    title: "Wallet", 
                    icon: "wallet.pass.fill",
                    color: .blue
                ) {
                    entryMode = .wallet
                }

                ActionBtn(
                    title: "My Number Card", 
                    icon: "person.badge.shield.fill",
                    isHighlighted: state.detectedCardType == .jpki
                ) {
                    entryMode = .jpki
                }
                
                ActionBtn(
                    title: "Passport", 
                    icon: "globe.europe.africa.fill", 
                    color: .green,
                    isHighlighted: state.detectedCardType == .passport
                ) {
                    entryMode = .passport
                }
                
                ActionBtn(
                    title: "Driver's License", 
                    icon: "car.fill", 
                    color: .orange,
                    isHighlighted: state.detectedCardType == .driversLicense
                ) {
                    entryMode = .license
                }
            }
        }
        .padding()
    }
}

struct EntryView: View {
    @EnvironmentObject var state: AppState
    @Binding var mode: MainView.EntryMode
    @Binding var pin: String
    @Binding var pin2: String
    @Binding var mrz: String
    @Binding var showScanner: Bool
    @FocusState private var focusedField: Field?

    enum Field: Hashable {
        case pin, pin2, mrz
    }
    
    var body: some View {
        VStack(spacing: 20) {
            HStack {
                Button(action: { mode = .none }) {
                    Image(systemName: "chevron.left")
                    Text("Back")
                }
                .buttonStyle(.plain)
                .foregroundColor(.blue)
                Spacer()
                
                // Card Presence Indicator in Entry View
                HStack(spacing: 6) {
                    Circle()
                        .fill(state.isCardPresent ? Color.green : Color.red)
                        .frame(width: 8, height: 8)
                    Text(state.isCardPresent ? "Card Ready" : "Card Disconnected")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }
            .padding(.horizontal)
            
            Text(title)
                .font(.headline)
            
            VStack(spacing: 12) {
                if mode == .jpki {
                    SecureField("4-digit PIN", text: $pin)
                        .textFieldStyle(.roundedBorder)
                        .multilineTextAlignment(.center)
                        .focused($focusedField, equals: .pin)
                        .onAppear {
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                                focusedField = .pin
                            }
                        }
                } else if mode == .passport {
                    HStack {
                        TextField("MRZ (or CAN)", text: $mrz)
                            .textFieldStyle(.roundedBorder)
                            .multilineTextAlignment(.center)
                            .focused($focusedField, equals: .mrz)
                            .onAppear {
                                DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                                    focusedField = .mrz
                                }
                            }

                        Button(action: { showScanner = true }) {
                            Image(systemName: "camera.viewfinder")
                                .font(.title3)
                        }
                        .buttonStyle(.plain)
                        .help("Scan with Camera")
                    }
                    Text("Enter MRZ (Passport No + Birth + Expiry) or 6-digit CAN")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                } else if mode == .license {
                    SecureField("PIN 1 (Common)", text: $pin)
                        .textFieldStyle(.roundedBorder)
                        .focused($focusedField, equals: .pin)
                        .onAppear {
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                                focusedField = .pin
                            }
                        }
                    
                    SecureField("PIN 2 (Sensitive - Optional)", text: $pin2)
                        .textFieldStyle(.roundedBorder)
                        .focused($focusedField, equals: .pin2)
                        
                    Text("PIN2 is required for Registered Domicile & Photo")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }
            .frame(width: 250)
            
            VStack(spacing: 8) {
                Button("Read Card") {
                    executeRead()
                }
                .buttonStyle(.borderedProminent)
                .disabled(!canRead || state.isReading || !state.isCardPresent)
                
                if !state.isCardPresent {
                    Text("Please connect the card to read")
                        .font(.caption2)
                        .foregroundColor(.orange)
                }
            }
            
            if let error = state.error {
                Text(error)
                    .font(.body)
                    .foregroundColor(.red)
                    .multilineTextAlignment(.center)
                    .textSelection(.enabled)
                    .onTapGesture {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(error, forType: .string)
                    }
                    .padding(.top, 10)
            }
        }
        .padding()
    }
    
    private var title: String {
        switch mode {
        case .jpki: return "JPKI Verification"
        case .passport: return "Passport Reading"
        case .license: return "Driver's License"
        default: return ""
        }
    }
    
    private var canRead: Bool {
        switch mode {
        case .jpki: return pin.count >= 4
        case .passport: return mrz.count >= 6
        case .license: return pin.count >= 4
        default: return false
        }
    }
    
    private func executeRead() {
        Task {
            switch mode {
            case .jpki: await state.readMyNumber(pin: pin)
            case .passport: 
                if mrz.count == 6 { await state.readPassport(can: mrz) }
                else { await state.readPassport(mrz: mrz) }
            case .license: await state.readDriverLicense(pin1: pin, pin2: pin2.isEmpty ? nil : pin2)
            default: break
            }
        }
    }
}

struct ActionBtn: View {
    let title: String
    let icon: String
    var color: Color = .blue
    var isHighlighted: Bool = false
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            HStack {
                Image(systemName: icon)
                Text(title)
                Spacer()
                if isHighlighted {
                    Text("Detected")
                        .font(.caption2)
                        .fontWeight(.bold)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(Capsule().fill(color))
                        .foregroundColor(.white)
                }
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .opacity(0.5)
            }
            .frame(maxWidth: 250)
            .padding()
            .background(RoundedRectangle(cornerRadius: 12).fill(isHighlighted ? color.opacity(0.25) : color.opacity(0.15)))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(isHighlighted ? color : color.opacity(0.3), lineWidth: isHighlighted ? 2 : 1))
        }
        .buttonStyle(.plain)
    }
}

struct IdentityResultView: View {
    let data: AppState.IdentityData

    var body: some View {
        HStack(alignment: .top, spacing: 20) {
            // Left side: Photo
            if let photo = data.facePhoto {
                Image(nsImage: photo)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: 160, height: 200)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .shadow(radius: 5)
            }

            // Right side: Information
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text(data.type.uppercased())
                        .font(.caption2)
                        .fontWeight(.bold)
                        .foregroundColor(.blue)
                    Spacer()
                    if let dump = data.fields["Debug Dump"] {
                        Button(action: {
                            let pasteboard = NSPasteboard.general
                            pasteboard.clearContents()
                            pasteboard.setString(dump, forType: .string)
                        }) {
                            Image(systemName: "doc.on.doc")
                                .font(.caption)
                        }
                        .buttonStyle(.plain)
                        .help("Copy Debug Info")
                    }
                }

                ForEach(data.fields.sorted(by: { $0.key < $1.key }), id: \.key) { key, value in
                    if key != "Debug Dump" {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(key)
                                .font(.caption)
                                .foregroundColor(.secondary)
                            Text(value)
                                .font(.system(.body, design: .monospaced))
                                .textSelection(.enabled)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
            .background(RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.05)))

            Spacer(minLength: 0)
        }
        .padding()
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
