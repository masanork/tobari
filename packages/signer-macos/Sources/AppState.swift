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
        status = "Accessing My Number Card..."
        error = nil
        
        let scm = SmartCardManager.shared
        scm.beginOperation()
        defer { scm.endOperation() }

        do {
            try await scm.establishSession()
            let jpki = JPKIController(manager: scm)
            let info = try await jpki.readAttributes(pin: pin)
            print("DEBUG: Attributes retrieved - Name: '\(info.name)', Address: '\(info.address)', Birth: '\(info.birthDate)', Gender: '\(info.gender)'")

            let myNumber = try await jpki.readMyNumber(pin: pin)
            print("DEBUG: My Number: '\(myNumber)'")

            let fields = [
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
        
        let scm = SmartCardManager.shared
        scm.beginOperation()
        defer { scm.endOperation() }

        do {
            try await scm.establishSession()
            let controller = PassportController(manager: scm)
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
            status = "Success"
        } catch {
            self.error = error.localizedDescription
            status = "Error"
        }
        isReading = false
    }
}
