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
//! ## 書く先は展開した根の下だけである（T-95、仕様書（ポータブル版））
//!
//! **配るのはポータブル版だけになった**（#245）。設定ディレクトリへ書く道は
//! 無い——**自分の置かれたディレクトリの外に、何も書かない。**
//!
//! 目印（`portable`）は T-93 で入れたが、**T-95 で外した。** あれは 2 つの版を
//! 見分けるためのものであり、**見分ける相手が居なくなれば、置いておく理由が
//! 無い。**

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

/// 読み書きの置き場所。展開した根の下に 1 段掘る。
const DATA_DIR: &str = "data";

/// 実行ファイルから、展開した根を割り出す。
///
/// **実行ファイルは根の直下にあるとは限らない**（仕様書（ポータブル版）§3.1）。
/// 同梱リソースの探し方が OS ごとに違うためであり、こちらの都合ではない。
///
/// | 版面 | 実行ファイル | 根 |
/// | --- | --- | --- |
/// | Windows | `UoDia/UoDia.exe` | `UoDia/` |
/// | Linux | `UoDia/bin/uodia` | `UoDia/` |
/// | macOS | `UoDia.app/Contents/MacOS/UoDia` | `.app` の隣 |
///
/// **段数ではなく構造で見る。** 「macOS は 3 段上」と決め打つと、開発中の
/// ビルド（`target/debug/uodia`）で**リポジトリの外に書く**。`.app` の中か
/// `bin/` の中かを見れば、当てはまらない置かれ方では実行ファイルの隣に落ちる。
///
/// **OS で分岐しない。** 分けると、その OS の上でしか通らない道ができる。
fn root_from(exe: &Path) -> Option<PathBuf> {
    let dir = exe.parent()?;

    // `Foo.app/Contents/MacOS/Foo` → `.app` の隣。**バンドルの中には書かない**
    // ——書くと署名が壊れる（同 §3.3）。
    if dir.ends_with("Contents/MacOS") {
        return dir.parent()?.parent()?.parent().map(Path::to_path_buf);
    }

    // `UoDia/bin/uodia` → `UoDia/`。リソースを `../lib/<productName>` から
    // 読むため、実行ファイルを根の直下には置けない。
    if dir.file_name() == Some(std::ffi::OsStr::new("bin")) {
        return dir.parent().map(Path::to_path_buf);
    }

    Some(dir.to_path_buf())
}

/// 読み書きの置き場所。
///
/// **設定ディレクトリへ倒さない**（同 §4）。倒す先が無い——配るのはポータブル版
/// だけであり、**持ち歩いたつもりのものが端末に残る**道を残さない。
///
/// 読み取り専用の媒体に置かれることはある。**そのときは失敗として伝える。**
fn data_dir() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("実行ファイルを特定できません: {e}"))?;
    let dir = root_from(&exe)
        .ok_or_else(|| format!("置き場所を特定できません: {}", exe.display()))?
        .join(DATA_DIR);

    std::fs::create_dir_all(&dir)
        .map(|()| dir.clone())
        .map_err(|e| format!("置き場所を作れません: {}: {e}", dir.display()))
}

/// 読み書きの置き場所にある `route.json`。**読むためだけに使う**（T-92 で書き戻しを畳んだ）。
fn route_path() -> Result<PathBuf, String> {
    Ok(data_dir()?.join(ROUTE_FILE))
}

pub fn backup_path() -> Result<PathBuf, String> {
    Ok(data_dir()?.join(BACKUP_FILE))
}

pub fn recent_path() -> Result<PathBuf, String> {
    Ok(data_dir()?.join(RECENT_FILE))
}

pub fn settings_path() -> Result<PathBuf, String> {
    Ok(data_dir()?.join(SETTINGS_FILE))
}

/// 同梱リソースの `route.json`。
fn bundled_route_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resolve(ROUTE_FILE, tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("同梱の {ROUTE_FILE} を特定できません: {e}"))
}

/// 設定ディレクトリに `route.json` が無ければ、同梱リソースから複製する。
pub fn ensure_route_file(app: &AppHandle) -> Result<PathBuf, String> {
    seed_if_absent(&route_path()?, &bundled_route_path(app)?)
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
    fn windows_は実行ファイルの階層が根() {
        let exe = PathBuf::from("/media/usb/UoDia/UoDia.exe");
        assert_eq!(root_from(&exe), Some(PathBuf::from("/media/usb/UoDia")));
    }

    #[test]
    fn linux_は_bin_の外が根() {
        // リソースを `../lib/UoDia` から読むため、実行ファイルは `bin/` に入る。
        let exe = PathBuf::from("/media/usb/UoDia/bin/uodia");
        assert_eq!(root_from(&exe), Some(PathBuf::from("/media/usb/UoDia")));
    }

    #[test]
    fn macos_は_app_の隣が根() {
        // バンドルの中に書くと署名が壊れる（仕様書（ポータブル版）§3.3）。
        let exe = PathBuf::from("/Volumes/USB/UoDia.app/Contents/MacOS/UoDia");
        assert_eq!(root_from(&exe), Some(PathBuf::from("/Volumes/USB")));
    }

    #[test]
    fn 開発中のビルドは実行ファイルの隣に落ちる() {
        // **段数で決め打つと、ここでリポジトリの外に書く。** 構造で見れば、
        // 当てはまらない置かれ方では隣に落ちる。
        let exe = PathBuf::from("/home/me/UoDia/src-tauri/target/debug/uodia");
        assert_eq!(
            root_from(&exe),
            Some(PathBuf::from("/home/me/UoDia/src-tauri/target/debug"))
        );
    }

    #[test]
    fn bin_という名前だけを見る() {
        // `sbin` や `binaries` は `bin` ではない。
        let exe = PathBuf::from("/opt/UoDia/sbin/uodia");
        assert_eq!(root_from(&exe), Some(PathBuf::from("/opt/UoDia/sbin")));
    }

    #[test]
    fn 複製元が無ければ失敗する() {
        let dir = scratch_dir("missing");
        let result = seed_if_absent(&dir.join(ROUTE_FILE), &dir.join("ない.json"));
        assert!(result.is_err());
    }
}
