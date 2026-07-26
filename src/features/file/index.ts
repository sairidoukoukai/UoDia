export { createFileService, type FileService, type FileServiceOptions } from './fileService';

export type { BackupDialogs, DialogAnswer, FileDialogs } from './prompts';

export {
  DEFAULT_BACKUP_INTERVAL_MS,
  createBackupService,
  type BackupService,
  type BackupServiceOptions,
  type RecoverableBackup,
} from './backupService';

export {
  useFileDialogs,
  type DialogRequest,
  type DiscardRequest,
  type ErrorRequest,
  type FileDialogController,
  type RecoverRequest,
  type WarningsRequest,
} from './dialogs';

export { FileDialogHost, type FileDialogHostProps } from './FileDialogHost';

export { APP_NAME, DIRTY_MARK, UNTITLED, formatWindowTitle, suggestFileName } from './title';

export { watchWindowTitle, windowTitleOf } from './windowTitle';
