use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use tauri::command;
use crate::models::{SignerError, MyNumberCardRequest, MyNumberCardData, PassportReadRequest, PassportData, DriverLicenseRequest, DriverLicenseData, JpkiSignRequest, UnifiedRequest, UnifiedResponse, ReadCardParams};
use crate::utils::{debug_log, convert_jp2_if_needed};
use civ::{
    jpki::JpkiController, 
    passport::PassportController, 
    jpdl::DriversLicenseController, 
    jprc::ResidenceCardController, 
    native_reader::PcscReader,
    reader::CardReader
};

#[cfg(not(target_arch = "wasm32"))]
#[command]
pub async fn detect_card_type() -> Result<String, SignerError> {
    let mut reader = PcscReader::new().map_err(|e| SignerError::Jpki(e.to_string()))?;

    // JPKI AP (Attributes)
    if let Ok(res) = reader.transmit(&[0x00, 0xA4, 0x04, 0x0C, 0x0A, 0xD3, 0x92, 0xF0, 0x00, 0x26, 0x01, 0x00, 0x00, 0x00, 0x01]).await {
        if res.len() >= 2 && res[res.len()-2] == 0x90 && res[res.len()-1] == 0x00 {
            return Ok("jpki".to_string());
        }
    }

    // Passport (ICAO)
    if let Ok(res) = reader.transmit(&[0x00, 0xA4, 0x04, 0x0C, 0x07, 0xA0, 0x00, 0x00, 0x02, 0x47, 0x10, 0x01]).await {
        if res.len() >= 2 && res[res.len()-2] == 0x90 && res[res.len()-1] == 0x00 {
            return Ok("passport".to_string());
        }
    }

    // Driver License
    if let Ok(res) = reader.transmit(&[0x00, 0xA4, 0x04, 0x0C, 0x10, 0xA0, 0x00, 0x00, 0x02, 0x31, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x07]).await {
         if res.len() >= 2 && res[res.len()-2] == 0x90 && res[res.len()-1] == 0x00 {
            return Ok("license".to_string());
        }
    }

    // Residence Card
    if let Ok(res) = reader.transmit(&[0x00, 0xA4, 0x04, 0x0C, 0x06, 0xA0, 0x00, 0x00, 0x02, 0x31, 0x02]).await {
         if res.len() >= 2 && res[res.len()-2] == 0x90 && res[res.len()-1] == 0x00 {
            return Ok("residence".to_string());
        }
    }

    Ok("unknown".to_string())
}

