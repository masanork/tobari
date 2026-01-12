import Foundation
import Vision
import AppKit

class MRZProcessor {
    /// Recognizes MRZ from an image and returns the combined MRZ string
    static func extractMRZ(from image: NSImage) async throws -> String? {
        guard let tiffData = image.tiffRepresentation,
              let ciImage = CIImage(data: tiffData) else {
            return nil
        }
        
        return try await withCheckedThrowingContinuation { continuation in
            let request = VNRecognizeTextRequest { request, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }
                
                guard let observations = request.results as? [VNRecognizedTextObservation] else {
                    continuation.resume(returning: nil)
                    return
                }
                
                let recognizedStrings = observations.compactMap { $0.topCandidates(1).first?.string }
                let mrz = parseMRZ(from: recognizedStrings)
                continuation.resume(returning: mrz)
            }
            
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = false // Disable correction for MRZ
            
            let handler = VNImageRequestHandler(ciImage: ciImage, options: [:])
            do {
                try handler.perform([request])
            } catch {
                continuation.resume(throwing: error)
            }
        }
    }
    
    /// Parses potential MRZ lines from a list of recognized strings
    private static func parseMRZ(from strings: [String]) -> String? {
        // Clean strings: remove spaces, convert to uppercase
        let cleaned = strings.map { $0.replacingOccurrences(of: " ", with: "").uppercased() }
        
        // Strategy: Look for strings that are 44 characters (TD3) or 30 characters (TD1) 
        // and contain mostly letters, numbers and '<'
        let mrzPattern = "^[A-Z0-9<]{30,44}$"
        let regex = try? NSRegularExpression(pattern: mrzPattern)
        
        let candidates = cleaned.filter {
            let range = NSRange(location: 0, length: $0.utf16.count)
            return regex?.firstMatch(in: $0, options: [], range: range) != nil
        }
        
        // TD3 (Passport): 2 lines of 44 chars
        if candidates.count >= 2 {
            let td3Lines = candidates.filter { $0.count == 44 }
            if td3Lines.count >= 2 {
                // Return the last two 44-char lines (usually MRZ is at bottom)
                return td3Lines.suffix(2).joined(separator: "\n")
            }
        }
        
        // TD1 (ID Card): 3 lines of 30 chars
        let td1Lines = candidates.filter { $0.count == 30 }
        if td1Lines.count >= 3 {
            return td1Lines.suffix(3).joined(separator: "\n")
        }
        
        return nil
    }
}
