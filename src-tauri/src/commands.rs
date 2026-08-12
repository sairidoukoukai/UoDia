//! フロントエンドから呼ばれるコマンド（仕様書 §10.3）。
//!
//! **ここに置くのはファイル I/O とダイアログだけである。** 時刻の計算・検証・
//! 運用の導出は TypeScript 側で完結させ、Web 版と同じコードを動かす。Rust 側に
//! ドメインロジックを足すと、その瞬間に Web 版と挙動が分かれる。
//!
//! 失敗は `Result<_, String>` で返す。フロントエンドには文字列として届き、
//! そのまま利用者に見せられる。取り消しは失敗ではないため `Option` で表す。

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use std::path::Path;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

use crate::atomic;
use crate::paths;
use crate::recent::{self, RecentEntry};

/// プロジェクトファイルの拡張子（仕様書 §7.1）。
const PROJECT_EXTENSION: &str = "uodia";
const PROJECT_FILTER_NAME: &str = "UoDia プロジェクト";

/// 書き出しの拡張子（仕様書 v2 §5.3）。**1 つの zip にまとめる。**
const EXPORT_EXTENSION: &str = "zip";
const EXPORT_FILTER_NAME: &str = "zip 書庫";

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

/// 「書き出し」の保存先ダイアログ（仕様書 v2 §5.3、T-74）。取り消されたら `None`。
#[tauri::command]
pub async fn save_export_dialog(app: AppHandle, suggested_name: String) -> Option<String> {
    app.dialog()
        .file()
        .add_filter(EXPORT_FILTER_NAME, &[EXPORT_EXTENSION])
        .set_file_name(suggested_name)
        .blocking_save_file()
        .and_then(|file| file.into_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
}

/// 書き出したものを保存する。**アトミックに書き込む**（T-74）。
///
/// **base64 で受け取る。** コマンドの引数は JSON で渡ってくるため、バイト列を
/// そのまま載せられない。数値の配列にすると 1 バイトが 3〜4 文字になり、300dpi の
/// 画像を包んだ書庫では受け渡しだけで数十 MB になる。
#[tauri::command]
pub fn save_export_file(path: String, content_base64: String) -> Result<(), String> {
    let bytes = BASE64
        .decode(content_base64)
        .map_err(|e| format!("書き出す内容を読み取れません: {e}"))?;
    atomic::write_atomic_bytes(Path::new(&path), &bytes)
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
///
/// **新しい文書を始めるための種である**（T-89、#235）。書き戻す口は持たない
/// ——路線は `.uodia` の中にあり、路線を直すことは文書を直すことである。
#[tauri::command]
pub fn read_route_def(app: AppHandle) -> Result<String, String> {
    let path = paths::ensure_route_file(&app)?;
    std::fs::read_to_string(&path)
        .map_err(|e| format!("route.json を読み込めません: {}: {e}", path.display()))
}

/// 設定を読む（T-39）。まだ保存していなければ `None`。
///
/// **読めなくても失敗にしない**のは呼び出し側（TS）の判断であり、ここでは
/// 素直に返す。壊れた設定で起動できなくなるのは代償が大きい。
#[tauri::command]
pub fn read_settings() -> Result<Option<String>, String> {
    atomic::read_optional(&paths::settings_path()?)
}

#[tauri::command]
pub fn write_settings(content: String) -> Result<(), String> {
    atomic::write_atomic(&paths::settings_path()?, &content)
}

#[tauri::command]
pub fn write_backup(content: String) -> Result<(), String> {
    atomic::write_atomic(&paths::backup_path()?, &content)
}

#[tauri::command]
pub fn read_backup() -> Result<Option<String>, String> {
    atomic::read_optional(&paths::backup_path()?)
}

#[tauri::command]
pub fn clear_backup() -> Result<(), String> {
    let path = paths::backup_path()?;
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
pub fn list_recent_files() -> Result<Vec<RecentEntry>, String> {
    read_recent(&paths::recent_path()?)
}

#[tauri::command]
pub fn add_recent_file(path: String, opened_at: String) -> Result<(), String> {
    let list_path = paths::recent_path()?;
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
    main_window(&app)?
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
    // close() ではなく destroy() を使う。close() は再び CloseRequested を起こし、
    // 止める側と閉じる側が延々と押し合うことになる。
    main_window(&app)?
        .destroy()
        .map_err(|e| format!("ウィンドウを閉じられません: {e}"))
}

/// 唯一のウィンドウを取得する。
fn main_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    app.get_webview_window(MAIN_WINDOW)
        .ok_or_else(|| format!("ウィンドウがありません: {MAIN_WINDOW}"))
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
