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

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { COMMANDS, MENUS, commandsIn, formatAccelerator } from './commands';
import { CREDITS, OFL_FONT } from './credits';
import { APP_VERSION, COPYRIGHT } from './version';

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
      <p className="help-dialog__note">{COPYRIGHT}</p>
      <p className="help-dialog__note">
        大阪大学の公式なソフトウェアではありません。時刻の正しさは利用者が確かめてください。
      </p>
      <Credits />
    </>
  );
}

/**
 * 借りているものの表示（仕様書 v2 §5.4.3、T-77）。
 *
 * **OFL の本文は求められたときに読む。** 92 行の全文を初回ロードに乗せる理由が
 * 無い——読む人は「ライセンスを確かめたい」と思ったときにしか開かない。
 */
function Credits(): ReactElement {
  const [license, setLicense] = useState<string | null>(null);

  return (
    <section className="help-dialog__credits">
      <h3>使っているもの</h3>
      <table className="help-dialog__keys">
        <tbody>
          {CREDITS.map((credit) => (
            <tr key={credit.name}>
              <th scope="row">{credit.name}</th>
              <td>{credit.use}</td>
              <td>{credit.license}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="help-dialog__note">
        {OFL_FONT} は PDF に埋めるためだけに使っています（画面には使いません）。
      </p>
      {license === null ? (
        <button
          type="button"
          onClick={() => {
            void loadOflText().then(setLicense, (error: unknown) => {
              setLicense(`ライセンス本文を読めません: ${String(error)}`);
            });
          }}
        >
          {OFL_FONT} のライセンス本文
        </button>
      ) : (
        <pre className="help-dialog__license">{license}</pre>
      )}
    </section>
  );
}

/** OFL の本文。**押されたときに初めて読む。** */
async function loadOflText(): Promise<string> {
  return (await import('../../../assets/fonts/OFL.txt?raw')).default;
}
