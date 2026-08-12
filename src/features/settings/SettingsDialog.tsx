/**
 * 設定ダイアログ（仕様書 §6.5、T-35）。
 *
 * `<dialog>` をそのまま使う理由は `FileDialogHost` と同じである（焦点の
 * 閉じ込め・<kbd>Esc</kbd>・背景の不活性化をブラウザに任せる。§9.4）。
 *
 * ## 打った値はすぐには効かない
 *
 * 区間所要時間は**適用するまで状態に触れない**（§6.5.1）。打ちかけの「1」で
 * 全便の時刻が動いては、直している最中に画面が跳ね回る。適用の前に**何便に
 * 効くかを出し**、押されてから初めて履歴に載る 1 回の変更にする。
 *
 * 動作・表示の設定は打った時点で効く。こちらは戻す先が明らかで（数を打ち直す
 * だけ）、間違えても何も壊れない。
 */

import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { DIAGRAM_ZOOM_LIMITS, type ViewSettings } from '@/domain/model';
import { DASH_KINDS, DASH_KIND_LABEL, defaultDashKindOf, patternStyles } from '@/features/diagram';
import type { PlatformAdapter } from '@/platform';
import {
  BACKUP_INTERVAL_LIMITS,
  MAX_HISTORY_LIMIT,
  MIN_HISTORY_LIMIT,
  NO_GRID_STYLE_OVERRIDES,
  NO_PATTERN_STYLES,
  selectNetwork,
  selectTrips,
  selectView,
  selectVisibleStops,
  useAppStore,
  type ThemeMode,
} from '@/store';
import {
  clearedGridStyles,
  GRID_STYLES,
  GRID_STYLE_LABEL,
  overrideCount,
  withGridStyleOverride,
} from './gridStyles';
import {
  clearedPatternStyles,
  patternStyleCount,
  withPatternStyle,
  withoutPatternStyle,
} from './patternStyles';
import {
  affectedTripCount,
  changedDistances,
  parseDistanceKm,
  type DistanceEdits,
  changedEdits,
  parseRunMinutes,
  segmentRows,
  type SegmentEdits,
} from './segments';
import { PatternsTab } from './PatternsTab';
import { METERS_PER_KM } from '@/domain/trip';
import { applySegmentEdits, saveNetworkDef } from './settingsService';

/** タブ。 */
type TabId = 'segments' | 'behavior' | 'display' | 'patterns';

const TABS: readonly { readonly id: TabId; readonly label: string }[] = [
  { id: 'segments', label: '区間' },
  { id: 'behavior', label: '動作' },
  { id: 'display', label: '表示' },
];

/** 隠し設定のタブ（§6.5.4）。有効化されるまで出さない。 */
const HIDDEN_TAB = { id: 'patterns', label: '停車パターン' } as const;

export interface SettingsDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly platform: PlatformAdapter;
  /** 起きたことを画面に伝える（ステータスバー）。 */
  readonly onNotice?: (message: string | null) => void;
}

export function SettingsDialog(props: SettingsDialogProps): ReactElement {
  const ref = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<TabId>('segments');
  // **通常の操作では到達できない**（受入条件）。有効化するまでタブ自体が無く、
  // 中身も組み立てない（`unlock.ts`）。
  const unlocked = useAppStore((state) => state.settings.patternsUnlocked);
  const tabs = unlocked ? [...TABS, HIDDEN_TAB] : TABS;

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;

    if (!props.open) {
      if (dialog.open) dialog.close();
      return;
    }
    if (!dialog.open) dialog.showModal();
  }, [props.open]);

  return (
    <dialog
      ref={ref}
      className="settings"
      aria-label="設定"
      onCancel={(event) => {
        event.preventDefault();
        props.onClose();
      }}
    >
      <div className="settings__tabs" role="tablist" aria-label="設定の区分">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            className={tab === entry.id ? 'settings__tab settings__tab--active' : 'settings__tab'}
            onClick={() => {
              setTab(entry.id);
            }}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {props.open && tab === 'segments' && (
        <SegmentsTab platform={props.platform} onNotice={props.onNotice} />
      )}
      {tab === 'behavior' && <BehaviorTab />}
      {tab === 'display' && <DisplayTab />}
      {props.open && unlocked && tab === 'patterns' && (
        <PatternsTab platform={props.platform} onNotice={props.onNotice} />
      )}

      <div className="settings__actions">
        <button type="button" onClick={props.onClose}>
          閉じる
        </button>
      </div>
    </dialog>
  );
}

interface SegmentsTabProps {
  readonly platform: PlatformAdapter;
  readonly onNotice?: ((message: string | null) => void) | undefined;
}

