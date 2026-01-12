import Foundation

struct MRZData {
    let documentNumber: String
    let birthDate: String // YYMMDD
    let expiryDate: String // YYMMDD
    let nationality: String
    let surname: String
    let givenNames: String
    let gender: String
    let documentType: String
    let issuingState: String
}

class MRZParser {
    
    /// Parses raw MRZ lines and returns structured data if valid
    static func parse(lines: [String]) -> MRZData? {
        let cleaned = lines.map { $0.replacingOccurrences(of: " ", with: "").uppercased() }
        
        if cleaned.count == 2 && cleaned[0].count == 44 {
            return parseTD3(cleaned)
        } else if cleaned.count == 3 && cleaned[0].count == 30 {
            return parseTD1(cleaned)
        } else if cleaned.count == 2 && cleaned[0].count == 36 {
            return parseTD2(cleaned)
        }
        
        return nil
    }
    
    // MARK: - TD3 (Passport)
    private static func parseTD3(_ lines: [String]) -> MRZData? {
        let line1 = lines[0]
        let line2 = lines[1]
        
        // Line 1: P<STASURNAME<<GIVEN<NAMES<<<<<<<<<<<<<<<<<<
        let type = String(line1.prefix(1))
        let state = String(line1.prefix(5).suffix(3))
        let namePart = String(line1.suffix(39))
        let (surname, givenNames) = parseNames(namePart)
        
        // Line 2: NUMBER<8CHECKSTATE8501019M2512311<<<<<<<<<<6D
        let docNum = String(line2.prefix(9))
        let docNumCheck = String(line2.prefix(10).suffix(1))
        let nationality = String(line2.prefix(13).suffix(3))
        let dob = String(line2.prefix(19).suffix(6))
        let dobCheck = String(line2.prefix(20).suffix(1))
        let gender = String(line2.prefix(21).suffix(1))
        let expiry = String(line2.prefix(27).suffix(6))
        let expiryCheck = String(line2.prefix(28).suffix(1))
        
        // Basic checksum validation
        guard validateChecksum(docNum, expected: docNumCheck),
              validateChecksum(dob, expected: dobCheck),
              validateChecksum(expiry, expected: expiryCheck) else {
            return nil
        }
        
        return MRZData(
            documentNumber: docNum.replacingOccurrences(of: "<", with: ""),
            birthDate: dob,
            expiryDate: expiry,
            nationality: nationality,
            surname: surname,
            givenNames: givenNames,
            gender: gender,
            documentType: type,
            issuingState: state
        )
    }
    
    // MARK: - TD1 (ID Card)
    private static func parseTD1(_ lines: [String]) -> MRZData? {
        let line1 = lines[0]
        let line2 = lines[1]
        let line3 = lines[2]
        
        // Line 1: I<STADOCUMENT<NUMBER<<<<<<<<<<<<
        let type = String(line1.prefix(1))
        let state = String(line1.prefix(5).suffix(3))
        let docNum = String(line1.prefix(14).suffix(9))
        let docNumCheck = String(line1.prefix(15).suffix(1))
        
        // Line 2: 8501019M2512311JPN<<<<<<<<<<<8
        let dob = String(line2.prefix(6))
        let dobCheck = String(line2.prefix(7).suffix(1))
        let gender = String(line2.prefix(8).suffix(1))
        let expiry = String(line2.prefix(14).suffix(6))
        let expiryCheck = String(line2.prefix(15).suffix(1))
        let nationality = String(line2.prefix(18).suffix(3))
        
        // Line 3: SURNAME<<GIVEN<NAMES<<<<<<<<<<<<
        let (surname, givenNames) = parseNames(line3)
        
        guard validateChecksum(docNum, expected: docNumCheck),
              validateChecksum(dob, expected: dobCheck),
              validateChecksum(expiry, expected: expiryCheck) else {
            return nil
        }
        
        return MRZData(
            documentNumber: docNum.replacingOccurrences(of: "<", with: ""),
            birthDate: dob,
            expiryDate: expiry,
            nationality: nationality,
            surname: surname,
            givenNames: givenNames,
            gender: gender,
            documentType: type,
            issuingState: state
        )
    }
    
    // MARK: - TD2
    private static func parseTD2(_ lines: [String]) -> MRZData? {
        // Similar logic for TD2 (36 chars)
        return nil // Placeholder
    }
    
    // MARK: - Helpers
    
    private static func parseNames(_ raw: String) -> (String, String) {
        let parts = raw.components(separatedBy: "<<")
        let surname = parts.first?.replacingOccurrences(of: "<", with: " ").trimmingCharacters(in: .whitespaces) ?? ""
        let givenNames = parts.count > 1 ? parts[1].replacingOccurrences(of: "<", with: " ").trimmingCharacters(in: .whitespaces) : ""
        return (surname, givenNames)
    }
    
    /// ICAO 9303 Checksum Algorithm (7-3-1 weight)
    static func validateChecksum(_ data: String, expected: String) -> Bool {
        let weights = [7, 3, 1]
        var sum = 0
        
        let chars = Array(data.uppercased())
        for (i, char) in chars.enumerated() {
            let val: Int
            if char == "<" {
                val = 0
            } else if let digit = Int(String(char)) {
                val = digit
            } else {
                val = Int(char.asciiValue! - UInt8(ascii: "A") + 10)
            }
            sum += val * weights[i % 3]
        }
        
        let calculated = String(sum % 10)
        return calculated == expected
    }
}
