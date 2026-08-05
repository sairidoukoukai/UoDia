/**
 * 描画先の型（実装計画書 §3.5）。
 *
 * **canvas そのものは見ない。** 使う機能をここに列挙しておく。増やすときは
 * 「本当に要るか」を一度考えることになり、`ctx` の全機能に手を伸ばした描画を
 * 書きにくくする。テスト側も、この列挙を満たすだけの記録用の器を書けば済む。
 *
 * 描画の各層（`drawGrid` / `drawTrips` / `drawDiagram`）がここだけを参照する
 * ことで、層のあいだに循環した依存が生まれない。
 */

export type DrawContext = Pick<
  CanvasRenderingContext2D,
  | 'save'
  | 'restore'
  | 'clearRect'
  | 'fillRect'
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'stroke'
  | 'arc'
  | 'fill'
  | 'setLineDash'
  | 'fillText'
  | 'rect'
  | 'clip'
> & {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  /**
   * 不透明度（#166）。フォーカス範囲の外を薄く描くために使う。
   *
   * **隠すのではなく薄くする。** 範囲の外の便を消すと、境目をまたぐ便の
   * 繋がりが読めなくなる（仕様書 v1.1 §6.4.1）。
   */
  globalAlpha: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
};
