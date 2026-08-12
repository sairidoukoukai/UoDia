//! アプリが使うファイルの置き場所（実装計画書 §3.3）。
//!
//! `route.json` は同梱リソースとして配布するが、**設定ディレクトリへ複製してから
//! 使う**。インストール先は書き込み不可のことがあり（Windows の Program Files、
//! macOS のアプリバンドル）、そこを読み書きの場所にはできないためである。
//!
//! 複製は初回起動時に一度だけ行う。既にあるものを上書きすると、利用者の編集が
//! アプリの更新のたびに消える。
//!
//! **書き戻す口は無い**（T-92、#235）。路線は `.uodia` の中にあり、ここにある
//! のは**新しい文書を始めるための種**だけである。

use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

use crate::atomic;

/// ネットワーク定義のファイル名。
const ROUTE_FILE: &str = "route.json";
/// 自動バックアップのファイル名。
const BACKUP_FILE: &str = "backup.uodia";
/// 最近使ったファイルの一覧。
const RECENT_FILE: &str = "recent.json";
/// 設定（T-39）。プロジェクトとは別に置く。
const SETTINGS_FILE: &str = "settings.json";

/// アプリの設定ディレクトリ。
fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|e| format!("設定ディレクトリを特定できません: {e}"))
}

/// 設定ディレクトリ内の `route.json`。**読むためだけに使う**（T-92 で書き戻しを畳んだ）。
fn route_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join(ROUTE_FILE))
}

pub fn backup_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join(BACKUP_FILE))
}

pub fn recent_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join(RECENT_FILE))
}

pub fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join(SETTINGS_FILE))
}

/// 同梱リソースの `route.json`。
fn bundled_route_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resolve(ROUTE_FILE, tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("同梱の {ROUTE_FILE} を特定できません: {e}"))
}

/// 設定ディレクトリに `route.json` が無ければ、同梱リソースから複製する。
pub fn ensure_route_file(app: &AppHandle) -> Result<PathBuf, String> {
    seed_if_absent(&route_path(app)?, &bundled_route_path(app)?)
}

/// `target` が無ければ `source` から複製する。
///
/// **既にある場合は何もしない。利用者が置いたものをアプリの更新で消さないため。**
fn seed_if_absent(target: &Path, source: &Path) -> Result<PathBuf, String> {
    if target.exists() {
        return Ok(target.to_path_buf());
    }

    let content = std::fs::read_to_string(source).map_err(|e| {
        format!(
            "同梱の {ROUTE_FILE} を読み込めません: {}: {e}",
            source.display()
        )
    })?;

    atomic::write_atomic(target, &content)?;
    Ok(target.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("uodia-paths-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("テスト用ディレクトリを作成できません");
        dir
    }

    #[test]
    fn 無ければ複製する() {
        let dir = scratch_dir("seed");
        let source = dir.join("bundled.json");
        let target = dir.join("config").join(ROUTE_FILE);
        fs::write(&source, "{\"version\":1}").unwrap();

        seed_if_absent(&target, &source).expect("複製できません");

        assert_eq!(fs::read_to_string(&target).unwrap(), "{\"version\":1}");
    }

    #[test]
    fn 既にあるものを上書きしない() {
        // 利用者が置いた種が、アプリの更新で戻ってはならない。
        let dir = scratch_dir("keep");
        let source = dir.join("bundled.json");
        let target = dir.join("config").join(ROUTE_FILE);
        fs::write(&source, "{\"version\":2}").unwrap();
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(&target, "利用者が直した内容").unwrap();

        seed_if_absent(&target, &source).expect("失敗しました");

        assert_eq!(fs::read_to_string(&target).unwrap(), "利用者が直した内容");
    }

    #[test]
    fn 複製元が無ければ失敗する() {
        let dir = scratch_dir("missing");
        let result = seed_if_absent(&dir.join(ROUTE_FILE), &dir.join("ない.json"));
        assert!(result.is_err());
    }
}
