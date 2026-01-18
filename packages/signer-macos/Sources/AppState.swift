import SwiftUI
import Foundation

class AppState: ObservableObject {
    @Published var status: String = "No card detected"
    @Published var progress: Double = 0
    @Published var cardData: IdentityData? = nil
    @Published var error: String? = nil
    @Published var isReading: Bool = false
    @Published var isCardPresent: Bool = false
    @Published var detectedCardType: SmartCardManager.CardType = .unknown
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
            if !isPresent {
                self?.status = "Waiting for card..."
                self?.cardData = nil
                self?.error = nil
                self?.detectedCardType = .unknown
            } else if self?.detectedCardType == .unknown {
                 self?.status = "Card detected! Identifying..."
            }
        }
        SmartCardManager.shared.onCardTypeDetected = { [weak self] type in
            self?.detectedCardType = type
            if type != .unknown {
                self?.status = "Detected: \(type.rawValue.capitalized). Ready to read."
            }
        }
        SmartCardManager.shared.checkCurrentState()
    }
    
    @MainActor
    func readMyNumber(pin: String) async {
        isReading = true
        status = "Identifying My Number Card..."
        error = nil
        
        let scm = SmartCardManager.shared
        scm.beginOperation()
        defer { scm.endOperation() }

        do {
            try await scm.establishSession()
            let jpki = JPKIController(manager: scm)
            
            status = "Reading Personal Attributes..."
            let info = try await jpki.readAttributes(pin: pin)

            status = "Verifying My Number..."
            let myNumber = try await jpki.readMyNumber(pin: pin)

            let fields = [
                "Name": info.name,
                "Address": info.address,
                "Birth Date": info.birthDate,
                "Gender": info.gender,
                "My Number": myNumber
            ]

            var photo: NSImage? = nil
            status = "Extracting Face Photo (may take a few seconds)..."
            do {
                let photoData = try await jpki.readFacePhoto(myNumber: myNumber)
                photo = NSImage(data: photoData)
            } catch {
                print("Photo extraction failed: \(error)")
            }

            self.cardData = IdentityData(type: "My Number Card", fields: fields, facePhoto: photo)
            status = "Ready"
        } catch {
            self.error = error.localizedDescription
            status = "Error"
        }
        isReading = false
    }
    
    @MainActor
    func readPassport(mrz: String? = nil, can: String? = nil) async {
        isReading = true
        status = "Connecting to Passport..."
        error = nil
        
        let scm = SmartCardManager.shared
        scm.beginOperation()
        defer { scm.endOperation() }

        do {
            try await scm.establishSession()
            let controller = PassportController(manager: scm)
            try await controller.selectPassportAP()
            
            if let can = can {
                status = "PACE Authentication (CAN)..."
                try await controller.performPACE(password: can, isCan: true)
            } else if let mrz = mrz {
                status = "BAC Authentication (MRZ)..."
                try await controller.performBAC(mrz: mrz)
            }
            
            status = "Reading Data Groups..."
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
            status = "Ready"
        } catch {
            self.error = error.localizedDescription
            status = "Error"
        }
        isReading = false
    }
    
    @MainActor
    func readDriverLicense(pin1: String, pin2: String?) async {
        isReading = true
        status = "Accessing Driver's License..."
        error = nil

        let scm = SmartCardManager.shared
        scm.beginOperation()
        defer { scm.endOperation() }

        do {
            try await scm.establishSession()
            let controller = DriversLicenseController(manager: scm)
            
            status = "Verifying PIN & Extracting Text..."
            let info = try await controller.readData(pin1: pin1, pin2: pin2)

            var fields = [
                "Name": info.name,
                "Address": info.address,
                "Birth Date": info.birthDate,
                "License No": info.licenseNumber,
                "Color": info.colorClass,
                "Registered Domicile": info.registeredDomicile ?? "(Restricted)"
            ]
            
            if let dump = info.debugDump {
                fields["Debug Dump"] = dump
            }
            
            var photo: NSImage? = nil
            if let photoBase64 = info.facePhoto, let data = Data(base64Encoded: photoBase64) {
                photo = NSImage(data: data)
            }

            self.cardData = IdentityData(type: "Driver's License", fields: fields, facePhoto: photo)
            status = "Ready"
        } catch {
            self.error = error.localizedDescription
            status = "Error"
        }
        isReading = false
    }
}
