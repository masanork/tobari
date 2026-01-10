use std::collections::HashMap;
use crate::apdu::ApduCommand;
use crate::crypto::pace::{PaceP256, PaceMappingType, derive_password_key, derive_session_keys_sha256};
use crate::crypto::sm::AesSecureMessaging;
use crate::mock::common::{MockBackend, MockSecureSession, der_wrap, build_tlv, extract_tlv_value};
use p256::{PublicKey, elliptic_curve::sec1::ToEncodedPoint};
use p256::ecdsa::{SigningKey, Signature as EcdsaSignature};
use signature::Signer;
use aes::cipher::{BlockEncryptMut, KeyIvInit, block_padding::NoPadding};
use cbc::Encryptor;
use aes::Aes128;
use rand_core::{OsRng, RngCore};

type Aes128CbcEnc = Encryptor<Aes128>;

pub struct PassportBackend {
    files: HashMap<Vec<u8>, Vec<u8>>,
    current_ef: Option<Vec<u8>>,
    password: String,
    pace_state: Option<PaceP256>,
    new_secure_session: Option<MockSecureSession>,
    aa_key: SigningKey,
    last_challenge: Vec<u8>,
}

impl PassportBackend {
    pub fn new(_password: &str) -> Self {
        let aa_key = SigningKey::random(&mut OsRng);
        let aa_pub_key = aa_key.verifying_key();
        let aa_spki = aa_pub_key.to_encoded_point(false).as_bytes().to_vec();

        let dg15_content = der_wrap(0x30, &vec![
             der_wrap(0x30, &hex::decode("06072a8648ce3d020106082a8648ce3d030107").unwrap()), 
             der_wrap(0x03, &vec![vec![0x00], aa_spki].concat()),
        ].concat());
        let dg15 = der_wrap(0x6F, &dg15_content);

        let mut files = HashMap::new();
        files.insert(vec![0x01, 0x0E], vec![0x31, 0x10, 0x30, 0x0E, 0x04, 0x0C, 0x01, 0x02, 0x03, 0x04]); 
        files.insert(vec![0x01, 0x0F], dg15.clone()); 
        
        let dg1_data = vec![0x61, 0x05, 0x5F, 0x1F, 0x02, 0x41, 0x42]; 
        files.insert(vec![0x01, 0x01], dg1_data.clone());
        
        let sod = Self::generate_mock_sod(vec![(1, dg1_data), (15, dg15)]);
        files.insert(vec![0x01, 0x1D], sod);
        
        Self {
            files,
            current_ef: None,
            password: "123456".to_string(),
            pace_state: Some(PaceP256::new("123456", PaceMappingType::GenericMapping, 16)),
            new_secure_session: None,
            aa_key,
            last_challenge: vec![0u8; 8],
        }
    }

