import Foundation

func assert(_ condition: Bool, _ message: String, file: String = #file, line: Int = #line) {
    if !condition {
        print("❌ Assertion Failed: \(message) at \(file):\(line)")
        exit(1)
    }
}

func assertEqual<T: Equatable>(_ actual: T, _ expected: T, _ message: String, file: String = #file, line: Int = #line) {
    if actual != expected {
        print("❌ Assertion Failed: \(message) - Expected: \(expected), Got: \(actual) at \(file):\(line)")
        exit(1)
    }
}

@main
struct MRZTests {
    static func main() {
        print("🚀 Starting MRZ Parser Tests...")
        testChecksum()
        testTD3Parsing()
        testTD1Parsing()
        print("✅ All MRZ Tests Passed!")
    }
    
    static func testChecksum() {
        print("Running testChecksum...")
        // Validating standard examples from ICAO 9303
        assert(MRZParser.validateChecksum("520727", expected: "3"), "DOB checksum failed")
        assert(MRZParser.validateChecksum("L898902C<", expected: "3"), "Passport number checksum failed")
    }
    
    static func testTD3Parsing() {
        print("Running testTD3Parsing...")
        let lines = [
            "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<",
            "L898902C<3UTO6908061F9406236ZE184226B<<<<<14"
        ]
        
        guard let data = MRZParser.parse(lines: lines) else {
            print("❌ Failed to parse valid TD3 MRZ")
            exit(1)
        }
        
        assertEqual(data.surname, "ERIKSSON", "Surname mismatch")
        assertEqual(data.givenNames, "ANNA MARIA", "Given names mismatch")
        assertEqual(data.documentNumber, "L898902C", "Doc number mismatch")
        assertEqual(data.birthDate, "690806", "DOB mismatch")
        assertEqual(data.expiryDate, "940623", "Expiry mismatch")
    }
    
    static func testTD1Parsing() {
        print("Running testTD1Parsing...")
        // Calculated correct checksums: 123456789 -> 7, 850101 -> 9, 251231 -> 4
        let lines = [
            "I<JPN1234567897<<<<<<<<<<<<<<<",
            "8501019M2512314JPN<<<<<<<<<<<8",
            "KYOKUYA<<TARO<<<<<<<<<<<<<<<<<"
        ]
        
        guard let data = MRZParser.parse(lines: lines) else {
            print("❌ Failed to parse valid TD1 MRZ")
            exit(1)
        }
        
        assertEqual(data.surname, "KYOKUYA", "Surname mismatch")
        assertEqual(data.documentNumber, "123456789", "Doc number mismatch")
    }
}
