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
        print("Running testComputeSignature...")
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
            let signature = try await controller.computeSignature(pin: "1234", data: dataToSign)
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
        
        var selectedEF: Data = Data()
        
        mock.handler = { apdu in
            let ins = apdu[1]
            if ins == 0xA4 && apdu[2] == 0x02 { // Select EF
                selectedEF = apdu.subdata(in: 5..<apdu.count)
                return Data([0x90, 0x00])
            }
            if ins == 0xB0 { // READ BINARY
                if selectedEF == Data([0x00, 0x02]) { // Attributes
                    var inner = Data()
                    inner.append(contentsOf: [0xDF, 0x22, 0x04])
                    inner.append(contentsOf: "Taro".data(using: .utf8)!)
                    var outer = Data()
                    outer.append(contentsOf: [0xDF, 0x20, UInt8(inner.count)])
                    outer.append(inner)
                    outer.append(contentsOf: [0x90, 0x00])
                    return outer
                } else if selectedEF == Data([0x00, 0x0A]) || selectedEF == Data([0x00, 0x01]) {
                    // Certificates
                    return Data([0x30, 0x04, 0x01, 0x02, 0x03, 0x04, 0x90, 0x00])
                }
            }
            return Data([0x90, 0x00])
        }
        
        do {
            let info = try await controller.readAttributes(pin: "1234")
            assertEqual(info.name, "Taro", "Name mismatch")
            assert(info.authCert != nil, "Auth Cert should be present")
            assert(info.signCert != nil, "Sign Cert should be present")
            assert(info.authCACert != nil, "Auth CA Cert should be present")
            assert(info.signCACert != nil, "Sign CA Cert should be present")
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
            let photo = try await controller.readFacePhoto(myNumber: "123456789012")
            assertEqual(photo.count, 4, "Photo data length mismatch")
            assertEqual(photo[0], 0xCA, "Photo data mismatch")
        } catch {
             print("❌ Unexpected Error: \(error)")
             exit(1)
        }
    }
}
