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
                    .frame(minWidth: 600, minHeight: 450)
            }
        }
        //.windowStyle(.hiddenTitleBar) // Removed to fix focus issues
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
            print("DEBUG: Attributes retrieved - Name: '\(info.name)', Address: '\(info.address)', Birth: '\(info.birthDate)', Gender: '\(info.gender)'")

            let myNumber = try await jpki.readMyNumber(pin: pin)
            print("DEBUG: My Number: '\(myNumber)'")

            var fields = [
                "Name": info.name,
                "Address": info.address,
                "Birth Date": info.birthDate,
                "Gender": info.gender,
                "My Number": myNumber
            ]

            var photo: NSImage? = nil
            var photoStatus = ""
            do {
                let photoData = try await jpki.readFacePhoto(myNumber: myNumber)
                photo = NSImage(data: photoData)
                if photo == nil {
                    photoStatus = " (Photo: failed to decode \(photoData.count) bytes)"
                } else {
                    photoStatus = " (Photo: OK)"
                }
            } catch {
                photoStatus = " (Photo error: \(error.localizedDescription))"
            }

            self.cardData = IdentityData(type: "My Number Card", fields: fields, facePhoto: photo)
            status = "Success" + photoStatus
        } catch {
            self.error = error.localizedDescription
            status = "Error"
        }
        isReading = false
    }
    
    @MainActor
    func readPassport(mrz: String? = nil, can: String? = nil) async {
        isReading = true
        status = "Accessing Passport..."
        error = nil
        
        do {
            let controller = PassportController(manager: SmartCardManager.shared)
            try await controller.selectPassportAP()
            
            if let can = can {
                try await controller.performPACE(password: can, isCan: true)
            } else if let mrz = mrz {
                try await controller.performBAC(mrz: mrz)
            }
            
            let info = try await controller.readFullPassportInfo()
            
            let fields = [
                "Name": info.name,
                "Passport No": info.passportNumber,
                "Nationality": info.nationality,
                "Birth Date": info.birthDate,
                "Expiry": info.expiryDate
            ]
            
            var photo: NSImage? = nil
            if let facePhotoB64 = info.facePhoto {
                photo = NSImage(data: Data(base64Encoded: facePhotoB64)!)
            }
            
            self.cardData = IdentityData(type: "ePassport", fields: fields, facePhoto: photo)
            status = "Success"
        } catch {
            self.error = error.localizedDescription
            status = "Error"
        }
        isReading = false
    }
    
    @MainActor
    func readDriverLicense(pin1: String, pin2: String) async {
        isReading = true
        status = "Accessing Driver's License..."
        error = nil
        
        do {
            let controller = DriversLicenseController(manager: SmartCardManager.shared)
            try await controller.selectDLAP()
            try await controller.verifyPIN1(pin1)
            try await controller.verifyPIN2(pin2)
            
            let info = try await controller.readCommonData()
            
            let fields = [
                "Name": info.name,
                "Address": info.address,
                "Birth Date": info.birthDate,
                "License No": info.licenseNumber,
                "Color": info.colorClass
            ]
            
            self.cardData = IdentityData(type: "Driver's License", fields: fields, facePhoto: nil)
            status = "Success"
        } catch {
            self.error = error.localizedDescription
            status = "Error"
        }
        isReading = false
    }
}
