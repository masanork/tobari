use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde_json;
use crate::models::SignerError;
use uuid;

pub fn get_tobari_home() -> std::path::PathBuf {
    if let Ok(env_path) = std::env::var("TOBARI_HOME") {
        return std::path::PathBuf::from(env_path);
    }
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from("."));

    #[cfg(target_os = "macos")]
    {
        home.join("Documents").join("Tobari")
    }
    #[cfg(target_os = "windows")]
    {
        home.join("Documents").join("Tobari")
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        home.join(".tobari")
    }
}

pub fn debug_log(message: &str) {
    if std::env::var("TOBARI_DEBUG").ok().as_deref() == Some("1") {
        println!("DEBUG: {}", message);
    }
}

pub fn cbor_to_json(val: ciborium::value::Value) -> serde_json::Value {
    match val {
        ciborium::value::Value::Text(s) => serde_json::Value::String(s),
        ciborium::value::Value::Integer(i) => {
            let i_128: i128 = i.into();
            serde_json::Value::Number(serde_json::Number::from(i_128 as i64))
        }
        ciborium::value::Value::Bool(b) => serde_json::Value::Bool(b),
        ciborium::value::Value::Array(arr) => {
            serde_json::Value::Array(arr.into_iter().map(cbor_to_json).collect())
        }
        ciborium::value::Value::Map(map) => {
            let mut obj = serde_json::Map::new();
            for (k, v) in map {
                if let Some(key_text) = k.as_text() {
                    obj.insert(key_text.to_string(), cbor_to_json(v));
                }
            }
            serde_json::Value::Object(obj)
        }
        ciborium::value::Value::Bytes(b) => serde_json::Value::String(format!("(binary:{}bytes)", b.len())),
        _ => serde_json::Value::Null,
    }
}

pub fn unwrap_cbor(val: ciborium::value::Value) -> ciborium::value::Value {
    match val {
        ciborium::value::Value::Tag(_tag, box_val) => unwrap_cbor(*box_val),
        _ => val,
    }
}

pub fn inspect_cbor_bytes(data: &[u8]) -> serde_json::Value {
    match ciborium::from_reader::<ciborium::value::Value, _>(data) {
        Ok(value) => inspect_cbor_value(value),
        Err(_) => {
            if let Ok(s) = String::from_utf8(data.to_vec()) {
                serde_json::Value::String(s)
            } else {
                let b64 = URL_SAFE_NO_PAD.encode(data);
                serde_json::json!({
                    "raw_bytes": b64,
                    "length": data.len()
                })
            }
        }
    }
}

pub fn inspect_cbor_value(val: ciborium::value::Value) -> serde_json::Value {
    match val {
        ciborium::value::Value::Integer(i) => {
            let i_val: i128 = i.into();
            if let Ok(v) = i8::try_from(i_val) { serde_json::Value::Number(v.into()) }
            else if let Ok(v) = i16::try_from(i_val) { serde_json::Value::Number(v.into()) }
            else if let Ok(v) = i32::try_from(i_val) { serde_json::Value::Number(v.into()) }
            else if let Ok(v) = i64::try_from(i_val) { serde_json::Value::Number(v.into()) }
            else { serde_json::Value::String(i_val.to_string()) }
        },
        ciborium::value::Value::Bytes(b) => {
            if b.len() > 2 {
                if let Ok(inner) = ciborium::from_reader::<ciborium::value::Value, _>(b.as_slice()) {
                    return inspect_cbor_value(inner);
                }
            }
            serde_json::Value::String(URL_SAFE_NO_PAD.encode(b))
        },
        ciborium::value::Value::Text(s) => serde_json::Value::String(s),
        ciborium::value::Value::Array(arr) => {
            serde_json::Value::Array(arr.into_iter().map(inspect_cbor_value).collect())
        },
        ciborium::value::Value::Map(map) => {
            let mut obj = serde_json::Map::new();
            for (k, v) in map {
                let key_str = match k {
                    ciborium::value::Value::Text(s) => s,
                    ciborium::value::Value::Integer(i) => {
                        let i_val: i128 = i.into();
                        i_val.to_string()
                    },
                    _ => "complex_key".to_string(),
                };
                obj.insert(key_str, inspect_cbor_value(v));
            }
            serde_json::Value::Object(obj)
        },
        ciborium::value::Value::Tag(_tag, inner) => {
            inspect_cbor_value(*inner)
        },
        ciborium::value::Value::Float(f) => {
             serde_json::Number::from_f64(f).map(serde_json::Value::Number).unwrap_or(serde_json::Value::Null)
        },
        ciborium::value::Value::Bool(b) => serde_json::Value::Bool(b),
        ciborium::value::Value::Null => serde_json::Value::Null,
        _ => serde_json::Value::String("Unknown CBOR Type".to_string()),
    }
}

