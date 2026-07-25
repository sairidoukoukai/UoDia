/**
 * アプリケーションのルート。
 *
 * T-01 の時点では起動確認のためのプレースホルダに留める。
 * 実際のレイアウト（上=ダイヤグラム／下=時刻表）は T-32 で実装する。
 */
export function App() {
  return (
    <div className="app-shell">
      <h1>UoDia</h1>
      <p>大阪大学 学内連絡バス ダイヤグラム設計ソフトウェア</p>
      <p className="app-shell__note">T-01: プロジェクト初期化。UI は T-19 以降で実装します。</p>
    </div>
  );
}
