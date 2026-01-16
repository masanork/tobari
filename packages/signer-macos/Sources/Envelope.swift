import Foundation

/// The version of the envelope format.
let ENVELOPE_VERSION = "2.0"

/// Algorithm identifier for the payload encryption.
let ALG_AES_256_GCM = "AES-256-GCM"

/// Represents the encrypted envelope containing the payload and recipients.
struct Envelope: Codable {
    let version: String
    let alg: String
    let iv: String
    let ciphertext: String
    let tag: String
    let recipients: [Recipient]
}

/// Represents a recipient who can decrypt the envelope.
enum Recipient: Codable {
    case webAuthnPrf(WebAuthnPrfRecipient)
    case hpkeP256(HpkeP256Recipient)
    
    enum CodingKeys: String, CodingKey {
        case type
    }
    
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)
        
        switch type {
        case "webauthn-prf":
            let val = try WebAuthnPrfRecipient(from: decoder)
            self = .webAuthnPrf(val)
        case "hpke-p256":
            let val = try HpkeP256Recipient(from: decoder)
            self = .hpkeP256(val)
        default:
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "Unknown recipient type: \(type)")
        }
    }
    
    func encode(to encoder: Encoder) throws {
        switch self {
        case .webAuthnPrf(let val):
            try val.encode(to: encoder)
        case .hpkeP256(let val):
            try val.encode(to: encoder)
        }
    }
}

struct WebAuthnPrfRecipient: Codable {
    let type: String
    let kid: String
    let salt: String
    let iv: String
    let encryptedKey: String
    let tag: String
    
    enum CodingKeys: String, CodingKey {
        case type, kid, salt, iv, tag
        case encryptedKey = "encrypted-key"
    }
    
    init(kid: String, salt: String, iv: String, encryptedKey: String, tag: String) {
        self.type = "webauthn-prf"
        self.kid = kid
        self.salt = salt
        self.iv = iv
        self.encryptedKey = encryptedKey
        self.tag = tag
    }
}

struct HpkeP256Recipient: Codable {
    let type: String
    let kid: String
    let enc: String
    let encryptedKey: String
    let tag: String?
    
    enum CodingKeys: String, CodingKey {
        case type, kid, enc, tag
        case encryptedKey = "encrypted-key"
    }
}