function SegmentsTab(props: SegmentsTabProps): ReactElement {
  const network = useAppStore(selectNetwork);
  const trips = useAppStore(selectTrips);
  /** 打たれている文字。鍵は `segmentKey`。 */
  const [texts, setTexts] = useState<ReadonlyMap<string, string>>(new Map());
  /** 打たれている距離の文字（km）。鍵は `segmentKey`。 */
  const [kmTexts, setKmTexts] = useState<ReadonlyMap<string, string>>(new Map());
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const rows = useMemo(() => (network === null ? [] : segmentRows(network)), [network]);

  /** 打たれた文字のうち、読み取れたもの。 */
  const edits = useMemo<SegmentEdits>(() => {
    const parsed = new Map<string, number>();
    for (const [key, text] of texts) {
      const value = parseRunMinutes(text);
      if (value !== null) parsed.set(key, value);
    }
    return parsed;
  }, [texts]);

  const invalid = useMemo(
    () =>
      [...texts.entries()].filter(([, text]) => parseRunMinutes(text) === null).map(([key]) => key),
    [texts],
  );
  const changed = useMemo(
    () => (network === null ? new Map<string, number>() : changedEdits(network, edits)),
    [network, edits],
  );
  const affected = useMemo(
    () => (network === null ? 0 : affectedTripCount(trips, network, edits)),
    [trips, network, edits],
  );

  /** 打たれた距離のうち、読み取れたもの。 */
  const distanceEdits = useMemo<DistanceEdits>(() => {
    const parsed = new Map<string, number>();
    for (const [key, text] of kmTexts) {
      const value = parseDistanceKm(text);
      if (value !== null) parsed.set(key, value);
    }
    return parsed;
  }, [kmTexts]);

  const invalidKm = useMemo(
    () =>
      [...kmTexts.entries()]
        .filter(([, text]) => parseDistanceKm(text) === null)
        .map(([key]) => key),
    [kmTexts],
  );
  const changedKm = useMemo(
    () => (network === null ? new Map<string, number>() : changedDistances(network, distanceEdits)),
    [network, distanceEdits],
  );

  const reset = (): void => {
    setTexts(new Map());
    setKmTexts(new Map());
    setConfirming(false);
    setMessage(null);
  };

  const apply = (): void => {
    const result = applySegmentEdits(useAppStore, changed, changedKm);
    setConfirming(false);
    setMessage(result.message);
    props.onNotice?.(result.message);
    if (result.ok) {
      setTexts(new Map());
      setKmTexts(new Map());
    }
  };

  const save = (): void => {
    void saveNetworkDef(useAppStore, props.platform).then(
      (said) => {
        if (said !== null) {
          setMessage(said);
          props.onNotice?.(said);
        }
      },
      (error: unknown) => {
        setMessage(`書き戻せません: ${String(error)}`);
      },
    );
  };

  const writable = props.platform.capabilities.networkDefWritable;

  return (
    <section className="settings__panel">
      <table className="settings__segments">
        <thead>
          <tr>
            <th scope="col">区間</th>
            <th scope="col">所要時間</th>
            <th scope="col">距離</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const text = texts.get(row.key) ?? String(row.runMinutes);
            const bad = parseRunMinutes(text) === null;
            // **未設定は空欄。** 0 と見分けられないと、入力漏れが「距離 0」に
            // 化ける（仕様書 v1.1 §6.1.4）。
            const kmText =
              kmTexts.get(row.key) ??
              (row.distanceMeters === undefined ? '' : String(row.distanceMeters / METERS_PER_KM));
            const badKm = kmText !== '' && parseDistanceKm(kmText) === null;
            return (
              <tr key={row.key} className={row.isDeadhead ? 'settings__row--deadhead' : undefined}>
                <th scope="row">
                  {row.label}
                  {row.isDeadhead && <span className="settings__note">（回送）</span>}
                </th>
                <td>
                  <input
                    className={
                      bad ? 'settings__minutes settings__minutes--invalid' : 'settings__minutes'
                    }
                    type="number"
                    step={5}
                    min={0}
                    inputMode="numeric"
                    aria-label={`${row.label} の所要時間（分）`}
                    aria-invalid={bad}
                    value={text}
                    onChange={(event) => {
                      const next = new Map(texts);
                      next.set(row.key, event.target.value);
                      setTexts(next);
                      setConfirming(false);
                    }}
                  />{' '}
                  分
                </td>
                <td>
                  {/*
                    **距離を変えても便の時刻は動かない**（#161、仕様書 v1.1 §6.1.3）。
                    時刻を決めるのは所要時間だけであり、「何便に効くか」の数にも
                    入らない。**5 の倍数の縛りも掛けない**——5 分刻みはダイヤの側の
                    決まりであって、距離にその制約は無い。
                  */}
                  <input
                    className={
                      badKm ? 'settings__minutes settings__minutes--invalid' : 'settings__minutes'
                    }
                    type="number"
                    step={0.1}
                    min={0}
                    inputMode="decimal"
                    aria-label={`${row.label} の距離（km）`}
                    aria-invalid={badKm}
                    value={kmText}
                    onChange={(event) => {
                      const next = new Map(kmTexts);
                      next.set(row.key, event.target.value);
                      setKmTexts(next);
                      setConfirming(false);
                    }}
                  />{' '}
                  km
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {invalid.length > 0 && (
        <p className="settings__error">
          所要時間は 0 以上の <strong>5 の倍数</strong>で入れてください（{invalid.length} 件が
          受け取れません）
        </p>
      )}

      {invalidKm.length > 0 && (
        <p className="settings__error">
          距離は 0 以上の数で入れてください（{invalidKm.length} 件が受け取れません）
        </p>
      )}

      {/*
        適用の前に、何便に効くのかを出す（§6.5.1）。

        **距離は便数に数えない**（#161、仕様書 v1.1 §6.1.3）。時刻を決めるのは
        所要時間だけであり、距離を変えても便は動かない。数に混ぜると、動かない
        変更まで「N 便に効く」と読めてしまう。
      */}
      {changed.size > 0 && (
        <p className="settings__affected">
          所要時間 {changed.size} 区間の変更。<strong>{affected} 便</strong>の時刻が変わります
          （各便のアンカーの時刻は変わりません）
        </p>
      )}
      {changedKm.size > 0 && (
        <p className="settings__affected">
          距離 {changedKm.size} 区間の変更。<strong>便の時刻は変わりません</strong>
        </p>
      )}

      <div className="settings__panel-actions">
        {confirming ? (
          <>
            <span className="settings__confirm">
              {affected} 便の時刻が変わります。よろしいですか？
            </span>
            <button type="button" onClick={apply}>
              適用する
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
              }}
            >
              やめる
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={
              changed.size + changedKm.size === 0 || invalid.length > 0 || invalidKm.length > 0
            }
            onClick={() => {
              setConfirming(true);
            }}
          >
            変更を適用
          </button>
        )}
        <button type="button" disabled={texts.size + kmTexts.size === 0} onClick={reset}>
          入力を元に戻す
        </button>
        <button type="button" onClick={save}>
          {writable ? 'route.json に書き戻す' : 'route.json を書き出す'}
        </button>
      </div>

      {!writable && (
        <p className="settings__note">
          この環境では route.json を書き戻せません（仕様書 §6.5.5）。変更はこのブラウザの中だけで
          有効です。書き出したファイルで route.json を差し替えるまで、ほかの環境には反映されません。
        </p>
      )}

      {message !== null && <p className="settings__message">{message}</p>}
    </section>
  );
}

