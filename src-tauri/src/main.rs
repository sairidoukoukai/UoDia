// Windows のリリースビルドで追加のコンソールウィンドウを出さない。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    uodia_lib::run()
}
