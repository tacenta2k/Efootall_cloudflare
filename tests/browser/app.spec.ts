import { expect, test } from '@playwright/test';
import { createTournament, applyAction } from '../../src/lib/engine';
import { defaultSettings } from '../../src/lib/types';
import { randomUUID } from 'node:crypto';
const now = '2026-09-27T12:00:00.000Z';
function fixture() {
  const players = ['Aswin', 'Rahul', 'Akhil', 'Vishnu'].map((name, i) => ({
    id: randomUUID(),
    name,
    avatar: ['🐐', '🔥', '⚡', '👑'][i],
  }));
  let t = createTournament(
    { ...defaultSettings, name: 'Sunday Night Cup' },
    players,
    'EFC-ABCDEFGH',
    now,
  );
  t = applyAction(t, { type: 'start' }, now);
  return t;
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('touchline-intro', '1'));
});
test('home, join, wizard validation and mobile overflow', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Your tournament');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Join a tournament', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('Tournament code').fill('EFC-ABCDEFGH');
  await page.route('**/api/tournaments/**', (route) =>
    route.fulfill({
      status: 404,
      json: { error: 'Tournament not found. Check the code and try again.' },
    }),
  );
  await page.getByRole('button', { name: 'View tournament', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Tournament not found');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Create tournament', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await page.goto('/create');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('name');
  await page.getByLabel('Tournament name').fill('Friends Cup');
  for (let i = 1; i <= 4; i++)
    await page.getByLabel(`Player ${i} name`, { exact: true }).fill(`Contender ${i}`);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose your format' })).toBeVisible();
  for (let i = 0; i < 3; i++)
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ready for kickoff?' })).toBeVisible();
  await expect(page.getByText('12 fixtures')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('viewer cannot enter results, refresh retains shared state, polling updates scores', async ({
  page,
}) => {
  let t = fixture();
  await page.route('**/api/tournaments/**', (route) =>
    route.fulfill({ json: { tournament: t, canEdit: false } }),
  );
  await page.goto('/t/' + t.code);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Sunday Night Cup');
  const nav =
    page.viewportSize()!.width < 800 ? page.locator('.mobile-nav') : page.locator('.sidebar nav');
  await nav.getByRole('button', { name: 'Matches', exact: true }).click();
  await page.locator('.match-card').first().click();
  await expect(page.getByRole('heading', { name: 'Match details' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save result' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  t = applyAction(
    t,
    { type: 'score', matchId: t.matches[0].id, home: 4, away: 2, confirmEdit: false },
    now,
  );
  await expect(page.locator('.match-card').first().locator('.match-score')).toHaveText('4–2', {
    timeout: 20000,
  });
  await page.reload();
  await nav.getByRole('button', { name: 'Matches', exact: true }).click();
  await expect(page.locator('.match-card').first().locator('.match-score')).toHaveText('4–2');
  t = applyAction(
    t,
    { type: 'score', matchId: t.matches[0].id, home: 5, away: 2, confirmEdit: true },
    now,
  );
  await expect(page.locator('.match-card').first().locator('.match-score')).toHaveText('5–2', {
    timeout: 20000,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('admin score entry survives network failure and does not claim success', async ({ page }) => {
  const t = fixture();
  await page.route('**/api/tournaments/**', (route) =>
    route.request().method() === 'PATCH'
      ? route.abort('failed')
      : route.fulfill({ json: { tournament: t, canEdit: true } }),
  );
  await page.goto('/t/' + t.code);
  await page.locator('.match-card').first().click();
  const m = t.matches[0];
  await page.getByLabel(t.players.find((p) => p.id === m.home)!.name + ' score').fill('4');
  await page.getByLabel(t.players.find((p) => p.id === m.away)!.name + ' score').fill('2');
  await page.getByRole('button', { name: 'Save result' }).click();
  await expect(page.getByRole('alert')).toContainText('entry is preserved');
  await expect(
    page.getByLabel(t.players.find((p) => p.id === m.home)!.name + ' score'),
  ).toHaveValue('4');
  await expect(page.getByRole('dialog')).toBeVisible();
});
test('stale score editing requires explicit review before retry', async ({ page }) => {
  let t = fixture();
  let submittedVersion: number | undefined;
  await page.route('**/api/tournaments/**', async (route) => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON();
      submittedVersion = body.version;
      return route.fulfill({
        status: 409,
        json: { error: 'This tournament changed on another device. Your entry is preserved.' },
      });
    }
    await route.fulfill({ json: { tournament: t, canEdit: true } });
  });
  await page.goto('/t/' + t.code);
  await page.locator('.match-card').first().click();
  const m = t.matches[0];
  await page.getByLabel(t.players.find((p) => p.id === m.home)!.name + ' score').fill('4');
  await page.getByLabel(t.players.find((p) => p.id === m.away)!.name + ' score').fill('2');
  t = applyAction(t, { type: 'score', matchId: m.id, home: 5, away: 1, confirmEdit: false }, now);
  await page.getByRole('button', { name: 'Save result' }).click();
  await expect.poll(() => submittedVersion).toBe(2);
  await expect(page.getByText('Latest saved result: 5 – 1.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save result' })).toBeDisabled();
  await page.getByRole('button', { name: 'I reviewed the latest result; enable save' }).click();
  await expect(page.getByRole('button', { name: 'Save result' })).toBeEnabled();
});

test('screens remain within a narrow viewport and render matchday information', async ({
  page,
}, testInfo) => {
  const t = fixture();
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Your tournament');
  await page.screenshot({ path: testInfo.outputPath('home.png'), fullPage: true });
  await page.route('**/api/tournaments/**', (route) =>
    route.fulfill({ json: { tournament: t, canEdit: false } }),
  );
  await page.goto('/t/' + t.code);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Sunday Night Cup');
  await page.screenshot({ path: testInfo.outputPath('dashboard.png'), fullPage: true });
  await page.getByText('Tournament information & rules', { exact: true }).click();
  await expect(page.getByText('Win 3 · Draw 1 · Loss 0')).toBeVisible();
  if (testInfo.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const nav =
    page.viewportSize()!.width < 800 ? page.locator('.mobile-nav') : page.locator('.sidebar nav');
  for (const label of ['Standings', 'Statistics', 'Knockout', 'Players', 'Admin']) {
    await nav.getByRole('button', { name: label, exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});

test('setup separates league draw rules from the knockout decider', async ({ page }) => {
  await page.goto('/create');
  await page.getByLabel('Tournament name').fill('Separate Rules Cup');
  for (let i = 1; i <= 4; i++)
    await page.getByLabel(`Player ${i} name`, { exact: true }).fill(`Player ${i}`);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(
    page.getByRole('radio', { name: 'Yes — Draws are allowed', exact: true }),
  ).toBeChecked();
  await page.getByRole('radio', { name: 'No — Penalty shootout required', exact: true }).check();
  await expect(
    page.getByText('League penalty points are not configured.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel('win points', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Knockout rules', exact: true })).toBeVisible();
  await expect(
    page.getByText('Semi-finals and finals must have a winner.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(
    page.getByRole('combobox', { name: 'Knockout tied-score / aggregate decider', exact: true }),
  ).toHaveValue('either');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(
    page.getByText('Not configured — tied results cannot be finalized yet', { exact: true }),
  ).toBeVisible();
});

test('league shootout input cannot finalize a result with an unspecified points policy', async ({
  page,
}) => {
  const t = fixture();
  t.settings.leagueDrawsAllowed = false;
  let submitted = false;
  await page.route('**/api/tournaments/**', (route) => {
    if (route.request().method() === 'PATCH') submitted = true;
    return route.fulfill({ json: { tournament: t, canEdit: true } });
  });
  await page.goto('/t/' + t.code);
  await page.locator('.match-card').first().click();
  const m = t.matches[0],
    home = t.players.find((p) => p.id === m.home)!.name,
    away = t.players.find((p) => p.id === m.away)!.name;
  await page.getByLabel(home + ' score').fill('2');
  await page.getByLabel(away + ' score').fill('2');
  await page.getByLabel(home + ' penalties').fill('4');
  await page.getByLabel(away + ' penalties').fill('3');
  await expect(page.getByRole('dialog').getByRole('status')).toContainText(
    'points are not configured',
  );
  await expect(page.getByRole('button', { name: 'Save result' })).toBeDisabled();
  expect(submitted).toBe(false);
  await page.getByLabel(away + ' score').fill('1');
  await expect(page.getByRole('button', { name: 'Save result' })).toBeEnabled();
});

for (const qualifiers of [2, 4])
  for (const resolution of ['penalties', 'manual', 'either'] as const)
    test(`${qualifiers === 2 ? 'final' : 'semi-final'} decider uses configured ${resolution} resolution`, async ({
      page,
    }) => {
      let t = fixture();
      t.settings.knockout = qualifiers;
      t.settings.resolution = resolution;
      for (const m of t.matches)
        t = applyAction(
          t,
          {
            type: 'score',
            matchId: m.id,
            home: t.players.findIndex((p) => p.id === m.home) + 1,
            away: t.players.findIndex((p) => p.id === m.away) + 1,
            confirmEdit: false,
          },
          now,
        );
      t = applyAction(t, { type: 'advance' }, now);
      const tie = t.ties[0],
        game = t.matches.find((m) => m.tieId === tie.id)!;
      t = applyAction(
        t,
        { type: 'score', matchId: game.id, home: 2, away: 2, confirmEdit: false },
        now,
      );
      await page.route('**/api/tournaments/**', async (route) => {
        if (route.request().method() === 'PATCH')
          t = applyAction(t, route.request().postDataJSON().action, now);
        await route.fulfill({ json: { tournament: t, canEdit: true } });
      });
      await page.goto('/t/' + t.code);
      const nav =
        page.viewportSize()!.width < 800
          ? page.locator('.mobile-nav')
          : page.locator('.sidebar nav');
      await nav.getByRole('button', { name: 'Knockout', exact: true }).click();
      await page.getByRole('button', { name: 'Resolve tied score' }).click();
      const decider = page
        .getByRole('dialog')
        .getByRole('combobox', { name: 'Decider', exact: true });
      await expect(decider).toHaveValue(resolution === 'manual' ? 'manual' : 'penalties');
      await expect(decider.locator('option')).toHaveCount(resolution === 'either' ? 2 : 1);
      if (resolution === 'either') await decider.selectOption('manual');
      if (resolution === 'penalties') {
        await page.getByLabel(t.players.find((p) => p.id === tie.a)!.name + ' penalties').fill('4');
        await page.getByLabel(t.players.find((p) => p.id === tie.b)!.name + ' penalties').fill('3');
      } else {
        await page
          .getByRole('combobox', { name: 'Confirmed winner', exact: true })
          .selectOption(tie.a);
      }
      await page.getByRole('button', { name: 'Confirm winner' }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(t.ties[0].winner).toBe(tie.a);
    });

for (const mode of ['clipboard', 'rejected', 'unavailable', 'failed'] as const)
  test(`repeated public link copy: ${mode}`, async ({ page }) => {
    const t = fixture();
    await page.addInitScript((mode) => {
      const copies: string[] = [];
      Object.assign(window, { testCopies: copies });
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value:
          mode === 'unavailable'
            ? undefined
            : {
                writeText: async (text: string) => {
                  if (mode !== 'clipboard') throw new Error('Clipboard unavailable');
                  copies.push(text);
                },
              },
      });
      document.execCommand = (command: string) => {
        if (mode === 'failed') return false;
        if (command === 'copy') copies.push((document.activeElement as HTMLTextAreaElement).value);
        return true;
      };
    }, mode);
    await page.route('**/api/tournaments/**', (route) =>
      route.fulfill({ json: { tournament: t, canEdit: false } }),
    );
    await page.goto('/t/' + t.code);
    for (let i = 0; i < 3; i++) {
      await page.getByTitle('Copy public link').click();
      if (mode === 'failed')
        await expect(page.getByRole('alert')).toContainText(
          'Could not copy automatically. Public link: http://127.0.0.1:5173/t/' + t.code,
        );
      else {
        await expect(page.getByText('Public link copied!')).toBeVisible();
        await expect(page.getByRole('alert')).toHaveCount(0);
      }
    }
    const copied = await page.evaluate(
      () => (window as unknown as { testCopies: string[] }).testCopies,
    );
    expect(copied).toEqual(
      mode === 'failed' ? [] : Array(3).fill('http://127.0.0.1:5173/t/' + t.code),
    );
    await expect(page.locator('textarea')).toHaveCount(0);
  });

test('real browser Clipboard API copies the public URL repeatedly', async ({ page, context }) => {
  const t = fixture();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.route('**/api/tournaments/**', (route) =>
    route.fulfill({ json: { tournament: t, canEdit: false } }),
  );
  await page.goto('/t/' + t.code);
  for (let i = 0; i < 3; i++) {
    await page.getByTitle('Copy public link').click();
    await expect(page.getByText('Public link copied!')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      'http://127.0.0.1:5173/t/' + t.code,
    );
  }
});