    fn generate_mock_sod(dgs: Vec<(u8, Vec<u8>)>) -> Vec<u8> {
        use sha2::{Sha256, Digest};
        let mut hash_list = Vec::new();
        for (num, data) in dgs {
            let hash = Sha256::digest(&data);
            let item = der_wrap(0x30, &vec![
                der_wrap(0x02, &vec![num]), 
                der_wrap(0x04, &hash.to_vec()), 
            ].concat());
            hash_list.extend(item);
        }
        let lds = der_wrap(0x30, &vec![
            der_wrap(0x02, &vec![0x00]), 
            hex::decode("300d06096086480165030402010500").unwrap(), 
            der_wrap(0x30, &hash_list),
        ].concat());
        let lds_hash = Sha256::digest(&lds);
        let signed_attrs_inner = vec![
            der_wrap(0x30, &vec![
                der_wrap(0x06, &hex::decode("2A864886F70D010904").unwrap()), 
                der_wrap(0x31, &der_wrap(0x04, &lds_hash.to_vec())), 
            ].concat())
        ].concat();
        let signed_attrs = der_wrap(0xA0, &signed_attrs_inner);
        let signing_key = SigningKey::random(&mut OsRng);
        let verifying_key = signing_key.verifying_key();
        let mut verification_data = signed_attrs.clone();
        verification_data[0] = 0x31; 
        let signature: EcdsaSignature = signing_key.sign(&verification_data);
        let sig_der = signature.to_der();
        let spki = verifying_key.to_encoded_point(false).as_bytes().to_vec();
        let spki_der = der_wrap(0x30, &vec![
             der_wrap(0x30, &hex::decode("06072a8648ce3d020106052b8104000a").unwrap()), 
             der_wrap(0x03, &vec![vec![0x00], spki].concat()),
        ].concat());
        let tbs_cert = der_wrap(0x30, &vec![
             der_wrap(0xA0, &der_wrap(0x02, &vec![0x02])), 
             der_wrap(0x02, &vec![0x01]), 
             der_wrap(0x30, &hex::decode("06082a8648ce3d040302").unwrap()), 
             der_wrap(0x30, &vec![]), 
             der_wrap(0x30, &vec![der_wrap(0x17, b"260101000000Z"), der_wrap(0x17, b"260101000000Z")].concat()), 
             der_wrap(0x30, &vec![]), 
             spki_der,
        ].concat());
        let dummy_cert = der_wrap(0x30, &vec![
             tbs_cert,
             der_wrap(0x30, &hex::decode("06082a8648ce3d040302").unwrap()), 
             der_wrap(0x03, &vec![0x00; 65]), 
        ].concat());
        let encap_content = der_wrap(0x30, &vec![
            der_wrap(0x06, &hex::decode("2A864886F70D010919").unwrap()), 
            der_wrap(0xA0, &der_wrap(0x04, &lds)), 
        ].concat());
        let signer_info = der_wrap(0x30, &vec![
            der_wrap(0x02, &vec![0x01]), 
            der_wrap(0x30, &vec![der_wrap(0x30, &vec![]), der_wrap(0x02, &vec![0x01])].concat()), 
            der_wrap(0x30, &hex::decode("06096086480165030402010500").unwrap()), 
            signed_attrs,
            der_wrap(0x30, &hex::decode("06082a8648ce3d040302").unwrap()), 
            der_wrap(0x04, &sig_der.to_bytes()), 
        ].concat());
        let signed_data_inner = vec![
            der_wrap(0x02, &vec![0x03]), 
            der_wrap(0x31, &vec![]), 
            encap_content,
            der_wrap(0xA0, &dummy_cert), 
            der_wrap(0x31, &signer_info), 
        ].concat();
        let signed_data = der_wrap(0x30, &signed_data_inner);
        der_wrap(0x30, &vec![
            der_wrap(0x06, &hex::decode("2A864886F70D010702").unwrap()), 
            der_wrap(0xA0, &signed_data),
        ].concat())
    }
}

impl MockBackend for PassportBackend {
    fn get_secure_session(&mut self) -> Option<MockSecureSession> {
        self.new_secure_session.take()
    }

