import Foundation
import Vision
import AppKit

class MRZProcessor {
    /// Recognizes MRZ from an image and returns the combined MRZ string
    static func extractMRZ(from image: NSImage) async throws -> String? {
        guard let tiffData = image.tiffRepresentation,
              let _ = CIImage(data: tiffData) else {
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
            request.usesLanguageCorrection = false
            
            let handler = VNImageRequestHandler(data: tiffData, options: [:])
            do {
                try handler.perform([request])
            } catch {
                continuation.resume(throwing: error)
            }
        }
    }
    
    private static func parseMRZ(from strings: [String]) -> String? {
        let cleaned = strings.map { $0.replacingOccurrences(of: " ", with: "").uppercased() }
        
        // Try TD3 (2 lines of 44)
        let td3Candidates = cleaned.filter { $0.count == 44 }
        if td3Candidates.count >= 2 {
            let mrzLines = Array(td3Candidates.suffix(2))
            if MRZParser.parse(lines: mrzLines) != nil {
                return mrzLines.joined(separator: "\n")
            }
        }
        
        // Try TD1 (3 lines of 30)
        let td1Candidates = cleaned.filter { $0.count == 30 }
        if td1Candidates.count >= 3 {
            let mrzLines = Array(td1Candidates.suffix(3))
            if MRZParser.parse(lines: mrzLines) != nil {
                return mrzLines.joined(separator: "\n")
            }
        }
        
        return nil
    }
}