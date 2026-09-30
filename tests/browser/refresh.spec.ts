import { expect, test, type Page } from '@playwright/test';
import { createTournament, applyAction } from '../../src/lib/engine';
import { defaultSettings } from '../../src/lib/types';

const now = '2026-10-01T00:00:00.000Z';
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
function fixture() {
  return createTournament(
    { ...defaultSettings, name: 'Refresh cup', knockout: 0 },
    ['One', 'Two'].map((name) => ({ id: crypto.randomUUID(), name, avatar: '⚽' })),
    'EFC-ABCDEFGH',
    now,
  );
}
async function signedIn(page: Page) {
  await page.addInitScript((session) => {
    localStorage.setItem('sb-abcdefghijklmnopqrst-auth-token', JSON.stringify(session));
  }, session);
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('touchline-intro', '1'));
});

test('five-second polling uses lightweight unchanged responses and still receives new scores', async ({
  page,
}) => {
  let t = applyAction(fixture(), { type: 'start' }, now);
  const versions: (string | undefined)[] = [];
  let unchanged = 0;
  let full = 0;
  let canEdit = false;
  await page.route('**/api/tournaments/**', (route) => {
    const version = route.request().headers()['x-tournament-version'];
    versions.push(version);
    if (version === String(t.version)) {
      unchanged++;
      return route.fulfill({ json: { unchanged: true, version: t.version, canEdit } });
    }
    full++;
    return route.fulfill({ json: { tournament: t, canEdit } });
  });
  await page.goto('/t/' + t.code);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Refresh cup.');
  const nav =
    page.viewportSize()!.width < 800 ? page.locator('.mobile-nav') : page.locator('.sidebar nav');
  await nav.getByRole('button', { name: 'Matches', exact: true }).click();
  await expect.poll(() => unchanged, { timeout: 8000 }).toBeGreaterThan(0);
  expect(full).toBe(1);
  expect(versions[0]).toBeUndefined();
  expect(versions.at(-1)).toBe(String(t.version));
  t = applyAction(
    t,
    { type: 'score', matchId: t.matches[0].id, home: 3, away: 1, confirmEdit: false },
    now,
  );
  await expect(page.locator('.match-card').first().locator('.match-score')).toHaveText('3–1', {
    timeout: 8000,
  });
  expect(full).toBe(2);
  // Permission changes must be accepted even when the tournament version stays unchanged.
  canEdit = true;
  await page.getByRole('button', { name: 'Refresh tournament', exact: true }).click();
  await expect(page.locator('.viewer-badge')).toHaveText('Administrator');
  expect(full).toBe(2);
  canEdit = false;
  await page.getByRole('button', { name: 'Refresh tournament', exact: true }).click();
  await expect(page.locator('.viewer-badge')).toHaveText('Spectator');
  await expect(page.locator('.match-card')).toHaveCount(t.matches.length);
});

test('equivalent auth events do not refetch, and token renewal preserves an unsaved admin draft', async ({
  page,
}) => {
  const t = fixture();
  await signedIn(page);
  let reads = 0;
  await page.route('**/api/tournaments/**', (route) => {
    reads++;
    return route.fulfill({
      json: route.request().headers()['x-tournament-version']
        ? { unchanged: true, version: t.version, canEdit: true }
        : { tournament: t, canEdit: true },
    });
  });
  await page.goto('/t/' + t.code + '/admin');
  await page.getByLabel('Tournament name', { exact: true }).fill('Unsaved draft');
  const before = reads;
  await page.evaluate(async (session) => {
    const modulePath = '/src/lib/auth.ts';
    const { auth } = await import(modulePath);
    // Exercise the SDK subscription boundary with duplicate notifications.
    await auth.auth._notifyAllSubscribers('SIGNED_IN', session);
    await auth.auth._notifyAllSubscribers('TOKEN_REFRESHED', session);
  }, session);
  await page.waitForTimeout(250);
  expect(reads).toBe(before);
  await page.evaluate(async (session) => {
    const modulePath = '/src/lib/auth.ts';
    const { auth } = await import(modulePath);
    await auth.auth._notifyAllSubscribers('TOKEN_REFRESHED', {
      ...session,
      access_token: 'dummy-renewed',
    });
  }, session);
  await expect.poll(() => reads).toBe(before + 1);
  await expect(page.getByLabel('Tournament name', { exact: true })).toHaveValue('Unsaved draft');
});

test('sign-out supersedes an in-flight authenticated poll and cannot restore old edit permissions', async ({
  page,
}) => {
  const t = fixture();
  await signedIn(page);
  await page.route('**/auth/v1/logout**', (route) => route.fulfill({ status: 204 }));
  let hold = false;
  let held = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let anonymous = 0;
  await page.route('**/api/tournaments/**', async (route) => {
    const canEdit = Boolean(route.request().headers().authorization);
    if (!canEdit) anonymous++;
    if (hold && canEdit) {
      held = true;
      await gate;
    }
    await route
      .fulfill({
        json: route.request().headers()['x-tournament-version']
          ? { unchanged: true, version: t.version, canEdit }
          : { tournament: t, canEdit },
      })
      .catch(() => undefined);
  });
  try {
    await page.goto('/t/' + t.code + '/admin');
    await expect(page.getByLabel('Tournament name', { exact: true })).toBeVisible();
    hold = true;
    await page.getByRole('button', { name: 'Refresh tournament', exact: true }).click();
    await expect.poll(() => held).toBe(true);
    await page.evaluate(async () => {
      const modulePath = '/src/lib/auth.ts';
      const { auth } = await import(modulePath);
      await auth.auth.signOut({ scope: 'local' });
    });
    await expect(page.locator('.viewer-badge')).toHaveText('Spectator');
    await expect(page.getByLabel('Tournament name', { exact: true })).toHaveCount(0);
    await expect.poll(() => anonymous).toBeGreaterThan(0);
    release();
    await page.waitForTimeout(250);
    await expect(page.locator('.viewer-badge')).toHaveText('Spectator');
  } finally {
    release();
  }
});
