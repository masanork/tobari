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

// Test Runner
@main
struct JPKITests {
    static func main() async {
        print("🚀 Starting JPKI Tests...")
        
        await testComputeAuthSignature()
        await testReadMyNumber()
        await testReadAttributes()
        await testReadFacePhoto()
        
        print("✅ All Tests Passed!")
    }
    
    static func testComputeAuthSignature() async {
        print("Running testComputeAuthSignature...")
        // ... (existing test logic)
        let mock = MockSmartCardManager()
        let controller = JPKIController(manager: mock)
        
        // Setup Mock Responses
        mock.handler = { apdu in
            let ins = apdu[1]
            if ins == 0xA4 { return Data([0x90, 0x00]) }
            if ins == 0x20 { return Data([0x90, 0x00]) }
            if ins == 0x2A {
                var sig = Data(repeating: 0xAB, count: 32)
                sig.append(contentsOf: [0x90, 0x00])
                return sig
            }
            return Data([0x90, 0x00])
        }
        
        do {
            let dataToSign = "Hello World".data(using: .utf8)!
            let signature = try await controller.computeAuthSignature(pin: "1234", data: dataToSign)
            assertEqual(signature.count, 32, "Signature length should be 32")
        } catch {
            print("❌ Unexpected Error: \(error)")
            exit(1)
        }
    }

    static func testReadMyNumber() async {
        print("Running testReadMyNumber...")
        let mock = MockSmartCardManager()
        let controller = JPKIController(manager: mock)
        
        mock.handler = { apdu in
            let ins = apdu[1]
            if ins == 0xB0 { // READ BINARY
                // Return 12 digits + status
                var data = "123456789012".data(using: .ascii)!
                data.append(contentsOf: [0x90, 0x00])
                return data
            }
            return Data([0x90, 0x00])
        }
        
        do {
            let myNumber = try await controller.readMyNumber(pin: "1234")
            assertEqual(myNumber, "123456789012", "My Number mismatch")
        } catch {
             print("❌ Unexpected Error: \(error)")
             exit(1)
        }
    }

    static func testReadAttributes() async {
        print("Running testReadAttributes...")
        let mock = MockSmartCardManager()
        let controller = JPKIController(manager: mock)
        
        mock.handler = { apdu in
            let ins = apdu[1]
            if ins == 0xB0 { // READ BINARY
                // Construct TLV: Name (DF22) = "Taro"
                var data = Data()
                // DF22 04 54 61 72 6F
                data.append(contentsOf: [0xDF, 0x22, 0x04])
                data.append(contentsOf: "Taro".data(using: .utf8)!)
                data.append(contentsOf: [0x90, 0x00])
                return data
            }
            return Data([0x90, 0x00])
        }
        
        do {
            let info = try await controller.readAttributes(pin: "1234")
            assertEqual(info.name, "Taro", "Name mismatch")
        } catch {
             print("❌ Unexpected Error: \(error)")
             exit(1)
        }
    }

    static func testReadFacePhoto() async {
        print("Running testReadFacePhoto...")
        let mock = MockSmartCardManager()
        let controller = JPKIController(manager: mock)
        
        mock.handler = { apdu in
            let ins = apdu[1]
            if ins == 0xB0 { // READ BINARY
                // Construct TLV: DF27 04 [CA FE BA BE]
                var data = Data()
                data.append(contentsOf: [0xDF, 0x27, 0x04, 0xCA, 0xFE, 0xBA, 0xBE])
                data.append(contentsOf: [0x90, 0x00])
                return data
            }
            return Data([0x90, 0x00])
        }
        
        do {
            let photo = try await controller.readFacePhoto(pin: "1234")
            assertEqual(photo.count, 4, "Photo data length mismatch")
            assertEqual(photo[0], 0xCA, "Photo data mismatch")
        } catch {
             print("❌ Unexpected Error: \(error)")
             exit(1)
        }
    }
}
