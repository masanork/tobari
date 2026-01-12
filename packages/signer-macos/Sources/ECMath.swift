import Foundation

class ECMath {
    static var useMock = false
    private static var _libCrypto: UnsafeMutableRawPointer? = nil
    private static var _initialized = false
    
    private static func getLibCrypto() -> UnsafeMutableRawPointer? {
        if useMock { return nil }
        if _initialized { return _libCrypto }
        _initialized = true
        let paths = [
            "/usr/lib/libcrypto.dylib",
            "/usr/lib/libcrypto.44.dylib",
            "libcrypto.dylib"
        ]
        for path in paths {
            if let handle = dlopen(path, RTLD_LAZY) {
                _libCrypto = handle
                return handle
            }
        }
        return nil
    }
    
    static let NID_X9_62_prime256v1: Int32 = 415
    
    private typealias EC_GROUP_new_by_curve_name_t = @convention(c) (Int32) -> OpaquePointer?
    private typealias EC_POINT_new_t = @convention(c) (OpaquePointer) -> OpaquePointer?
    private typealias EC_POINT_free_t = @convention(c) (OpaquePointer) -> Void
    private typealias EC_POINT_add_t = @convention(c) (OpaquePointer, OpaquePointer, OpaquePointer, OpaquePointer, OpaquePointer?) -> Int32
    private typealias EC_POINT_mul_t = @convention(c) (OpaquePointer, OpaquePointer, OpaquePointer?, OpaquePointer?, OpaquePointer?, OpaquePointer?) -> Int32
    private typealias BN_bin2bn_t = @convention(c) (UnsafePointer<UInt8>, Int32, OpaquePointer?) -> OpaquePointer?
    private typealias BN_free_t = @convention(c) (OpaquePointer) -> Void
    private typealias EC_POINT_oct2point_t = @convention(c) (OpaquePointer, OpaquePointer, UnsafePointer<UInt8>, Int, OpaquePointer?) -> Int32
    private typealias EC_POINT_point2oct_t = @convention(c) (OpaquePointer, OpaquePointer, Int32, UnsafeMutablePointer<UInt8>?, Int, OpaquePointer?) -> Int

    private static func loadSymbol<T>(_ name: String) -> T? {
        guard let handle = getLibCrypto() else { return nil }
        guard let symbol = dlsym(handle, name) else { return nil }
        return unsafeBitCast(symbol, to: T.self)
    }
    
    /// Computes G' = [s]G + P on NIST P-256
    static func computeMappedGenerator(scalarS: Data, pointP: Data) throws -> Data {
        if useMock {
            return Data(repeating: 0xEE, count: 65)
        }
        
        // Load symbols safely
        guard let EC_GROUP_new_by_curve_name: EC_GROUP_new_by_curve_name_t = loadSymbol("EC_GROUP_new_by_curve_name"),
              let EC_POINT_new: EC_POINT_new_t = loadSymbol("EC_POINT_new"),
              let EC_POINT_free: EC_POINT_free_t = loadSymbol("EC_POINT_free"),
              let EC_POINT_add: EC_POINT_add_t = loadSymbol("EC_POINT_add"),
              let EC_POINT_mul: EC_POINT_mul_t = loadSymbol("EC_POINT_mul"),
              let BN_bin2bn: BN_bin2bn_t = loadSymbol("BN_bin2bn"),
              let BN_free: BN_free_t = loadSymbol("BN_free"),
              let EC_POINT_oct2point: EC_POINT_oct2point_t = loadSymbol("EC_POINT_oct2point"),
              let EC_POINT_point2oct: EC_POINT_point2oct_t = loadSymbol("EC_POINT_point2oct") else {
            throw SignerError.internalError("libcrypto or required symbols not found. Cannot perform PACE GM mapping.")
        }
        
        guard let group = EC_GROUP_new_by_curve_name(NID_X9_62_prime256v1) else {
            throw SignerError.internalError("Failed to initialize EC group")
        }
        
        let ctx: OpaquePointer? = nil
        let nilBN: OpaquePointer? = nil
        let nilBuf: UnsafeMutablePointer<UInt8>? = nil
        
        // 1. Convert scalar s to BIGNUM
        guard let sBN = scalarS.withUnsafeBytes({ BN_bin2bn($0.bindMemory(to: UInt8.self).baseAddress!, Int32(scalarS.count), nilBN) }) else {
            throw SignerError.internalError("Failed to convert scalar s to BIGNUM")
        }
        defer { BN_free(sBN) }
        
        // 2. Convert point P to EC_POINT
        guard let pPoint = EC_POINT_new(group) else {
            throw SignerError.internalError("Failed to create EC_POINT P")
        }
        defer { EC_POINT_free(pPoint) }
        pointP.withUnsafeBytes { _ = EC_POINT_oct2point(group, pPoint, $0.bindMemory(to: UInt8.self).baseAddress!, pointP.count, ctx) }
        
        // 3. Compute [s]G
        guard let sG = EC_POINT_new(group) else {
            throw SignerError.internalError("Failed to create EC_POINT sG")
        }
        defer { EC_POINT_free(sG) }
        _ = EC_POINT_mul(group, sG, sBN, nilBN, nilBN, ctx)
        
        // 4. Compute G' = [s]G + P
        guard let gPrime = EC_POINT_new(group) else {
            throw SignerError.internalError("Failed to create EC_POINT gPrime")
        }
        defer { EC_POINT_free(gPrime) }
        _ = EC_POINT_add(group, gPrime, sG, pPoint, ctx)
        
        // 5. Serialize G'
        let len = EC_POINT_point2oct(group, gPrime, 4, nilBuf, 0, ctx)
        var result = Data(count: len)
        result.withUnsafeMutableBytes { _ = EC_POINT_point2oct(group, gPrime, 4, $0.bindMemory(to: UInt8.self).baseAddress!, len, ctx) }
        
        return result
    }
}
