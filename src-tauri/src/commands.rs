//! フロントエンドから呼ばれるコマンド（仕様書 §10.3）。
//!
//! **ここに置くのはファイル I/O とダイアログだけである。** 時刻の計算・検証・
//! 運用の導出は TypeScript 側で完結させ、Web 版と同じコードを動かす。Rust 側に
//! ドメインロジックを足すと、その瞬間に Web 版と挙動が分かれる。
//!
//! 失敗は `Result<_, String>` で返す。フロントエンドには文字列として届き、
//! そのまま利用者に見せられる。取り消しは失敗ではないため `Option` で表す。

use std::path::Path;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

use crate::atomic;
use crate::paths;
use crate::recent::{self, RecentEntry};

/// プロジェクトファイルの拡張子（仕様書 §7.1）。
const PROJECT_EXTENSION: &str = "uodia";
const PROJECT_FILTER_NAME: &str = "UoDia プロジェクト";

/// `tauri.conf.json` で定義しているウィンドウのラベル。
const MAIN_WINDOW: &str = "main";

/// 「開く」ダイアログ。取り消されたら `None`。
#[tauri::command]
pub async fn open_project_dialog(app: AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .add_filter(PROJECT_FILTER_NAME, &[PROJECT_EXTENSION])
        .blocking_pick_file()
        .and_then(|file| file.into_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
}

/// 「名前を付けて保存」ダイアログ。取り消されたら `None`。
#[tauri::command]
pub async fn save_project_dialog(app: AppHandle, suggested_name: String) -> Option<String> {
    app.dialog()
        .file()
        .add_filter(PROJECT_FILTER_NAME, &[PROJECT_EXTENSION])
        .set_file_name(suggested_name)
        .blocking_save_file()
        .and_then(|file| file.into_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn read_project_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("ファイルを読み込めません: {path}: {e}"))
}

/// プロジェクトを保存する。**アトミックに書き込む**（[`atomic::write_atomic`]）。
#[tauri::command]
pub fn save_project_file(path: String, content: String) -> Result<(), String> {
    atomic::write_atomic(Path::new(&path), &content)
}

/// `route.json` を読む。初回は同梱リソースから設定ディレクトリへ複製する。
#[tauri::command]
pub fn read_route_def(app: AppHandle) -> Result<String, String> {
    let path = paths::ensure_route_file(&app)?;
    std::fs::read_to_string(&path)
        .map_err(|e| format!("route.json を読み込めません: {}: {e}", path.display()))
}

#[tauri::command]
pub fn write_route_def(app: AppHandle, content: String) -> Result<(), String> {
    atomic::write_atomic(&paths::route_path(&app)?, &content)
}

#[tauri::command]
pub fn write_backup(app: AppHandle, content: String) -> Result<(), String> {
    atomic::write_atomic(&paths::backup_path(&app)?, &content)
}

#[tauri::command]
pub fn read_backup(app: AppHandle) -> Result<Option<String>, String> {
    atomic::read_optional(&paths::backup_path(&app)?)
}

#[tauri::command]
pub fn clear_backup(app: AppHandle) -> Result<(), String> {
    let path = paths::backup_path(&app)?;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        // 無いものを消せなくても困らない。正常終了時に呼ばれるため、ここで
        // 失敗を返すと「保存できたのに終了時にエラーが出る」ことになる。
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!(
            "バックアップを削除できません: {}: {e}",
            path.display()
        )),
    }
}

#[tauri::command]
pub fn list_recent_files(app: AppHandle) -> Result<Vec<RecentEntry>, String> {
    read_recent(&paths::recent_path(&app)?)
}

#[tauri::command]
pub fn add_recent_file(app: AppHandle, path: String, opened_at: String) -> Result<(), String> {
    let list_path = paths::recent_path(&app)?;
    let entries = read_recent(&list_path)?;
    let next = recent::add(&entries, RecentEntry { path, opened_at });
    let json = serde_json::to_string_pretty(&next)
        .map_err(|e| format!("履歴を書き出せません: {e}"))?;
    atomic::write_atomic(&list_path, &json)
}

/// ウィンドウの題名を変える（仕様書 §6.8）。
///
/// フロントエンドの `document.title` では OS のウィンドウ題名は変わらない。
/// 未保存を示す `[*]` を題名に出すため、ここで橋渡しする。
#[tauri::command]
pub fn set_window_title(app: AppHandle, title: String) -> Result<(), String> {
    let window = app
        .get_webview_window(MAIN_WINDOW)
        .ok_or_else(|| format!("ウィンドウがありません: {MAIN_WINDOW}"))?;
    window
        .set_title(&title)
        .map_err(|e| format!("題名を変えられません: {e}"))
}

/// ウィンドウを閉じる。
///
/// 閉じる操作はいったん Rust 側で必ず止めており（[`crate::run`]）、閉じてよいと
/// フロントエンドが判断したときにここへ戻ってくる。未保存の変更があるかを
/// 知っているのはフロントエンドだけであり、Rust 側で判断できない。
#[tauri::command]
pub fn close_window(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(MAIN_WINDOW)
        .ok_or_else(|| format!("ウィンドウがありません: {MAIN_WINDOW}"))?;
    // close() ではなく destroy() を使う。close() は再び CloseRequested を起こし、
    // 止める側と閉じる側が延々と押し合うことになる。
    window
        .destroy()
        .map_err(|e| format!("ウィンドウを閉じられません: {e}"))
}

/// 履歴を読む。壊れていれば空として扱う。
///
/// 履歴が読めないだけでアプリが起動しないのは割に合わない。失われるのは
/// 「最近開いたファイルの一覧」であり、作り直せる情報である。
fn read_recent(path: &Path) -> Result<Vec<RecentEntry>, String> {
    let Some(content) = atomic::read_optional(path)? else {
        return Ok(Vec::new());
    };
    Ok(serde_json::from_str(&content).unwrap_or_default())
}
