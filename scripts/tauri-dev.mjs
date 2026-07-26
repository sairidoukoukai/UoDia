/**
 * `tauri dev` を、環境に合わせた設定で起動する。
 *
 * WSL では WebKitGTK の描画が既定の経路（Wayland）で失敗し、**ウィンドウは
 * 作られるのに何も描かれない**という分かりにくい壊れ方をする。タスクバーに
 * 項目だけが現れるため、起動していないのか描けていないのかも判別しにくい。
 *
 * ```
 * MESA: error: ZINK: failed to choose pdev
 * libEGL warning: egl: failed to create dri2 screen
 * ```
 *
 * 回避策を別のスクリプト名に分けていたが、名前を覚えていないと必ず踏む。
 * 環境を見て自動で切り替える。
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * WSL 上か。
 *
 * `WSL_DISTRO_NAME` だけでは、環境変数を引き継がない起動経路で取りこぼす。
 * カーネル名も見る。
 */
function isWsl() {
  if (process.platform !== 'linux') return false;
  if (process.env['WSL_DISTRO_NAME'] !== undefined) return true;
  try {
    return readFileSync('/proc/sys/kernel/osrelease', 'utf8').toLowerCase().includes('microsoft');
  } catch {
    return false;
  }
}

/**
 * WSL で WebKitGTK を描画させるための設定。
 *
 * - `GDK_BACKEND=x11` — **これが要**。WSLg の Wayland 経路では EGL の初期化に
 *   失敗する。X11（Xwayland）経由なら描画される。
 * - 残りは GPU を諦めてソフトウェア描画に倒すためのもの。無くてもウィンドウは
 *   出るが、`libEGL warning: DRI3 error` が出続けて紛らわしい。
 */
const WSL_ENV = {
  GDK_BACKEND: 'x11',
  WEBKIT_DISABLE_DMABUF_RENDERER: '1',
  LIBGL_ALWAYS_SOFTWARE: '1',
  GALLIUM_DRIVER: 'llvmpipe',
};

const env = { ...process.env };
if (isWsl()) {
  Object.assign(env, WSL_ENV);
  console.log('[tauri-dev] WSL を検出しました。ソフトウェア描画（X11）で起動します。');
}

const child = spawn('npx', ['tauri', 'dev', ...process.argv.slice(2)], {
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

child.on('exit', (code, signal) => {
  process.exit(signal !== null ? 1 : (code ?? 0));
});
