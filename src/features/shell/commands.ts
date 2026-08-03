/**
 * 操作の一覧（仕様書 §8.1、T-37）。
 *
 * **ここが唯一の定義である。** メニューに並ぶ項目も、キーを押したときに走る
 * ものも、この表を読む。2 か所に書くと、メニューには「Ctrl+S」と出ているのに
 * 押しても何も起きない、という食い違いが**画面を見ても分からない形で**生まれる。
 *
 * ## 何を持ち、何を持たないか
 *
 * 持つのは「どのメニューに、どの名前で、どの鍵で並ぶか」だけである。**何が
 * 起きるかは持たない**——押されたときの動きは状態を知っている側（`App`）が渡す。
 * この表はストアにもプラットフォームにも触れず、純粋なデータのままにしておく。
 *
 * ## <kbd>Delete</kbd> は載せない
 *
 * 仕様書 §8.1 の <kbd>Delete</kbd> は**焦点のある場所で決まる**（列見出しなら
 * 便の削除、升目なら時刻を消す）。全体で 1 つの動きに結び付けられないため、
 * 表には載せず、時刻表が自分で受ける（§6.1.2）。
 *
 * <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>D</kbd>（隠し設定）も
 * 載せない。**隠してあるものをメニューに並べては隠したことにならない。** 有効に
 * する手立ては T-36 が持つ。
 */

/** メニューバーの見出し。並びがそのまま画面の並びになる。 */
export type MenuId = 'file' | 'edit' | 'view' | 'settings' | 'help';

export interface Menu {
  readonly id: MenuId;
  readonly label: string;
}

export const MENUS: readonly Menu[] = [
  { id: 'file', label: 'ファイル' },
  { id: 'edit', label: '編集' },
  { id: 'view', label: '表示' },
  { id: 'settings', label: '設定' },
  { id: 'help', label: 'ヘルプ' },
];

export type CommandId =
  | 'file.new'
  | 'file.open'
  | 'file.save'
  | 'file.saveAs'
  | 'file.backupNow'
  | 'file.documentInfo'
  | 'edit.undo'
  | 'edit.redo'
  | 'edit.copy'
  | 'edit.cut'
  | 'edit.paste'
  | 'edit.selectTool'
  | 'edit.drawTool'
  | 'view.maximizeDiagram'
  | 'view.maximizeTimetable'
  | 'view.resetZoom'
  | 'settings.open'
  | 'help.shortcuts'
  | 'help.about';

/**
 * 鍵の組み合わせ。
 *
 * **<kbd>Ctrl</kbd>（macOS では <kbd>Cmd</kbd>）は必ず要る。** 仕様書 §8.1 の
 * ショートカットはすべて修飾付きであり、修飾の無い 1 文字を横取りすると、
 * 時刻表の升目に数字を打てなくなる。
 */
export interface Accelerator {
  /** 主キー。**小文字で書く**（比べるときも小文字に揃える）。 */
  readonly key: string;
  readonly shift?: true;
  readonly alt?: true;
}

export interface Command {
  readonly id: CommandId;
  readonly menu: MenuId;
  readonly label: string;
  readonly accelerator?: Accelerator;
  /** この項目の前に区切り線を引く。 */
  readonly separatorBefore?: true;
  /**
   * 今その状態かどうかを印で出す（作図の道具・最大化）。
   *
   * **状態はメニューにも出す。** ツールバーを畳んだ以上（#144）、いま選択と
   * 作図のどちらを持っているかを知る場所がメニューしか無い。押しボタンの
   * 「押されている」に当たるものを、メニューでは印で示す。
   */
  readonly checkable?: true;
  /**
   * 記入欄の中では横取りしない。
   *
   * 時刻や運用番号を打っている最中の <kbd>Ctrl</kbd>+<kbd>Z</kbd> は**文字の
   * 取り消し**であり、便の取り消しではない（受入条件）。写す・貼るも同じで、
   * 記入欄の中では文字が相手である（仕様書 §6.1.4）。
   */
  readonly nativeInField?: true;
}

