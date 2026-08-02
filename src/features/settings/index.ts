export { PatternsTab, type PatternsTabProps } from './PatternsTab';
export { SettingsDialog, type SettingsDialogProps } from './SettingsDialog';

export { attachUnlock, isUnlockShortcut, type UnlockOptions } from './unlock';

export {
  affectedTripCount as affectedByPatterns,
  changedPatternIds,
  duplicatedPattern,
  movedStop,
  patternRows,
  samePattern,
  withHandling,
  withPatterns,
  withStopAdded,
  withStopRemoved,
  type PatternRow,
} from './patterns';

export {
  affectedTripCount,
  changedEdits,
  parseRunMinutes,
  segmentRows,
  withRunMinutes,
  type SegmentEdits,
  type SegmentRow,
} from './segments';

export {
  applyPatterns,
  applySegmentEdits,
  saveNetworkDef,
  type ApplyResult,
  type SettingsStore,
} from './settingsService';
