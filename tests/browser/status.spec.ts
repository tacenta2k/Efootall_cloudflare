import { expect, test } from '@playwright/test';
import {
  finishLeague,
  reachFinal,
  statusAction,
  statusTournament,
} from '../tournamentStatus.fixture';

test('public tournament status follows server state and survives reload', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('touchline-intro', '1'));
  let tournament = statusTournament();
  await page.route('**/api/tournaments/**', (route) =>
    route.fulfill({ json: { tournament, canEdit: false } }),
  );
  await page.goto('/t/' + tournament.code);
  const badge = page.getByLabel('Tournament status', { exact: true });
  await expect(badge).toHaveText('LIVE');
  await expect(badge).toBeVisible();
  for (const next of [finishLeague(), reachFinal()]) {
    tournament = next;
    await page.getByRole('button', { name: 'Refresh tournament', exact: true }).click();
    await expect(badge).toHaveText('LIVE');
  }
  const final = tournament.matches.at(-1)!;
  tournament = statusAction(tournament, {
    type: 'score',
    matchId: final.id,
    home: 1,
    away: 0,
    confirmEdit: false,
  });
  await page.getByRole('button', { name: 'Refresh tournament', exact: true }).click();
  await expect(badge).toHaveText('COMPLETED');
  await expect(badge).toBeVisible();
  await expect(page.getByText('Spectator', { exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /mark.*completed/i })).toHaveCount(0);
  await page.reload();
  await expect(badge).toHaveText('COMPLETED');
  await expect(badge).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Status Cup');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
