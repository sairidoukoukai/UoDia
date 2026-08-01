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
 */

import { useState, type ReactElement } from 'react';
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
                handleRemove(service.serviceId);
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
    </section>
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
