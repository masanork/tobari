/// ICAO 9303 Applet AID
pub const DF_ICAO: [u8; 7] = [0xA0, 0x00, 0x00, 0x02, 0x47, 0x10, 0x01];

/// EF.COM (Common Data)
pub const EF_COM: [u8; 2] = [0x01, 0x1E];
/// EF.DG1 (MRZ)
pub const EF_DG1: [u8; 2] = [0x01, 0x01];
/// EF.DG2 (Photo)
pub const EF_DG2: [u8; 2] = [0x01, 0x02];
/// EF.DG3 (Fingerprints)
pub const EF_DG3: [u8; 2] = [0x01, 0x03];
/// EF.DG4 (Iris)
pub const EF_DG4: [u8; 2] = [0x01, 0x04];
/// EF.DG11 (Additional Personal Details - Address, etc.)
pub const EF_DG11: [u8; 2] = [0x01, 0x0B];
/// EF.DG12 (Additional Document Details)
pub const EF_DG12: [u8; 2] = [0x01, 0x0C];
/// EF.DG14 (Security Infos / Chip Authentication Info)
pub const EF_DG14: [u8; 2] = [0x01, 0x0E];
/// EF.DG15 (Active Authentication Public Key Info)
pub const EF_DG15: [u8; 2] = [0x01, 0x0F];
/// EF.SOD (Security Object Document - Signed hashes of all DGs)
pub const EF_SOD: [u8; 2] = [0x01, 0x1D];
