import Foundation

// Simple Assertion Helper
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
struct DriversLicenseTests {
    static func main() async {
        print("🚀 Starting Driver's License Tests...")
        await testDLSelection()
        await testDLReadCommonData()
        print("✅ All Driver's License Tests Passed!")
    }
    
    static func testDLSelection() async {
        print("Running testDLSelection...")
        let mock = MockSmartCardManager()
        let controller = DriversLicenseController(manager: mock)
        
        do {
            try await controller.selectDLAP()
            assertEqual(mock.requestLog.count, 1, "Should have sent 1 APDU")
            assertEqual(mock.requestLog[0][1], 0xA4, "Should be SELECT")
        } catch {
            print("❌ Unexpected Error: \(error)")
            exit(1)
        }
    }
    
    static func testDLReadCommonData() async {
        print("Running testDLReadCommonData...")
        let mock = MockSmartCardManager()
        let controller = DriversLicenseController(manager: mock)
        
        var selectedEF: Data = Data()
        
        mock.handler = { apdu in
            let ins = apdu[1]
            if ins == 0xA4 && apdu[2] == 0x02 { // Select EF
                selectedEF = apdu.subdata(in: 5..<apdu.count)
                return Data([0x90, 0x00])
            }
            if ins == 0xB0 { // READ BINARY
                if selectedEF == Data([0x00, 0x01]) {
                    // Name (0x12) = "山田 太郎"
                    let sjisName = "山田 太郎".data(using: String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(CFStringEncoding(CFStringEncodings.shiftJIS.rawValue))))!
                    var res = Data([0x12, UInt8(sjisName.count)])
                    res.append(sjisName)
                    res.append(contentsOf: [0x90, 0x00])
                    return res
                } else if selectedEF == Data([0x00, 0x02]) { // Signature
                    return Data([0xAA, 0xBB, 0xCC, 0xDD, 0x90, 0x00])
                }
            }
            return Data([0x90, 0x00])
        }
        
        do {
            let info = try await controller.readCommonData()
            assertEqual(info.name, "山田 太郎", "Name mismatch")
            assert(info.signature != nil, "Signature should be present")
            assert(info.rawDataGroup1 != nil, "Raw Data Group 1 should be present")
        } catch {
            print("❌ Unexpected Error: \(error)")
            exit(1)
        }
    }
}
