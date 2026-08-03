//! 最近使ったファイルの一覧（仕様書 §6.8）。
//!
//! 一覧そのものは JSON として設定ディレクトリに置く。件数の上限と並び順の規則は
//! TypeScript 側と揃える必要があるため、値をここに書き下すのではなく、両方から
//! 同じ仕様（§6.8）を参照している。

use serde::{Deserialize, Serialize};

/// 保持する件数の上限（仕様書 §6.8）。
pub const MAX_RECENT_FILES: usize = 10;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RecentEntry {
    /// ファイルの絶対パス。
    pub path: String,
    /// 最後に開いた時刻。ISO 8601。
    #[serde(rename = "openedAt")]
    pub opened_at: String,
}

/// 一覧に 1 件加えた結果を返す。
///
/// 同じパスが既にあれば取り除いてから先頭に置く。重複を残すと、同じファイルが
/// 履歴を埋め尽くして他の項目が押し出される。
pub fn add(entries: &[RecentEntry], entry: RecentEntry) -> Vec<RecentEntry> {
    let mut next: Vec<RecentEntry> = entries
        .iter()
        .filter(|e| e.path != entry.path)
        .cloned()
        .collect();
    next.insert(0, entry);
    next.truncate(MAX_RECENT_FILES);
    next
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(path: &str, opened_at: &str) -> RecentEntry {
        RecentEntry {
            path: path.to_string(),
            opened_at: opened_at.to_string(),
        }
    }

    #[test]
    fn 新しいものが先頭に来る() {
        let list = add(&[], entry("/a", "t1"));
        let list = add(&list, entry("/b", "t2"));

        assert_eq!(
            list.iter().map(|e| e.path.as_str()).collect::<Vec<_>>(),
            vec!["/b", "/a"]
        );
    }

    #[test]
    fn 同じパスは重複せず先頭へ移る() {
        let list = add(&[], entry("/a", "t1"));
        let list = add(&list, entry("/b", "t2"));
        let list = add(&list, entry("/a", "t3"));

        assert_eq!(
            list.iter().map(|e| e.path.as_str()).collect::<Vec<_>>(),
            vec!["/a", "/b"]
        );
    }

    #[test]
    fn 開いた時刻が更新される() {
        let list = add(&[], entry("/a", "t1"));
        let list = add(&list, entry("/a", "t2"));

        assert_eq!(list[0].opened_at, "t2");
    }

    #[test]
    fn 上限を超えると古いものから落ちる() {
        let mut list = Vec::new();
        for i in 0..MAX_RECENT_FILES + 5 {
            list = add(&list, entry(&format!("/f{i}"), "t"));
        }

        assert_eq!(list.len(), MAX_RECENT_FILES);
        assert_eq!(list[0].path, format!("/f{}", MAX_RECENT_FILES + 4));
        assert_eq!(list.last().unwrap().path, format!("/f{}", 5));
    }
}
