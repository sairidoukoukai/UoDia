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
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
};
