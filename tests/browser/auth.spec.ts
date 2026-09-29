import { expect, test } from '@playwright/test';
const project = 'abcdefghijklmnopqrst';
// Deliberately invalid, low-entropy placeholders used only by mocked auth routes.
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
const tournaments = [
  {
    code: 'EFC-ABCDEFGH',
    name: 'College Tournament',
    players: 8,
    knockout: 4,
    status: 'league_active',
  },
  {
    code: 'EFC-BCDEFGHJ',
    name: 'Friends Tournament',
    players: 12,
    knockout: 8,
    status: 'completed',
  },
];
test.beforeEach(async ({ page, context }) => {
  await context.setOffline(false);
  await page.addInitScript(() => sessionStorage.setItem('touchline-intro', '1'));
});
test('Google button initiates Supabase PKCE OAuth with the callback URL', async ({ page }) => {
  await page.route('**/auth/v1/authorize**', async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get('provider')).toBe('google');
    expect(url.searchParams.get('redirect_to')).toBe('http://127.0.0.1:5173/auth/callback');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('code_challenge_method')).toBe('s256');
    await route.fulfill({ contentType: 'text/html', body: 'Google redirect intercepted' });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Admin sign in' }).click();
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page).toHaveURL(/auth\/v1\/authorize/);
});
test('existing session restores multiple tournaments across reload and a new browser context', async ({
  page,
  browser,
}) => {
  await page.addInitScript(
    ({ project, session }) => {
      if (!localStorage.getItem(`sb-${project}-auth-token`))
        localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify(session));
    },
    { project, session },
  );
  let writes = 0;
  await page.route('**/api/tournaments', (route) => {
    if (route.request().method() !== 'GET') writes++;
    expect(route.request().headers().authorization).toBe(`Bearer ${session.access_token}`);
    return route.fulfill({ json: { tournaments } });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'My Tournaments' })).toBeVisible();
  await expect(page.getByText('College Tournament')).toBeVisible();
  await expect(page.getByText('Friends Tournament')).toBeVisible();
  for (const badge of await page.getByLabel('Tournament status').all())
    await expect(badge).toBeVisible();
  await expect(
    page.getByRole('link', { name: /College Tournament/ }).getByLabel('Tournament status'),
  ).toHaveText('LIVE');
  await expect(
    page.getByRole('link', { name: /Friends Tournament/ }).getByLabel('Tournament status'),
  ).toHaveText('COMPLETED');
  await expect(page.getByRole('link', { name: /College Tournament/ })).toHaveAttribute(
    'href',
    '/t/EFC-ABCDEFGH',
  );
  await page.reload();
  await expect(page.getByText('College Tournament')).toBeVisible();
  const state = await page.context().storageState();
  const context = await browser.newContext({ storageState: state });
  await context.route('**/api/tournaments', (route) => route.fulfill({ json: { tournaments } }));
  await context.setOffline(false);
  const reopened = await context.newPage();
  await reopened.goto('http://127.0.0.1:5173/');
  await expect(reopened.getByText('College Tournament')).toBeVisible();
  await context.close();
  expect(writes).toBe(0);
});
test('PKCE callback waits for session exchange then loads tournaments without creating one', async ({
  page,
}) => {
  await page.addInitScript(
    (project) =>
      localStorage.setItem(
        `sb-${project}-auth-token-code-verifier`,
        JSON.stringify('dummy-verifier'),
      ),
    project,
  );
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route('**/auth/v1/token?grant_type=pkce', async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      auth_code: 'dummy-code',
      code_verifier: 'dummy-verifier',
    });
    await gate;
    await route.fulfill({ json: session });
  });
  let reads = 0,
    writes = 0;
  await page.route('**/api/tournaments', (route) => {
    if (route.request().method() === 'GET') reads++;
    else writes++;
    return route.fulfill({ json: { tournaments } });
  });
  await page.goto('/auth/callback?code=dummy-code');
  await expect(page.getByText('Restoring your session…')).toBeVisible();
  expect(reads).toBe(0);
  await expect(page.getByLabel('Tournament name')).toHaveCount(0);
  finish();
  await expect(page.getByText('College Tournament')).toBeVisible();
  await page.reload();
  await expect(page.getByText('College Tournament')).toBeVisible();
  expect(writes).toBe(0);
  expect(
    await page.evaluate(() => localStorage.getItem('sb-abcdefghijklmnopqrst-auth-token')),
  ).toContain(session.refresh_token);
});
test('empty ownership list offers creation and load failure offers retry', async ({ page }) => {
  await page.addInitScript(
    ({ project, session }) =>
      localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify(session)),
    { project, session },
  );
  let fail = true;
  await page.route('**/api/tournaments', (route) =>
    route.fulfill(
      fail
        ? { status: 503, json: { error: 'Temporarily unavailable' } }
        : { json: { tournaments: [] } },
    ),
  );
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Temporarily unavailable');
  await expect(page.getByRole('link', { name: 'Create Tournament' })).toHaveCount(0);
  fail = false;
  await page.getByRole('button', { name: 'Retry loading tournaments' }).click();
  await expect(page.getByRole('link', { name: 'Create Tournament' })).toBeVisible();
  await page.getByRole('button', { name: 'Your account' }).click();
  await page.route('**/auth/v1/logout**', (route) => route.fulfill({ status: 204 }));
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Admin sign in' })).toBeVisible();
});

