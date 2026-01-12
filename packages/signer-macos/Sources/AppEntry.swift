import SwiftUI

@main
struct SignerApp: App {
    @StateObject private var appState = AppState()
    
    init() {
        let args = ProcessInfo.processInfo.arguments
        if args.count > 1 {
            // CLI Mode: Run handler and exit
            Task {
                let handler = CLIHandler()
                await handler.run()
                exit(0)
            }
        }
    }
    
    var body: some Scene {
        WindowGroup {
            if ProcessInfo.processInfo.arguments.count <= 1 {
                MainView()
                    .environmentObject(appState)
                    .frame(minWidth: 400, minHeight: 500)
            }
        }
        .windowStyle(.hiddenTitleBar)
    }
}

class AppState: ObservableObject {
    @Published var status: String = "No card detected"
    @Published var progress: Double = 0
    @Published var cardData: IdentityData? = nil
    @Published var error: String? = nil
    @Published var isReading: Bool = false
    @Published var isCardPresent: Bool = false
    @Published var showPinEntry: Bool = false
    @Published var pinPrompt: String = ""
    
    var pendingAction: (() async -> Void)?
    
    struct IdentityData: Identifiable {
        let id = UUID()
        let type: String
        let fields: [String: String]
        let facePhoto: NSImage?
    }
    
    init() {
        SmartCardManager.shared.onCardStateChanged = { [weak self] isPresent in
            self?.isCardPresent = isPresent
            self?.status = isPresent ? "Card detected! Ready to read." : "Waiting for card..."
            if !isPresent { self?.cardData = nil; self?.error = nil }
        }
        SmartCardManager.shared.checkCurrentState()
    }
    
    @MainActor
    func readMyNumber(pin: String) async {
        isReading = true
        status = "Accessing My Number Card..."
        error = nil
        
        do {
            let jpki = JPKIController(manager: SmartCardManager.shared)
            let info = try await jpki.readAttributes(pin: pin)
            let myNumber = try await jpki.readMyNumber(pin: pin)
            
            var fields = [
                "Name": info.name,
                "Address": info.address,
                "Birth Date": info.birthDate,
                "My Number": myNumber
            ]
            
            var photo: NSImage? = nil
            if let photoData = try? await jpki.readFacePhoto(pin: pin) {
                photo = NSImage(data: photoData)
            }
            
            self.cardData = IdentityData(type: "My Number Card", fields: fields, facePhoto: photo)
            status = "Success"
        } catch {
            self.error = error.localizedDescription
            status = "Error"
        }
        isReading = false
    }
}