function BehaviorTab(): ReactElement {
  const limit = useAppStore((state) => state.history.limit);
  const setHistoryLimit = useAppStore((state) => state.setHistoryLimit);
  const backupIntervalMs = useAppStore((state) => state.settings.backupIntervalMs);
  const setSettings = useAppStore((state) => state.setSettings);

  return (
    <section className="settings__panel">
      <label className="settings__field">
        取り消しの段数
        <input
          type="number"
          min={MIN_HISTORY_LIMIT}
          max={MAX_HISTORY_LIMIT}
          value={limit}
          onChange={(event) => {
            setHistoryLimit(Number(event.target.value));
          }}
        />
        <span className="settings__note">
          {MIN_HISTORY_LIMIT}〜{MAX_HISTORY_LIMIT}。範囲の外は収めます
        </span>
      </label>

      <label className="settings__field">
        自動バックアップの間隔
        <input
          type="number"
          min={BACKUP_INTERVAL_LIMITS.min / 60_000}
          max={BACKUP_INTERVAL_LIMITS.max / 60_000}
          value={Math.round(backupIntervalMs / 60_000)}
          onChange={(event) => {
            setSettings({ backupIntervalMs: Number(event.target.value) * 60_000 });
          }}
        />
        <span className="settings__note">分（仕様書 §6.8）</span>
      </label>
    </section>
  );
}

const THEME_LABEL: Record<ThemeMode, string> = {
  system: 'システムに従う',
  light: 'ライト',
  dark: 'ダーク',
};

