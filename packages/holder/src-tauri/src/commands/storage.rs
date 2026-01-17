use tauri::command;
use crate::models::{SignerError, WalletCredential};
use crate::utils::{get_tobari_home, inspect_cbor_bytes};
use ciborium;
use std;

#[command]
pub async fn get_wallet_credentials() -> Result<Vec<WalletCredential>, SignerError> {
    let credentials_dir = get_tobari_home().join("credentials");
    if !credentials_dir.exists() {
        std::fs::create_dir_all(&credentials_dir).map_err(|e| SignerError::Internal(e.to_string()))?;
        return Ok(vec![]);
    }

    let mut list = Vec::new();
    let entries = std::fs::read_dir(credentials_dir).map_err(|e| SignerError::Internal(e.to_string()))?;

    for entry in entries {
        if let Ok(entry) = entry {
            let path = entry.path();
            if path.is_file() && path.extension().map_or(false, |ext| ext == "cose") {
                let file = std::fs::File::open(&path).map_err(|e| SignerError::Internal(e.to_string()))?;
                let doc_type = match ciborium::from_reader::<ciborium::value::Value, _>(file) {
                    Ok(val) => {
                        let mut current = &val;
                        while let ciborium::value::Value::Tag(_tag, box_val) = current {
                            current = box_val.as_ref();
                        }
                        if let Some(map) = current.as_map() {
                            map.iter()
                                .find(|(k, _)| k.as_text() == Some("docType"))
                                .and_then(|(_, v)| v.as_text())
                                .unwrap_or("Unknown")
                                .to_string()
                        } else { "Unknown".to_string() }
                    }
                    Err(_) => "Unknown".to_string(),
                };

                let metadata = entry.metadata().ok();
                let created_at = metadata.and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs());

                list.push(WalletCredential {
                    name: path.file_name().and_then(|n| n.to_str()).unwrap_or("Unknown").to_string(),
                    path: path.to_string_lossy().to_string(),
                    doc_type,
                    created_at,
                });
            }
        }
    }
    Ok(list)
}

#[command]
pub async fn save_to_wallet(name: String, _doc_type: String, data: serde_json::Value) -> Result<String, SignerError> {
    let credentials_dir = get_tobari_home().join("credentials");
    if !credentials_dir.exists() {
        std::fs::create_dir_all(&credentials_dir).map_err(|e| SignerError::Internal(e.to_string()))?;
    }

    let file_name = format!("{}.cose", name.replace(" ", "_").to_lowercase());
    let file_path = credentials_dir.join(&file_name);
    
    let mut buf = Vec::new();
    ciborium::into_writer(&data, &mut buf)
        .map_err(|e| SignerError::Serialization(e.to_string()))?;
    
    std::fs::write(&file_path, buf).map_err(|e| SignerError::Internal(e.to_string()))?;
    Ok(file_path.to_string_lossy().to_string())
}

#[command]
pub async fn inspect_wallet_file(path: String) -> Result<serde_json::Value, SignerError> {
    let content = std::fs::read(&path).map_err(|e| SignerError::Internal(e.to_string()))?;
    if content.is_empty() {
        return Ok(serde_json::Value::String("Empty file".to_string()));
    }
    Ok(inspect_cbor_bytes(&content))
}
