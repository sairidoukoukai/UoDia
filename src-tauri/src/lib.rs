//! UoDia デスクトップ版のエントリポイント。
//!
//! Rust 側の責務はファイル I/O のみに限定する（仕様書 §10.3）。
//! ドメインロジック（時刻計算・検証・運用の導出）は TypeScript 側で完結させ、
//! Web 版と同一のコードを用いる。ここにビジネスロジックを追加してはならない。
//!
//! ファイル操作コマンドは T-13 で実装する。

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("Tauri アプリケーションの起動に失敗しました");
}
