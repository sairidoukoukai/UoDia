/**
 * ダイヤの一覧（仕様書 §5.7、§6.4、T-33）。
 *
 * 切替・追加・改名・削除をここで行う。**画面に出ているのは常に 1 本のダイヤ**
 * であり（`selectActiveService`）、どれを編集しているのかが分かる場所は今まで
 * どこにも無かった。
 *
 * ## 名前は打ちながら書き込む
 *
 * 運用番号の欄（T-22）と同じく、打つたびに `mergeKey` でまとめて履歴に積む。
 * ただし**空の名前は書き込まない**——スキーマが 1 文字以上を求めており、空で
 * 書くと保存はできても開けないファイルになる（`renameService`）。消している
 * 途中の空欄は画面の上だけに留め、離れたときに元へ戻す。
 *
 * ## 削除は確かめてから行う（T-59、#160）
 *
 * 削除は履歴に載っており取り消せる。**それでも確認を挟むのは、戻せることが
 * 画面から読めない**ためである。消えた直後に残るのは、消えたという事実だけで
 * あり、<kbd>Ctrl</kbd>+<kbd>Z</kbd> で戻ると知っている人にしか戻せない。
 * `✕` は名前の欄のすぐ隣にあり、名前を直そうとして端まで動かした指が届く。
 *
 * **問いはここが持つ。** ファイル操作の問い（`features/file`）に相乗りすると、
 * サイドパネルがファイル機能に依存することになる。`showModal()` は他の要素を
 * すべて不活性にするため、**問いが重ならないことはブラウザが保証する**——
 * 「一度に出す問いは 1 つ」（`features/file/dialogs.ts`）を、こちらで数えて
 * 守る必要が無い。
 */

import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { Service } from '@/domain/model';
import { addService, removeService, renameService } from '@/domain/service';
import { selectActiveService, selectServices, useAppStore } from '@/store';