#[cfg(not(target_arch = "wasm32"))]
#[command]
pub async fn jpki_sign(app: tauri::AppHandle, request: JpkiSignRequest) -> Result<(), SignerError> {
    let reader: PcscReader = PcscReader::new().map_err(|e| SignerError::Jpki(e.to_string()))?;
    let mut controller: JpkiController<PcscReader> = JpkiController::new(reader);

    controller.select_jpki_ap().await.map_err(SignerError::from)?;

    let challenge_bytes = URL_SAFE_NO_PAD.decode(&request.challenge).map_err(|e| SignerError::Internal(e.to_string()))?;
    
    let signature = controller
        .compute_auth_signature(&request.pin, &challenge_bytes)
        .await
        .map_err(SignerError::from)?;
    
    let response = crate::models::SignResponse {
        signature: URL_SAFE_NO_PAD.encode(&signature),
        auth_data: None,
        client_data_json: None,
        public_key: None,
    };

    println!("{}", serde_json::to_string(&response).map_err(|e| SignerError::Serialization(e.to_string()))?);
    app.exit(0);
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
#[command]
pub async fn read_my_number_card(request: MyNumberCardRequest) -> Result<MyNumberCardData, SignerError> {
    read_my_number_card_internal(request.pin, true, true).await
}

pub async fn read_my_number_card_internal(pin: String, include_my_number: bool, include_face_photo: bool) -> Result<MyNumberCardData, SignerError> {
    let reader: PcscReader = PcscReader::new().map_err(|e| SignerError::Jpki(e.to_string()))?;
    let mut controller = JpkiController::new(reader);

    let my_number = if include_my_number {
        controller.read_mynumber(&pin).await.map_err(SignerError::from)?
    } else {
        "".to_string()
    };

    let info = controller
        .read_attributes(&pin)
        .await
        .map_err(SignerError::from)?;
    
    let (face_photo, face_photo_format) = if include_face_photo {
        let from_mynumber = if !my_number.is_empty() {
            match controller.read_face_photo(&my_number).await {
                Ok(photo) => Some(photo),
                Err(_) => None
            }
        } else {
            None
        };
        
        let photo = match from_mynumber {
            Some(photo) => Some(photo),
            None => {
                match controller.read_face_photo(&pin).await {
                    Ok(photo) => Some(photo),
                    Err(_) => None
                }
            }
        };
        
        if let Some(raw) = photo {
            let (converted, format) = convert_jp2_if_needed(raw);
            (
                Some(URL_SAFE_NO_PAD.encode(converted)),
                format.map(|f| f.to_string()),
            )
        } else {
            (None, None)
        }
    } else {
        (None, None)
    };
    
    let auth_cert = controller.read_auth_cert().await.ok();
    let sign_cert = controller.read_sign_cert().await.ok();
    let auth_ca = controller.read_ef_full(&[0x00, 0x0B]).await.ok();
    let sign_ca = controller.read_ef_full(&[0x00, 0x02]).await.ok();

    Ok(MyNumberCardData {
        name: info.name,
        address: info.address,
        birth_date: info.birth_date,
        gender: info.gender,
        my_number,
        face_photo,
        face_photo_format,
        auth_cert: auth_cert.map(|d| URL_SAFE_NO_PAD.encode(d)),
        sign_cert: sign_cert.map(|d| URL_SAFE_NO_PAD.encode(d)),
        auth_ca_cert: auth_ca.map(|d| URL_SAFE_NO_PAD.encode(d)),
        sign_ca_cert: sign_ca.map(|d| URL_SAFE_NO_PAD.encode(d)),
    })
}

#[cfg(not(target_arch = "wasm32"))]
#[command]
pub async fn read_passport(request: PassportReadRequest) -> Result<PassportData, SignerError> {
    read_passport_internal(request.mrz).await
}

pub async fn read_passport_internal(mrz: String) -> Result<PassportData, SignerError> {
    debug_log("Passport: Starting connection...");
    let reader: PcscReader = PcscReader::new().map_err(|e| SignerError::Jpki(e.to_string()))?;
    let mut controller = PassportController::new(reader);

    debug_log("Passport: Selecting ICAO applet...");
    controller.select_ep_ap().await.map_err(|e| SignerError::Jpki(format!("Select AP failed: {}", e)))?;
    
    let mrz_key = normalize_mrz_for_bac(&mrz)?;
    debug_log(&format!("Passport: BAC Key generated (len={})", mrz_key.len()));
    
    debug_log("Passport: Performing BAC authentication...");
    controller.perform_bac(&mrz_key).await.map_err(|e| SignerError::Jpki(format!("BAC failed: {}", e)))?;
    
    debug_log("Passport: BAC Success. Reading DG1...");
    let dg1 = controller.read_dg1().await.map_err(|e| SignerError::Jpki(format!("Read DG1 failed: {}", e)))?;
    
    debug_log(&format!("Passport: DG1 read ({} bytes). Reading DG2...", dg1.len()));
    let dg2 = controller.read_dg2().await.map_err(|e| SignerError::Jpki(format!("Read DG2 failed: {}", e)))?;
    
    debug_log(&format!("Passport: DG2 read ({} bytes). Reading SOD/others...", dg2.len()));
    let sod = controller.read_sod().await.ok();
    let dg11 = controller.read_dg11().await.ok();
    let dg12 = controller.read_dg12().await.ok();
    let dg14 = controller.read_dg14().await.ok();
    let dg15 = controller.read_dg15().await.ok();

    let mrz_text = extract_mrz_from_dg1(&dg1);
    let parsed = mrz_text
        .as_deref()
        .and_then(|m| civ::utils::MrzUtils::parse_mrz_td3(m).ok());

    let (face_photo, face_photo_format) = extract_photo_from_dg2(&dg2)
        .map(|raw| {
            let (converted, format) = convert_jp2_if_needed(raw);
            (Some(URL_SAFE_NO_PAD.encode(converted)), format.map(|f| f.to_string()))
        })
        .unwrap_or((None, None));

    Ok(PassportData {
        dg1: URL_SAFE_NO_PAD.encode(dg1),
        dg2: URL_SAFE_NO_PAD.encode(dg2),
        mrz: mrz_text,
        name: parsed.as_ref().map(|p| p.full_name.clone()),
        passport_number: parsed.as_ref().map(|p| p.identity_number.clone()),
        birth_date: parsed.as_ref().map(|p| p.birth_date.clone()),
        expiry_date: parsed.as_ref().and_then(|p| p.expiration_date.clone()),
        gender: parsed.as_ref().map(|p| p.gender.clone()),
        nationality: parsed.as_ref().and_then(|p| p.issuing_authority.clone()),
        face_photo,
        face_photo_format,
        sod: sod.map(|d| URL_SAFE_NO_PAD.encode(d)),
        dg11: dg11.map(|d| URL_SAFE_NO_PAD.encode(d)),
        dg12: dg12.map(|d| URL_SAFE_NO_PAD.encode(d)),
        dg14: dg14.map(|d| URL_SAFE_NO_PAD.encode(d)),
        dg15: dg15.map(|d| URL_SAFE_NO_PAD.encode(d)),
    })
}

#[cfg(not(target_arch = "wasm32"))]
#[command]
pub async fn read_driver_license(request: DriverLicenseRequest) -> Result<DriverLicenseData, SignerError> {
    let reader: PcscReader = PcscReader::new().map_err(|e| SignerError::Jpki(e.to_string()))?;
    let mut controller = DriversLicenseController::new(reader);

    controller.select_dl_ap().await.map_err(|e| SignerError::Jpki(e.to_string()))?;
    controller.verify_pin1(&request.pin1).await.map_err(SignerError::from)?;
    controller.verify_pin2(&request.pin2).await.map_err(SignerError::from)?;
    controller.select_dl_ap().await.map_err(|e| SignerError::Jpki(format!("Failed to re-select DL AP: {}", e)))?;

    let raw_dg1 = controller.read_ef_full(&[0x00, 0x01]).await
        .map_err(|e| SignerError::Jpki(format!("Failed to read EF01: {}", e)))?;
    
    if raw_dg1.is_empty() {
        return Err(SignerError::Jpki("Read EF01 but it was empty".to_string()));
    }

    let info = controller.parse_common_data(&raw_dg1).map_err(SignerError::from)?;
    let signature = controller.read_signature().await.ok();
    let face_photo_raw = controller.read_photo().await.ok();
    
    let (face_photo, face_photo_format) = face_photo_raw
        .map(|d| {
            let (converted, format) = convert_jp2_if_needed(d);
            (Some(URL_SAFE_NO_PAD.encode(converted)), format.map(|f| f.to_string()))
        })
        .unwrap_or((None, None));

    Ok(DriverLicenseData {
        name: info.name,
        name_kana: info.name_kana,
        address: info.address,
        birth_date: info.birth_date,
        license_number: info.license_number,
        issue_date: info.issue_date,
        expire_date: info.expire_date,
        face_photo,
        face_photo_format,
        signature: signature.map(|d| URL_SAFE_NO_PAD.encode(d)),
        raw_data_group1: Some(URL_SAFE_NO_PAD.encode(raw_dg1)),
    })
}

#[cfg(not(target_arch = "wasm32"))]
#[command]
pub async fn read_residence_card() -> Result<serde_json::Value, SignerError> {
    let reader: PcscReader = PcscReader::new().map_err(|e| SignerError::Jpki(e.to_string()))?;
    let mut controller = ResidenceCardController::new(reader);

    controller.select_df2().await.map_err(|e| SignerError::Jpki(e.to_string()))?;
    let info = controller.read_df2_info().await.map_err(SignerError::from)?;

    Ok(serde_json::to_value(&info).unwrap())
}

pub async fn handle_read_card(request: &UnifiedRequest) -> UnifiedResponse {
    let params: ReadCardParams = match serde_json::from_value(request.params.clone()) {
        Ok(p) => p,
        Err(e) => return UnifiedResponse::error(&request.command, "InvalidRequest", &e.to_string()),
    };

    match params.card_type.as_str() {
        "jpki" => {
            let pin = params.pin.clone().unwrap_or_default();
            if pin.is_empty() { return UnifiedResponse::error(&request.command, "InvalidRequest", "PIN required"); }
            match read_my_number_card_internal(pin, params.include_my_number.unwrap_or(false), params.include_face_photo.unwrap_or(false)).await {
                Ok(data) => UnifiedResponse::success(&request.command, "cardData", "json", serde_json::to_value(&data).unwrap(), Some(serde_json::json!({"cardType": "jpki"}))),
                Err(e) => UnifiedResponse::error(&request.command, "InternalError", &e.to_string()),
            }
        },
        "passport" => {
            let mrz = params.mrz.clone().unwrap_or_default();
            if mrz.is_empty() { return UnifiedResponse::error(&request.command, "InvalidRequest", "MRZ required"); }
            match read_passport_internal(mrz).await {
                Ok(data) => UnifiedResponse::success(&request.command, "cardData", "json", serde_json::to_value(&data).unwrap(), Some(serde_json::json!({"cardType": "passport"}))),
                Err(e) => UnifiedResponse::error(&request.command, "InternalError", &e.to_string()),
            }
        },
        _ => UnifiedResponse::error(&request.command, "Unsupported", "Card type not supported"),
    }
}

// --- Passport Helpers ---

fn extract_mrz_from_dg1(dg1: &[u8]) -> Option<String> {
    fn find_mrz_tlv(tlvs: &[civ::utils::BerTlv]) -> Option<Vec<u8>> {
        for tlv in tlvs {
            if tlv.tag == 0x5F1F {
                return Some(tlv.value.clone());
            }
            if let Some(value) = find_mrz_tlv(&tlv.children) {
                return Some(value);
            }
        }
        None
    }

    if let Ok(tlvs) = civ::utils::parse_ber_tlv(dg1) {
        if let Some(value) = find_mrz_tlv(&tlvs) {
            let mut mrz = String::from_utf8_lossy(&value).to_string();
            mrz = mrz.replace('\r', "").replace('\n', "");
            if mrz.len() == 88 {
                mrz.insert(44, '\n');
            }
            return Some(mrz);
        }
    }

    let needle_td3 = [b'P', b'<'];
    let needle_td1 = [b'I', b'<'];
    let pos = dg1.windows(2).position(|w| w == needle_td3 || w == needle_td1)?;
    let slice = &dg1[pos..];
    let mut mrz: String = slice.iter().map(|b| if b.is_ascii() { *b as char } else { ' ' }).collect();
    mrz = mrz.replace('\r', "").replace('\n', "");
    if mrz.len() >= 90 { mrz.truncate(90); }
    else if mrz.len() >= 88 { mrz.truncate(88); }
    if mrz.len() == 88 { mrz.insert(44, '\n'); }
    Some(mrz)
}

fn extract_photo_from_dg2(dg2: &[u8]) -> Option<Vec<u8>> {
    let jpeg_sig = [0xFF, 0xD8, 0xFF];
    if let Some(pos) = dg2.windows(jpeg_sig.len()).position(|w| w == jpeg_sig) {
        return Some(dg2[pos..].to_vec());
    }
    let jp2_sig = [0x00, 0x00, 0x00, 0x0C, 0x6A, 0x50, 0x20, 0x20];
    if let Some(pos) = dg2.windows(jp2_sig.len()).position(|w| w == jp2_sig) {
        return Some(dg2[pos..].to_vec());
    }
    let j2k_sig = [0xFF, 0x4F];
    if let Some(pos) = dg2.windows(j2k_sig.len()).position(|w| w == j2k_sig) {
        return Some(dg2[pos..].to_vec());
    }
    None
}

fn normalize_mrz_for_bac(input: &str) -> Result<String, SignerError> {
    let trimmed = input.trim();
    let normalized_input = trimmed
        .replace('\r', "\n")
        .replace(' ', "")
        .replace('\t', "")
        .to_ascii_uppercase();

    let lines: Vec<&str> = normalized_input
        .lines()
        .filter(|l| !l.trim().is_empty())
        .collect();

    if lines.len() == 2 {
        let mut line2 = lines[1].to_string();
        if line2.len() < 44 {
            line2.push_str(&"<".repeat(44 - line2.len()));
        }
        if line2.len() >= 44 {
            let line2 = line2.as_str();
            let doc_no = line2[0..9].to_string();
            let birth = line2[13..19].to_string();
            let expiry = line2[21..27].to_string();
            return Ok(format_bac_key(&doc_no, &birth, &expiry));
        }
    }

    if lines.len() == 3 {
        let mut line1 = lines[0].to_string();
        let mut line2 = lines[1].to_string();
        if line1.len() < 30 {
            line1.push_str(&"<".repeat(30 - line1.len()));
        }
        if line2.len() < 30 {
            line2.push_str(&"<".repeat(30 - line2.len()));
        }
        if line1.len() >= 30 && line2.len() >= 30 {
            let line1 = line1.as_str();
            let line2 = line2.as_str();
            let doc_no = line1[0..9].to_string();
            let birth = line2[0..6].to_string();
            let expiry = line2[8..14].to_string();
            return Ok(format_bac_key(&doc_no, &birth, &expiry));
        }
    }

    if lines.len() == 1 {
        let line = lines[0];
        if line.len() >= 88 && line.starts_with("P<") {
            let slice = &line[0..88];
            let line2 = &slice[44..88];
            let doc_no = line2[0..9].to_string();
            let birth = line2[13..19].to_string();
            let expiry = line2[21..27].to_string();
            return Ok(format_bac_key(&doc_no, &birth, &expiry));
        } else if line.len() >= 90 {
            let slice = &line[0..90];
            let line1 = &slice[0..30];
            let line2 = &slice[30..60];
            let doc_no = line1[0..9].to_string();
            let birth = line2[0..6].to_string();
            let expiry = line2[8..14].to_string();
            return Ok(format_bac_key(&doc_no, &birth, &expiry));
        }
    }

    let cleaned: String = normalized_input
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '<')
        .collect();

    if cleaned.len() == 24 {
        return Ok(cleaned);
    }

    let (doc_no, birth, expiry) = if cleaned.len() == 21 {
        (
            cleaned[0..9].to_string(),
            cleaned[9..15].to_string(),
            cleaned[15..21].to_string(),
        )
    } else if cleaned.len() == 20 {
        let mut doc = cleaned[0..8].to_string();
        doc.push('<');
        (
            doc,
            cleaned[8..14].to_string(),
            cleaned[14..20].to_string(),
        )
    } else {
        return Err(SignerError::Jpki(
            "Invalid MRZ length. Expected 20, 21, or 24 characters.".to_string(),
        ));
    };

    Ok(format_bac_key(&doc_no, &birth, &expiry))
}

fn format_bac_key(doc_no: &str, birth: &str, expiry: &str) -> String {
    let doc_cd = civ::utils::MrzUtils::calculate_check_digit(doc_no) as char;
    let birth_cd = civ::utils::MrzUtils::calculate_check_digit(birth) as char;
    let expiry_cd = civ::utils::MrzUtils::calculate_check_digit(expiry) as char;
    format!("{}{}{}{}{}{}", doc_no, doc_cd, birth, birth_cd, expiry, expiry_cd)
}