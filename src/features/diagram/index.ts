export { DiagramCanvas, type DiagramCanvasProps } from './DiagramCanvas';

export { DiagramScrollbars, type DiagramScrollbarsProps } from './DiagramScrollbars';

export { cursorAt, type DiagramCursor } from './cursor';

export { STOP_LINE_TOLERANCE, creationTargetAt, type CreationTarget } from './creation';

export { TripContextMenu, type MenuPosition, type TripContextMenuProps } from './TripContextMenu';

export {
  attachDiagram,
  paintDiagram,
  type DiagramHostOptions,
  type DiagramStore,
} from './canvasHost';

export type { DrawContext } from './drawContext';

export { drawDiagram } from './drawDiagram';

export {
  MIN_STOP_LABEL_GAP,
  MIN_TIME_LABEL_GAP,
  drawGrid,
  timeLabelStepMinutes,
  timeLines,
  type TimeLine,
  type TimeLineKind,
} from './drawGrid';

export {
  STUB_LENGTH,
  drawTrips,
  isTripVisible,
  tripPolyline,
  tripPolylines,
  type ScreenPoint,
  type TripPolyline,
} from './drawTrips';

export {
  DEFAULT_DIAGRAM_VIEW,
  axisBoundsOf,
  axisBoundsOfStops,
  clampScroll,
  scrollRanges,
  sameView,
  viewAfterDrag,
  viewAfterWheel,
  viewportForCanvas,
  type AxisBounds,
  type ScrollRanges,
  type WheelInput,
} from './interaction';

export {
  DRAG_THRESHOLD,
  attachTripControls,
  type TripControlOptions,
  type TripControlStore,
} from './tripControls';

export {
  HIT_TOLERANCE,
  distanceToSegment,
  hitTrip,
  nextSelection,
  selectionAfterRect,
  tripsInRect,
} from './selection';

export { REVEAL_LEAD_AXIS, REVEAL_LEAD_MINUTES, viewToReveal } from './reveal';

export {
  attachSelectionReveal,
  type RevealControlOptions,
  type RevealStore,
} from './revealControls';

export {
  attachViewportControls,
  type ViewportControlOptions,
  type ViewportStore,
} from './viewportControls';

export {
  selectDiagramScene,
  type DiagramScene,
  type ScenePoint,
  type SceneStop,
  type SceneTheme,
  type SceneTrip,
} from './scene';

export {
  DASH_BY_KIND,
  DASH_DOT,
  DASH_KINDS,
  DASH_KIND_LABEL,
  DEADHEAD_DASH,
  SOLID,
  assignPatternDashes,
  dashForServiceType,
  patternStyles,
  type PatternStyle,
} from './tripStyle';

export { MIN_CONTRAST, contrastRatio, luminance, readableOn } from './color';

export {
  AXIS_LABEL_WIDTH,
  DIAGRAM_END_TIME,
  DIAGRAM_START_TIME,
  TIME_LABEL_HEIGHT,
  axisToY,
  fitBackingStore,
  isTimeVisible,
  plotXRange,
  screenRect,
  timeToX,
  viewportEndAxis,
  viewportEndTime,
  viewportOf,
  xToTime,
  yToAxis,
  type ScreenRect,
  type Viewport,
} from './viewport';