export function ServiceList(): ReactElement {
  const services = useAppStore(selectServices);
  const activeId = useAppStore((state) => selectActiveService(state)?.serviceId ?? null);
  const editProject = useAppStore((state) => state.editProject);
  const clearSelection = useAppStore((state) => state.clearSelection);

  /** 編集対象を移す。**見えていない便を選んだままにしない。** */
  const activate = (serviceId: string): void => {
    if (serviceId === activeId) return;
    clearSelection();
    editProject('ダイヤの切り替え', (project) => {
      project.view.activeServiceId = serviceId;
    });
  };

  const handleAdd = (): void => {
    clearSelection();
    editProject('ダイヤの追加', (project) => {
      const { services: next, added } = addService(project.services);
      project.services = next as Service[];
      // 作ったダイヤへ移る。作ってから探して切り替える、という手間を残さない。
      project.view.activeServiceId = added.serviceId;
    });
  };

  /**
   * 消してよいか尋ねている相手。`null` なら尋ねていない。
   *
   * **`serviceId` ではなく `Service` を持つ。** 問いの中で名前と便数を出すため
   * であり、一覧から引き直すと、尋ねている最中に消えた場合に何を出すか決められない。
   */
  const [pending, setPending] = useState<Service | null>(null);

  const handleRemove = (serviceId: string): void => {
    clearSelection();
    editProject('ダイヤの削除', (project) => {
      const next = removeService(project.services, serviceId);
      if (next === null) return;
      project.services = next as Service[];
      // 消したダイヤを指したままにしない。指し先が無いと先頭に落ちるが
      // （`selectActiveService`）、**保存された設定が壊れたまま残る。**
      if (project.view.activeServiceId === serviceId) {
        project.view.activeServiceId = next[0]?.serviceId ?? null;
      }
    });
  };

  return (
    <section className="panel__section">
      <h2 className="panel__title">ダイヤ</h2>

      <ul className="panel__list">
        {services.map((service) => (
          <li
            key={service.serviceId}
            className={
              service.serviceId === activeId ? 'panel__row panel__row--active' : 'panel__row'
            }
          >
            <input
              type="radio"
              name="active-service"
              aria-label={`${service.serviceName} を編集する`}
              checked={service.serviceId === activeId}
              onChange={() => {
                activate(service.serviceId);
              }}
            />
            <ServiceName
              service={service}
              onRename={(name) => {
                editProject(
                  'ダイヤ名の変更',
                  (project) => {
                    const next = renameService(project.services, service.serviceId, name);
                    if (next !== null) project.services = next as Service[];
                  },
                  // 打っている間の 1 文字ずつを 1 回の取り消しでまとめて戻す。
                  `service.name:${service.serviceId}`,
                );
              }}
            />
            <span className="panel__count">{service.trips.length} 便</span>
            <button
              type="button"
              className="panel__icon-button"
              // **最後の 1 つは消せない**（便の置き場所が無くなる）。
              disabled={services.length <= 1}
              title={`${service.serviceName} を削除`}
              aria-label={`${service.serviceName} を削除`}
              onClick={() => {
                // **押しただけでは消えない。** まず尋ねる（T-59、#160）。
                setPending(service);
              }}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>

      <button type="button" onClick={handleAdd}>
        ダイヤを追加
      </button>

      <ConfirmRemove
        service={pending}
        onCancel={() => {
          setPending(null);
        }}
        onConfirm={() => {
          const target = pending;
          setPending(null);
          if (target !== null) handleRemove(target.serviceId);
        }}
      />
    </section>
  );
}

interface ConfirmRemoveProps {
  /** 尋ねている相手。`null` なら閉じている。 */
  readonly service: Service | null;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * 削除してよいか尋ねる窓（T-59、#160）。
 *
 * `<dialog>` をそのまま使う理由は `FileDialogHost` と同じである——焦点の
 * 閉じ込め・<kbd>Esc</kbd>・背景の不活性化をブラウザに任せる（仕様書 §9.4）。
 *
 * **答えるまで何も起きない。** 消すかどうかを決めるまで、選択も編集中のダイヤも
 * 履歴も動かさない。`handleRemove` を呼ぶのは「削除する」を押したときだけである。
 */
function ConfirmRemove({ service, onConfirm, onCancel }: ConfirmRemoveProps): ReactElement {
  const ref = useRef<HTMLDialogElement>(null);

  // 開閉は効果で行う（`FileDialogHost` / `HelpDialog` と同じ形）。描画の途中で
  // `showModal` を呼ぶと、描き直しのたびに窓を触ることになる。
  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;

    if (service === null) {
      if (dialog.open) dialog.close();
      return;
    }
    if (!dialog.open) dialog.showModal();
  }, [service]);

  return (
    <dialog
      ref={ref}
      className="file-dialog"
      onCancel={(event) => {
        // Esc は「キャンセル」とみなす。既定の動作に任せると、閉じたことを
        // こちら側の状態に伝えられない。
        event.preventDefault();
        onCancel();
      }}
      onClick={(event) => {
        // 背景を押したときもキャンセルとする。`<dialog>` 自身が押されたのは、
        // 中身ではなく余白（＝背景）を押したときだけである。
        if (event.target === ref.current) onCancel();
      }}
    >
      {service !== null && (
        <>
          <h2>ダイヤを削除します</h2>
          {/*
            **便数を出す。** 「本当に削除しますか」だけでは、失うものの大きさが
            分からない。0 便でも尋ねる——「空なら出ない」は覚えられず、**出ない
            場合があると確認そのものを信用しなくなる。**
          */}
          <p>
            {service.serviceName}（{service.trips.length} 便）を削除します。よろしいですか。
          </p>
          <div className="file-dialog__actions">
            {/*
              **既定の焦点はキャンセル。** <kbd>Enter</kbd> を続けて押しても
              消えない。未保存の問い（`FileDialogHost`）で「保存する」に焦点が
              あるのとは逆であり、**理由も逆である**——あちらは押し続けても
              何も失わない。
            */}
            <button type="button" autoFocus onClick={onCancel}>
              キャンセル
            </button>
            <button type="button" onClick={onConfirm}>
              削除する
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}

interface ServiceNameProps {
  readonly service: Service;
  readonly onRename: (name: string) => void;
}

/** 名前の欄。空にしている途中は画面の上だけで持つ。 */
function ServiceName(props: ServiceNameProps): ReactElement {
  const { service } = props;
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <input
      className="panel__name"
      aria-label={`${service.serviceName} の名前`}
      value={draft ?? service.serviceName}
      onChange={(event) => {
        const text = event.target.value;
        setDraft(text);
        if (text.trim() !== '') props.onRename(text);
      }}
      onBlur={() => {
        // 空のまま離れたら元の名前に戻す。書き込んでいないため、状態は無傷である。
        setDraft(null);
      }}
    />
  );
}
