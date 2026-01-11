import Foundation

class ResidenceCardController {
    let manager: SmartCardInterface
    
    // JPRC AID (Japan Residence Card)
    static let AID_JPRC = Data([0xD3, 0x92, 0xF0, 0x00, 0x4F, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
    
    init(manager: SmartCardInterface) {
        self.manager = manager
    }
    
    func selectJPRCAP() async throws {
        var apdu = Data([0x00, 0xA4, 0x04, 0x0C])
        apdu.append(UInt8(Self.AID_JPRC.count))
        apdu.append(Self.AID_JPRC)
        
        let res = try await manager.transmit(apdu: apdu)
        try checkSW(res, context: "Select JPRC AP")
    }
    
    func readDF2Info() async throws -> Data {
        // Select DF2 (Address Info)
        let df2AID = Data([0xD3, 0x92, 0xF0, 0x00, 0x4F, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
        var selApdu = Data([0x00, 0xA4, 0x04, 0x0C])
        selApdu.append(UInt8(df2AID.count))
        selApdu.append(df2AID)
        let resSel = try await manager.transmit(apdu: selApdu)
        try checkSW(resSel, context: "Select DF2")
        
        // Read Address EF (Tag D2-D4 usually)
        // For simplicity, just read EF01
        return try await readEF(fileID: Data([0x00, 0x01]))
    }
    
    private func readEF(fileID: Data) async throws -> Data {
        var selApdu = Data([0x00, 0xA4, 0x02, 0x0C, 0x02])
        selApdu.append(fileID)
        let resSel = try await manager.transmit(apdu: selApdu)
        try checkSW(resSel, context: "Select EF")
        
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
        throw SignerError.jpki("\(context) failed: \(String(format: "%02X%02X", sw1, sw2))")
    }
}
