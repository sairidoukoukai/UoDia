import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import { createMemoryPlatform, PlatformProvider } from '@/platform';
import '@/app/styles.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('#root が見つかりません');
}

// 実際のアダプタは T-13（Tauri）と T-14（Web）で実装する。それまではインメモリ
// 実装を差し込んでおく。ここを差し替えるだけで環境が切り替わることが、
// PlatformAdapter を設けた目的そのものである。
const platform = createMemoryPlatform();

createRoot(container).render(
  <StrictMode>
    <PlatformProvider platform={platform}>
      <App />
    </PlatformProvider>
  </StrictMode>,
);
