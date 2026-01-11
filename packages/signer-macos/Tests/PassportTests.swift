import Foundation
import CryptoKit

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
struct PassportTests {
    static func main() async {
        print("🚀 Starting Passport Tests...")
        await testPassportSelection()
        await testPassportReadDG1()
        print("✅ All Passport Tests Passed!")
    }
    
    static func testPassportSelection() async {
        print("Running testPassportSelection...")
        let mock = MockSmartCardManager()
        let controller = PassportController(manager: mock)
        
        do {
            try await controller.selectPassportAP()
            assertEqual(mock.requestLog.count, 1, "Should have sent 1 APDU")
            assertEqual(mock.requestLog[0][1], 0xA4, "Should be SELECT")
        } catch {
            print("❌ Unexpected Error: \(error)")
            exit(1)
        }
    }
    
    static func testPassportReadDG1() async {
        print("Running testPassportReadDG1...")
        let mock = MockSmartCardManager()
        let controller = PassportController(manager: mock)
        
        // Mock DG1 Data (MRZ)
        let mockDG1: [UInt8] = [0x61, 0x05, 0x31, 0x32, 0x33, 0x34, 0x35]
        
        mock.handler = { apdu in
            let ins = apdu[1]
            if ins == 0xB0 { // READ BINARY
                var res = Data(mockDG1)
                res.append(contentsOf: [0x90, 0x00])
                return res
            }
            return Data([0x90, 0x00])
        }
        
        do {
            let dg1 = try await controller.readDG1()
            assertEqual(dg1.count, mockDG1.count, "DG1 length mismatch")
            assertEqual(dg1[2], 0x31, "DG1 content mismatch")
        } catch {
            print("❌ Unexpected Error: \(error)")
            exit(1)
        }
    }
}
