import Foundation

struct ResidenceCardInfo: Codable {
    let address: String
    let dateUpdated: String
    let permitGlobal: String
    let permitIndiv: String
    let updateStatus: String
}

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
    
    func readDF2Info() async throws -> ResidenceCardInfo {
        // Select DF2 (Address / Back Side)
        let df2AID = Data([0xD3, 0x92, 0xF0, 0x00, 0x4F, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
        var selApdu = Data([0x00, 0xA4, 0x04, 0x0C])
        selApdu.append(UInt8(df2AID.count))
        selApdu.append(df2AID)
        let resSel = try await manager.transmit(apdu: selApdu)
        try checkSW(resSel, context: "Select DF2")
        
        let addressData = try await readEF(fileID: Data([0x00, 0x01]))
        let globalPermitData = try await readEF(fileID: Data([0x00, 0x02]))
        let indivPermitData = try await readEF(fileID: Data([0x00, 0x03]))
        let statusData = try await readEF(fileID: Data([0x00, 0x04]))
        
        return try parseResidenceCardInfo(address: addressData, global: globalPermitData, indiv: indivPermitData, status: statusData)
    }
    
    private func parseResidenceCardInfo(address: Data, global: Data, indiv: Data, status: Data) throws -> ResidenceCardInfo {
        let addressTlvs = TLVParser.parse(data: address)
        let globalTlvs = TLVParser.parse(data: global)
        let indivTlvs = TLVParser.parse(data: indiv)
        let statusTlvs = TLVParser.parse(data: status)
        
        // Tags: D2-D4 (Address), D5 (Global Permit), D6 (Indiv Permit), D7 (Status)
        let addrStr = addressTlvs.first?.findString(tag: 0xD2) ?? ""
        let dateUpd = addressTlvs.first?.findString(tag: 0xD4) ?? ""
        let permitG = globalTlvs.first?.findString(tag: 0xD5) ?? ""
        let permitI = indivTlvs.first?.findString(tag: 0xD6) ?? ""
        let stat = statusTlvs.first?.findString(tag: 0xD7) ?? ""
        
        return ResidenceCardInfo(
            address: addrStr,
            dateUpdated: dateUpd,
            permitGlobal: permitG,
            permitIndiv: permitI,
            updateStatus: stat
        )
    }
    
    private func readEF(fileID: Data) async throws -> Data {
        var selApdu = Data([0x00, 0xA4, 0x02, 0x0C, 0x02])
        selApdu.append(fileID)
        let resSel = try await manager.transmit(apdu: selApdu)
        try checkSW(resSel, context: "Select EF")
        
        var result = Data()
        var offset = 0
        while true {
            let p1 = UInt8((offset >> 8) & 0xFF)
            let p2 = UInt8(offset & 0xFF)
            let readApdu = Data([0x00, 0xB0, p1, p2, 0x00, 0x00, 0x00])
            let res = try await manager.transmit(apdu: readApdu)
            
            if res.count < 2 { break }
            let chunk = res.prefix(res.count-2)
            if chunk.isEmpty { break }
            result.append(chunk)
            offset += chunk.count
            
            break 
        }
        return result
    }
    
    private func checkSW(_ data: Data, context: String) throws {
        if data.count < 2 { throw SignerError.residenceCard("\(context): too short") }
        let sw1 = data[data.count-2]
        let sw2 = data[data.count-1]
        if sw1 == 0x90 && sw2 == 0x00 { return }
        throw SignerError.residenceCard("\(context) failed with SW=\(String(format: "%02X%02X", sw1, sw2))")
    }
}

