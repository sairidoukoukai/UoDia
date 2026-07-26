//! 実行環境に応じた描画設定。
//!
//! WSLg の既定経路（Wayland）では WebKitGTK の EGL 初期化が失敗し、**ウィンドウ
//! そのものが作られない**。タスクバーには項目が現れるため、起動していないのか
//! 描けていないのかも判別しにくい。
//!
//! ```text
//! MESA: error: ZINK: failed to choose pdev
//! libEGL warning: egl: failed to create dri2 screen
//! ```
//!
//! **この設定はアプリ自身が行う。** 起動スクリプトで環境変数を渡す方式だと、
//! 配布したバイナリ（.deb / AppImage）を直接実行したときに効かない。利用者は
//! 開発用のスクリプトなど使わない。
//!
//! GTK は初期化時に `GDK_BACKEND` を読むため、ウィンドウを作る前に設定する
//! 必要がある。

/// WSL で用いる設定。
///
/// - `GDK_BACKEND=x11` — **これが要**。X11（Xwayland）経由なら描画される。
/// - 残りは GPU を諦めてソフトウェア描画に倒すためのもの。無くてもウィンドウは
///   出るが、`libEGL warning: DRI3 error` が出続けて紛らわしい。
#[cfg(target_os = "linux")]
const WSL_ENV: [(&str, &str); 4] = [
    ("GDK_BACKEND", "x11"),
    ("WEBKIT_DISABLE_DMABUF_RENDERER", "1"),
    ("LIBGL_ALWAYS_SOFTWARE", "1"),
    ("GALLIUM_DRIVER", "llvmpipe"),
];

/// WSL 上か。
///
/// `WSL_DISTRO_NAME` だけでは、環境変数を引き継がない起動経路で取りこぼす。
/// カーネル名も見る。
#[cfg(target_os = "linux")]
fn is_wsl() -> bool {
    if std::env::var_os("WSL_DISTRO_NAME").is_some() {
        return true;
    }
    std::fs::read_to_string("/proc/sys/kernel/osrelease")
        .map(|release| release.to_ascii_lowercase().contains("microsoft"))
        .unwrap_or(false)
}

/// 必要なら描画設定を入れる。**ウィンドウを作る前に呼ぶ。**
///
/// 既に設定されている値は上書きしない。利用者が意図して指定した設定を
/// 奪わないためである。
#[cfg(target_os = "linux")]
pub fn configure() {
    if !is_wsl() {
        return;
    }
    for (key, value) in WSL_ENV {
        if std::env::var_os(key).is_none() {
            std::env::set_var(key, value);
        }
    }
}

/// Linux 以外では何もしない。
#[cfg(not(target_os = "linux"))]
pub fn configure() {}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;

    #[test]
    fn 設定する値に描画の要が含まれている() {
        // GDK_BACKEND=x11 が無いとウィンドウが作られない。落とせない設定である。
        assert!(WSL_ENV.contains(&("GDK_BACKEND", "x11")));
    }

    #[test]
    fn 設定の名前が重複しない() {
        let mut keys: Vec<&str> = WSL_ENV.iter().map(|(k, _)| *k).collect();
        keys.sort_unstable();
        let count = keys.len();
        keys.dedup();
        assert_eq!(keys.len(), count);
    }

    #[test]
    fn 既に設定されている値を上書きしない() {
        // 利用者が意図して指定した設定を奪わない。
        let key = "GDK_BACKEND";
        let original = std::env::var_os(key);
        std::env::set_var(key, "wayland");

        configure();

        assert_eq!(std::env::var(key).unwrap(), "wayland");
        match original {
            Some(value) => std::env::set_var(key, value),
            None => std::env::remove_var(key),
        }
    }
}
