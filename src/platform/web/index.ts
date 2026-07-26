export { createWebPlatform } from './adapter';

export {
  createBrowserEnvironment,
  createFallbackIo,
  createFileSystemAccess,
  hasFileSystemAccess,
} from './browser';

export { openKeyValueStore } from './idb';

export type {
  FallbackIo,
  FileSystemAccess,
  KeyValueStore,
  PickedFile,
  WebEnvironment,
} from './environment';
