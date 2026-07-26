/**
 * 問いかけの見た目（仕様書 §6.8、§9.4）。
 *
 * `<dialog>` をそのまま使う。焦点の閉じ込め・<kbd>Esc</kbd> での取り消し・
 * 背景の不活性化がブラウザ側で行われるため、自前で組むより正しく動く。
 * すべての機能をキーボードだけで操作できること（§9.4）は、ここでは
 * ブラウザの実装に乗ることで満たす。
 */

import { useEffect, useRef, type ReactElement } from 'react';
import type { ProjectWarning } from '@/domain/io';
import type { DialogRequest } from './dialogs';
import type { DialogAnswer } from './prompts';
import { UNTITLED } from './title';

export interface FileDialogHostProps {
  readonly request: DialogRequest | null;
  readonly onRespond: (choice: DialogAnswer) => void;
}

export function FileDialogHost({ request, onRespond }: FileDialogHostProps): ReactElement {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;

    if (request === null) {
      if (dialog.open) dialog.close();
      return;
    }
    if (!dialog.open) dialog.showModal();
  }, [request]);

  return (
    <dialog
      ref={ref}
      className="file-dialog"
      onCancel={(event) => {
        // Esc は「やめる」とみなす。既定の動作に任せると、閉じたことを
        // 待っている側に伝えられない。
        event.preventDefault();
        onRespond('cancel');
      }}
    >
      {request !== null && renderBody(request, onRespond)}
    </dialog>
  );
}

/**
 * 答えを 1 つ返す押しボタン。
 *
 * **先頭の選択肢に `focused` を付ける。** `<dialog>` は開いたときに最初の
 * 操作可能な要素へ焦点を当てるが、それがどれかを見た目の並びから決めさせると、
 * 選択肢を並べ替えたときに既定の答えが黙って変わる。
 */
function Answer({
  answer,
  onRespond,
  focused = false,
  children,
}: {
  readonly answer: DialogAnswer;
  readonly onRespond: (choice: DialogAnswer) => void;
  readonly focused?: boolean;
  readonly children: string;
}): ReactElement {
  return (
    <button
      type="button"
      autoFocus={focused}
      onClick={() => {
        onRespond(answer);
      }}
    >
      {children}
    </button>
  );
}

/** 保存先の名前。まだ保存していなければ「無題」と呼ぶ。 */
function displayName(fileName: string): string {
  return fileName === '' ? UNTITLED : fileName;
}

function renderBody(request: DialogRequest, onRespond: (choice: DialogAnswer) => void) {
  switch (request.kind) {
    case 'discard':
      return (
        <>
          <h2>保存していない変更があります</h2>
          <p>{displayName(request.fileName)} の変更をどうしますか。</p>
          <div className="file-dialog__actions">
            <Answer answer="save" onRespond={onRespond} focused>
              保存して続ける
            </Answer>
            <Answer answer="discard" onRespond={onRespond}>
              破棄して続ける
            </Answer>
            <Answer answer="cancel" onRespond={onRespond}>
              やめる
            </Answer>
          </div>
        </>
      );

    case 'recover':
      return (
        <>
          <h2>前回の編集内容が残っています</h2>
          <p>
            {displayName(request.fileName)} の編集内容が{formatSavedAt(request.savedAt)}{' '}
            の時点で残っています。復元しますか。
          </p>
          <p className="file-dialog__note">
            復元した内容は未保存の状態になります。保存先を選び直してください。
          </p>
          <div className="file-dialog__actions">
            <Answer answer="recover" onRespond={onRespond} focused>
              復元する
            </Answer>
            <Answer answer="discard" onRespond={onRespond}>
              破棄する
            </Answer>
          </div>
        </>
      );

    case 'warnings':
      return (
        <>
          <h2>ファイルを開きました</h2>
          <p>次の点を調整しています。</p>
          <ul className="file-dialog__warnings">
            {request.warnings.map((warning, index) => (
              <li key={`${warning.id}-${String(index)}`}>{describeWarning(warning)}</li>
            ))}
          </ul>
          <div className="file-dialog__actions">
            {/* 伝えるだけの問い。閉じ方が 1 つしか無いため cancel を返す。 */}
            <Answer answer="cancel" onRespond={onRespond} focused>
              閉じる
            </Answer>
          </div>
        </>
      );

    case 'error':
      return (
        <>
          <h2>できませんでした</h2>
          <p className="file-dialog__message">{request.message}</p>
          <div className="file-dialog__actions">
            <Answer answer="cancel" onRespond={onRespond} focused>
              閉じる
            </Answer>
          </div>
        </>
      );
  }
}

/**
 * 書き出した時刻を読める形にする。
 *
 * 「いつの内容か」が分からないと、復元してよいかを判断できない。
 */
function formatSavedAt(savedAt: string): string {
  const time = new Date(savedAt);
  return Number.isNaN(time.getTime()) ? savedAt : time.toLocaleString('ja-JP');
}

/** 警告 1 件を、何が起きたか分かる文にする。 */
function describeWarning(warning: ProjectWarning): string {
  return warning.path === undefined
    ? `${warning.id}: ${warning.message}`
    : `${warning.id}: ${warning.message}（${warning.path}）`;
}
