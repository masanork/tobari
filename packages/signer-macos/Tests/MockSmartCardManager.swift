import Foundation

class MockSmartCardManager: SmartCardInterface {
    var handler: ((Data) -> Data)?
    var requestLog: [Data] = []
    
    func transmit(apdu: Data) async throws -> Data {
        requestLog.append(apdu)
        if let handler = handler {
            return handler(apdu)
        }
        // Default: Success SW
        return Data([0x90, 0x00])
    }
}
