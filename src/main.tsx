import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import { createPlatform, PlatformProvider } from '@/platform';
import '@/app/styles.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('#root が見つかりません');
}

// トップレベル await は使わない。デスクトップ版のビルド対象（chrome105 /
// safari15）に無く、Web 単体のビルドだけが通って気づけないため。
// 実装の選択は createPlatform に閉じている。起動側は環境を知らない。
void createPlatform().then((platform) => {
  createRoot(container).render(
    <StrictMode>
      <PlatformProvider platform={platform}>
        <App />
      </PlatformProvider>
    </StrictMode>,
  );
});
