import { expect, test, type Page } from '@playwright/test';
import { applyAction, createTournament } from '../../src/lib/engine';
import { defaultSettings } from '../../src/lib/types';

const session = {
  access_token: 'dummy-access',
  refresh_token: 'dummy-refresh',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: {
    id: 'owner-user',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'owner@example.com',
  },
};
const cups = ['EFC-ABCDEFGH', 'EFC-BCDEFGHJ'].map((code, i) =>
  applyAction(
    createTournament(
      { ...defaultSettings, name: `Lifecycle Cup ${i + 1}`, knockout: 0 },
      ['One', 'Two'].map((name) => ({ id: crypto.randomUUID(), name, avatar: '⚽' })),
      code,
      '2026-10-01T00:00:00Z',
    ),
    { type: 'start' },
    '2026-10-01T00:00:00Z',
  ),
);
const firstPath = '/t/' + cups[0].code;
const secondPath = '/t/' + cups[1].code;

async function navigate(page: Page, path: string) {
  await page.evaluate(async (path) => {
    const modulePath = '/src/lib/navigation.ts';
    (await import(modulePath)).navigate(path);
  }, path);
}
async function markDocument(page: Page) {
  await page.evaluate(() => {
    document.documentElement.dataset.lifecycleDocument = 'original';
  });
}
async function sameDocument(page: Page) {
  await expect(page.locator('html')).toHaveAttribute('data-lifecycle-document', 'original');
}
async function dirtyScore(page: Page) {
  const nav =
    page.viewportSize()!.width < 800 ? page.locator('.mobile-nav') : page.locator('.sidebar nav');
  await nav.getByRole('button', { name: 'Matches', exact: true }).click();
  await page.locator('.match-card').first().click();
  await page.getByLabel('One score', { exact: true }).fill('7');
}

test.beforeEach(async ({ page, context }) => {
  await context.setOffline(false);
  await page.addInitScript((session) => {
    sessionStorage.setItem('touchline-intro', '1');
    localStorage.setItem('sb-abcdefghijklmnopqrst-auth-token', JSON.stringify(session));
  }, session);
  await page.route('**/auth/v1/**', (route) => route.abort());
  await page.route('**/api/tournaments', (route) =>
    route.fulfill({
      json: {
        tournaments: cups.map((t) => ({
          code: t.code,
          name: t.settings.name,
          players: 2,
          knockout: 0,
          status: t.status,
        })),
      },
    }),
  );
  await page.route('**/api/tournaments/**', (route) => {
    const tournament = cups.find((t) => route.request().url().includes(t.code))!;
    return route.fulfill({ json: { tournament, canEdit: true } });
  });
});

for (const direction of ['back', 'forward'] as const) {
  test(`dirty score ${direction}: cancel restores URL/state; accept traverses in the same document`, async ({
    page,
  }) => {
    await page.goto('/');
    await markDocument(page);
    await page.getByRole('link', { name: /Lifecycle Cup 1/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Lifecycle Cup 1');
    if (direction === 'forward') {
      await navigate(page, secondPath);
      await expect(page.getByRole('heading', { level: 1 })).toContainText('Lifecycle Cup 2');
      await page.goBack();
      await expect(page.getByRole('heading', { level: 1 })).toContainText('Lifecycle Cup 1');
    }
    await dirtyScore(page);
    const state = await page.evaluate(() => history.state);
    let dismissed = false;
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toBe('Discard the scores you have not saved?');
      await dialog.dismiss();
      dismissed = true;
    });
    await page.evaluate((direction) => history[direction](), direction);
    await expect.poll(() => dismissed).toBe(true);
    await expect(page).toHaveURL(new RegExp(firstPath + '$'));
    await expect(page.getByLabel('One score', { exact: true })).toHaveValue('7');
    await expect.poll(() => page.evaluate(() => history.state)).toEqual(state);
    await sameDocument(page);
    page.once('dialog', (dialog) => dialog.accept());
    await page.evaluate((direction) => history[direction](), direction);
    await expect(page).toHaveURL(new RegExp(direction === 'back' ? '/$' : secondPath + '$'));
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await sameDocument(page);
    // Cancellation must not truncate or add entries to either side of history.
    await page.evaluate(
      (direction) => history[direction === 'back' ? 'forward' : 'back'](),
      direction,
    );
    await expect(page).toHaveURL(new RegExp(firstPath + '$'));
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Lifecycle Cup 1');
  });
}

