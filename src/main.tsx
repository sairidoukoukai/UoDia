import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import { createPlatform, PlatformProvider } from '@/platform';
import '@/app/styles.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('#root が見つかりません');
}

// 実装の選択は createPlatform に閉じている。起動側は環境を知らない。
const platform = await createPlatform();

createRoot(container).render(
  <StrictMode>
    <PlatformProvider platform={platform}>
      <App />
    </PlatformProvider>
  </StrictMode>,
);