function DisplayTab(): ReactElement {
  const view = useAppStore((state) => state.settings.defaultDiagramView);
  const theme = useAppStore((state) => state.settings.theme);
  const setSettings = useAppStore((state) => state.setSettings);

  const update = (patch: { pxPerMinute?: number; pxPerAxisUnit?: number }): void => {
    setSettings({ defaultDiagramView: { ...view, ...patch } });
  };

  return (
    <section className="settings__panel">
      {/*
        テーマ（§6.5.3、§9.4）。**ダイヤグラムの配色も一緒に変わる**——canvas は
        この CSS から色を読んでいる（`DiagramCanvas`）。
      */}
      <fieldset className="settings__theme">
        <legend>テーマ</legend>
        {(['system', 'light', 'dark'] as const).map((mode) => (
          <label key={mode} className="settings__radio">
            <input
              type="radio"
              name="theme"
              value={mode}
              checked={theme === mode}
              onChange={() => {
                setSettings({ theme: mode });
              }}
            />
            {THEME_LABEL[mode]}
          </label>
        ))}
      </fieldset>

      <p className="settings__note">
        <kbd>Ctrl</kbd>+<kbd>0</kbd>（拡大率を既定に戻す）が戻す先です。
      </p>

      <label className="settings__field">
        横（1 分あたり）
        <input
          type="number"
          step={0.5}
          min={DIAGRAM_ZOOM_LIMITS.minPxPerMinute}
          max={DIAGRAM_ZOOM_LIMITS.maxPxPerMinute}
          value={view.pxPerMinute}
          onChange={(event) => {
            update({ pxPerMinute: Number(event.target.value) });
          }}
        />
        <span className="settings__note">px</span>
      </label>

      <label className="settings__field">
        縦（軸 1 単位あたり）
        <input
          type="number"
          step={1}
          min={DIAGRAM_ZOOM_LIMITS.minPxPerAxisUnit}
          max={DIAGRAM_ZOOM_LIMITS.maxPxPerAxisUnit}
          value={view.pxPerAxisUnit}
          onChange={(event) => {
            update({ pxPerAxisUnit: Number(event.target.value) });
          }}
        />
        <span className="settings__note">px</span>
      </label>

      <StopGridStyles />
      <PatternStyles />
    </section>
  );
}

/**
 * 表示の上書きを書き換える（T-90、#235）。
 *
 * **履歴に積む。** 運用の色（`blockColors`）と同じ扱いである——文書の見え方を
 * 決める操作であり、取り消せるべきものである。`setSettings` は履歴に載らないが、
 * あれが変えるのは「道具の使い方」であって文書ではない。
 */
function editView(label: string, recipe: (view: ViewSettings) => void): void {
  useAppStore.getState().editProject(label, (project) => {
    recipe(project.view);
  });
}

/**
 * 停車パターンの色と線種（§6.5.3、#147）。
 *
 * **色と線種は独立に選ぶ。** 片方だけ変えても、もう片方は `route.json` のまま
 * である。上書きしていないパターンは既定のままで、`route.json` は書き換わらない。
 */
