import Foundation

/// BER-TLV (Basic Encoding Rules - Tag, Length, Value) object
struct TLV {
    let tag: UInt32
    let value: Data
    let children: [TLV]
    
    var isConstructed: Bool {
        // Bit 6 of the first tag byte indicates constructed (1) or primitive (0)
        let firstByte = UInt8((tag >> ((tagBytesCount - 1) * 8)) & 0xFF)
        return (firstByte & 0x20) != 0
    }
    
    private var tagBytesCount: Int {
        if tag <= 0xFF { return 1 }
        if tag <= 0xFFFF { return 2 }
        if tag <= 0xFFFFFF { return 3 }
        return 4
    }
    
    func find(tag: UInt32) -> TLV? {
        if self.tag == tag { return self }
        for child in children {
            if let found = child.find(tag: tag) {
                return found
            }
        }
        return nil
    }
    
    func findValue(tag: UInt32) -> Data? {
        return find(tag: tag)?.value
    }
    
    func findString(tag: UInt32, encoding: String.Encoding = .utf8) -> String? {
        guard let data = findValue(tag: tag) else { return nil }
        return String(data: data, encoding: encoding)
    }
}

class TLVParser {
    static func parse(data: Data) -> [TLV] {
        var tlvs = [TLV]()
        var offset = 0
        let bytes = [UInt8](data)
        
        while offset < bytes.count {
            guard let tlv = parseNext(bytes: bytes, offset: &offset) else { break }
            tlvs.append(tlv)
        }
        
        return tlvs
    }
    
    private static func parseNext(bytes: [UInt8], offset: inout Int) -> TLV? {
        guard offset < bytes.count else { return nil }
        
        // 1. Parse Tag
        var tag: UInt32 = UInt32(bytes[offset])
        let firstTagByte = bytes[offset]
        offset += 1
        
        // JPDL Special: 0x1F is used as a single byte tag despite bits 5-1 being 11111
        if (firstTagByte & 0x1F) == 0x1F && firstTagByte != 0x1F {
            // Multi-byte tag
            while offset < bytes.count {
                let nextByte = bytes[offset]
                tag = (tag << 8) | UInt32(nextByte)
                offset += 1
                if (nextByte & 0x80) == 0 { break }
            }
        }
        
        // 2. Parse Length
        guard offset < bytes.count else { return nil }
        var length: Int = 0
        let firstLenByte = bytes[offset]
        offset += 1
        
        if firstLenByte <= 0x7F {
            length = Int(firstLenByte)
        } else {
            let lenBytesCount = Int(firstLenByte & 0x7F)
            for _ in 0..<lenBytesCount {
                guard offset < bytes.count else { return nil }
                length = (length << 8) | Int(bytes[offset])
                offset += 1
            }
        }
        
        // 3. Extract Value
        guard offset + length <= bytes.count else { return nil }
        let valueData = Data(bytes[offset..<offset+length])
        offset += length
        
        // 4. Parse Children if Constructed
        var children = [TLV]()
        if (firstTagByte & 0x20) != 0 && length > 0 {
            children = parse(data: valueData)
        }
        
        return TLV(tag: tag, value: valueData, children: children)
    }
}
