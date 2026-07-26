//! UoDia デスクトップ版のエントリポイント。
//!
//! Rust 側の責務はファイル I/O のみに限定する（仕様書 §10.3）。
//! ドメインロジック（時刻計算・検証・運用の導出）は TypeScript 側で完結させ、
//! Web 版と同一のコードを用いる。ここにビジネスロジックを追加してはならない。
//!
//! ファイル操作は [`commands`] に置く。

mod atomic;
mod commands;
mod paths;
mod recent;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::open_project_dialog,
            commands::save_project_dialog,
            commands::read_project_file,
            commands::save_project_file,
            commands::read_route_def,
            commands::write_route_def,
            commands::write_backup,
            commands::read_backup,
            commands::clear_backup,
            commands::list_recent_files,
            commands::add_recent_file,
        ])
        .run(tauri::generate_context!())
        .expect("Tauri アプリケーションの起動に失敗しました");
}
