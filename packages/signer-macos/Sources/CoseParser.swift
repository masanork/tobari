import Foundation

// MARK: - Data Structures

struct MdocDocument {
    let docType: String
    let nameSpaces: [String: [String: Any]]
    let rawNameSpaces: [String: Data] // Raw CBOR bytes for each namespace
    let rawIssuerSigned: Data         // Raw CBOR bytes of IssuerSigned structure

    /// Get all field names across all namespaces
    func getAllFields() -> [String] {
        var fields: [String] = []
        for (namespace, items) in nameSpaces {
            for (key, _) in items {
                fields.append("\(namespace).\(key)")
            }
        }
        return fields.sorted()
    }

    /// Get human-readable field name
    func getFieldDisplayName(_ field: String) -> String {
        let components = field.split(separator: ".")
        guard components.count >= 2 else { return field }

        let fieldName = String(components.last!)

        // Map common field names to human-readable labels
        switch fieldName {
        case "name": return "Full Name"
        case "given_name": return "Given Name"
        case "family_name": return "Family Name"
        case "birth_date": return "Date of Birth"
        case "address": return "Address"
        case "gender": return "Gender"
        case "portrait": return "Photo"
        case "document_number": return "Document Number"
        case "issue_date": return "Issue Date"
        case "expiry_date": return "Expiry Date"
        default: return fieldName.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }

    /// Get field value as string
    func getFieldValue(_ field: String) -> String {
        let components = field.split(separator: ".")
        guard components.count >= 2 else { return "" }

        let namespace = String(components[0])
        let key = String(components[1])

        guard let nsData = nameSpaces[namespace],
              let value = nsData[key] else {
            return ""
        }

        return formatValue(value)
    }
    
    private func formatValue(_ value: Any) -> String {
        if let stringValue = value as? String {
            return stringValue
        } else if let intValue = value as? Int {
            return String(intValue)
        } else if let dict = value as? [String: Any] {
            return "{ " + dict.map { "\($0.key): \(formatValue($0.value))" }.joined(separator: ", ") + " }"
        } else if let arr = value as? [Any] {
            return "[ " + arr.map { formatValue($0) }.joined(separator: ", ") + " ]"
        } else if let data = value as? Data {
            return "(binary:\(data.count)bytes)"
        } else {
            return "\(value)"
        }
    }

    /// Recursive inspection to JSON-compatible dictionary
    func inspect() -> [String: Any] {
        var fields: [String: Any] = [:]
        for (ns, items) in nameSpaces {
            var nsItems: [String: Any] = [:]
            for (k, v) in items {
                nsItems[k] = recursiveInspect(v)
            }
            fields[ns] = nsItems
        }
        return [
            "docType": docType,
            "fields": fields
        ]
    }

    private func recursiveInspect(_ value: Any) -> Any {
        if let data = value as? Data {
            if data.count > 2 {
                // Try parsing as CBOR if it looks like a meaningful structure
                if let inner = try? CoseParser.readAnyCBOR(data: data) {
                    return recursiveInspect(inner)
                }
            }
            return data.base64EncodedString()
        } else if let dict = value as? [String: Any] {
            return dict.mapValues { recursiveInspect($0) }
        } else if let arr = value as? [Any] {
            return arr.map { recursiveInspect($0) }
        }
        return value
    }

    /// Try to extract a face photo from common fields (DG2 for passport, portrait for mDL)
    func getFacePhoto() -> Data? {
        // Look for DG2 in passport namespaces
        if let dg2 = nameSpaces["org.icao.lds.1"]?["dg2"] as? Data ?? nameSpaces["dg2"]?["dg2"] as? Data {
            return extractPhotoFromDG2(dg2)
        }
        // Look for portrait in mDL namespaces
        if let portrait = nameSpaces["org.iso.18013.5.1"]?["portrait"] as? Data {
            return portrait
        }
        return nil
    }

    private func extractPhotoFromDG2(_ data: Data) -> Data? {
        let jpegSig = Data([0xFF, 0xD8, 0xFF])
        if let range = data.range(of: jpegSig) {
            return data.subdata(in: range.lowerBound..<data.count)
        }
        let jp2Sig = Data([0x00, 0x00, 0x00, 0x0C, 0x6A, 0x50, 0x20, 0x20])
        if let range = data.range(of: jp2Sig) {
            return data.subdata(in: range.lowerBound..<data.count)
        }
        return nil
    }
}

/// COSE/CBOR parser for mdoc documents
class CoseParser {

