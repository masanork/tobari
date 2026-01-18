import Foundation

/// Simple CBOR writer for encoding basic structures required for mdoc VP signing
class CBORWriter {
    var data = Data()

    func writeInt(_ value: Int) {
        if value >= 0 {
            writeUInt(UInt64(value))
        } else {
            writeNegativeInt(Int64(value))
        }
    }

    func writeUInt(_ value: UInt64) {
        if value < 24 {
            data.append(UInt8(value))
        } else if value <= 0xFF {
            data.append(0x18)
            data.append(UInt8(value))
        } else if value <= 0xFFFF {
            data.append(0x19)
            data.append(UInt16(value).bigEndianBytes)
        } else if value <= 0xFFFFFFFF {
            data.append(0x1A)
            data.append(UInt32(value).bigEndianBytes)
        } else {
            data.append(0x1B)
            data.append(value.bigEndianBytes)
        }
    }

    func writeNegativeInt(_ value: Int64) {
        let positiveValue = UInt64(-1 - value)
        if positiveValue < 24 {
            data.append(0x20 | UInt8(positiveValue))
        } else if positiveValue <= 0xFF {
            data.append(0x38)
            data.append(UInt8(positiveValue))
        } else if positiveValue <= 0xFFFF {
            data.append(0x39)
            data.append(UInt16(positiveValue).bigEndianBytes)
        } else if positiveValue <= 0xFFFFFFFF {
            data.append(0x3A)
            data.append(UInt32(positiveValue).bigEndianBytes)
        } else {
            data.append(0x3B)
            data.append(positiveValue.bigEndianBytes)
        }
    }

    func writeString(_ value: String) {
        let utf8 = value.data(using: .utf8)!
        let length = UInt64(utf8.count)
        
        if length < 24 {
            data.append(0x60 | UInt8(length))
        } else if length <= 0xFF {
            data.append(0x78)
            data.append(UInt8(length))
        } else if length <= 0xFFFF {
            data.append(0x79)
            data.append(UInt16(length).bigEndianBytes)
        } else if length <= 0xFFFFFFFF {
            data.append(0x7A)
            data.append(UInt32(length).bigEndianBytes)
        } else {
            data.append(0x7B)
            data.append(length.bigEndianBytes)
        }
        data.append(utf8)
    }

    func writeBytes(_ value: Data) {
        let length = UInt64(value.count)
        
        if length < 24 {
            data.append(0x40 | UInt8(length))
        } else if length <= 0xFF {
            data.append(0x58)
            data.append(UInt8(length))
        } else if length <= 0xFFFF {
            data.append(0x59)
            data.append(UInt16(length).bigEndianBytes)
        } else if length <= 0xFFFFFFFF {
            data.append(0x5A)
            data.append(UInt32(length).bigEndianBytes)
        } else {
            data.append(0x5B)
            data.append(length.bigEndianBytes)
        }
        data.append(value)
    }

    func writeArrayStart(_ count: Int) {
        let length = UInt64(count)
        if length < 24 {
            data.append(0x80 | UInt8(length))
        } else if length <= 0xFF {
            data.append(0x98)
            data.append(UInt8(length))
        } else if length <= 0xFFFF {
            data.append(0x99)
            data.append(UInt16(length).bigEndianBytes)
        } else if length <= 0xFFFFFFFF {
            data.append(0x9A)
            data.append(UInt32(length).bigEndianBytes)
        } else {
            data.append(0x9B)
            data.append(length.bigEndianBytes)
        }
    }

    func writeMapStart(_ count: Int) {
        let length = UInt64(count)
        if length < 24 {
            data.append(0xA0 | UInt8(length))
        } else if length <= 0xFF {
            data.append(0xB8)
            data.append(UInt8(length))
        } else if length <= 0xFFFF {
            data.append(0xB9)
            data.append(UInt16(length).bigEndianBytes)
        } else if length <= 0xFFFFFFFF {
            data.append(0xBA)
            data.append(UInt32(length).bigEndianBytes)
        } else {
            data.append(0xBB)
            data.append(length.bigEndianBytes)
        }
    }

    func writeTag(_ tag: UInt64) {
        if tag < 24 {
            data.append(0xC0 | UInt8(tag))
        } else if tag <= 0xFF {
            data.append(0xD8)
            data.append(UInt8(tag))
        } else if tag <= 0xFFFF {
            data.append(0xD9)
            data.append(UInt16(tag).bigEndianBytes)
        } else if tag <= 0xFFFFFFFF {
            data.append(0xDA)
            data.append(UInt32(tag).bigEndianBytes)
        } else {
            data.append(0xDB)
            data.append(tag.bigEndianBytes)
        }
    }

    func writeBool(_ value: Bool) {
        data.append(value ? 0xF5 : 0xF4)
    }

    func writeNull() {
        data.append(0xF6)
    }
}

extension UInt16 {
    var bigEndianBytes: Data {
        var value = self.bigEndian
        return Data(bytes: &value, count: 2)
    }
}

extension UInt32 {
    var bigEndianBytes: Data {
        var value = self.bigEndian
        return Data(bytes: &value, count: 4)
    }
}

extension UInt64 {
    var bigEndianBytes: Data {
        var value = self.bigEndian
        return Data(bytes: &value, count: 8)
    }
}