// --- Image Utils ---

pub fn is_jpeg(data: &[u8]) -> bool {
    data.len() >= 3 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF
}

pub fn is_jp2(data: &[u8]) -> bool {
    let sig = [0x00, 0x00, 0x00, 0x0C, 0x6A, 0x50, 0x20, 0x20];
    data.windows(sig.len()).any(|w| w == sig)
}

pub fn is_j2k_codestream(data: &[u8]) -> bool {
    data.len() >= 2 && data[0] == 0xFF && data[1] == 0x4F
}

pub fn normalize_jp2_payload(data: Vec<u8>) -> Vec<u8> {
    if let Some(offset) = find_jp2_signature_offset(&data) {
        return data[offset..].to_vec();
    }
    if let Some(offset) = find_j2k_soc_offset(&data) {
        return data[offset..].to_vec();
    }
    data
}

fn find_jp2_signature_offset(data: &[u8]) -> Option<usize> {
    let sig = [0x00, 0x00, 0x00, 0x0C, 0x6A, 0x50, 0x20, 0x20, 0x0D, 0x0A, 0x87, 0x0A];
    data.windows(sig.len()).position(|w| w == sig)
}

fn find_j2k_soc_offset(data: &[u8]) -> Option<usize> {
    data.windows(2).position(|w| w[0] == 0xFF && w[1] == 0x4F)
}

pub fn convert_jp2_if_needed(data: Vec<u8>) -> (Vec<u8>, Option<&'static str>) {
    if is_jpeg(&data) {
        return (data, Some("jpeg"));
    }

    let mut source = normalize_jp2_payload(data);
    if is_j2k_codestream(&source) && !is_jp2(&source) {
        if let Some(wrapped) = wrap_j2k_as_jp2(&source) {
            source = wrapped;
        }
    }

    #[cfg(target_os = "macos")]
    {
        match convert_jp2_to_jpeg(&source) {
            Ok(jpeg) => {
                debug_log(&format!("JP2 converted to JPEG: {} bytes", jpeg.len()));
                return (jpeg, Some("jpeg"));
            }
            Err(err) => {
                debug_log(&format!("JP2 conversion failed: {}", err));
            }
        }
    }

    let fallback_format = if is_jp2(&source) || is_j2k_codestream(&source) {
        Some("jp2")
    } else {
        None
    };

    (source, fallback_format)
}

#[cfg(target_os = "macos")]
fn convert_jp2_to_jpeg(data: &[u8]) -> Result<Vec<u8>, SignerError> {
    use std::process::Command;

    let temp_dir = std::env::temp_dir();
    let id = uuid::Uuid::new_v4().to_string();
    let output_path = temp_dir.join(format!("tobari-dl-{}.jpg", id));

    let candidates = if is_j2k_codestream(data) {
        vec!["j2k", "jp2"]
    } else if is_jp2(data) {
        vec!["jp2", "j2k"]
    } else {
        vec!["j2k", "jp2"]
    };

    let mut last_err: Option<String> = None;

    for ext in candidates {
        let input_path = temp_dir.join(format!("tobari-dl-{}.{}", id, ext));
        std::fs::write(&input_path, data).map_err(|e| {
            SignerError::Internal(format!("Failed to write {} temp file: {e}", ext))
        })?;

        let input_str = input_path
            .to_str()
            .ok_or_else(|| SignerError::Internal("Failed to format JP2 temp path".to_string()))?;
        let output_str = output_path
            .to_str()
            .ok_or_else(|| SignerError::Internal("Failed to format JPEG temp path".to_string()))?;

        let output = Command::new("/usr/bin/sips")
            .args(["-s", "format", "jpeg", input_str, "--out", output_str])
            .output()
            .map_err(|e| SignerError::Internal(format!("Failed to run sips: {e}")))?;

        let _ = std::fs::remove_file(&input_path);

        if output.status.success() {
            let jpeg = std::fs::read(&output_path)
                .map_err(|e| SignerError::Internal(format!("Failed to read JPEG output: {e}")))?;
            let _ = std::fs::remove_file(&output_path);
            return Ok(jpeg);
        }

        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        last_err = Some(format!("sips failed for .{}: {}", ext, stderr));
    }

    Err(SignerError::Internal(
        last_err.unwrap_or_else(|| "sips failed".to_string()),
    ))
}

