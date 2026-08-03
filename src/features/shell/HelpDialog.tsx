/**
 * ヘルプの窓（T-37）。
 *
 * ショートカットの一覧は `commands.ts` の表から作る。**手で書き写した一覧は
 * 必ず古くなる**——鍵を変えたときに直し忘れると、書いてあるとおりに押しても
 * 動かない案内になる。
 *
 * `<dialog>` をそのまま使う理由は `FileDialogHost` と同じである（焦点の
 * 閉じ込め・<kbd>Esc</kbd>・背景の不活性化をブラウザに任せる。§9.4）。
 */

import { useEffect, useRef, type ReactElement } from 'react';
import { COMMANDS, MENUS, commandsIn, formatAccelerator } from './commands';
import { APP_VERSION } from './version';

/** 何を出しているか。`null` なら閉じている。 */
export type HelpTopic = 'shortcuts' | 'about';

export interface HelpDialogProps {
  readonly topic: HelpTopic | null;
  readonly onClose: () => void;
}

export function HelpDialog({ topic, onClose }: HelpDialogProps): ReactElement {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;

    if (topic === null) {
      if (dialog.open) dialog.close();
      return;
    }
    if (!dialog.open) dialog.showModal();
  }, [topic]);

  return (
    <dialog
      ref={ref}
      className="help-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {topic === 'shortcuts' && <Shortcuts />}
      {topic === 'about' && <About />}
      <div className="help-dialog__actions">
        <button type="button" onClick={onClose}>
          閉じる
        </button>
      </div>
    </dialog>
  );
}

function Shortcuts(): ReactElement {
  return (
    <>
      <h2>キーボードショートカット</h2>
      {MENUS.map((menu) => {
        const commands = commandsIn(menu.id, COMMANDS).filter(
          (command) => command.accelerator !== undefined,
        );
        if (commands.length === 0) return null;

        return (
          <section key={menu.id}>
            <h3>{menu.label}</h3>
            <table className="help-dialog__keys">
              <tbody>
                {commands.map((command) => (
                  <tr key={command.id}>
                    <th scope="row">{command.label}</th>
                    <td>
                      {command.accelerator === undefined
                        ? ''
                        : formatAccelerator(command.accelerator)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
      <p className="help-dialog__note">
        <kbd>Delete</kbd>{' '}
        は焦点のある場所で決まります（列見出しなら選んだ便の削除、升目なら時刻を消す）。
      </p>
    </>
  );
}

function About(): ReactElement {
  return (
    <>
      <h2>UoDia について</h2>
      <p>大阪大学 学内連絡バス（再履バス）のダイヤグラム設計ソフトウェア</p>
      <p className="help-dialog__note">版数 {APP_VERSION}</p>
      <p className="help-dialog__note">
        大阪大学の公式なソフトウェアではありません。時刻の正しさは利用者が確かめてください。
      </p>
    </>
  );
}
