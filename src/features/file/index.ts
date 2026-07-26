export {
  createFileService,
  type DiscardChoice,
  type FileDialogs,
  type FileService,
  type FileServiceOptions,
} from './fileService';

export {
  useFileDialogs,
  type DialogRequest,
  type DiscardRequest,
  type ErrorRequest,
  type FileDialogController,
  type WarningsRequest,
} from './dialogs';

export { FileDialogHost, type FileDialogHostProps } from './FileDialogHost';

export { APP_NAME, DIRTY_MARK, UNTITLED, formatWindowTitle, suggestFileName } from './title';

export { watchWindowTitle, windowTitleOf } from './windowTitle';
