import XCTest
import Foundation
import CryptoKit

class EnvelopeTests: XCTestCase {
    
    func testEnvelopePrfDecryption() throws {
        // Load vectors
        // Assuming running from project root or derived path. 
        // We can try relative path or environment variable.
        // For CLI execution, often CWD is the package root.
        let fm = FileManager.default
        let currentDir = fm.currentDirectoryPath
        let vectorPath = URL(fileURLWithPath: currentDir).appendingPathComponent("Tests/envelope_vectors.json")
        
        guard fm.fileExists(atPath: vectorPath.path) else {
            print("⚠️ Skipping interoperability test: envelope_vectors.json not found at \(vectorPath.path)")
            return
        }
        
        let data = try Data(contentsOf: vectorPath)
        
        struct Vector: Codable {
            let name: String
            let payload: String
            let kid: String
            let salt: String
            let prfOutput: String
            let envelope: Envelope
        }
        
        let vectors = try JSONDecoder().decode([Vector].self, from: data)
        
        for vector in vectors {
            print("Running test vector: \(vector.name)")
            
            guard let prfOutputData = Data(base64URLEncoded: vector.prfOutput) else {
                XCTFail("Invalid PRF output format")
                return
            }
            
            let decryptor = EnvelopeEncryption()
            let decrypted = try decryptor.decrypt(envelope: vector.envelope, prfOutput: prfOutputData, prfKid: vector.kid)
            
            let decryptedString = String(data: decrypted, encoding: .utf8)
            XCTAssertEqual(decryptedString, vector.payload)
        }
    }
}
