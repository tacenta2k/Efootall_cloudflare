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
for (const qualifiers of [2, 4])
  for (const resolution of ['penalties', 'manual', 'either'] as const)
    test(`version-aware match dialog: ${qualifiers === 2 ? 'final' : 'semi-final'} decider uses configured ${resolution} resolution`, async ({
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
        await route.fulfill({
          json:
            route.request().headers()['x-tournament-version'] === String(t.version)
              ? { unchanged: true, version: t.version, canEdit: true }
              : { tournament: t, canEdit: true },
        });
      });
      await page.goto('/t/' + t.code);
      const nav =
        page.viewportSize()!.width < 800
          ? page.locator('.mobile-nav')
          : page.locator('.sidebar nav');
      await nav.getByRole('button', { name: 'Knockout', exact: true }).click();
      const checked = page.waitForResponse((response) =>
        Boolean(response.request().headers()['x-tournament-version']),
      );
      await page.getByRole('button', { name: 'Refresh tournament', exact: true }).click();
      expect(await (await checked).json()).toEqual({
        unchanged: true,
        version: t.version,
        canEdit: true,
      });
      await page.locator('.tie-legs button').first().click();
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
      await page.getByRole('button', { name: 'Save result' }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(t.ties[0].winner).toBe(tie.a);
    });
