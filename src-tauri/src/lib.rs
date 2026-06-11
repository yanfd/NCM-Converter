mod ncmdump;

use ncmdump::{convert_ncm, ConvertResult};
use std::path::PathBuf;
use tauri::command;

#[command]
fn convert_files(files: Vec<String>, output_dir: Option<String>) -> Vec<ConvertResult> {
    let out_dir = output_dir.map(PathBuf::from);
    files
        .iter()
        .map(|f| {
            let result = convert_ncm(PathBuf::from(f).as_path(), out_dir.as_deref());
            if result.success {
                eprintln!("[ok] {} -> {}", f, result.output_file.as_deref().unwrap_or("?"));
            } else {
                eprintln!("[fail] {} -> {}", f, result.error.as_deref().unwrap_or("unknown"));
            }
            result
        })
        .collect()
}

#[command]
fn reveal_in_file_manager(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| format!("Failed to open Finder: {}", e))?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| format!("Failed to open Explorer: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        // Try xdg-open on the parent directory
        if let Some(parent) = std::path::Path::new(&path).parent() {
            std::process::Command::new("xdg-open")
                .arg(parent)
                .spawn()
                .map_err(|e| format!("Failed to open file manager: {}", e))?;
        }
    }
    Ok(())
}

#[command]
fn delete_file(path: String) -> Result<(), String> {
    std::fs::remove_file(&path)
        .map_err(|e| format!("Failed to delete {}: {}", path, e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            convert_files,
            reveal_in_file_manager,
            delete_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
