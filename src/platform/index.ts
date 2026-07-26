export {
  MAX_RECENT_FILES,
  type CloseHandler,
  type FileHandle,
  type OpenedProject,
  type PlatformAdapter,
  type PlatformCapabilities,
  type RecentFile,
} from './types';

export { createMemoryPlatform, type MemoryPlatform, type MemoryPlatformOptions } from './memory';

export { createPlatform, isTauri } from './create';

export { createWebPlatform, hasFileSystemAccess } from './web';

export { usePlatform } from './context';

export { PlatformProvider, type PlatformProviderProps } from './PlatformProvider';