function PatternStyles(): ReactElement {
  const network = useAppStore(selectNetwork);
  const choices = useAppStore((state) => selectView(state)?.patternStyles ?? NO_PATTERN_STYLES);

  /*
   * **回送も並べる**（#179、2026-08-05 改め）。
   *
   * 当初は「回送かどうかはパターンの好みではない」として外していた。**その線を
   * どう見分けたいかはその人の目の話**であり、営業パターンと変わらない。運用で
   * 着色すると回送は元の便と同じ色になり、太さの違いだけが手掛かりになる。
   */
  const patterns = useMemo(() => network?.def.patterns ?? [], [network]);
  const styles = useMemo(
    () => (network === null ? null : patternStyles(network.def.patterns, choices)),
    [network, choices],
  );

  const count = patternStyleCount(choices);

  return (
    <fieldset className="settings__grid-styles">
      <legend>停車パターンの色と線種</legend>
      <p className="settings__note">
        ダイヤグラムのスジの姿です。<strong>色と線種は別々に選べます</strong>
        。選んでいないパターンは上書きされず、route.json も書き換わりません。
      </p>

      <table className="settings__stops">
        <thead>
          <tr>
            <th scope="col">パターン</th>
            <th scope="col">色</th>
            <th scope="col">線種</th>
          </tr>
        </thead>
        <tbody>
          {patterns.map((pattern) => (
            <tr key={pattern.patternId}>
              <th scope="row">
                {pattern.patternId}
                <span className="settings__note"> {pattern.patternName}</span>
              </th>
              <td>
                <input
                  type="color"
                  aria-label={`${pattern.patternId} の色`}
                  value={styles?.get(pattern.patternId)?.color ?? pattern.color}
                  onChange={(event) => {
                    const color = event.target.value;
                    editView('パターンの色の変更', (view) => {
                      view.patternStyles = withPatternStyle(choices, pattern.patternId, { color });
                    });
                  }}
                />
              </td>
              <td>
                <select
                  aria-label={`${pattern.patternId} の線種`}
                  value={choices[pattern.patternId]?.dash ?? ''}
                  onChange={(event) => {
                    const dash = DASH_KINDS.find((kind) => kind === event.target.value);
                    editView('パターンの線種の変更', (view) => {
                      view.patternStyles = withPatternStyle(choices, pattern.patternId, {
                        dash: dash ?? null,
                      });
                    });
                  }}
                >
                  {/*
                    既定は**描画と同じ関数**から引く（#222）。ここで
                    `serviceType` を読み直していたため、回送を見落として
                    「実線」と書いていた——実際には破線が引かれる。
                  */}
                  <option value="">
                    上書きしない（{DASH_KIND_LABEL[defaultDashKindOf(pattern)]}）
                  </option>
                  {DASH_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {DASH_KIND_LABEL[kind]}
                    </option>
                  ))}
                </select>{' '}
                {/* 上書きしている行にだけ出す。押しても何も起きない印を並べない。 */}
                {choices[pattern.patternId] !== undefined && (
                  <button
                    type="button"
                    aria-label={`${pattern.patternId} の上書きをやめる`}
                    onClick={() => {
                      editView('パターンの上書きをやめる', (view) => {
                        view.patternStyles = withoutPatternStyle(choices, pattern.patternId);
                      });
                    }}
                  >
                    ↺
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="settings__panel-actions">
        <span className="settings__note">
          {count === 0 ? '上書きはありません' : `${String(count)} パターンを上書きしています`}
        </span>
        <button
          type="button"
          disabled={count === 0}
          onClick={() => {
            editView('すべての上書きをやめる', (view) => {
              view.patternStyles = clearedPatternStyles(choices);
            });
          }}
        >
          すべての上書きをやめる
        </button>
      </div>
    </fieldset>
  );
}

/**
 * 停留所の線種（§6.5.3、#133）。
 *
 * **`route.json` の値は消さない。** 選び直せるように「上書きしない」を残し、
 * その横に元の線種を出す。上書きしているつもりが無いのに違う線で描かれる、
 * という状態を作らないためである。
 */
function StopGridStyles(): ReactElement {
  const stops = useAppStore(selectVisibleStops);
  const overrides = useAppStore(
    (state) => selectView(state)?.stopGridStyles ?? NO_GRID_STYLE_OVERRIDES,
  );

  const choose = (stopId: string, value: string): void => {
    // 選ばれた文字が線種かどうかを**照らして**決める。素の文字を線種として
    // 通すと、`<option>` を書き換えたときに型の上では気づけない。
    const style = GRID_STYLES.find((entry) => entry === value) ?? null;
    editView('停留所の線種の変更', (view) => {
      view.stopGridStyles = withGridStyleOverride(overrides, stopId, style);
    });
  };

  const count = overrideCount(overrides);

  return (
    <fieldset className="settings__grid-styles">
      <legend>停留所の線種</legend>
      <p className="settings__note">
        ダイヤグラムの横線の引き方です。<strong>選んでいない停留所は上書きされません</strong>
        で、route.json は書き換わりません。
      </p>

      <table className="settings__stops">
        <thead>
          <tr>
            <th scope="col">停留所</th>
            <th scope="col">線種</th>
          </tr>
        </thead>
        <tbody>
          {stops.map((stop) => (
            <tr key={stop.stopId}>
              <th scope="row">{stop.shortName}</th>
              <td>
                <select
                  aria-label={`${stop.shortName} の線種`}
                  value={overrides[stop.stopId] ?? ''}
                  onChange={(event) => {
                    choose(stop.stopId, event.target.value);
                  }}
                >
                  <option value="">上書きしない（{GRID_STYLE_LABEL[stop.gridStyle]}）</option>
                  {GRID_STYLES.map((style) => (
                    <option key={style} value={style}>
                      {GRID_STYLE_LABEL[style]}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="settings__panel-actions">
        <span className="settings__note">
          {count === 0 ? '上書きはありません' : `${String(count)} 停留所を上書きしています`}
        </span>
        <button
          type="button"
          disabled={count === 0}
          onClick={() => {
            editView('停留所の線種の上書きをやめる', (view) => {
              view.stopGridStyles = clearedGridStyles(overrides);
            });
          }}
        >
          すべての上書きをやめる
        </button>
      </div>
    </fieldset>
  );
}
