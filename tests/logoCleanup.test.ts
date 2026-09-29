import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  begin: vi.fn(),
  remove: vi.fn(),
  client: vi.fn(),
}));
vi.mock('../server/store', () => ({ db: () => ({ begin: mocks.begin }) }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.client }));
vi.mock('../server/config', () => ({
  serverAuthConfig: () => ({
    url: 'https://example.supabase.co',
    key: 'sb_publishable_test',
    error: null,
  }),
}));
import { cleanupLogos, reserveLogo, retireDraft } from '../server/logos';
const owner = '00000000-0000-4000-8000-000000000001';
const path = `${owner}/00000000-0000-4000-8000-000000000002.webp`;
const request = new Request('https://example.com/api/logos', {
  headers: { Authorization: 'Bearer dummy-access' },
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.begin.mockImplementation((fn) => fn(mocks.sql));
  mocks.sql.mockResolvedValue([]);
  mocks.client.mockReturnValue({ storage: { from: () => ({ remove: mocks.remove }) } });
});
it('bounds pending upload reservations and assigns the authenticated owner', async () => {
  mocks.sql.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: 64 }]);
  await expect(reserveLogo(owner, 'webp')).rejects.toThrow('TOO_MANY_LOGOS');
  mocks.sql.mockClear();
  mocks.sql.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: 0 }]);
  expect(await reserveLogo(owner, 'png')).toMatch(new RegExp('^' + owner + '/.*\\.png$'));
  expect(mocks.sql.mock.calls[2].slice(1)).toEqual([expect.stringMatching(/\.png$/), owner]);
});
it('discard only retires pending assets belonging to the caller', async () => {
  await retireDraft(owner, path);
  const [parts, ...values] = mocks.sql.mock.calls[1];
  expect(parts.join('?')).toContain("state='pending'");
  expect(values).toEqual([path, owner]);
});
it('removes through Storage using the user JWT and retries failures without rejecting a committed deletion', async () => {
  mocks.sql.mockResolvedValueOnce([]).mockResolvedValueOnce([{ path }]);
  mocks.remove.mockResolvedValueOnce({ error: new Error('Storage down') });
  await expect(cleanupLogos(owner, request)).resolves.toBeUndefined();
  expect(mocks.remove).toHaveBeenCalledWith([path]);
  expect(mocks.client).toHaveBeenCalledWith(
    expect.any(String),
    'sb_publishable_test',
    expect.objectContaining({
      global: expect.objectContaining({ headers: { Authorization: 'Bearer dummy-access' } }),
    }),
  );
  expect(mocks.begin).toHaveBeenCalledOnce();
  mocks.sql.mockResolvedValueOnce([]).mockResolvedValueOnce([{ path }]);
  mocks.remove.mockResolvedValueOnce({ error: null });
  await cleanupLogos(owner, request);
  const last = mocks.sql.mock.calls.at(-1)!;
  expect(last[0].join('?')).toContain('not exists(select 1 from storage.objects');
  expect(last.slice(1)).toContain(owner);
});
it('does not call Storage when there are no retired images', async () => {
  await cleanupLogos(owner, request);
  expect(mocks.client).not.toHaveBeenCalled();
});