fn wrap_j2k_as_jp2(codestream: &[u8]) -> Option<Vec<u8>> {
    let (width, height, components, bpc) = parse_j2k_siz(codestream)?;

    let mut jp2 = Vec::new();
    jp2.extend_from_slice(&jp2_signature_box());
    jp2.extend_from_slice(&jp2_file_type_box());
    jp2.extend_from_slice(&jp2_header_box(width, height, components, bpc));
    jp2.extend_from_slice(&jp2_codestream_box(codestream));
    Some(jp2)
}

fn parse_j2k_siz(data: &[u8]) -> Option<(u32, u32, u16, u8)> {
    let mut i = 0;
    while i + 4 < data.len() {
        if data[i] == 0xFF && data[i + 1] == 0x51 {
            if i + 4 >= data.len() {
                return None;
            }
            let lsiz = u16::from_be_bytes([data[i + 2], data[i + 3]]) as usize;
            if i + 2 + lsiz > data.len() || lsiz < 38 {
                return None;
            }
            let base = i + 4;
            let xsiz = u32::from_be_bytes([data[base + 2], data[base + 3], data[base + 4], data[base + 5]]);
            let ysiz = u32::from_be_bytes([data[base + 6], data[base + 7], data[base + 8], data[base + 9]]);
            let xosiz = u32::from_be_bytes([data[base + 10], data[base + 11], data[base + 12], data[base + 13]]);
            let yosiz = u32::from_be_bytes([data[base + 14], data[base + 15], data[base + 16], data[base + 17]]);
            let csiz = u16::from_be_bytes([data[base + 30], data[base + 31]]);

            let width = xsiz.saturating_sub(xosiz);
            let height = ysiz.saturating_sub(yosiz);
            if width == 0 || height == 0 || csiz == 0 {
                return None;
            }

            let first_ssiz_offset = base + 32;
            if first_ssiz_offset >= data.len() {
                return None;
            }
            let first_ssiz = data[first_ssiz_offset];
            let bpc = (first_ssiz & 0x7F).saturating_add(1);
            let bpc_field = bpc.saturating_sub(1);

            return Some((width, height, csiz, bpc_field));
        }
        i += 1;
    }
    None
}

fn make_box(typ: &[u8; 4], data: &[u8]) -> Vec<u8> {
    let len = (8 + data.len()) as u32;
    let mut out = Vec::with_capacity(len as usize);
    out.extend_from_slice(&len.to_be_bytes());
    out.extend_from_slice(typ);
    out.extend_from_slice(data);
    out
}

fn jp2_signature_box() -> Vec<u8> {
    let mut out = Vec::with_capacity(12);
    out.extend_from_slice(&12u32.to_be_bytes());
    out.extend_from_slice(b"jP  ");
    out.extend_from_slice(&[0x0D, 0x0A, 0x87, 0x0A]);
    out
}

fn jp2_file_type_box() -> Vec<u8> {
    let mut data = Vec::new();
    data.extend_from_slice(b"jp2 ");
    data.extend_from_slice(&0u32.to_be_bytes());
    data.extend_from_slice(b"jp2 ");
    make_box(b"ftyp", &data)
}

fn jp2_header_box(width: u32, height: u32, components: u16, bpc: u8) -> Vec<u8> {
    let mut ihdr = Vec::new();
    ihdr.extend_from_slice(&height.to_be_bytes());
    ihdr.extend_from_slice(&width.to_be_bytes());
    ihdr.extend_from_slice(&components.to_be_bytes());
    ihdr.push(bpc);
    ihdr.push(7); // compression type: JPEG2000
    ihdr.push(0); // unknown colorspace
    ihdr.push(0); // intellectual property
    let ihdr_box = make_box(b"ihdr", &ihdr);

    let mut colr = Vec::new();
    colr.push(1); // meth: enumerated
    colr.push(0); // precedence
    colr.push(0); // approximation
    colr.extend_from_slice(&17u32.to_be_bytes()); // grayscale
    let colr_box = make_box(b"colr", &colr);

    let mut jp2h = Vec::new();
    jp2h.extend_from_slice(&ihdr_box);
    jp2h.extend_from_slice(&colr_box);
    make_box(b"jp2h", &jp2h)
}

fn jp2_codestream_box(codestream: &[u8]) -> Vec<u8> {
    make_box(b"jp2c", codestream)
}
