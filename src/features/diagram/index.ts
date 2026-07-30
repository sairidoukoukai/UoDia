export { DiagramCanvas } from './DiagramCanvas';

export {
  attachDiagram,
  paintDiagram,
  type DiagramHostOptions,
  type DiagramStore,
} from './canvasHost';

export { drawDiagram, tripPolyline, type DrawContext } from './drawDiagram';

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
  selectDiagramScene,
  type DiagramScene,
  type ScenePoint,
  type SceneStop,
  type SceneTheme,
  type SceneTrip,
} from './scene';

export {
  AXIS_LABEL_WIDTH,
  DIAGRAM_END_TIME,
  DIAGRAM_START_TIME,
  TIME_LABEL_HEIGHT,
  axisToY,
  fitBackingStore,
  isTimeVisible,
  plotXRange,
  timeToX,
  viewportEndAxis,
  viewportEndTime,
  viewportOf,
  xToTime,
  yToAxis,
  type Viewport,
} from './viewport';
