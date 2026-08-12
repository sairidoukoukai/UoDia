//! アプリが使うファイルの置き場所（実装計画書 §3.3）。
//!
//! **路線はここで扱わない**（T-96）。`.uodia` の中にあり（T-89）、新しい文書を
//! 始めるための種は**実行ファイルに埋まった資産**から読む
//! （`src/platform/networkSeed.ts`）——Web 版と同じ道である。ここにあった複製の
//! 手順は、書き戻す口が無くなった時点（T-92）で意味を失っていた。
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
/// | Linux | `UoDia/uodia` | `UoDia/` |
/// | macOS | `UoDia.app/Contents/MacOS/UoDia` | `.app` の隣 |
///
/// **入れ子になるのは macOS だけである**（T-96 で改め）。Linux が `bin/` に
/// 入っていたのは**同梱リソースを `../lib/<productName>` から読むため**であり、
/// リソースが 1 つも無くなった以上、根の直下でよい。
///
/// **段数ではなく構造で見る。** 「macOS は 3 段上」と決め打つと、開発中の
/// ビルド（`target/debug/uodia`）で**リポジトリの外に書く**。`.app` の中かを
/// 見れば、当てはまらない置かれ方では実行ファイルの隣に落ちる。
fn root_from(exe: &Path) -> Option<PathBuf> {
    let dir = exe.parent()?;

    // `Foo.app/Contents/MacOS/Foo` → `.app` の隣。**バンドルの中には書かない**
    // ——書くと署名が壊れる（同 §3.3）。
    if dir.ends_with("Contents/MacOS") {
        return dir.parent()?.parent()?.parent().map(Path::to_path_buf);
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

pub fn backup_path() -> Result<PathBuf, String> {
    Ok(data_dir()?.join(BACKUP_FILE))
}

pub fn recent_path() -> Result<PathBuf, String> {
    Ok(data_dir()?.join(RECENT_FILE))
}

pub fn settings_path() -> Result<PathBuf, String> {
    Ok(data_dir()?.join(SETTINGS_FILE))
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
    fn windows_は実行ファイルの階層が根() {
        let exe = PathBuf::from("/media/usb/UoDia/UoDia.exe");
        assert_eq!(root_from(&exe), Some(PathBuf::from("/media/usb/UoDia")));
    }

    #[test]
    fn linux_も実行ファイルの階層が根() {
        // T-96 で `bin/` が要らなくなった（同梱リソースが無くなったため）。
        let exe = PathBuf::from("/media/usb/UoDia/uodia");
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

}
