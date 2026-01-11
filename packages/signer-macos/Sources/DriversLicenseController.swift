import Foundation

class DriversLicenseController {
    let manager: SmartCardInterface
    
    // JPDL AID (Japan Driver License)
    static let AID_JPDL = Data([0xA0, 0x00, 0x00, 0x02, 0x31, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
    
    init(manager: SmartCardInterface) {
        self.manager = manager
    }
    
    func selectDLAP() async throws {
        var apdu = Data([0x00, 0xA4, 0x04, 0x0C])
        apdu.append(UInt8(Self.AID_JPDL.count))
        apdu.append(Self.AID_JPDL)
        
        let res = try await manager.transmit(apdu: apdu)
        try checkSW(res, context: "Select DL AP")
    }
    
    func verifyPIN1(_ pin: String) async throws {
        try await verifyPIN(fileID: Data([0x00, 0x11]), pin: pin)
    }
    
    func verifyPIN2(_ pin: String) async throws {
        try await verifyPIN(fileID: Data([0x00, 0x12]), pin: pin)
    }
    
    private func verifyPIN(fileID: Data, pin: String) async throws {
        // Select PIN EF
        var selApdu = Data([0x00, 0xA4, 0x02, 0x0C, 0x02])
        selApdu.append(fileID)
        let resSel = try await manager.transmit(apdu: selApdu)
        try checkSW(resSel, context: "Select PIN EF")
        
        // Verify
        let pinData = pin.data(using: .ascii) ?? Data()
        var verApdu = Data([0x00, 0x20, 0x00, 0x80])
        verApdu.append(UInt8(pinData.count))
        verApdu.append(pinData)
        
        let resVer = try await manager.transmit(apdu: verApdu)
        try checkSW(resVer, context: "Verify PIN")
    }
    
    func readCommonData() async throws -> Data {
        return try await readEF(fileID: Data([0x00, 0x01]))
    }
    
    private func readEF(fileID: Data) async throws -> Data {
        // Select EF
        var selApdu = Data([0x00, 0xA4, 0x02, 0x0C, 0x02])
        selApdu.append(fileID)
        let resSel = try await manager.transmit(apdu: selApdu)
        try checkSW(resSel, context: "Select EF")
        
        // Read Binary
        var readApdu = Data([0x00, 0xB0, 0x00, 0x00, 0x00])
        let res = try await manager.transmit(apdu: readApdu)
        if res.count < 2 { throw SignerError.jpki("Read EF failed") }
        return res.subdata(in: 0..<res.count-2)
    }
    
    private func checkSW(_ data: Data, context: String) throws {
        if data.count < 2 { throw SignerError.jpki("\(context): too short") }
        let sw1 = data[data.count-2]
        let sw2 = data[data.count-1]
        
        if sw1 == 0x90 && sw2 == 0x00 { return }
        if sw1 == 0x63 && (sw2 & 0xF0) == 0xC0 {
            throw SignerError.pinIncorrect(retries: Int(sw2 & 0x0F))
        }
        if sw1 == 0x69 && sw2 == 0x83 {
            throw SignerError.pinLocked
        }
        throw SignerError.jpki("\(context) failed: \(String(format: "%02X%02X", sw1, sw2))")
    }
}
