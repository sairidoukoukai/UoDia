import { expect, test, type Page } from '@playwright/test';

interface Viewport {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly narrow: boolean;
}

const VIEWPORTS: readonly Viewport[] = [
  { name: 'phone-small', width: 320, height: 568, narrow: true },
  { name: 'phone', width: 390, height: 844, narrow: true },
  { name: 'phone-landscape', width: 844, height: 390, narrow: false },
  { name: 'desktop', width: 1440, height: 900, narrow: false },
];

async function expectNoPageOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    documentClientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    bodyClientWidth: document.body.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
    shellClientWidth: document.querySelector<HTMLElement>('.app-shell')?.clientWidth ?? 0,
    shellScrollWidth: document.querySelector<HTMLElement>('.app-shell')?.scrollWidth ?? 0,
  }));

  expect(dimensions.documentScrollWidth).toBeLessThanOrEqual(dimensions.documentClientWidth);
  expect(dimensions.bodyScrollWidth).toBeLessThanOrEqual(dimensions.bodyClientWidth);
  expect(dimensions.shellScrollWidth).toBeLessThanOrEqual(dimensions.shellClientWidth);

  const shellBox = await page.locator('.app-shell').boundingBox();
  expect(shellBox?.x).toBe(0);
  expect(shellBox?.y).toBe(0);
  expect(shellBox?.width).toBe(page.viewportSize()?.width);
  expect(shellBox?.height).toBe(page.viewportSize()?.height);
}

for (const viewport of VIEWPORTS) {
  test(`${viewport.name}のシェルが表示領域に収まる`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.locator('.app-shell')).toBeVisible();

    const compact = page.getByRole('menuitem', { name: 'メニュー' });
    const file = page.getByRole('menuitem', { name: 'ファイル' });
    if (viewport.narrow) {
      await expect(compact).toBeVisible();
      await expect(file).toBeHidden();
      await compact.click();
      await expect(page.getByRole('menu', { name: 'メニュー' })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: '設定…' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(compact).toBeFocused();
    } else {
      await expect(compact).toBeHidden();
      await expect(file).toBeVisible();
    }

    await expectNoPageOverflow(page);
  });
}

test('狭幅メニューから設定へ到達できる', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/');
  await page.getByRole('menuitem', { name: 'メニュー' }).click();
  await page.getByRole('menuitem', { name: '設定…' }).click();

  await expect(page.getByRole('dialog', { name: '設定' })).toBeVisible();
  await expectNoPageOverflow(page);
});

test('幅を跨いで切り替えると見えるメニューへ焦点が移る', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/');
  await page.getByRole('menuitem', { name: 'ファイル' }).press('ArrowDown');
  await expect(page.getByRole('menu', { name: 'file' })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const compact = page.getByRole('menuitem', { name: 'メニュー' });
  await expect(compact).toBeFocused();
  await compact.press('ArrowDown');
  await expect(page.getByRole('menu', { name: 'メニュー' })).toBeVisible();

  await page.setViewportSize({ width: 844, height: 390 });
  const file = page.getByRole('menuitem', { name: 'ファイル' });
  await expect(file).toBeFocused();
  await file.press('ArrowDown');
  await expect(page.getByRole('menu', { name: 'file' })).toBeVisible();
  await expectNoPageOverflow(page);
});

test('390px幅の明暗配色が区別される', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  const colors = async (colorScheme: 'light' | 'dark') => {
    await page.emulateMedia({ colorScheme });
    await page.goto('/');
    await expect(page.locator('.app-shell')).toBeVisible();
    await expectNoPageOverflow(page);
    return page.evaluate(() => {
      const body = getComputedStyle(document.body);
      return {
        background: body.backgroundColor,
        foreground: body.color,
      };
    });
  };

  const light = await colors('light');
  const dark = await colors('dark');
  expect(light.background).not.toBe(light.foreground);
  expect(dark.background).not.toBe(dark.foreground);
  expect(light.background).not.toBe(dark.background);
  expect(light.foreground).not.toBe(dark.foreground);
});
