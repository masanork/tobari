import Foundation

class ECMath {
    private static let libCrypto = dlopen("/usr/lib/libcrypto.dylib", RTLD_NOW)
    
    static let NID_X9_62_prime256v1: Int32 = 415
    
    private static func loadSymbol<T>(_ name: String) -> T? {
        guard let symbol = dlsym(libCrypto, name) else { return nil }
        return unsafeBitCast(symbol, to: T.self)
    }
    
    /// Computes G' = [s]G + P on NIST P-256
    static func computeMappedGenerator(scalarS: Data, pointP: Data) throws -> Data {
        guard libCrypto != nil else {
            throw SignerError.internalError("libcrypto not found")
        }
        
        // Define function types
        typealias EC_GROUP_new_by_curve_name_t = @convention(c) (Int32) -> OpaquePointer?
        typealias EC_POINT_new_t = @convention(c) (OpaquePointer) -> OpaquePointer?
        typealias EC_POINT_free_t = @convention(c) (OpaquePointer) -> Void
        typealias EC_POINT_add_t = @convention(c) (OpaquePointer, OpaquePointer, OpaquePointer, OpaquePointer, OpaquePointer?) -> Int32
        typealias EC_POINT_mul_t = @convention(c) (OpaquePointer, OpaquePointer, OpaquePointer?, OpaquePointer?, OpaquePointer?, OpaquePointer?) -> Int32
        typealias BN_bin2bn_t = @convention(c) (UnsafePointer<UInt8>, Int32, OpaquePointer?) -> OpaquePointer?
        typealias BN_free_t = @convention(c) (OpaquePointer) -> Void
        typealias EC_POINT_oct2point_t = @convention(c) (OpaquePointer, OpaquePointer, UnsafePointer<UInt8>, Int, OpaquePointer?) -> Int32
        typealias EC_POINT_point2oct_t = @convention(c) (OpaquePointer, OpaquePointer, Int32, UnsafeMutablePointer<UInt8>?, Int, OpaquePointer?) -> Int
        
        // Load symbols
        let EC_GROUP_new_by_curve_name: EC_GROUP_new_by_curve_name_t = loadSymbol("EC_GROUP_new_by_curve_name")!
        let EC_POINT_new: EC_POINT_new_t = loadSymbol("EC_POINT_new")!
        let EC_POINT_free: EC_POINT_free_t = loadSymbol("EC_POINT_free")!
        let EC_POINT_add: EC_POINT_add_t = loadSymbol("EC_POINT_add")!
        let EC_POINT_mul: EC_POINT_mul_t = loadSymbol("EC_POINT_mul")!
        let BN_bin2bn: BN_bin2bn_t = loadSymbol("BN_bin2bn")!
        let BN_free: BN_free_t = loadSymbol("BN_free")!
        let EC_POINT_oct2point: EC_POINT_oct2point_t = loadSymbol("EC_POINT_oct2point")!
        let EC_POINT_point2oct: EC_POINT_point2oct_t = loadSymbol("EC_POINT_point2oct")!
        
        guard let group = EC_GROUP_new_by_curve_name(NID_X9_62_prime256v1) else {
            throw SignerError.internalError("Failed to initialize EC group")
        }
        
        let ctx: OpaquePointer? = nil
        
        // 1. Convert scalar s to BIGNUM
        let sBN = scalarS.withUnsafeBytes { BN_bin2bn($0.bindMemory(to: UInt8.self).baseAddress!, Int32(scalarS.count), nil) }!
        defer { BN_free(sBN) }
        
        // 2. Convert point P to EC_POINT
        let pPoint = EC_POINT_new(group)!
        defer { EC_POINT_free(pPoint) }
        pointP.withUnsafeBytes { _ = EC_POINT_oct2point(group, pPoint, $0.bindMemory(to: UInt8.self).baseAddress!, pointP.count, ctx) }
        
        // 3. Compute [s]G
        let sG = EC_POINT_new(group)!
        defer { EC_POINT_free(sG) }
        _ = EC_POINT_mul(group, sG, sBN, nil, nil, ctx)
        
        // 4. Compute G' = [s]G + P
        let gPrime = EC_POINT_new(group)!
        defer { EC_POINT_free(gPrime) }
        _ = EC_POINT_add(group, gPrime, sG, pPoint, ctx)
        
        // 5. Serialize G'
        let len = EC_POINT_point2oct(group, gPrime, 4, nil, 0, ctx)
        var result = Data(count: len)
        result.withUnsafeMutableBytes { _ = EC_POINT_point2oct(group, gPrime, 4, $0.bindMemory(to: UInt8.self).baseAddress!, len, ctx) }
        
        return result
    }
}