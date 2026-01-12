import Foundation
import SwiftUI

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
struct AppTests {
    static func main() async {
        print("🚀 Starting App State Tests...")
        await testAppStateInitial()
        await testAppStateCardDetection()
        print("✅ All App State Tests Passed!")
    }
    
    static func testAppStateInitial() async {
        print("Running testAppStateInitial...")
        let state = AppState()
        assertEqual(state.isReading, false, "Initial isReading should be false")
        assertEqual(state.cardData == nil, true, "Initial cardData should be nil")
    }
    
    static func testAppStateCardDetection() async {
        print("Running testAppStateCardDetection...")
        let state = AppState()
        
        // Mock a card insertion event
        SmartCardManager.shared.onCardStateChanged?(true)
        assertEqual(state.isCardPresent, true, "isCardPresent should be true after insertion")
        assert(state.status.contains("Card detected"), "Status should indicate detection")
        
        // Mock removal
        SmartCardManager.shared.onCardStateChanged?(false)
        assertEqual(state.isCardPresent, false, "isCardPresent should be false after removal")
    }
}