    /// Parse mdoc from COSE binary data
    static func parseMdoc(data: Data) throws -> MdocDocument {
        // Extract CBOR payload from COSE Sign1 structure
        let payload = try extractCosePayload(data: data)

        // Decode CBOR to extract IssuerSigned structure
        return try decodeIssuerSigned(data: payload)
    }

    /// Extract payload from COSE_Sign1 structure
    static func extractCosePayload(data: Data) throws -> Data {
        // COSE_Sign1 is a CBOR array [protected, unprotected, payload, signature]
        // Tag 98 (COSE_Sign1)

        guard data.count > 10 else {
            throw CoseError.invalidFormat("Data too short")
        }

        var offset = 0

        // Check for COSE_Sign1 tag (98 = 0xD8 0x62)
        if data[offset] == 0xD8 && data[offset + 1] == 0x62 {
            offset += 2
        } else if data[offset] == 0xD2 { // Tag 18
            offset += 1
        }

        // Array of 4 elements (0x84)
        guard data[offset] == 0x84 else {
            throw CoseError.invalidFormat("Expected COSE_Sign1 array, got \(String(format: "%02X", data[offset]))")
        }
        offset += 1

        // Skip protected headers (bytes string)
        let (protectedSize, protectedOffset) = try readCBORBytesLength(data: data, offset: offset)
        offset = protectedOffset + protectedSize

        // Skip unprotected headers (map)
        offset = try skipCBORValue(data: data, offset: offset)

        // Read payload (bytes string)
        let (payloadSize, payloadOffset) = try readCBORBytesLength(data: data, offset: offset)
        let payload = data.subdata(in: payloadOffset..<(payloadOffset + payloadSize))

        return payload
    }

    /// Decode CBOR IssuerSigned structure
    private static func decodeIssuerSigned(data: Data) throws -> MdocDocument {
        var offset = 0

        // IssuerSigned is a map
        guard data[offset] >> 5 == 5 else { // Major type 5 (map)
            throw CoseError.invalidFormat("Expected map")
        }

        let (mapSize, mapHeaderOffset) = try readCBORMapSize(data: data, offset: offset)
        offset = mapHeaderOffset

        var nameSpaces: [String: [String: Any]] = [:]
        var rawNameSpaces: [String: Data] = [:]
        var docType: String = ""

        // Parse map entries
        for _ in 0..<mapSize {
            // Read key (text string)
            let (key, keyEndOffset) = try readCBORString(data: data, offset: offset)
            offset = keyEndOffset

            if key == "docType" {
                let (value, valueEndOffset) = try readCBORString(data: data, offset: offset)
                docType = value
                offset = valueEndOffset
            } else if key == "nameSpaces" {
                // Parse nameSpaces
                (nameSpaces, rawNameSpaces, offset) = try parseNameSpaces(data: data, offset: offset)
            } else {
                // Skip unknown keys
                offset = try skipCBORValue(data: data, offset: offset)
            }
        }

        return MdocDocument(docType: docType, nameSpaces: nameSpaces, rawNameSpaces: rawNameSpaces, rawIssuerSigned: data)
    }

    /// Parse nameSpaces map
    private static func parseNameSpaces(data: Data, offset: Int) throws -> ([String: [String: Any]], [String: Data], Int) {
        var currentOffset = offset
        var nameSpaces: [String: [String: Any]] = [:]
        var rawNameSpaces: [String: Data] = [:]

        guard data[currentOffset] >> 5 == 5 else {
            throw CoseError.invalidFormat("Expected nameSpaces map")
        }

        let (mapSize, mapHeaderOffset) = try readCBORMapSize(data: data, offset: currentOffset)
        currentOffset = mapHeaderOffset

        for _ in 0..<mapSize {
            // Namespace name
            let (nsName, nsEndOffset) = try readCBORString(data: data, offset: currentOffset)
            currentOffset = nsEndOffset

            // Array of IssuerSignedItems
            guard data[currentOffset] >> 5 == 4 else { // Array
                throw CoseError.invalidFormat("Expected array of items")
            }

            let nsValueStart = currentOffset
            let (arraySize, arrayOffset) = try readCBORArraySize(data: data, offset: currentOffset)
            currentOffset = arrayOffset

            var items: [String: Any] = [:]

            for _ in 0..<arraySize {
                // Each item is a tagged byte string containing IssuerSignedItem
                let (elementId, elementValue, itemEndOffset) = try parseIssuerSignedItem(data: data, offset: currentOffset)
                items[elementId] = elementValue
                currentOffset = itemEndOffset
            }
            
            nameSpaces[nsName] = items
            rawNameSpaces[nsName] = data.subdata(in: nsValueStart..<currentOffset)
        }

        return (nameSpaces, rawNameSpaces, currentOffset)
    }

