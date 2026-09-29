import { expect, test } from '@playwright/test';
import { applyAction, createTournament } from '../../src/lib/engine';
import { defaultSettings, type Tournament } from '../../src/lib/types';

for (const size of [2, 4, 8])
  test(`wizard exposes every format and Top ${size} drives the saved setup and bracket`, async ({
    page,
  }) => {
    // A test-only SDK session; the tournament API below remains mocked.
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
    await page.getByLabel('Tournament name', { exact: true }).fill('Knockout cup');
    await page.getByLabel('Number of players', { exact: true }).fill(String(size));
    for (let i = 1; i <= size; i++)
      await page.getByLabel(`Player ${i} name`, { exact: true }).fill(`Player ${i}`);
    for (let i = 0; i < 3; i++)
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
    const formats = page.getByRole('group', { name: 'Knockout format' });
    await expect(formats.getByRole('button')).toHaveCount(4);
    await expect(formats.getByRole('button', { name: 'League only', exact: true })).toBeEnabled();
    for (const n of [2, 4, 8]) {
      const option = formats.getByRole('button', { name: new RegExp(`^Top ${n} →`) });
      await expect(option).toBeVisible();
      if (n > size) await expect(option).toBeDisabled();
      else await expect(option).toBeEnabled();
    }
    await formats.getByRole('button', { name: new RegExp(`^Top ${size} →`) }).click();
    await expect(
      formats.getByRole('button', { name: new RegExp(`^Top ${size} →`) }),
    ).toHaveAttribute('aria-pressed', 'true');
    await page
      .getByRole('combobox', { name: 'Matches per knockout tie', exact: true })
      .selectOption('2');
    await page
      .getByRole('combobox', { name: 'Knockout tied-score / aggregate decider', exact: true })
      .selectOption('manual');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByText(`Top ${size} · Two legs`, { exact: true })).toBeVisible();
    let stored: Tournament | undefined;
    await page.route('**/api/tournaments**', async (route) => {
      if (route.request().method() === 'POST') {
        const { settings, players } = route.request().postDataJSON();
        expect(settings.knockout).toBe(size);
        expect(settings.legs).toBe(2);
        expect(settings.resolution).toBe('manual');
        expect(settings.leaguePenaltyPoints).toBeNull();
        const now = new Date().toISOString();
        stored = createTournament(settings, players, 'EFC-ABCDEFGH', now);
        stored = applyAction(stored, { type: 'start' }, now);
        for (const game of stored.matches) {
          stored = applyAction(
            stored,
            {
              type: 'score',
              matchId: game.id,
              home: players.findIndex((p: { id: string }) => p.id === game.home) + 1,
              away: players.findIndex((p: { id: string }) => p.id === game.away) + 1,
              confirmEdit: false,
            },
            now,
          );
        }
        stored = applyAction(stored, { type: 'advance' }, now);
      }
      await route.fulfill({ json: { tournament: stored, canEdit: true } });
    });
    await page.getByRole('button', { name: 'Create tournament', exact: true }).click();
    await expect(page).toHaveURL(/\/t\/EFC-ABCDEFGH\/admin$/);
    const nav =
      page.viewportSize()!.width < 800 ? page.locator('.mobile-nav') : page.locator('.sidebar nav');
    await nav.getByRole('button', { name: 'Knockout', exact: true }).click();
    await expect(page.locator('.bracket-tie')).toHaveCount(size / 2);
    expect(stored?.matches.filter((m) => m.stage === 'knockout')).toHaveLength(size);
    await expect(
      page.getByText(size === 8 ? 'QUARTER-FINALS' : size === 4 ? 'SEMI-FINALS' : 'THE FINAL', {
        exact: true,
      }),
    ).toBeVisible();
  });
