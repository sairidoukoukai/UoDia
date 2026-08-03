/**
 * 文書情報のダイアログ（仕様書 §5.10、#144）。
 *
 * 文書名・作成者・メモを直す場所である。ツールバーの隅に置いていた文書名の
 * 記入欄（T-35 の積み残し）を、ここへ引き取った。
 *
 * `<dialog>` をそのまま使う理由は `SettingsDialog` と同じである（焦点の
 * 閉じ込め・<kbd>Esc</kbd>・背景の不活性化をブラウザに任せる。§9.4）。
 *
 * ## 打った時点で効く
 *
 * 設定ダイアログの区間所要時間（§6.5.1）と違い、ここには「適用」が要らない。
 * **直しても他の値は動かない**——文書名を変えても便の時刻は変わらない。戻す
 * 先も明らかで、打ち直せばよい。
 *
 * 連続した打鍵は 1 回の取り消しにまとまる（`mergeKey`）。1 文字ずつ取り消す
 * 履歴は、文字の編集としては正しくても、便の編集を探すときに邪魔になる。
 */

import { useEffect, useRef, type ReactElement } from 'react';
import { useAppStore } from '@/store';

export interface DocumentDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function DocumentDialog(props: DocumentDialogProps): ReactElement {
  const ref = useRef<HTMLDialogElement>(null);
  const document = useAppStore((state) => state.project?.document ?? null);
  const editProject = useAppStore((state) => state.editProject);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;

    if (!props.open) {
      if (dialog.open) dialog.close();
      return;
    }
    if (!dialog.open) dialog.showModal();
  }, [props.open]);

  const change = (field: 'name' | 'author' | 'comment', value: string): void => {
    editProject(
      '文書情報の変更',
      (project) => {
        project.document[field] = value;
      },
      `document.${field}`,
    );
  };

  return (
    <dialog
      ref={ref}
      className="settings"
      aria-label="文書情報"
      onCancel={(event) => {
        event.preventDefault();
        props.onClose();
      }}
    >
      <section className="settings__panel">
        {document === null ? (
          <p className="settings__note">プロジェクトを開いていません</p>
        ) : (
          <>
            <label className="settings__field">
              文書名
              <input
                value={document.name}
                onChange={(event) => {
                  change('name', event.target.value);
                }}
              />
            </label>

            <label className="settings__field">
              作成者
              <input
                value={document.author}
                onChange={(event) => {
                  change('author', event.target.value);
                }}
              />
            </label>

            <label className="settings__field settings__field--block">
              メモ
              <textarea
                rows={3}
                value={document.comment}
                onChange={(event) => {
                  change('comment', event.target.value);
                }}
              />
            </label>
          </>
        )}
      </section>

      <div className="settings__actions">
        <button type="button" onClick={props.onClose}>
          閉じる
        </button>
      </div>
    </dialog>
  );
}