test('ordinary SPA navigation uses the same dirty-score confirmation', async ({ page }) => {
  await page.goto(firstPath);
  await markDocument(page);
  await dirtyScore(page);
  page.once('dialog', (dialog) => dialog.dismiss());
  await navigate(page, '/');
  await expect(page).toHaveURL(new RegExp(firstPath + '$'));
  await expect(page.getByLabel('One score', { exact: true })).toHaveValue('7');
  page.once('dialog', (dialog) => dialog.accept());
  await navigate(page, '/');
  await expect(page.getByRole('heading', { name: 'My Tournaments' })).toBeVisible();
  await sameDocument(page);
});

test('OAuth callback can enter Create without a document reload', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem('sb-abcdefghijklmnopqrst-auth-token');
    localStorage.setItem(
      'sb-abcdefghijklmnopqrst-auth-token-code-verifier',
      JSON.stringify('dummy-verifier'),
    );
  });
  await page.route('**/auth/v1/token?grant_type=pkce', (route) => route.fulfill({ json: session }));
  await page.goto('/auth/callback?code=dummy-code');
  await expect(page.getByRole('heading', { name: 'My Tournaments' })).toBeVisible();
  await markDocument(page);
  await page.getByRole('link', { name: /Create new tournament/ }).click();
  await expect(page).toHaveURL(/\/create$/);
  await expect(page.getByLabel('Tournament name', { exact: true })).toBeVisible();
  await sameDocument(page);
});

test('modified, target, download and external anchors retain native defaults', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'My Tournaments' })).toBeVisible();
  await markDocument(page);
  // Observe defaultPrevented after React handles the click, then suppress the
  // browser default so this assertion does not launch downloads or other tabs.
  const prevented = await page
    .getByRole('link', { name: /Create new tournament/ })
    .evaluate((anchor) => {
      const outcomes: boolean[] = [];
      const variants = [
        { ctrlKey: true },
        { metaKey: true },
        { shiftKey: true },
        { altKey: true },
        { button: 1 },
        { target: '_blank' },
        { download: 'file' },
        { href: 'https://example.com/' },
        { rel: 'external' },
      ];
      for (const variant of variants) {
        const saved = anchor.outerHTML;
        for (const key of ['target', 'download', 'href', 'rel'] as const)
          if (key in variant) anchor.setAttribute(key, String(variant[key]));
        document.addEventListener(
          'click',
          (event) => {
            outcomes.push(event.defaultPrevented);
            event.preventDefault();
          },
          { once: true },
        );
        anchor.dispatchEvent(
          new MouseEvent('click', { bubbles: true, cancelable: true, ...variant }),
        );
        const original = new DOMParser().parseFromString(saved, 'text/html').querySelector('a')!;
        for (const key of ['target', 'download', 'href', 'rel']) {
          if (original.hasAttribute(key)) anchor.setAttribute(key, original.getAttribute(key)!);
          else anchor.removeAttribute(key);
        }
      }
      return outcomes;
    });
  expect(prevented).toEqual(Array(9).fill(false));
  await expect(page).toHaveURL(/\/$/);
  await sameDocument(page);
});

for (const gesture of ['control', 'middle'] as const) {
  test(`${gesture} click opens a native new page without replacing the current document`, async ({
    page,
    context,
  }, testInfo) => {
    test.skip(
      gesture === 'middle' && testInfo.project.name === 'mobile',
      'Pixel touch emulation does not reliably open tabs for native middle-click; desktop covers this gesture.',
    );
    await page.goto('/');
    await markDocument(page);
    const opened = context.waitForEvent('page');
    await page
      .getByRole('link', { name: /Create new tournament/ })
      .click(gesture === 'middle' ? { button: 'middle' } : { modifiers: ['Control'] });
    const other = await opened;
    await expect(other).toHaveURL(/\/create$/);
    await expect(page).toHaveURL(/\/$/);
    await sameDocument(page);
    await other.close();
  });
}

test('tournament and admin pathname transitions isolate dashboard state', async ({ page }) => {
  await page.goto(firstPath);
  await markDocument(page);
  const nav =
    page.viewportSize()!.width < 800 ? page.locator('.mobile-nav') : page.locator('.sidebar nav');
  await nav.getByRole('button', { name: 'Matches', exact: true }).click();
  await page.getByRole('button', { name: 'completed', exact: true }).click();
  await navigate(page, secondPath);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Lifecycle Cup 2');
  await expect(nav.getByRole('button', { name: 'Overview', exact: true })).toHaveClass('active');
  await nav.getByRole('button', { name: 'Matches', exact: true }).click();
  await expect(page.getByRole('button', { name: 'all', exact: true })).toHaveClass('active');
  await navigate(page, secondPath + '/admin');
  await expect(nav.getByRole('button', { name: 'Admin', exact: true })).toHaveClass('active');
  await navigate(page, secondPath);
  await expect(nav.getByRole('button', { name: 'Overview', exact: true })).toHaveClass('active');
  await sameDocument(page);
});