test('expired access token refreshes before owner loading without logging out', async ({
  page,
}) => {
  await page.addInitScript(
    ({ project, session }) =>
      localStorage.setItem(
        `sb-${project}-auth-token`,
        JSON.stringify({ ...session, expires_at: 1 }),
      ),
    { project, session },
  );
  let refreshed = false;
  await page.route('**/auth/v1/token?grant_type=refresh_token', async (route) => {
    expect(route.request().postDataJSON().refresh_token).toBe(session.refresh_token);
    refreshed = true;
    await route.fulfill({ json: session });
  });
  await page.route('**/api/tournaments', (route) => {
    expect(refreshed).toBe(true);
    return route.fulfill({ json: { tournaments } });
  });
  await page.goto('/');
  await expect(page.getByText('College Tournament')).toBeVisible();
  expect(refreshed).toBe(true);
});

test('denied OAuth callback explains failure and allows retry without creating data', async ({
  page,
}) => {
  let writes = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/tournaments') && request.method() === 'POST') writes++;
  });
  await page.goto('/auth/callback?error=access_denied&error_description=Cancelled');
  await expect(page.getByRole('alert')).toContainText('sign-in was not completed');
  await page.getByRole('button', { name: 'Admin sign in' }).click();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
  expect(writes).toBe(0);
});

test('offline Google initiation explains the issue and allows another attempt', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Admin sign in' }).click();
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('offline');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
  await context.setOffline(false);
});

