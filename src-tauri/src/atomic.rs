//! アトミックなファイル書き込み。
//!
//! **保存中にプロセスが落ちても、既存のファイルが壊れてはならない**（実装計画書
//! T-13 の受入条件）。ファイルを直接開いて書くと、書き込みの途中で電源が落ちた
//! 場合に「古い内容でも新しい内容でもない断片」が残る。1 日分のダイヤを失う
//! 事故はこれで起こる。
//!
//! そこで、同じディレクトリに一時ファイルを書いてから名前を付け替える。
//! 名前の付け替えはファイルシステムの単一の操作であり、途中の状態が存在しない。
//! 読み手から見えるのは、常に「古い内容」か「新しい内容」のどちらかである。
//!
//! 一時ファイルを**同じディレクトリに置く**のが要点である。別の場所（`/tmp` など）
//! に置くと、ファイルシステムをまたいだ付け替えになり、実体のコピーに退化して
//! アトミック性が失われる。

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// 一時ファイルに付ける拡張子。
const TEMP_SUFFIX: &str = "uodia-tmp";

/// 書き込み先に対応する一時ファイルのパス。
fn temp_path_for(path: &Path) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".");
    name.push(TEMP_SUFFIX);
    path.with_file_name(name)
}

/// 内容をアトミックに書き込む。
///
/// 途中で失敗した場合、書き込み先は元のまま残る。一時ファイルは削除を試みるが、
/// 削除に失敗しても書き込み先には影響しない。
pub fn write_atomic(path: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("ディレクトリを作成できません: {}: {}", parent.display(), e))?;
    }

    let temp = temp_path_for(path);

    // 一時ファイルへの書き込みが失敗したら、書き込み先には触れずに終える。
    let write_result = (|| -> std::io::Result<()> {
        let mut file = fs::File::create(&temp)?;
        file.write_all(content.as_bytes())?;
        // 名前を付け替える前に内容をディスクへ送る。これを省くと、付け替えだけが
        // 先に永続化され、中身が空のファイルが残ることがある。
        file.sync_all()?;
        Ok(())
    })();

    if let Err(error) = write_result {
        let _ = fs::remove_file(&temp);
        return Err(format!(
            "一時ファイルに書き込めません: {}: {}",
            temp.display(),
            error
        ));
    }

    fs::rename(&temp, path).map_err(|error| {
        let _ = fs::remove_file(&temp);
        format!("ファイルを保存できません: {}: {}", path.display(), error)
    })
}

/// ファイルを読む。存在しない場合は `Ok(None)`。
pub fn read_optional(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(content) => Ok(Some(content)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!(
            "ファイルを読み込めません: {}: {}",
            path.display(),
            error
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    /// テストごとに使い捨てのディレクトリを作る。
    fn scratch_dir(name: &str) -> PathBuf {
        let dir = env::temp_dir().join(format!("uodia-test-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("テスト用ディレクトリを作成できません");
        dir
    }

    #[test]
    fn 新規ファイルを書ける() {
        let dir = scratch_dir("new");
        let path = dir.join("a.uodia");

        write_atomic(&path, "内容").expect("書き込めません");

        assert_eq!(fs::read_to_string(&path).unwrap(), "内容");
    }

    #[test]
    fn 既存ファイルを置き換える() {
        let dir = scratch_dir("replace");
        let path = dir.join("a.uodia");
        fs::write(&path, "古い内容").unwrap();

        write_atomic(&path, "新しい内容").expect("書き込めません");

        assert_eq!(fs::read_to_string(&path).unwrap(), "新しい内容");
    }

    #[test]
    fn 一時ファイルを残さない() {
        let dir = scratch_dir("no-temp");
        let path = dir.join("a.uodia");

        write_atomic(&path, "内容").expect("書き込めません");

        let leftovers: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|name| name.ends_with(TEMP_SUFFIX))
            .collect();
        assert!(leftovers.is_empty(), "一時ファイルが残っています: {leftovers:?}");
    }

    #[test]
    fn 前回の中断で残った一時ファイルがあっても保存できる() {
        // 保存中に強制終了すると、一時ファイルだけが残る。次回の保存はそれに
        // 妨げられてはならない。
        let dir = scratch_dir("leftover");
        let path = dir.join("a.uodia");
        fs::write(&path, "元の内容").unwrap();
        fs::write(temp_path_for(&path), "中断された断片").unwrap();

        write_atomic(&path, "新しい内容").expect("書き込めません");

        assert_eq!(fs::read_to_string(&path).unwrap(), "新しい内容");
        assert!(!temp_path_for(&path).exists());
    }

    #[test]
    fn 中断された一時ファイルは書き込み先を汚さない() {
        // 一時ファイルが残っている状態でも、書き込み先は元のままである。
        // 名前を付け替えるまで、書き込み先には一切触れないため。
        let dir = scratch_dir("untouched");
        let path = dir.join("a.uodia");
        fs::write(&path, "元の内容").unwrap();
        fs::write(temp_path_for(&path), "中断された断片").unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "元の内容");
    }

    #[test]
    fn 書き込みに失敗しても既存ファイルを壊さない() {
        let dir = scratch_dir("failure");
        let path = dir.join("a.uodia");
        fs::write(&path, "元の内容").unwrap();

        // 一時ファイルと同じ名前のディレクトリを作ると、一時ファイルを作れない。
        fs::create_dir(temp_path_for(&path)).unwrap();

        let result = write_atomic(&path, "新しい内容");

        assert!(result.is_err(), "失敗するはずが成功しました");
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "元の内容",
            "失敗したのに書き込み先が変わっています"
        );
    }

    #[test]
    fn 親ディレクトリが無ければ作る() {
        let dir = scratch_dir("mkdir");
        let path = dir.join("深い").join("階層").join("a.uodia");

        write_atomic(&path, "内容").expect("書き込めません");

        assert_eq!(fs::read_to_string(&path).unwrap(), "内容");
    }

    #[test]
    fn 一時ファイルは書き込み先と同じディレクトリに置く() {
        // 別のファイルシステムに置くと、名前の付け替えが実体のコピーに退化し、
        // アトミック性が失われる。
        let path = Path::new("/data/projects/a.uodia");
        assert_eq!(temp_path_for(path).parent(), path.parent());
    }

    #[test]
    fn 存在しないファイルの読込は_none() {
        let dir = scratch_dir("read-none");
        assert_eq!(read_optional(&dir.join("ない.uodia")).unwrap(), None);
    }

    #[test]
    fn 存在するファイルを読める() {
        let dir = scratch_dir("read-some");
        let path = dir.join("a.uodia");
        fs::write(&path, "内容").unwrap();

        assert_eq!(read_optional(&path).unwrap(), Some("内容".to_string()));
    }
}
