/**
 * File System Access API の型宣言。
 *
 * TypeScript の標準ライブラリにはまだ含まれていない（`FileSystemFileHandle`
 * 自体はあるが、権限の問い合わせと picker が無い）。**使う分だけ**書く。
 * 仕様の全体を写すと、実際には呼んでいない部分の宣言が古びていく。
 */

interface FileSystemPermissionDescriptor {
  readonly mode: 'read' | 'readwrite';
}

type PermissionState = 'granted' | 'denied' | 'prompt';

interface FileSystemFileHandle {
  /** 今の権限を問い合わせる。求め直しはしない。 */
  queryPermission(descriptor: FileSystemPermissionDescriptor): Promise<PermissionState>;
  /** 権限を求める。利用者への確認が出ることがある。 */
  requestPermission(descriptor: FileSystemPermissionDescriptor): Promise<PermissionState>;
}

interface FilePickerAcceptType {
  readonly description?: string;
  readonly accept: Readonly<Record<string, readonly string[]>>;
}

interface OpenFilePickerOptions {
  readonly types?: readonly FilePickerAcceptType[];
  readonly multiple?: boolean;
}

interface SaveFilePickerOptions {
  readonly suggestedName?: string;
  readonly types?: readonly FilePickerAcceptType[];
}

interface Window {
  showOpenFilePicker(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>;
  showSaveFilePicker(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>;
}
