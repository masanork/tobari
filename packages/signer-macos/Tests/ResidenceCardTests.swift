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
struct ResidenceCardTests {
    static func main() async {
        print("🚀 Starting Residence Card Tests...")
        await testRCSelection()
        await testRCReadDF2()
        print("✅ All Residence Card Tests Passed!")
    }
    
    static func testRCSelection() async {
        print("Running testRCSelection...")
        let mock = MockSmartCardManager()
        let controller = ResidenceCardController(manager: mock)
        
        do {
            try await controller.selectJPRCAP()
            assertEqual(mock.requestLog.count, 1, "Should have sent 1 APDU")
            assertEqual(mock.requestLog[0][1], 0xA4, "Should be SELECT")
        } catch {
            print("❌ Unexpected Error: \(error)")
            exit(1)
        }
    }
    
    static func testRCReadDF2() async {
        print("Running testRCReadDF2...")
        let mock = MockSmartCardManager()
        let controller = ResidenceCardController(manager: mock)
        
        mock.handler = { apdu in
            let ins = apdu[1]
            if ins == 0xB0 { // READ BINARY
                // Return TLV: D2 (Address) = "Minato-ku"
                var res = Data([0xD2, 0x09])
                res.append(contentsOf: "Minato-ku".data(using: .utf8)!)
                res.append(contentsOf: [0x90, 0x00])
                return res
            }
            return Data([0x90, 0x00])
        }
        
        do {
            let info = try await controller.readDF2Info()
            assertEqual(info.address, "Minato-ku", "Address mismatch")
        } catch {
            print("❌ Unexpected Error: \(error)")
            exit(1)
        }
    }
}