    /// Parse individual IssuerSignedItem
    private static func parseIssuerSignedItem(data: Data, offset: Int) throws -> (String, Any, Int) {
        // Tag 24 (encoded CBOR data item)
        var itemOffset = offset
        if data[itemOffset] == 0xD8 && data[itemOffset + 1] == 0x18 {
            itemOffset += 2
        } else if data[itemOffset] == 0xD8 && data[itemOffset + 1] == 0x62 {
             // Wrapper COSE_Sign1 (sometimes used in tests or legacy)
             let payload = try extractCosePayload(data: data.subdata(in: offset..<data.count))
             let (id, val, _) = try parseIssuerSignedItemBody(data: payload, offset: 0)
             let nextOffset = try skipCBORValue(data: data, offset: offset)
             return (id, val, nextOffset)
        }
        
        // It's a byte string containing the map
        let (len, bodyOffset) = try readCBORBytesLength(data: data, offset: itemOffset)
        let body = data.subdata(in: bodyOffset..<(bodyOffset + len))
        
        let (elementId, elementValue, _) = try parseIssuerSignedItemBody(data: body, offset: 0)
        
        return (elementId, elementValue, bodyOffset + len)
    }
    
    private static func parseIssuerSignedItemBody(data: Data, offset: Int) throws -> (String, Any, Int) {
        var itemOffset = offset
        // IssuerSignedItem is a map with digestID, random, elementIdentifier, elementValue
        guard data[itemOffset] >> 5 == 5 else {
            throw CoseError.invalidFormat("Expected IssuerSignedItem map, got \(String(format: "%02X", data[itemOffset]))")
        }

        let (mapSize, mapHeaderOffset) = try readCBORMapSize(data: data, offset: itemOffset)
        itemOffset = mapHeaderOffset

        var elementId = ""
        var elementValue: Any = ""

        for _ in 0..<mapSize {
            let (key, keyEndOffset) = try readCBORString(data: data, offset: itemOffset)
            itemOffset = keyEndOffset

            if key == "elementIdentifier" {
                let (value, valueEndOffset) = try readCBORString(data: data, offset: itemOffset)
                elementId = value
                itemOffset = valueEndOffset
            } else if key == "elementValue" {
                (elementValue, itemOffset) = try readCBORValue(data: data, offset: itemOffset)
            } else {
                // Skip other fields
                itemOffset = try skipCBORValue(data: data, offset: itemOffset)
            }
        }
        return (elementId, elementValue, itemOffset)
    }

    // MARK: - CBOR Utility Functions

    static func readAnyCBOR(data: Data) throws -> Any {
        let (val, _) = try readCBORValue(data: data, offset: 0)
        return val
    }

    private static func readCBORBytesLength(data: Data, offset: Int) throws -> (Int, Int) {
        guard offset < data.count else {
            throw CoseError.invalidFormat("Offset out of bounds")
        }

        let majorType = data[offset] >> 5
        guard majorType == 2 || majorType == 3 else { // Byte or Text string
            throw CoseError.invalidFormat("Expected string type, got \(majorType)")
        }

        return try readCBORInt(data: data, offset: offset)
    }
    
    private static func readCBORArraySize(data: Data, offset: Int) throws -> (Int, Int) {
        guard data[offset] >> 5 == 4 else { throw CoseError.invalidFormat("Expected array") }
        return try readCBORInt(data: data, offset: offset)
    }
    
    private static func readCBORMapSize(data: Data, offset: Int) throws -> (Int, Int) {
        guard data[offset] >> 5 == 5 else { throw CoseError.invalidFormat("Expected map") }
        return try readCBORInt(data: data, offset: offset)
    }

    private static func readCBORInt(data: Data, offset: Int) throws -> (Int, Int) {
        let info = data[offset] & 0x1F
        if info < 24 {
            return (Int(info), offset + 1)
        } else if info == 24 {
            return (Int(data[offset + 1]), offset + 2)
        } else if info == 25 {
            let val = (Int(data[offset + 1]) << 8) | Int(data[offset + 2])
            return (val, offset + 3)
        } else if info == 26 {
            let val = (Int(data[offset + 1]) << 24) | (Int(data[offset + 2]) << 16) | (Int(data[offset + 3]) << 8) | Int(data[offset + 4])
            return (val, offset + 5)
        }
        throw CoseError.invalidFormat("Unsupported int size")
    }

