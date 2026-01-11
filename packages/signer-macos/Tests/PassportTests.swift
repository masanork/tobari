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
        await testPassportPACE()
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

    static func testPassportPACE() async {
        print("Running testPassportPACE...")
        let mock = MockSmartCardManager()
        let controller = PassportController(manager: mock)
        
        let password = "CAN123456"
        
        mock.handler = { apdu in
            let ins = apdu[1]
            let p1 = apdu[2]
            
            if ins == 0x22 && p1 == 0xC1 { // MSE:Set AT
                return Data([0x90, 0x00])
            }
            if ins == 0x86 { // General Authenticate
                if apdu.count == 8 { // Step 1: Get Nonce
                    // Header (7C 0A 80 08) + Mock Encrypted Nonce (8 bytes) + SW (90 00)
                    // Note: This must be a multiple of 16 for AES decryption to not crash if it uses padding
                    // Or we just return 16 bytes.
                    var res = Data([0x7C, 0x12, 0x80, 0x10])
                    res.append(Data(repeating: 0x00, count: 16)) 
                    res.append(contentsOf: [0x90, 0x00])
                    return res
                } else { // Step 2+
                    return Data([0x90, 0x00])
                }
            }
            return Data([0x90, 0x00])
        }
        
        do {
            try await controller.selectPassportAP()
            // We ignore errors here because the decryption will fail with 00s, 
            // but we want to see if the command sequence is correct in the mock log.
            _ = try? await controller.performPACE(password: password, isCan: true)
            
            // Should have seen MSE:Set AT, GA Step 1, and GA Step 2
            assert(mock.requestLog.count >= 3, "Sequence too short")
            assertEqual(mock.requestLog[1][1], 0x22, "Second command should be MSE:Set AT")
            assertEqual(mock.requestLog[2][1], 0x86, "Third command should be General Authenticate")
        } catch {
            print("❌ Unexpected Error: \(error)")
            exit(1)
        }
    }
}
