import { expect, test, type Page } from '@playwright/test';
import { createTournament, applyAction } from '../../src/lib/engine';
import { defaultSettings } from '../../src/lib/types';
const owner = '00000000-0000-4000-8000-000000000001';
const project = 'abcdefghijklmnopqrst';
const now = '2026-09-29T12:00:00.000Z';
async function signIn(page: Page) {
  await page.addInitScript(
    ({ owner, project }) => {
      sessionStorage.setItem('touchline-intro', '1');
      localStorage.setItem(
        `sb-${project}-auth-token`,
        JSON.stringify({
          access_token: 'dummy-access',
          refresh_token: 'dummy-refresh',
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: {
            id: owner,
            aud: 'authenticated',
            role: 'authenticated',
            email: 'owner@example.com',
          },
        }),
      );
    },
    { owner, project },
  );
}
async function photo(page: Page, mimeType = 'image/png') {
  const data = await page.evaluate((type) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1600;
    canvas.height = 800;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 1600, 800);
    ctx.fillStyle = '#00ff00';
    ctx.fillRect(400, 0, 800, 800);
    return canvas.toDataURL(type).split(',')[1];
  }, mimeType);
  return {
    name: 'phone-photo.' + (mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1]),
    mimeType,
    buffer: Buffer.from(data, 'base64'),
  };
}
async function storage(page: Page) {
  const files = new Map<string, Buffer>();
  const discarded: string[] = [];
  let fail = false;
  await page.route('**/api/logos', async (route) => {
    expect(route.request().headers().authorization).toBe('Bearer dummy-access');
    const payload = route.request().postDataJSON();
    if (route.request().method() === 'DELETE') {
      discarded.push(payload.path);
      return route.fulfill({ json: { deleted: true } });
    }
    await route.fulfill({
      status: 201,
      json: { path: `${owner}/${crypto.randomUUID()}.${payload.extension}` },
    });
  });
  await page.route('**/storage/v1/object/team-logos/**', async (route) => {
    expect(route.request().headers().authorization).toBe('Bearer dummy-access');
    if (fail) return route.fulfill({ status: 503, json: { error: 'Unavailable' } });
    const body = route.request().postDataBuffer()!;
    const start = body.indexOf(Buffer.from('RIFF'));
    expect(start).toBeGreaterThan(-1);
    const image = body.subarray(start, start + body.readUInt32LE(start + 4) + 8);
    expect(image.length).toBeLessThanOrEqual(128 * 1024);
    files.set(new URL(route.request().url()).pathname.split('/team-logos/')[1], image);
    await route.fulfill({ json: { Key: 'team-logos/image', Id: crypto.randomUUID() } });
  });
  await page.route('**/storage/v1/object/public/team-logos/**', async (route) => {
    const file = files.get(new URL(route.request().url()).pathname.split('/team-logos/')[1]);
    await route.fulfill(file ? { contentType: 'image/webp', body: file } : { status: 404 });
  });
  return {
    files,
    discarded,
    setFailure: (value: boolean) => {
      fail = value;
    },
  };
}
test('emoji categories preserve existing choices and cancel preserves the selected logo', async ({
  page,
}) => {
  await page.goto('/create');
  const trigger = page.getByRole('button', { name: 'Player 1 avatar', exact: true });
  await expect(trigger).toContainText('⚽');
  await trigger.click();
  await page.getByLabel('Emoji category').selectOption('Animals');
  await page.getByRole('button', { name: 'Select 🦁', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Select 🦁', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Use logo', exact: true }).click();
  await expect(trigger).toContainText('🦁');
  await trigger.click();
  await page.getByRole('button', { name: 'Select 🏀', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(trigger).toContainText('🦁');
});
test('rejects invalid files and handles upload failure without losing the existing emoji', async ({
  page,
}) => {
  await signIn(page);
  const mock = await storage(page);
  await page.goto('/create');
  const file = await photo(page);
  await page.getByRole('button', { name: 'Player 1 avatar', exact: true }).click();
  const input = page.getByLabel('Upload team logo');
  await input.setInputFiles({
    name: 'bad.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg/>'),
  });
  await expect(page.getByRole('alert')).toContainText('JPG, PNG, or WebP');
  await input.setInputFiles({
    name: 'bad.png',
    mimeType: 'image/png',
    buffer: Buffer.from('not an image'),
  });
  await expect(page.getByRole('alert')).toContainText('could not be opened');
  await input.setInputFiles({
    name: 'large.png',
    mimeType: 'image/png',
    buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
  });
  await expect(page.getByRole('alert')).toContainText('10 MB');
  await input.setInputFiles(file);
  await expect(page.getByAltText('Selected logo preview')).toBeVisible();
  mock.setFailure(true);
  await page.getByRole('button', { name: 'Use logo', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Logo upload failed');
  await expect(page.getByRole('dialog')).toBeVisible();
  mock.setFailure(false);
  await page.getByRole('button', { name: 'Use logo', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Player 1 avatar', exact: true }).getByRole('img'),
  ).toBeVisible();
});
test('uploads a centered optimized image, persists on reload, replaces it and switches back to emoji', async ({
  page,
}) => {
  await signIn(page);
  const mock = await storage(page);
  let t = applyAction(
    createTournament(
      { ...defaultSettings, name: 'Logo cup', knockout: 0 },
      ['Aswin', 'Rahul'].map((name) => ({ id: crypto.randomUUID(), name, avatar: '⚽' })),
      'EFC-ABCDEFGH',
      now,
    ),
    { type: 'start' },
    now,
  );
  let canEdit = true;
  await page.route('**/api/tournaments/**', async (route) => {
    if (route.request().method() === 'PATCH') {
      const { action } = route.request().postDataJSON();
      expect(action.type).toBe('avatar');
      t = applyAction(t, action, now);
    }
    await route.fulfill({ json: { tournament: t, canEdit } });
  });
  await page.goto('/t/' + t.code + '/admin');
  const originalMatches = structuredClone(t.matches);
  const file = await photo(page, 'image/jpeg');
  const trigger = page.getByRole('button', { name: 'Aswin avatar', exact: true });
  await trigger.click();
  await page.getByLabel('Upload team logo').setInputFiles(file);
  const preview = page.getByAltText('Selected logo preview');
  await expect(preview).toBeVisible();
  expect(
    await preview.evaluate((element) => {
      const img = element as HTMLImageElement;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const pixel = Array.from(ctx.getImageData(128, 128, 1, 1).data);
      return {
        width: img.naturalWidth,
        height: img.naturalHeight,
        green: pixel[1] > 240 && pixel[0] < 15,
      };
    }),
  ).toEqual({ width: 256, height: 256, green: true });
  expect(mock.files.size).toBe(0);
  await page.getByRole('button', { name: 'Use logo', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const first = t.players[0].avatar;
  expect(first).toMatch(/^logo:/);
  await page.reload();
  await expect(trigger.getByRole('img')).toBeVisible();
  await trigger.click();
  await expect(page.getByText('Current uploaded logo')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(t.players[0].avatar).toBe(first);
  await trigger.click();
  await page.getByLabel('Upload team logo').setInputFiles(await photo(page, 'image/webp'));
  await expect(page.getByAltText('Selected logo preview')).toBeVisible();
  await page.getByRole('button', { name: 'Use logo', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(t.players[0].avatar).not.toBe(first);
  await expect.poll(() => mock.discarded).toContain(first.slice(5));
  canEdit = false;
  await page.goto('/t/' + t.code);
  await expect(page.getByRole('img', { name: 'Team logo' }).first()).toBeVisible();
  await expect(trigger).toHaveCount(0);
  canEdit = true;
  await page.goto('/t/' + t.code + '/admin');
  await trigger.click();
  await page.getByLabel('Emoji category').selectOption('Fire / Power');
  await page.getByRole('button', { name: 'Select 🔥', exact: true }).click();
  await page.getByRole('button', { name: 'Use logo', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(trigger).toContainText('🔥');
  await page.reload();
  await expect(trigger).toContainText('🔥');
  expect(t.matches).toEqual(originalMatches);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
