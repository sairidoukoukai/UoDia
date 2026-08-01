export { DiagramCanvas } from './DiagramCanvas';

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
  depotLane,
  drawGrid,
  timeLabelStepMinutes,
  timeLines,
  type DepotLane,
  type TimeLine,
  type TimeLineKind,
} from './drawGrid';

export {
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
  clampScroll,
  sameView,
  viewAfterDrag,
  viewAfterWheel,
  viewportForCanvas,
  type AxisBounds,
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

export { DEADHEAD_DASH, SOLID, assignPatternDashes, patternDashAt } from './tripStyle';

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
