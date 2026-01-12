import Foundation

/// COSE/CBOR parser for mdoc documents
class CoseParser {

    /// Parse mdoc from COSE binary data
    static func parseMdoc(data: Data) throws -> MdocDocument {
        // Extract CBOR payload from COSE Sign1 structure
        let payload = try extractCosePayload(data: data)

        // Decode CBOR to extract IssuerSigned structure
        let issuerSigned = try decodeCBOR(data: payload)

        return issuerSigned
    }

    /// Extract payload from COSE_Sign1 structure
    private static func extractCosePayload(data: Data) throws -> Data {
        // COSE_Sign1 is a CBOR array [protected, unprotected, payload, signature]
        // Tag 98 (COSE_Sign1)

        guard data.count > 10 else {
            throw CoseError.invalidFormat("Data too short")
        }

        var offset = 0

        // Check for COSE_Sign1 tag (98 = 0xD8 0x62)
        if data[offset] == 0xD8 && data[offset + 1] == 0x62 {
            offset += 2
        }

        // Array of 4 elements (0x84)
        guard data[offset] == 0x84 else {
            throw CoseError.invalidFormat("Expected COSE_Sign1 array")
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
    private static func decodeCBOR(data: Data) throws -> MdocDocument {
        var offset = 0

        // IssuerSigned is a map
        guard data[offset] >> 5 == 5 else { // Major type 5 (map)
            throw CoseError.invalidFormat("Expected map")
        }

        let mapSize = Int(data[offset] & 0x1F)
        offset += 1

        var nameSpaces: [String: [String: Any]] = [:]
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
                (nameSpaces, offset) = try parseNameSpaces(data: data, offset: offset)
            } else {
                // Skip unknown keys
                offset = try skipCBORValue(data: data, offset: offset)
            }
        }

        return MdocDocument(docType: docType, nameSpaces: nameSpaces)
    }

    /// Parse nameSpaces map
    private static func parseNameSpaces(data: Data, offset: Int) throws -> ([String: [String: Any]], Int) {
        var currentOffset = offset
        var nameSpaces: [String: [String: Any]] = [:]

        guard data[currentOffset] >> 5 == 5 else {
            throw CoseError.invalidFormat("Expected nameSpaces map")
        }

        let mapSize = Int(data[currentOffset] & 0x1F)
        currentOffset += 1

        for _ in 0..<mapSize {
            // Namespace name
            let (nsName, nsEndOffset) = try readCBORString(data: data, offset: currentOffset)
            currentOffset = nsEndOffset

            // Array of IssuerSignedItems
            guard data[currentOffset] >> 5 == 4 else { // Array
                throw CoseError.invalidFormat("Expected array of items")
            }

            let arraySize = Int(data[currentOffset] & 0x1F)
            currentOffset += 1

            var items: [String: Any] = [:]

            for _ in 0..<arraySize {
                // Each item is a COSE_Sign1 containing IssuerSignedItem
                // For preview, we'll extract the elementIdentifier and elementValue
                let (elementId, elementValue, itemEndOffset) = try parseIssuerSignedItem(data: data, offset: currentOffset)
                items[elementId] = elementValue
                currentOffset = itemEndOffset
            }

            nameSpaces[nsName] = items
        }

        return (nameSpaces, currentOffset)
    }

    /// Parse individual IssuerSignedItem
    private static func parseIssuerSignedItem(data: Data, offset: Int) throws -> (String, Any, Int) {
        // IssuerSignedItem is wrapped in COSE_Sign1, extract payload
        let itemPayload = try extractCosePayload(data: data.subdata(in: offset..<data.count))

        var itemOffset = 0

        // IssuerSignedItem is a map with digestID, random, elementIdentifier, elementValue
        guard itemPayload[itemOffset] >> 5 == 5 else {
            throw CoseError.invalidFormat("Expected IssuerSignedItem map")
        }

        let mapSize = Int(itemPayload[itemOffset] & 0x1F)
        itemOffset += 1

        var elementId = ""
        var elementValue: Any = ""

        for _ in 0..<mapSize {
            let (key, keyEndOffset) = try readCBORString(data: itemPayload, offset: itemOffset)
            itemOffset = keyEndOffset

            if key == "elementIdentifier" {
                let (value, valueEndOffset) = try readCBORString(data: itemPayload, offset: itemOffset)
                elementId = value
                itemOffset = valueEndOffset
            } else if key == "elementValue" {
                (elementValue, itemOffset) = try readCBORValue(data: itemPayload, offset: itemOffset)
            } else {
                // Skip other fields
                itemOffset = try skipCBORValue(data: itemPayload, offset: itemOffset)
            }
        }

        // Calculate end offset in original data
        // This is approximate - for preview we'll return a safe offset
        return (elementId, elementValue, offset + 100) // TODO: Calculate actual size
    }

