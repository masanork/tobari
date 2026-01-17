pub mod models;
pub mod utils;
pub mod keys;
pub mod commands;

use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use crate::commands::webauthn::AppState;
use crate::utils::get_tobari_home;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Ensure TOBARI_HOME structure exists
    let home = get_tobari_home();
    for sub in ["credentials", "requests", "data", "history", "config"] {
        let _ = std::fs::create_dir_all(home.join(sub));
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            request: Mutex::new(None),
            allow_credentials: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            crate::commands::webauthn::get_pending_request,
            crate::commands::webauthn::perform_sign,
            crate::commands::webauthn::perform_register,
            crate::commands::webauthn::reject,
            crate::commands::card::read_my_number_card,
            crate::commands::card::read_passport,
            crate::commands::card::read_driver_license,
            crate::commands::card::read_residence_card,
            crate::commands::crypto::bbs_generate_key,
            crate::commands::crypto::perform_bbs_proof,
            crate::commands::storage::get_wallet_credentials,
            crate::commands::storage::save_to_wallet,
            crate::commands::storage::inspect_wallet_file,
            crate::keys::get_registered_keys,
            crate::keys::get_device_public_key,
            crate::keys::decrypt_data,
            crate::commands::card::jpki_sign
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}