export const COMMANDS: readonly Command[] = [
  { id: 'file.new', menu: 'file', label: '新規', accelerator: { key: 'n' } },
  { id: 'file.open', menu: 'file', label: '開く…', accelerator: { key: 'o' } },
  { id: 'file.save', menu: 'file', label: '上書き保存', accelerator: { key: 's' } },
  {
    id: 'file.saveAs',
    menu: 'file',
    label: '名前を付けて保存…',
    accelerator: { key: 's', shift: true },
  },
  {
    id: 'file.documentInfo',
    menu: 'file',
    label: '文書情報…',
    separatorBefore: true,
  },
  { id: 'file.backupNow', menu: 'file', label: '今すぐバックアップ' },

  {
    id: 'edit.undo',
    menu: 'edit',
    label: '元に戻す',
    accelerator: { key: 'z' },
    nativeInField: true,
  },
  {
    id: 'edit.redo',
    menu: 'edit',
    label: 'やり直す',
    accelerator: { key: 'y' },
    nativeInField: true,
  },
  {
    id: 'edit.copy',
    menu: 'edit',
    label: 'コピー',
    accelerator: { key: 'c' },
    separatorBefore: true,
    nativeInField: true,
  },
  {
    id: 'edit.cut',
    menu: 'edit',
    label: '切り取り',
    accelerator: { key: 'x' },
    nativeInField: true,
  },
  {
    id: 'edit.paste',
    menu: 'edit',
    label: '貼り付け',
    accelerator: { key: 'v' },
    nativeInField: true,
  },
  /*
    作図の道具（仕様書 §6.3.3）。**鍵は与えない。** 作図をやめる <kbd>Esc</kbd>
    は既にあり（T-30）、始める側だけに鍵を足すと釣り合わない。
  */
  {
    id: 'edit.selectTool',
    menu: 'edit',
    label: '選択',
    separatorBefore: true,
    checkable: true,
  },
  { id: 'edit.drawTool', menu: 'edit', label: 'スジ作成', checkable: true },

  {
    id: 'view.maximizeDiagram',
    menu: 'view',
    label: 'ダイヤグラムを最大化',
    accelerator: { key: '1' },
    checkable: true,
  },
  {
    id: 'view.maximizeTimetable',
    menu: 'view',
    label: '時刻表を最大化',
    accelerator: { key: '2' },
    checkable: true,
  },
  {
    id: 'view.resetZoom',
    menu: 'view',
    label: '拡大率を既定に戻す',
    accelerator: { key: '0' },
    separatorBefore: true,
  },

  { id: 'settings.open', menu: 'settings', label: '設定…', accelerator: { key: ',' } },

  { id: 'help.shortcuts', menu: 'help', label: 'キーボードショートカット' },
  { id: 'help.about', menu: 'help', label: 'UoDia について' },
];

/** そのメニューに並ぶ操作。 */
export function commandsIn(menu: MenuId, commands: readonly Command[] = COMMANDS): Command[] {
  return commands.filter((command) => command.menu === menu);
}

/** 押された鍵から操作を引く。当てはまらなければ `null`。 */
export function matchCommand(
  event: {
    readonly key: string;
    readonly ctrlKey: boolean;
    readonly metaKey: boolean;
    readonly shiftKey: boolean;
    readonly altKey: boolean;
  },
  commands: readonly Command[] = COMMANDS,
): Command | null {
  if (!(event.ctrlKey || event.metaKey)) return null;

  const key = event.key.toLowerCase();
  return (
    commands.find(({ accelerator }) => {
      if (accelerator?.key !== key) return false;
      // **修飾は過不足なく一致させる。** Ctrl+S と Ctrl+Shift+S は別の操作で
      // あり、緩く見ると保存のつもりで名前を付けて保存が走る。
      return (
        event.shiftKey === (accelerator.shift ?? false) &&
        event.altKey === (accelerator.alt ?? false)
      );
    }) ?? null
  );
}

/** 画面に出す鍵の綴り（「Ctrl+Shift+S」）。 */
export function formatAccelerator(accelerator: Accelerator): string {
  const parts = ['Ctrl'];
  if (accelerator.shift === true) parts.push('Shift');
  if (accelerator.alt === true) parts.push('Alt');
  parts.push(accelerator.key.length === 1 ? accelerator.key.toUpperCase() : accelerator.key);
  return parts.join('+');
}
