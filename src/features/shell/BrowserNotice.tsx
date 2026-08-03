/**
 * 対応していないブラウザへの案内（仕様書 §10.4、T-42／T-14）。
 *
 * **できないことを、押す前に伝える。** File System Access API の無いブラウザ
 * （Firefox・Safari）では、保存がダウンロードになり、開き直すたびにファイルを
 * 選び直すことになる。押してから「思っていたのと違う」と気づくより、初めに
 * 一度だけ伝えるほうがよい。
 *
 * ## 一度閉じたら出さない
 *
 * 環境は変わらない。**同じ知らせを毎回出すのは、読まれない知らせを作ること**で
 * ある。閉じたことはこの起動のあいだだけ覚える——保存する値でもない。
 */

import { useState, type ReactElement } from 'react';
import type { PlatformCapabilities } from '@/platform';

export interface BrowserNoticeProps {
  readonly kind: string;
  readonly capabilities: PlatformCapabilities;
}

export function BrowserNotice(props: BrowserNoticeProps): ReactElement | null {
  const [closed, setClosed] = useState(false);

  // デスクトップ版では出さない。伝えるべき制限が無い。
  if (props.kind !== 'web' || props.capabilities.saveInPlace || closed) return null;

  return (
    <div className="notice" role="status">
      <p className="notice__text">
        このブラウザでは<strong>ファイルへの上書き保存ができません</strong>
        。保存はダウンロードになり、
        開き直すときは毎回ファイルを選ぶことになります（「最近使ったファイル」も残りません）。
        Chrome か Edge では、開いたファイルへそのまま保存できます。
      </p>
      <button
        type="button"
        className="notice__close"
        onClick={() => {
          setClosed(true);
        }}
      >
        閉じる
      </button>
    </div>
  );
}
