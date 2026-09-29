import { expect, test } from '@playwright/test';
import { createTournament, applyAction } from '../../src/lib/engine';
import { defaultSettings } from '../../src/lib/types';

test('settings conflict loads latest values and saves the reviewed draft with the refreshed version', async ({
  page,
}) => {
  const now = '2026-09-27T12:00:00.000Z';
  let t = createTournament(
    { ...defaultSettings, name: 'Original cup', knockout: 0 },
    ['Aswin', 'Rahul'].map((name) => ({ id: crypto.randomUUID(), name, avatar: '⚽' })),
    'EFC-ABCDEFGH',
    now,
  );
  const versions: number[] = [];
  let readsAfterConflict = 0;
  await page.route('**/api/tournaments/**', async (route) => {
    if (route.request().method() === 'PATCH') {
      const payload = route.request().postDataJSON();
      versions.push(payload.version);
      if (versions.length === 1) {
        t = applyAction(
          t,
          {
            type: 'settings',
            settings: { ...t.settings, name: 'Newer server cup', repetitions: 3 },
            players: t.players,
          },
          now,
        );
      }
      if (payload.version !== t.version) {
        return route.fulfill({
          status: 409,
          json: { error: 'This tournament changed on another device.' },
        });
      }
      t = applyAction(t, payload.action, now);
    } else if (versions.length) {
      readsAfterConflict++;
    }
    await route.fulfill({ json: { tournament: t, canEdit: true } });
  });
  await page.goto('/t/' + t.code + '/admin');
  await page.getByLabel('Tournament name', { exact: true }).fill('My conflicting name');
  await page.getByLabel('win points', { exact: true }).fill('5');
  await page.getByLabel('Player 1 name', { exact: true }).fill('Local player edit');
  const save = page.getByRole('button', { name: 'Save settings', exact: true });
  await save.click();
  await expect(page.getByRole('alert')).toContainText('Settings changed on another device');
  expect(versions).toEqual([1]);
  expect(readsAfterConflict).toBeGreaterThan(0);
  await expect(page.getByLabel('Tournament name', { exact: true })).toHaveValue('Newer server cup');
  await expect(
    page.getByRole('combobox', { name: 'Matches per opponent', exact: true }),
  ).toHaveValue('3');
  await expect(page.getByLabel('win points', { exact: true })).toHaveValue('5');
  await expect(page.getByLabel('Player 1 name', { exact: true })).toHaveValue('Local player edit');
  await expect(save).toBeDisabled();
  await page
    .getByRole('button', { name: 'I reviewed the refreshed settings; enable save' })
    .click();
  await save.click();
  await expect(page.getByRole('status')).toContainText('Tournament updated.');
  expect(versions).toEqual([1, 2]);
  expect(t.version).toBe(3);
  expect(t.settings).toMatchObject({ name: 'Newer server cup', repetitions: 3, win: 5 });
  expect(t.players[0].name).toBe('Local player edit');
  await page.reload();
  await expect(page.getByLabel('Tournament name', { exact: true })).toHaveValue('Newer server cup');
  await expect(page.getByLabel('win points', { exact: true })).toHaveValue('5');
});
