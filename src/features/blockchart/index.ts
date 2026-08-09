export { barEnds, drawBlockChart } from './drawBlockChart';

export {
  selectBlockChartScene,
  totalRows,
  type BlockChartScene,
  type ChartBar,
  type ChartBlock,
  type ChartStop,
} from './scene';

export {
  BLOCK_GAP_ROWS,
  BLOCK_LABEL_WIDTH,
  CHART_EDGE_MARGIN,
  MAX_ROW_HEIGHT,
  MIN_ROW_HEIGHT,
  STOP_LABEL_HEIGHT,
  axisToX,
  blockRowOffsets,
  chartHeight,
  fitBlockChart,
  fitRowHeight,
  rowToY,
  type BlockChartFitOptions,
  type BlockChartViewport,
} from './viewport';

export {
  CELLS_PER_PAGE,
  GRID_COLUMNS,
  GRID_ROWS,
  blockChartCells,
  blockChartPageCount,
  type BlockChartCell,
  type BlockChartPageSize,
} from './grid';
