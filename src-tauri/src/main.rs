// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::Path;
use tauri::Manager;

#[tauri::command]
fn save_export_zip(
    app: tauri::AppHandle,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    let clean_name = Path::new(&file_name)
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|n| !n.is_empty())
        .ok_or_else(|| "Invalid export filename".to_string())?;
    let dir = app
        .path()
        .download_dir()
        .map_err(|e| format!("Failed to locate Downloads folder: {e}"))?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to prepare Downloads folder: {e}"))?;

    let target = dir.join(clean_name);
    if std::fs::write(&target, &bytes).is_ok() {
        return Ok(target.to_string_lossy().into_owned());
    }

    let path = Path::new(clean_name);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or(clean_name);
    let ext = path.extension().and_then(|e| e.to_str());
    for idx in 1..=999 {
        let candidate_name = match ext {
            Some(e) => format!("{stem} ({idx}).{e}"),
            None => format!("{stem} ({idx})"),
        };
        let candidate = dir.join(candidate_name);
        if std::fs::write(&candidate, &bytes).is_ok() {
            return Ok(candidate.to_string_lossy().into_owned());
        }
    }

    Err(format!(
        "Could not write export zip to {}",
        target.to_string_lossy()
    ))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![save_export_zip])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
