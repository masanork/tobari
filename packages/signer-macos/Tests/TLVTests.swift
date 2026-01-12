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
struct TLVTests {
    static func main() {
        print("🚀 Starting TLV Parser Tests...")
        testSimpleTLV()
        testNestedTLV()
        testMultiByteLength()
        print("✅ All TLV Tests Passed!")
    }
    
    static func testSimpleTLV() {
        print("Running testSimpleTLV...")
        // Tag 01, Length 02, Value AA BB
        let data = Data([0x01, 0x02, 0xAA, 0xBB])
        let tlvs = TLVParser.parse(data: data)
        assertEqual(tlvs.count, 1, "Should have 1 TLV")
        assertEqual(tlvs[0].tag, 0x01, "Tag mismatch")
        assertEqual(tlvs[0].value, Data([0xAA, 0xBB]), "Value mismatch")
    }
    
    static func testNestedTLV() {
        print("Running testNestedTLV...")
        // Tag 21 (Constructed), Length 04
        //   Tag 01, Length 02, Value CC DD
        let data = Data([0x21, 0x04, 0x01, 0x02, 0xCC, 0xDD])
        let tlvs = TLVParser.parse(data: data)
        assertEqual(tlvs.count, 1, "Should have 1 top-level TLV")
        assertEqual(tlvs[0].tag, 0x21, "Tag mismatch")
        assertEqual(tlvs[0].children.count, 1, "Should have 1 child")
        assertEqual(tlvs[0].children[0].tag, 0x01, "Child tag mismatch")
    }
    
    static func testMultiByteLength() {
        print("Running testMultiByteLength...")
        // Tag 01, Length 81 80 (128 bytes), Value [00...00]
        var data = Data([0x01, 0x81, 0x80])
        data.append(Data(repeating: 0xEE, count: 128))
        let tlvs = TLVParser.parse(data: data)
        assertEqual(tlvs.count, 1, "Should have 1 TLV")
        assertEqual(tlvs[0].value.count, 128, "Length mismatch")
    }
}
