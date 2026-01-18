import Foundation

/// Helper for DIF Presentation Exchange (PEX) parsing
class PresentationExchange {
    
    struct PresentationRequest {
        let id: String
        let inputDescriptors: [InputDescriptor]
    }
    
    struct InputDescriptor {
        let id: String
        let docType: String?
        let fields: [String]
    }
    
    static func parseDefinition(_ json: [String: Any]) -> PresentationRequest? {
        guard let definition = json["presentation_definition"] as? [String: Any],
              let id = definition["id"] as? String,
              let descriptors = definition["input_descriptors"] as? [[String: Any]] else {
            return nil
        }
        
        var parsedDescriptors = [InputDescriptor]()
        for desc in descriptors {
            guard let descId = desc["id"] as? String else { continue }
            var fields = [String]()
            if let constraints = desc["constraints"] as? [String: Any],
               let fieldsArray = constraints["fields"] as? [[String: Any]] {
                for field in fieldsArray {
                    if let paths = field["path"] as? [String], let path = paths.first {
                        let cleaned = path.replacingOccurrences(of: "$['", with: "")
                                          .replacingOccurrences(of: "']['", with: ".")
                                          .replacingOccurrences(of: "']", with: "")
                        fields.append(cleaned)
                    }
                }
            }
            parsedDescriptors.append(InputDescriptor(id: descId, docType: nil, fields: fields))
        }
        return PresentationRequest(id: id, inputDescriptors: parsedDescriptors)
    }
}
