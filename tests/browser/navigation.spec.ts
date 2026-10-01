import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createTournament } from '../../src/lib/engine';
import { defaultSettings } from '../../src/lib/types';

const code = 'EFC-NAVTESTA';
const tournament = createTournament(
  { ...defaultSettings, name: 'Navigation Cup', knockout: 0 },
  [
    { id: randomUUID(), name: 'One', avatar: '⚽' },
    { id: randomUUID(), name: 'Two', avatar: '🎮' },
  ],
  code,
  '2026-09-27T12:00:00.000Z',
);

async function trackDocument(page: Page) {
  const sentinel = randomUUID();
  await page.evaluate((value) => {
    document.documentElement.dataset.navigationSentinel = value;
  }, sentinel);
  let requests = 0;
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) requests++;
  });
  return async () => {
    expect(requests).toBe(0);
    await expect(page.locator('html')).toHaveAttribute('data-navigation-sentinel', sentinel);
  };
}

async function joinTournament(page: Page) {
  await page.getByRole('button', { name: 'Join a tournament', exact: true }).click();
  await page.getByLabel('Tournament code').fill(code);
  await page.getByRole('button', { name: 'View tournament', exact: true }).click();
}

async function authChanged(page: Page) {
  await page.evaluate(async () => {
    const modulePath = '/src/lib/auth.ts';
    const { auth } = await import(modulePath);
    await auth.auth._notifyAllSubscribers('USER_UPDATED', null);
  });
}

async function pauseBeforePoll(page: Page) {
  // Use the browser clock, not the host clock: the two can drift during setup.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
}

async function prepareCreate(page: Page) {
  await page.addInitScript(() =>
    localStorage.setItem(
      'sb-abcdefghijklmnopqrst-auth-token',
      JSON.stringify({
        access_token: 'browser-test-token',
        refresh_token: 'browser-test-refresh',
        token_type: 'bearer',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: 'browser-test-owner', aud: 'authenticated', email: 'owner@example.com' },
      }),
    ),
  );
  await page.route('**/auth/v1/**', (route) => route.abort('failed'));
  await page.goto('/create');
  await page.getByLabel('Tournament name', { exact: true }).fill('Navigation Cup');
  await page.getByLabel('Number of players', { exact: true }).fill('2');
  for (let i = 1; i <= 2; i++)
    await page.getByLabel(`Player ${i} name`, { exact: true }).fill(`Player ${i}`);
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Continue' }).click();
}

test.beforeEach(async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => sessionStorage.setItem('touchline-intro', '1'));
});

test('internal navigation keeps the app mounted and supports back/forward', async ({ page }) => {
  let reads = 0;
  await page.route('**/api/tournaments/**', async (route) => {
    reads++;
    await route.fulfill({ json: { tournament, canEdit: false } });
  });
  await page.goto('/t/' + code);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Navigation Cup');
  const sameDocument = await trackDocument(page);
  if (page.viewportSize()!.width < 800)
    await page.locator('.mobile-brand').getByRole('link', { name: 'Touchline home' }).click();
  else await page.getByRole('link', { name: /Back to home/ }).click();
  await expect(page).toHaveURL(/\/$/);
  await sameDocument();
  expect(reads).toBe(1);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/t/${code}$`));
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Navigation Cup');
  await sameDocument();
  await page.goForward();
  await expect(page).toHaveURL(/\/$/);
  await sameDocument();
});

test('join reuses its validated snapshot instead of fetching it again on startup', async ({
  page,
}) => {
  let reads = 0;
  const urls: string[] = [];
  await page.route('**/api/tournaments/**', async (route) => {
    reads++;
    urls.push(route.request().url());
    await route.fulfill({ json: { tournament, canEdit: false } });
  });
  await page.goto('/');
  const sameDocument = await trackDocument(page);
  await joinTournament(page);
  await expect(page).toHaveURL(new RegExp(`/t/${code}$`));
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Navigation Cup');
  expect({ reads, urls }).toEqual({ reads: 1, urls: [expect.any(String)] });
  await sameDocument();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('touchline-recent')!))).toEqual([
    { code, name: 'Navigation Cup' },
  ]);
});

test('create reuses the server response when entering the new admin dashboard', async ({
  page,
}) => {
  let creates = 0;
  let reads = 0;
  await page.route('**/api/tournaments**', async (route) => {
    if (route.request().method() === 'POST') {
      creates++;
      await route.fulfill({ json: { tournament, canEdit: true } });
    } else {
      reads++;
      await route.fulfill({ json: { tournament, canEdit: true } });
    }
  });
  await prepareCreate(page);
  const sameDocument = await trackDocument(page);
  await page.getByRole('button', { name: 'Create tournament', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/t/${code}/admin$`));
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Navigation Cup');
  expect(creates).toBe(1);
  expect(reads).toBe(0);
  await sameDocument();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('touchline-recent')!))).toEqual([
    { code, name: 'Navigation Cup' },
  ]);
});