    private static func readCBORString(data: Data, offset: Int) throws -> (String, Int) {
        let (length, stringOffset) = try readCBORBytesLength(data: data, offset: offset)
        let stringData = data.subdata(in: stringOffset..<(stringOffset + length))
        guard let string = String(data: stringData, encoding: .utf8) else {
            throw CoseError.invalidFormat("Invalid UTF-8 string")
        }
        return (string, stringOffset + length)
    }

    private static func readCBORValue(data: Data, offset: Int) throws -> (Any, Int) {
        guard offset < data.count else {
            throw CoseError.invalidFormat("Offset out of bounds")
        }

        let majorType = data[offset] >> 5
        
        switch majorType {
        case 0: // Unsigned integer
            return try readCBORInt(data: data, offset: offset)
        case 1: // Negative integer
            let (val, next) = try readCBORInt(data: data, offset: offset)
            return (-1 - val, next)
        case 2: // Byte string
            let (length, bodyOffset) = try readCBORBytesLength(data: data, offset: offset)
            return (data.subdata(in: bodyOffset..<(bodyOffset + length)), bodyOffset + length)
        case 3: // Text string
            return try readCBORString(data: data, offset: offset)
        case 4: // Array
            let (size, bodyOffset) = try readCBORArraySize(data: data, offset: offset)
            var currentOffset = bodyOffset
            var arr: [Any] = []
            for _ in 0..<size {
                let (val, next) = try readCBORValue(data: data, offset: currentOffset)
                arr.append(val)
                currentOffset = next
            }
            return (arr, currentOffset)
        case 5: // Map
            let (size, bodyOffset) = try readCBORMapSize(data: data, offset: offset)
            var currentOffset = bodyOffset
            var dict: [String: Any] = [:]
            for _ in 0..<size {
                let (key, nextKey) = try readCBORString(data: data, offset: currentOffset)
                let (val, nextVal) = try readCBORValue(data: data, offset: nextKey)
                dict[key] = val
                currentOffset = nextVal
            }
            return (dict, currentOffset)
        case 7: // Simple/Float
            if data[offset] == 0xF4 { return (false, offset + 1) }
            if data[offset] == 0xF5 { return (true, offset + 1) }
            if data[offset] == 0xF6 { return (NSNull(), offset + 1) }
            return ("(simple:\(data[offset] & 0x1F))", offset + 1)
        default:
            return ("(unknown type:\(majorType))", try skipCBORValue(data: data, offset: offset))
        }
    }

    private static func skipCBORValue(data: Data, offset: Int) throws -> Int {
        let majorType = data[offset] >> 5
        let info = data[offset] & 0x1F

        switch majorType {
        case 0, 1: // Integer
            return try readCBORInt(data: data, offset: offset).1
        case 2, 3: // Byte/Text string
            let (length, bodyOffset) = try readCBORBytesLength(data: data, offset: offset)
            return bodyOffset + length
        case 4: // Array
            let (size, bodyOffset) = try readCBORArraySize(data: data, offset: offset)
            var currentOffset = bodyOffset
            for _ in 0..<size {
                currentOffset = try skipCBORValue(data: data, offset: currentOffset)
            }
            return currentOffset
        case 5: // Map
            let (size, bodyOffset) = try readCBORMapSize(data: data, offset: offset)
            var currentOffset = bodyOffset
            for _ in 0..<size {
                currentOffset = try skipCBORValue(data: data, offset: currentOffset)
                currentOffset = try skipCBORValue(data: data, offset: currentOffset)
            }
            return currentOffset
        case 6: // Tag
            return try skipCBORValue(data: data, offset: try readCBORInt(data: data, offset: offset).1)
        case 7: // Simple
            return offset + 1
        default:
            return offset + 1
        }
    }
}

enum CoseError: Error, LocalizedError {
    case invalidFormat(String)
    case decodingFailed(String)

    var errorDescription: String? {
        switch self {
        case .invalidFormat(let msg):
            return "Invalid COSE format: \(msg)"
        case .decodingFailed(let msg):
            return "CBOR decoding failed: \(msg)"
        }
    }
}