test('delete requires exact confirmation, handles failure and prevents duplicate submissions', async ({
  page,
}) => {
  await page.addInitScript(
    ({ project, session }) =>
      localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify(session)),
    { project, session },
  );
  let remaining = [...tournaments];
  await page.route('**/api/tournaments', (route) =>
    route.fulfill({ json: { tournaments: remaining } }),
  );
  let requests = 0;
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route('**/api/tournaments/EFC-ABCDEFGH', async (route) => {
    expect(route.request().method()).toBe('DELETE');
    expect(route.request().headers().authorization).toBe(`Bearer ${session.access_token}`);
    expect(route.request().postDataJSON()).toEqual({ confirmation: 'DELETE' });
    requests++;
    if (requests === 1)
      return route.fulfill({ status: 503, json: { error: 'Storage unavailable. Please retry.' } });
    await gate;
    remaining = remaining.filter((t) => t.code !== 'EFC-ABCDEFGH');
    await route.fulfill({ json: { deleted: true } });
  });
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Delete College Tournament', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog');
  const input = dialog.getByLabel('Type DELETE to confirm');
  const submit = dialog.getByRole('button', { name: 'Delete Tournament', exact: true });
  await expect(dialog).toContainText('teams, players, matches, results, settings');
  await expect(submit).toBeDisabled();
  for (const value of ['delete', 'DELETE ', ' DELETE']) {
    await input.fill(value);
    await expect(submit).toBeDisabled();
  }
  await input.fill('DELETE');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(requests).toBe(0);
  await trigger.click();
  await expect(input).toHaveValue('');
  await input.fill('DELETE');
  await submit.click();
  await expect(dialog.getByRole('alert')).toContainText('Storage unavailable');
  await expect(page.getByRole('link', { name: /College Tournament/ })).toHaveCount(1);
  await submit.click();
  await expect(dialog.getByRole('button', { name: 'Deleting…' })).toBeDisabled();
  await expect(input).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect.poll(() => requests).toBe(2);
  finish();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveText('College Tournament was deleted.');
  await expect(page.getByRole('link', { name: /College Tournament/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Friends Tournament/ })).toBeVisible();
  await page.reload();
  await expect(trigger).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Friends Tournament/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('deleting the last tournament offers creation immediately', async ({ page }) => {
  await page.addInitScript(
    ({ project, session }) =>
      localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify(session)),
    { project, session },
  );
  await page.route('**/api/tournaments', (route) =>
    route.fulfill({ json: { tournaments: [tournaments[0]] } }),
  );
  await page.route('**/api/tournaments/EFC-ABCDEFGH', (route) =>
    route.fulfill({ json: { deleted: true } }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Delete College Tournament', exact: true }).click();
  await page.getByLabel('Type DELETE to confirm').fill('DELETE');
  await page.getByRole('button', { name: 'Delete Tournament', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Create your first tournament to get started.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create Tournament', exact: true })).toBeVisible();
});

test('tournament cards keep metadata, actions and long names usable on narrow screens', async ({
  page,
}, testInfo) => {
  await page.addInitScript(
    ({ project, session }) =>
      localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify(session)),
    { project, session },
  );
  const longName = 'Championship'.repeat(5);
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/tournaments', async (route) => {
    await ready;
    await route.fulfill({
      json: {
        tournaments: [
          ...tournaments,
          { code: 'EFC-CDEFGHJK', name: longName, players: 32, knockout: 0 },
        ],
      },
    });
  });
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveText('Loading your tournaments…');
  release();
  const cards = page.locator('.owned-tournament-card');
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toContainText('8 players');
  await expect(cards.nth(0)).toContainText('League + knockout');
  await expect(cards.nth(0)).toContainText('Top 4 qualify');
  await expect(cards.nth(1).getByLabel('Tournament status')).toHaveText('COMPLETED');
  await expect(cards.nth(2)).toContainText('League only');
  await expect(cards.nth(2).getByLabel('Tournament status')).toHaveCount(0);
  await expect(cards.nth(2).getByRole('heading')).toHaveText(longName);
  await page.screenshot({ path: testInfo.outputPath('my-tournaments.png'), fullPage: true });
  await page.setViewportSize({ width: 320, height: 740 });
  for (const card of await cards.all()) {
    const action = card.locator('.owned-tournament-continue');
    const remove = card.getByRole('button', { name: /^Delete / });
    await expect(action).toBeVisible();
    await expect(remove).toBeVisible();
    expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await remove.boundingBox())!.width).toBeGreaterThanOrEqual(44);
    expect((await remove.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(cards.nth(0).getByRole('link')).toHaveAttribute('href', '/t/EFC-ABCDEFGH');
  await page.screenshot({ path: testInfo.outputPath('my-tournaments-narrow.png'), fullPage: true });
});