    // MARK: - CBOR Utility Functions

    private static func readCBORBytesLength(data: Data, offset: Int) throws -> (Int, Int) {
        guard offset < data.count else {
            throw CoseError.invalidFormat("Offset out of bounds")
        }

        let majorType = data[offset] >> 5
        guard majorType == 2 else { // Byte string
            throw CoseError.invalidFormat("Expected byte string")
        }

        let additionalInfo = data[offset] & 0x1F

        if additionalInfo < 24 {
            return (Int(additionalInfo), offset + 1)
        } else if additionalInfo == 24 {
            return (Int(data[offset + 1]), offset + 2)
        } else if additionalInfo == 25 {
            let length = Int(data[offset + 1]) << 8 | Int(data[offset + 2])
            return (length, offset + 3)
        } else if additionalInfo == 26 {
            let length = Int(data[offset + 1]) << 24 | Int(data[offset + 2]) << 16 | Int(data[offset + 3]) << 8 | Int(data[offset + 4])
            return (length, offset + 5)
        }

        throw CoseError.invalidFormat("Unsupported byte string length encoding")
    }

    private static func readCBORString(data: Data, offset: Int) throws -> (String, Int) {
        guard offset < data.count else {
            throw CoseError.invalidFormat("Offset out of bounds")
        }

        let majorType = data[offset] >> 5
        guard majorType == 3 else { // Text string
            throw CoseError.invalidFormat("Expected text string")
        }

        let additionalInfo = data[offset] & 0x1F
        var length = 0
        var stringOffset = offset + 1

        if additionalInfo < 24 {
            length = Int(additionalInfo)
        } else if additionalInfo == 24 {
            length = Int(data[offset + 1])
            stringOffset = offset + 2
        } else if additionalInfo == 25 {
            length = Int(data[offset + 1]) << 8 | Int(data[offset + 2])
            stringOffset = offset + 3
        } else {
            throw CoseError.invalidFormat("Unsupported string length encoding")
        }

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
        let additionalInfo = data[offset] & 0x1F

        switch majorType {
        case 0: // Unsigned integer
            if additionalInfo < 24 {
                return (Int(additionalInfo), offset + 1)
            } else if additionalInfo == 24 {
                return (Int(data[offset + 1]), offset + 2)
            }

        case 3: // Text string
            return try readCBORString(data: data, offset: offset)

        default:
            // For preview, return placeholder
            return ("(binary data)", try skipCBORValue(data: data, offset: offset))
        }

        return ("(unknown)", offset + 1)
    }

    private static func skipCBORValue(data: Data, offset: Int) throws -> Int {
        guard offset < data.count else {
            throw CoseError.invalidFormat("Offset out of bounds")
        }

        let majorType = data[offset] >> 5
        let additionalInfo = data[offset] & 0x1F

        switch majorType {
        case 0, 1: // Integer
            if additionalInfo < 24 {
                return offset + 1
            } else if additionalInfo == 24 {
                return offset + 2
            } else if additionalInfo == 25 {
                return offset + 3
            }

        case 2, 3: // Byte/Text string
            let (length, stringOffset) = try readCBORBytesLength(data: data, offset: offset)
            return stringOffset + length

        case 4: // Array
            var currentOffset = offset + 1
            let arraySize = additionalInfo < 24 ? Int(additionalInfo) : Int(data[offset + 1])
            if additionalInfo >= 24 { currentOffset += 1 }

            for _ in 0..<arraySize {
                currentOffset = try skipCBORValue(data: data, offset: currentOffset)
            }
            return currentOffset

        case 5: // Map
            var currentOffset = offset + 1
            let mapSize = additionalInfo < 24 ? Int(additionalInfo) : Int(data[offset + 1])
            if additionalInfo >= 24 { currentOffset += 1 }

            for _ in 0..<(mapSize * 2) { // Key + Value pairs
                currentOffset = try skipCBORValue(data: data, offset: currentOffset)
            }
            return currentOffset

        default:
            return offset + 1
        }

        return offset + 1
    }
}

// MARK: - Data Structures

struct MdocDocument {
    let docType: String
    let nameSpaces: [String: [String: Any]]

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

        // Format value based on type
        if let stringValue = value as? String {
            return stringValue
        } else if let intValue = value as? Int {
            return String(intValue)
        } else {
            return "(binary)"
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
