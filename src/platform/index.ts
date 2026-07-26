export {
  MAX_RECENT_FILES,
  type FileHandle,
  type OpenedProject,
  type PlatformAdapter,
  type RecentFile,
} from './types';

export { createMemoryPlatform, type MemoryPlatform, type MemoryPlatformOptions } from './memory';

export { usePlatform } from './context';

export { PlatformProvider, type PlatformProviderProps } from './PlatformProvider';
