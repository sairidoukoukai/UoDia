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
//!
//! ## ポータブル版（T-93、仕様書（ポータブル版））
//!
//! **実行ファイルの隣に `portable` があれば、書く先を隣の `data/` に移す。**
//! 定義は 1 つだけである——**自分の置かれたディレクトリの外に、何も書かない。**
//!
//! 目印で決めるのは、**ポータブルかどうかがバイナリの性質ではなく置かれ方の
//! 性質**だからである。ビルドで分けると、インストーラー版のバイナリを USB に
//! 置いてもポータブルにならず、同じものが 2 つ並ぶ。

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

/// ポータブル版の目印。**中身は見ない。あるかどうかだけを見る。**
const PORTABLE_MARKER: &str = "portable";
/// ポータブル版が書く先。実行ファイルの隣を散らかさないよう 1 段掘る。
const PORTABLE_DATA_DIR: &str = "data";

/// アプリの設定ディレクトリ。
fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|e| format!("設定ディレクトリを特定できません: {e}"))
}

/// 目印を探しに登る段数。
///
/// **実行ファイルは展開した根の直下にあるとは限らない。**
///
/// | OS | 実行ファイルの位置 | 根までの段 |
/// | --- | --- | --- |
/// | Windows | `UoDia/UoDia.exe` | 0 |
/// | Linux | `UoDia/bin/uodia` | 1 |
/// | macOS | `UoDia.app/Contents/MacOS/UoDia` | 3 |
///
/// **入れ子になるのはリソースの都合である**（仕様書（ポータブル版）§3）。Tauri は
/// 同梱リソースを OS ごとに違う場所から読む——Linux は `exe_dir/../lib/<名前>`、
/// macOS は `.app/Contents/Resources` である。実行ファイルを根の直下に置くと、
/// **`route.json` を見つけられない。**
const MARKER_SEARCH_DEPTH: usize = 3;

/// 目印がある祖先を探す。**展開した根を指す。**
///
/// **OS で分岐しない。** 分けると、その OS の上でしか通らない道ができる——
/// ここは 3 つの版面すべてを 1 つの規則で扱う。
fn portable_base_from(exe: &Path) -> Option<PathBuf> {
    let mut dir = exe.parent()?;

    for _ in 0..=MARKER_SEARCH_DEPTH {
        if dir.join(PORTABLE_MARKER).exists() {
            return Some(dir.to_path_buf());
        }
        dir = dir.parent()?;
    }

    None
}

/// 目印がある基準から、書く先を作る。
fn portable_data_dir_of(base: &Path) -> PathBuf {
    base.join(PORTABLE_DATA_DIR)
}

/// いまの実行ファイルから見たポータブル版の置き場所。
fn portable_data_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    Some(portable_data_dir_of(&portable_base_from(&exe)?))
}

/// 読み書きの置き場所。
///
/// **ポータブル版では設定ディレクトリへ倒さない**（同 §4.2）。目印を置いた人は
/// そこに書かせたいのであり、黙って倒すと**持ち歩いたつもりのものが端末に残る**
/// ——ポータブル版として最も避けたい壊れ方である。
fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let Some(dir) = portable_data_dir() else {
        return config_dir(app);
    };

    // 読み取り専用の媒体に置かれることはある。**そのときは失敗として伝える。**
    std::fs::create_dir_all(&dir)
        .map(|()| dir.clone())
        .map_err(|e| format!("ポータブル版の置き場所を作れません: {}: {e}", dir.display()))
}

/// 読み書きの置き場所にある `route.json`。**読むためだけに使う**（T-92 で書き戻しを畳んだ）。
fn route_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join(ROUTE_FILE))
}

pub fn backup_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join(BACKUP_FILE))
}

pub fn recent_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join(RECENT_FILE))
}

pub fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join(SETTINGS_FILE))
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

    /// 目印を置いた根の下に、実行ファイルを深さ `depth` で作る。
    fn portable_layout(name: &str, depth: usize) -> (PathBuf, PathBuf) {
        let root = scratch_dir(name);
        fs::write(root.join(PORTABLE_MARKER), "").unwrap();

        let mut dir = root.clone();
        for i in 0..depth {
            dir = dir.join(format!("d{i}"));
        }
        fs::create_dir_all(&dir).unwrap();

        (root, dir.join("UoDia"))
    }

    #[test]
    fn 目印が無ければポータブルではない() {
        let dir = scratch_dir("plain");
        assert_eq!(portable_base_from(&dir.join("UoDia")), None);
    }

    #[test]
    fn 実行ファイルの隣にあれば効く() {
        // Windows の版面。`UoDia/UoDia.exe`
        let (root, exe) = portable_layout("win", 0);
        assert_eq!(portable_base_from(&exe), Some(root));
    }

    #[test]
    fn bin_の中にあっても根を見つける() {
        // Linux の版面。`UoDia/bin/uodia`——リソースが `../lib/uodia` にあるため
        // 実行ファイルは根の直下に置けない。
        let (root, exe) = portable_layout("linux", 1);
        assert_eq!(portable_base_from(&exe), Some(root));
    }

    #[test]
    fn app_バンドルの中にあっても根を見つける() {
        // macOS の版面。`UoDia.app/Contents/MacOS/UoDia`。**バンドルの中には
        // 書かない**——署名が壊れる（仕様書（ポータブル版）§3.1）。
        let (root, exe) = portable_layout("macos", 3);
        assert_eq!(portable_base_from(&exe), Some(root));
    }

    #[test]
    fn 深すぎるところは見に行かない() {
        // 3 段で足りる。無闇に登ると、無関係な `portable` を拾う。
        let (_root, exe) = portable_layout("deep", 4);
        assert_eq!(portable_base_from(&exe), None);
    }

    #[test]
    fn 目印の中身は見ない() {
        let root = scratch_dir("marker-content");
        fs::write(root.join(PORTABLE_MARKER), "なんでもよい").unwrap();

        assert_eq!(portable_base_from(&root.join("UoDia")), Some(root));
    }

    #[test]
    fn 目印がディレクトリでも効く() {
        // 展開の仕方によってはフォルダとして作られうる。**あるかどうかだけを
        // 見る**と決めた以上、ここで弾かない。
        let root = scratch_dir("marker-dir");
        fs::create_dir(root.join(PORTABLE_MARKER)).unwrap();

        assert_eq!(portable_base_from(&root.join("UoDia")), Some(root));
    }

    #[test]
    fn 書く先は根の下の_data_である() {
        let dir = PathBuf::from("/media/usb/UoDia");
        assert_eq!(portable_data_dir_of(&dir), dir.join("data"));
    }

    #[test]
    fn 複製元が無ければ失敗する() {
        let dir = scratch_dir("missing");
        let result = seed_if_absent(&dir.join(ROUTE_FILE), &dir.join("ない.json"));
        assert!(result.is_err());
    }
}