    fn handle_apdu(&mut self, cmd: &ApduCommand, _aid: &[u8]) -> (Vec<u8>, u16) {
        match cmd.ins {
            0xA4 => {
                self.current_ef = Some(cmd.data.clone());
                (vec![], 0x9000)
            },
            0xB0 => {
                if let Some(ef) = &self.current_ef {
                    if let Some(data) = self.files.get(ef) {
                        let offset = ((cmd.p1 as usize) << 8) | (cmd.p2 as usize);
                        if offset >= data.len() { (vec![], 0x6B00) }
                        else { (data[offset..].to_vec(), 0x9000) }
                    } else { (vec![], 0x6A82) }
                } else { (vec![], 0x6986) }
            },
            0x84 => { 
                let mut rnd = vec![0u8; 8];
                OsRng.fill_bytes(&mut rnd);
                self.last_challenge = rnd.clone();
                (rnd, 0x9000) 
            },
            0x82 => {
                use crate::crypto::bac;
                let k_seed = bac::derive_key_seed("123456");
                let (k_enc, k_mac) = bac::derive_session_keys(&k_seed);
                
                let rnd_icc: [u8; 8] = self.last_challenge.clone().try_into().unwrap_or([0u8; 8]);
                match bac::mock_mutual_auth_response(&k_enc, &k_mac, &cmd.data, &rnd_icc) {
                    Ok((resp_data, ssc)) => {
                        let s = bac::BacSession::new(k_enc, k_mac, ssc);
                        self.new_secure_session = Some(MockSecureSession::Bac(s));
                        (resp_data, 0x9000)
                    },
                    Err(_) => (vec![], 0x6300),
                }
            },
            0x88 => { // INTERNAL AUTHENTICATE
                if cmd.data.len() != 8 { return (vec![], 0x6700); }
                let signature: EcdsaSignature = self.aa_key.sign(&cmd.data);
                (signature.to_vec(), 0x9000)
            },
            0x22 => (vec![], 0x9000),
            0x86 => {
                if cmd.data.len() >= 2 && cmd.data[0] == 0x7C {
                    let inner_tag = if cmd.data.len() > 2 { cmd.data[2] } else { 0 };
                    match inner_tag {
                        0x00 => {
                            let nonce = [0x11u8; 16];
                            let k_pi = derive_password_key(&self.password);
                            let encryptor = <Aes128CbcEnc as KeyIvInit>::new(&k_pi.into(), &[0u8; 16].into());
                            let mut nonce_buf = nonce.to_vec();
                            let _ = encryptor.encrypt_padded_mut::<NoPadding>(&mut nonce_buf, 16).unwrap();
                            if let Some(pace) = &mut self.pace_state { 
                                pace.set_encrypted_nonce(&nonce_buf); 
                            }
                            (build_tlv(0x80, &nonce_buf), 0x9000)
                        },
                        0x81 => {
                            if let Some(pace) = &mut self.pace_state {
                                let server_pk = pace.perform_mapping_and_generate_key().unwrap();
                                let pcd_pk = extract_tlv_value(&cmd.data, 0x81).unwrap_or_default();
                                if !pcd_pk.is_empty() { pace.compute_shared_secret(&pcd_pk).unwrap(); }
                                (build_tlv(0x82, &server_pk), 0x9000)
                            } else { (vec![], 0x6A80) }
                        },
                        0x85 => {
                            if let Some(pace) = &mut self.pace_state {
                                let pcd_token = extract_tlv_value(&cmd.data, 0x85).unwrap_or_default();
                                let server_token = pace.perform_token_exchange(&pcd_token).unwrap();
                                let session = pace.finalize_session().unwrap();
                                self.new_secure_session = Some(MockSecureSession::Pace(AesSecureMessaging::new(&session.k_enc, &session.k_mac, session.ssc).unwrap()));
                                (build_tlv(0x86, &server_token), 0x9000)
                            } else { (vec![], 0x6A80) }
                        },
                        0x80 => {
                            let pcd_pk_bytes = extract_tlv_value(&cmd.data, 0x80).unwrap_or_default();
                            if !pcd_pk_bytes.is_empty() {
                                let pcd_pk = PublicKey::from_sec1_bytes(&pcd_pk_bytes).unwrap();
                                let shared_point = pcd_pk.to_projective();
                                let shared_bytes = shared_point.to_affine().to_encoded_point(false).x().unwrap().to_vec();
                                let (k_enc, k_mac) = derive_session_keys_sha256(&shared_bytes, 16);
                                self.new_secure_session = Some(MockSecureSession::Pace(AesSecureMessaging::new(&k_enc, &k_mac, 0).unwrap()));
                                (vec![], 0x9000)
                            } else { (vec![], 0x6A80) }
                        },
                        _ => (vec![], 0x6A88),
                    }
                } else { (vec![], 0x6A80) }
            }
            _ => (vec![], 0x6D00),
        }
    }
}
