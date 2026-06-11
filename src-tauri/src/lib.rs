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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![convert_files])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