test('a reused join handoff still refreshes on later auth revisions in StrictMode', async ({
  page,
}) => {
  let reads = 0;
  await page.route('**/api/tournaments/**', (route) => {
    reads++;
    return route.fulfill({
      json:
        reads === 1
          ? { tournament, canEdit: true }
          : { unchanged: true, version: tournament.version, canEdit: false },
    });
  });
  await page.goto('/');
  await joinTournament(page);
  await expect(page.locator('.viewer-badge')).toHaveText('Administrator');
  expect(reads).toBe(1);
  await pauseBeforePoll(page);
  await authChanged(page);
  await expect(page.locator('.viewer-badge')).toHaveText('Spectator');
  expect(reads).toBe(2);
  await authChanged(page);
  await expect.poll(() => reads).toBe(3);
});

test('a reused create handoff refreshes a renewed token without replacing the admin draft', async ({
  page,
}) => {
  let reads = 0;
  await page.route('**/api/tournaments**', (route) => {
    if (route.request().method() === 'POST')
      return route.fulfill({ json: { tournament, canEdit: true } });
    reads++;
    return route.fulfill({
      json: { unchanged: true, version: tournament.version, canEdit: true },
    });
  });
  await prepareCreate(page);
  await page.getByRole('button', { name: 'Create tournament', exact: true }).click();
  await page.getByLabel('Tournament name', { exact: true }).fill('Unsaved handoff draft');
  expect(reads).toBe(0);
  await pauseBeforePoll(page);
  await page.evaluate(async () => {
    const modulePath = '/src/lib/auth.ts';
    const { auth } = await import(modulePath);
    const { data } = await auth.auth.getSession();
    await auth.auth._notifyAllSubscribers('TOKEN_REFRESHED', {
      ...data.session,
      access_token: 'renewed-handoff-token',
    });
  });
  await expect.poll(() => reads).toBe(1);
  await expect(page.getByLabel('Tournament name', { exact: true })).toHaveValue(
    'Unsaved handoff draft',
  );
});

for (const operation of ['Join', 'Create'] as const) {
  test(`${operation} rejects a handoff when auth changes during its outstanding request`, async ({
    page,
  }) => {
    let held = false;
    let reads = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/tournaments**', async (route) => {
      const isHandoff = operation === 'Create' ? route.request().method() === 'POST' : !held;
      if (isHandoff) {
        held = true;
        await gate;
        await route.fulfill({ json: { tournament, canEdit: true } });
      } else {
        reads++;
        // A rejected handoff must not be used as the lightweight refresh baseline.
        expect(route.request().headers()['x-tournament-version']).toBeUndefined();
        await route.fulfill({ json: { tournament, canEdit: false } });
      }
    });
    try {
      if (operation === 'Create') {
        await prepareCreate(page);
        await page.getByRole('button', { name: 'Create tournament', exact: true }).click();
      } else {
        await page.goto('/');
        await joinTournament(page);
      }
      await expect.poll(() => held).toBe(true);
      await pauseBeforePoll(page);
      const sameDocument = await trackDocument(page);
      await authChanged(page);
      release();
      await expect(page.locator('.viewer-badge')).toHaveText('Spectator');
      expect(reads).toBe(1);
      await sameDocument();
      await expect(page.getByLabel('Tournament name', { exact: true })).toHaveCount(0);
    } finally {
      release();
    }
  });
}

test('auth changes before the lazy dashboard mounts invalidate the pending handoff', async ({
  page,
}) => {
  let held = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/src/components/Dashboard.tsx*', async (route) => {
    held = true;
    await gate;
    await route.continue();
  });
  let reads = 0;
  await page.route('**/api/tournaments/**', (route) => {
    reads++;
    return route.fulfill({ json: { tournament, canEdit: reads === 1 } });
  });
  try {
    await page.goto('/');
    await joinTournament(page);
    await expect.poll(() => held).toBe(true);
    await pauseBeforePoll(page);
    expect(reads).toBe(1);
    await authChanged(page);
    release();
    await expect(page.locator('.viewer-badge')).toHaveText('Spectator');
    expect(reads).toBe(2);
  } finally {
    release();
  }
});
