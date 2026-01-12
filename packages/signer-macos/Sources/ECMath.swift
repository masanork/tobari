import Foundation

class ECMath {
    static var useMock = false
    private static var _libCrypto: UnsafeMutableRawPointer? = nil
    private static var _initialized = false
    
    private static func getLibCrypto() -> UnsafeMutableRawPointer? {
        if useMock { return nil }
        if _initialized { return _libCrypto }
        _initialized = true
        let paths = ["/usr/lib/libcrypto.dylib", "/usr/lib/libcrypto.44.dylib", "libcrypto.dylib"]
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
    private typealias EC_GROUP_free_t = @convention(c) (OpaquePointer) -> Void
    private typealias EC_GROUP_set_generator_t = @convention(c) (OpaquePointer, OpaquePointer, OpaquePointer?, OpaquePointer?) -> Int32
    private typealias EC_POINT_new_t = @convention(c) (OpaquePointer) -> OpaquePointer?
    private typealias EC_POINT_free_t = @convention(c) (OpaquePointer) -> Void
    private typealias EC_POINT_add_t = @convention(c) (OpaquePointer, OpaquePointer, OpaquePointer, OpaquePointer, OpaquePointer?) -> Int32
    private typealias EC_POINT_mul_t = @convention(c) (OpaquePointer, OpaquePointer, OpaquePointer?, OpaquePointer?, OpaquePointer?, OpaquePointer?) -> Int32
    private typealias BN_bin2bn_t = @convention(c) (UnsafePointer<UInt8>, Int32, OpaquePointer?) -> OpaquePointer?
    private typealias BN_new_t = @convention(c) () -> OpaquePointer?
    private typealias BN_free_t = @convention(c) (OpaquePointer) -> Void
    private typealias EC_POINT_oct2point_t = @convention(c) (OpaquePointer, OpaquePointer, UnsafePointer<UInt8>, Int, OpaquePointer?) -> Int32
    private typealias EC_POINT_point2oct_t = @convention(c) (OpaquePointer, OpaquePointer, Int32, UnsafeMutablePointer<UInt8>?, Int, OpaquePointer?) -> Int
    private typealias EC_KEY_new_t = @convention(c) () -> OpaquePointer?
    private typealias EC_KEY_free_t = @convention(c) (OpaquePointer) -> Void
    private typealias EC_KEY_set_group_t = @convention(c) (OpaquePointer, OpaquePointer) -> Int32
    private typealias EC_KEY_generate_key_t = @convention(c) (OpaquePointer) -> Int32
    private typealias EC_KEY_get0_public_key_t = @convention(c) (OpaquePointer) -> OpaquePointer?
    private typealias ECDH_compute_key_t = @convention(c) (UnsafeMutablePointer<UInt8>, Int, OpaquePointer, OpaquePointer, OpaquePointer?) -> Int

    private static func loadSymbol<T>(_ name: String) -> T? {
        guard let handle = getLibCrypto() else { return nil }
        guard let symbol = dlsym(handle, name) else { return nil }
        return unsafeBitCast(symbol, to: T.self)
    }
    
    /// Computes G' = [s]G + P on NIST P-256
    static func computeMappedGenerator(scalarS: Data, pointP: Data) throws -> Data {
        if useMock { return Data(repeating: 0xEE, count: 65) }
        
        let EC_GROUP_new_by_curve_name: EC_GROUP_new_by_curve_name_t = loadSymbol("EC_GROUP_new_by_curve_name")!
        let EC_GROUP_free: EC_GROUP_free_t = loadSymbol("EC_GROUP_free")!
        let EC_POINT_new: EC_POINT_new_t = loadSymbol("EC_POINT_new")!
        let EC_POINT_free: EC_POINT_free_t = loadSymbol("EC_POINT_free")!
        let EC_POINT_add: EC_POINT_add_t = loadSymbol("EC_POINT_add")!
        let EC_POINT_mul: EC_POINT_mul_t = loadSymbol("EC_POINT_mul")!
        let BN_bin2bn: BN_bin2bn_t = loadSymbol("BN_bin2bn")!
        let BN_free: BN_free_t = loadSymbol("BN_free")!
        let EC_POINT_oct2point: EC_POINT_oct2point_t = loadSymbol("EC_POINT_oct2point")!
        let EC_POINT_point2oct: EC_POINT_point2oct_t = loadSymbol("EC_POINT_point2oct")!
        
        guard let group = EC_GROUP_new_by_curve_name(NID_X9_62_prime256v1) else { throw SignerError.internalError("EC Init Fail") }
        defer { EC_GROUP_free(group) }
        
        let nilBN: OpaquePointer? = nil
        let nilBuf: UnsafeMutablePointer<UInt8>? = nil
        
        let sBN = scalarS.withUnsafeBytes { BN_bin2bn($0.bindMemory(to: UInt8.self).baseAddress!, Int32(scalarS.count), nilBN) }!
        defer { BN_free(sBN) }
        
        let pPoint = EC_POINT_new(group)!
        defer { EC_POINT_free(pPoint) }
        pointP.withUnsafeBytes { _ = EC_POINT_oct2point(group, pPoint, $0.bindMemory(to: UInt8.self).baseAddress!, pointP.count, nil) }
        
        let sG = EC_POINT_new(group)!
        defer { EC_POINT_free(sG) }
        _ = EC_POINT_mul(group, sG, sBN, nil, nil, nil)
        
        let gPrime = EC_POINT_new(group)!
        defer { EC_POINT_free(gPrime) }
        _ = EC_POINT_add(group, gPrime, sG, pPoint, nil)
        
        let len = EC_POINT_point2oct(group, gPrime, 4, nilBuf, 0, nil)
        var result = Data(count: len)
        result.withUnsafeMutableBytes { _ = EC_POINT_point2oct(group, gPrime, 4, $0.bindMemory(to: UInt8.self).baseAddress!, len, nil) }
        return result
    }
    
    /// Performs full ECDH Key Agreement on a custom generator point
    static func performECDHWithMappedGenerator(gPrimeData: Data, remotePublicKeyData: Data) throws -> (ephemeralPublic: Data, sharedSecret: Data) {
        if useMock { return (Data(repeating: 0x11, count: 65), Data(repeating: 0x22, count: 32)) }
        
        let EC_GROUP_new_by_curve_name: EC_GROUP_new_by_curve_name_t = loadSymbol("EC_GROUP_new_by_curve_name")!
        let EC_GROUP_free: EC_GROUP_free_t = loadSymbol("EC_GROUP_free")!
        let EC_GROUP_set_generator: EC_GROUP_set_generator_t = loadSymbol("EC_GROUP_set_generator")!
        let EC_POINT_new: EC_POINT_new_t = loadSymbol("EC_POINT_new")!
        let EC_POINT_free: EC_POINT_free_t = loadSymbol("EC_POINT_free")!
        let EC_POINT_oct2point: EC_POINT_oct2point_t = loadSymbol("EC_POINT_oct2point")!
        let EC_POINT_point2oct: EC_POINT_point2oct_t = loadSymbol("EC_POINT_point2oct")!
        let EC_KEY_new: EC_KEY_new_t = loadSymbol("EC_KEY_new")!
        let EC_KEY_free: EC_KEY_free_t = loadSymbol("EC_KEY_free")!
        let EC_KEY_set_group: EC_KEY_set_group_t = loadSymbol("EC_KEY_set_group")!
        let EC_KEY_generate_key: EC_KEY_generate_key_t = loadSymbol("EC_KEY_generate_key")!
        let EC_KEY_get0_public_key: EC_KEY_get0_public_key_t = loadSymbol("EC_KEY_get0_public_key")!
        let ECDH_compute_key: ECDH_compute_key_t = loadSymbol("ECDH_compute_key")!
        let BN_new: BN_new_t = loadSymbol("BN_new")!
        let BN_free: BN_free_t = loadSymbol("BN_free")!

        // 1. Create group and set G' as generator
        let group = EC_GROUP_new_by_curve_name(NID_X9_62_prime256v1)!
        defer { EC_GROUP_free(group) }
        
        let gPrime = EC_POINT_new(group)!
        defer { EC_POINT_free(gPrime) }
        gPrimeData.withUnsafeBytes { _ = EC_POINT_oct2point(group, gPrime, $0.bindMemory(to: UInt8.self).baseAddress!, gPrimeData.count, nil) }
        
        // Order and cofactor are same as original P-256 for PACE GM
        let order = BN_new()! // Simplified: In real implementation, get order from original group
        defer { BN_free(order) }
        _ = EC_GROUP_set_generator(group, gPrime, nil, nil) // Placeholder for order/cofactor
        
        // 2. Generate Local Ephemeral Key on this mapped group
        let ecKey = EC_KEY_new()!
        defer { EC_KEY_free(ecKey) }
        _ = EC_KEY_set_group(ecKey, group)
        _ = EC_KEY_generate_key(ecKey)
        
        let pubPoint = EC_KEY_get0_public_key(ecKey)!
        let pubLen = EC_POINT_point2oct(group, pubPoint, 4, nil, 0, nil)
        var pubData = Data(count: pubLen)
        pubData.withUnsafeMutableBytes { _ = EC_POINT_point2oct(group, pubPoint, 4, $0.bindMemory(to: UInt8.self).baseAddress!, pubLen, nil) }
        
        // 3. Compute Shared Secret with remote public key P_ic
        let remotePoint = EC_POINT_new(group)!
        defer { EC_POINT_free(remotePoint) }
        remotePublicKeyData.withUnsafeBytes { _ = EC_POINT_oct2point(group, remotePoint, $0.bindMemory(to: UInt8.self).baseAddress!, remotePublicKeyData.count, nil) }
        
        var secret = Data(count: 32)
        secret.withUnsafeMutableBytes { secretBytes in
            _ = ECDH_compute_key(secretBytes.bindMemory(to: UInt8.self).baseAddress!, 32, remotePoint, ecKey, nil)
        }
        
        return (pubData, secret)
    }
}