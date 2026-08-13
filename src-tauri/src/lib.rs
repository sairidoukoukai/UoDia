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
mod rendering;

use tauri::Emitter;

/// フロントエンドへ「閉じようとしている」と伝えるイベント名。
/// `src/platform/tauri.ts` の `CLOSE_REQUESTED_EVENT` と一致させる。
const CLOSE_REQUESTED_EVENT: &str = "uodia://close-requested";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // ウィンドウを作る前に行う。GTK は初期化時に GDK_BACKEND を読む。
    rendering::configure();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // 閉じる操作は必ず一度止め、フロントエンドに尋ねる（仕様書 §6.8）。
        // 未保存の変更があるかを知っているのはフロントエンドだけである。
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                // 伝えられなければ閉じられなくなる。握り潰さず記録する。
                if let Err(e) = window.emit(CLOSE_REQUESTED_EVENT, ()) {
                    eprintln!("閉じる要求を伝えられません: {e}");
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_project_dialog,
            commands::save_project_dialog,
            commands::read_project_file,
            commands::save_project_file,
            commands::save_export_dialog,
            commands::save_export_file,
            commands::read_settings,
            commands::write_settings,
            commands::write_backup,
            commands::read_backup,
            commands::clear_backup,
            commands::list_recent_files,
            commands::add_recent_file,
            commands::set_window_title,
            commands::close_window,
        ])
        .run(tauri::generate_context!())
        .expect("Tauri アプリケーションの起動に失敗しました");
}
