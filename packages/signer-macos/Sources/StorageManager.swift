import Foundation

struct WalletCredential: Identifiable {
    let id = UUID()
    let name: String
    let path: String
    let docType: String
    let createdAt: Date?
}

class StorageManager {
    static let shared = StorageManager()
    
    var tobariHome: URL {
        if let envPath = ProcessInfo.processInfo.environment["TOBARI_HOME"] {
            return URL(fileURLWithPath: envPath)
        }
        
        let fm = FileManager.default
        let documents = fm.urls(for: .documentDirectory, in: .userDomainMask).first!
        return documents.appendingPathComponent("Tobari")
    }
    
    func ensureDirectoryStructure() {
        let fm = FileManager.default
        let subs = ["credentials", "requests", "data", "history", "config"]
        for sub in subs {
            let url = tobariHome.appendingPathComponent(sub)
            if !fm.fileExists(atPath: url.path) {
                try? fm.createDirectory(at: url, withIntermediateDirectories: true)
            }
        }
    }
    
    func listCredentials() -> [WalletCredential] {
        let fm = FileManager.default
        let credentialsDir = tobariHome.appendingPathComponent("credentials")
        
        guard let items = try? fm.contentsOfDirectory(at: credentialsDir, includingPropertiesForKeys: [URLResourceKey.creationDateKey], options: .skipsHiddenFiles) else {
            return []
        }
        
        return items.filter { $0.pathExtension == "cose" }.compactMap { url in
            let name = url.lastPathComponent
            let createdAt = (try? url.resourceValues(forKeys: [URLResourceKey.creationDateKey]))?.creationDate
            
            // Minimal decode to get docType
            var docType = "Unknown"
            if let data = try? Data(contentsOf: url) {
                docType = extractDocType(from: data)
            }
            
            return WalletCredential(name: name, path: url.path, docType: docType, createdAt: createdAt)
        }
    }
    
    private func extractDocType(from data: Data) -> String {
        // Very basic CBOR decoding logic to find "docType"
        // In a real implementation, we would use a proper CBOR parser
        // For now, look for the "docType" string followed by a value
        
        // mdoc docType is usually near the beginning after the COSE headers
        // We'll look for UTF-8 string "docType" (0x67 0x64 0x6f 0x63 0x54 0x79 0x70 0x65)
        let pattern = Data([0x67, 0x64, 0x6f, 0x63, 0x54, 0x79, 0x70, 0x65])
        if let range = data.range(of: pattern) {
            let valueStart = range.upperBound
            if valueStart < data.count {
                let firstByte = data[valueStart]
                if firstByte >= 0x60 && firstByte <= 0x7B {
                    // It's a short UTF-8 string
                    let length = Int(firstByte & 0x1F)
                    if valueStart + 1 + length <= data.count {
                        let stringData = data.subdata(in: (valueStart + 1)..<(valueStart + 1 + length))
                        return String(data: stringData, encoding: .utf8) ?? "Unknown"
                    }
                }
            }
        }
        
        return "Unknown"
    }
}
