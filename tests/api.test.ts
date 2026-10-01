vi.mock('../server/logos', () => ({
  cleanupLogos: vi.fn(),
  reserveLogo: vi.fn(),
  retireDraft: vi.fn(),
}));
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  listOwned: vi.fn(),
  deleteOwned: vi.fn(),
  load: vi.fn(),
  save: vi.fn(),
  begin: vi.fn(),
  sql: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: mocks.getUser } }),
}));
vi.mock('../server/store', () => ({
  db: () => ({ begin: mocks.begin }),
  load: mocks.load,
  listOwned: mocks.listOwned,
  deleteOwned: mocks.deleteOwned,
  save: mocks.save,
}));
import { handler } from '../server/api';
import { reserveLogo, retireDraft, cleanupLogos } from '../server/logos';
import { createTournament, applyAction } from '../src/lib/engine';
import { defaultSettings } from '../src/lib/types';
const now = '2026-09-27T12:00:00.000Z';
const owner = 'owner-user',
  code = 'EFC-ABCDEFGH';
const request = (method: string, body?: unknown, token?: string, path = `tournaments/${code}`) =>
  new Request(`https://example.com/api/${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
beforeEach(() => {
  vi.clearAllMocks();
  process.env.SUPABASE_URL = 'https://abcdefghijklmnopqrst.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'sb_publishable_test';
  mocks.getUser.mockResolvedValue({ data: { user: { id: owner } }, error: null });
  mocks.begin.mockImplementation(async (...args: unknown[]) => {
    const callback = args.at(-1) as (sql: unknown) => unknown;
    return callback(Object.assign(mocks.sql, { json: (v: unknown) => v }));
  });
  const t = applyAction(
    createTournament(
      { ...defaultSettings, name: 'Secure cup', knockout: 0 },
      [
        { id: crypto.randomUUID(), name: 'Aswin', avatar: '⚽' },
        { id: crypto.randomUUID(), name: 'Rahul', avatar: '🔥' },
      ],
      code,
      now,
    ),
    { type: 'start' },
    now,
  );
  mocks.load.mockResolvedValue({ owner, t });
});
describe('server authorization and concurrency', () => {
  it('public viewers receive a tournament without owner identifiers', async () => {
    const response = await handler(request('GET'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.canEdit).toBe(false);
    expect(body.tournament.owner_id).toBeUndefined();
    expect(body.owner).toBeUndefined();
  });
  it('rejects unauthenticated writes before database access', async () => {
    const response = await handler(request('PATCH', { version: 1, action: { type: 'start' } }));
    expect(response.status).toBe(401);
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('rejects a signed-in admin for another tournament', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'someone-else' } }, error: null });
    const response = await handler(
      request(
        'PATCH',
        { version: 2, action: { type: 'reset', scope: 'league', confirmation: 'RESET' } },
        'valid',
      ),
    );
    expect(response.status).toBe(403);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('rejects invalid or expired sessions', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: Object.assign(new Error('Invalid'), { status: 401 }),
    });
    expect(
      (await handler(request('PATCH', { version: 1, action: { type: 'start' } }, 'expired')))
        .status,
    ).toBe(401);
  });
  it('rejects stale versions without writing', async () => {
    expect(
      (
        await handler(
          request(
            'PATCH',
            { version: 1, action: { type: 'reset', scope: 'league', confirmation: 'RESET' } },
            'valid',
          ),
        )
      ).status,
    ).toBe(409);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('validates negative scores on the server', async () => {
    const response = await handler(
      request(
        'PATCH',
        {
          version: 2,
          action: {
            type: 'score',
            matchId: crypto.randomUUID(),
            home: -1,
            away: 0,
            confirmEdit: false,
          },
        },
        'valid',
      ),
    );
    expect(response.status).toBe(422);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('rejects foreign match IDs', async () => {
    const response = await handler(
      request(
        'PATCH',
        {
          version: 2,
          action: {
            type: 'score',
            matchId: crypto.randomUUID(),
            home: 1,
            away: 0,
            confirmEdit: false,
          },
        },
        'valid',
      ),
    );
    expect(response.status).toBe(422);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('saves legitimate results and audit in one transaction', async () => {
    const found = await mocks.load();
    const response = await handler(
      request(
        'PATCH',
        {
          version: 2,
          action: {
            type: 'score',
            matchId: found.t.matches[0].id,
            home: 4,
            away: 2,
            confirmEdit: false,
          },
        },
        'valid',
      ),
    );
    expect(response.status).toBe(200);
    expect(mocks.sql).toHaveBeenCalledOnce();
    expect(mocks.save).toHaveBeenCalledOnce();
    expect((await response.json()).tournament.matches[0].homeScore).toBe(4);
  });
  it('passes avatar edits to the persistence fast path', async () => {
    const found = await mocks.load();
    const player = found.t.players[0];
    const response = await handler(
      request(
        'PATCH',
        {
          version: found.t.version,
          action: { type: 'avatar', playerId: player.id, avatar: '🔥' },
        },
        'valid',
      ),
    );
    expect(response.status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ version: found.t.version + 1 }),
      owner,
      false,
      { type: 'avatar', playerId: player.id, avatar: '🔥' },
    );
  });
  it('does not pretend database errors succeeded', async () => {
    mocks.save.mockRejectedValueOnce(new Error('Connection lost'));
    const response = await handler(
      request(
        'PATCH',
        { version: 2, action: { type: 'reset', scope: 'league', confirmation: 'RESET' } },
        'valid',
      ),
    );
    expect(response.status).toBe(500);
    expect((await response.json()).error).toContain('previous data is safe');
  });
  it('returns a clear not-found response', async () => {
    mocks.load.mockResolvedValue(null);
    expect((await handler(request('GET'))).status).toBe(404);
    expect((await handler(request('GET', undefined, undefined, 'tournaments/nope'))).status).toBe(
      404,
    );
  });
  it('protects audit history from public viewers', async () => {
    expect(
      (await handler(request('GET', undefined, undefined, `tournaments/${code}/audit`))).status,
    ).toBe(403);
  });
});

describe('server-enforced league draw policy', () => {
  it('rejects a shootout result without an explicit points policy before any write', async () => {
    const found = await mocks.load();
    found.t.settings.leagueDrawsAllowed = false;
    const response = await handler(
      request(
        'PATCH',
        {
          version: found.t.version,
          action: {
            type: 'score',
            matchId: found.t.matches[0].id,
            home: 2,
            away: 2,
            leaguePenalties: { home: 4, away: 3 },
            confirmEdit: false,
          },
        },
        'valid',
      ),
    );
    expect(response.status).toBe(422);
    expect((await response.json()).error).toContain('points are not configured');
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.sql).not.toHaveBeenCalled();
  });
  it('rejects a disallowed draw without penalties even when points are configured', async () => {
    const found = await mocks.load();
    found.t.settings.leagueDrawsAllowed = false;
    found.t.settings.leaguePenaltyPoints = { winner: 4, loser: 2 };
    const response = await handler(
      request(
        'PATCH',
        {
          version: found.t.version,
          action: {
            type: 'score',
            matchId: found.t.matches[0].id,
            home: 2,
            away: 2,
            confirmEdit: false,
          },
        },
        'valid',
      ),
    );
    expect(response.status).toBe(422);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});

it('rejects manual completion when the final is configured for penalties', async () => {
  const found = await mocks.load();
  let t = found.t;
  t.settings.knockout = 2;
  t.settings.resolution = 'penalties';
  const leader = t.players[0].id;
  for (const m of t.matches) {
    t = applyAction(
      t,
      {
        type: 'score',
        matchId: m.id,
        home: m.home === leader ? 1 : 0,
        away: m.away === leader ? 1 : 0,
        confirmEdit: false,
      },
      now,
    );
  }
  t = applyAction(t, { type: 'advance' }, now);
  const tie = t.ties[0],
    final = t.matches.find((m: { tieId: string | null }) => m.tieId === tie.id)!;
  t = applyAction(
    t,
    { type: 'score', matchId: final.id, home: 2, away: 2, confirmEdit: false },
    now,
  );
  mocks.load.mockResolvedValue({ owner, t });
  const response = await handler(
    request(
      'PATCH',
      {
        version: t.version,
        action: {
          type: 'resolveTie',
          tieId: tie.id,
          winner: tie.a,
          method: 'manual',
          extraTime: false,
        },
      },
      'valid',
    ),
  );
  expect(response.status).toBe(422);
  expect((await response.json()).error).toContain('not allowed');
  expect(mocks.save).not.toHaveBeenCalled();
  expect(t.champion).toBeNull();
});

it('lists multiple tournaments using only the verified session owner', async () => {
  mocks.listOwned.mockResolvedValue([
    { code, name: 'College' },
    { code: 'EFC-BCDEFGHJ', name: 'Friends' },
  ]);
  const response = await handler(request('GET', undefined, 'valid', 'tournaments?owner=other'));
  expect(response.status).toBe(200);
  expect((await response.json()).tournaments).toHaveLength(2);
  expect(mocks.listOwned).toHaveBeenCalledWith(expect.anything(), owner);
  expect(mocks.save).not.toHaveBeenCalled();
});
it('requires authentication to list owned tournaments', async () => {
  expect((await handler(request('GET', undefined, undefined, 'tournaments'))).status).toBe(401);
  expect(mocks.listOwned).not.toHaveBeenCalled();
});
it('creates tournaments with the verified owner and rejects client ownership fields', async () => {
  const { t } = await mocks.load();
  const input = { settings: t.settings, players: t.players };
  const response = await handler(request('POST', input, 'valid', 'tournaments'));
  expect(response.status).toBe(201);
  expect(mocks.save).toHaveBeenCalledWith(expect.anything(), expect.anything(), owner, true);
  mocks.save.mockClear();
  expect(
    (await handler(request('POST', { ...input, owner: 'other' }, 'valid', 'tournaments'))).status,
  ).toBe(422);
  expect(mocks.save).not.toHaveBeenCalled();
});

it('keeps public links readable with a revoked session without edit permission', async () => {
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401 } });
  const response = await handler(request('GET', undefined, 'revoked'));
  expect(response.status).toBe(200);
  expect((await response.json()).canEdit).toBe(false);
  expect(
    (await handler(request('GET', undefined, 'revoked', `tournaments/${code}/audit`))).status,
  ).toBe(401);
});

describe('tournament deletion', () => {
  it('rejects anonymous and expired sessions before database access', async () => {
    expect((await handler(request('DELETE', { confirmation: 'DELETE' }))).status).toBe(401);
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401 } });
    expect((await handler(request('DELETE', { confirmation: 'DELETE' }, 'expired'))).status).toBe(
      401,
    );
    expect(mocks.begin).not.toHaveBeenCalled();
    expect(mocks.deleteOwned).not.toHaveBeenCalled();
  });
  it.each(['delete', 'DELETE ', '', undefined])(
    'rejects incorrect confirmation %s',
    async (confirmation) => {
      expect((await handler(request('DELETE', { confirmation }, 'valid'))).status).toBe(422);
      expect(mocks.deleteOwned).not.toHaveBeenCalled();
    },
  );
  it('deletes only using the verified owner, ignoring a spoofed owner query', async () => {
    mocks.deleteOwned.mockResolvedValueOnce(true);
    const response = await handler(
      request(
        'DELETE',
        { confirmation: 'DELETE' },
        'valid',
        `tournaments/${code}?owner=someone-else`,
      ),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
    expect(mocks.deleteOwned).toHaveBeenCalledWith(expect.anything(), code, owner);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('does not report success for another owner or a missing tournament', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'someone-else' } }, error: null });
    mocks.deleteOwned.mockResolvedValueOnce(false);
    expect((await handler(request('DELETE', { confirmation: 'DELETE' }, 'valid'))).status).toBe(
      404,
    );
    expect(mocks.deleteOwned).toHaveBeenCalledWith(expect.anything(), code, 'someone-else');
  });
  it('reports storage failure and rejects nested delete routes', async () => {
    mocks.deleteOwned.mockRejectedValueOnce(new Error('Database unavailable'));
    expect((await handler(request('DELETE', { confirmation: 'DELETE' }, 'valid'))).status).toBe(
      500,
    );
    mocks.deleteOwned.mockClear();
    expect(
      (
        await handler(
          request('DELETE', { confirmation: 'DELETE' }, 'valid', `tournaments/${code}/audit`),
        )
      ).status,
    ).toBe(405);
    expect(mocks.deleteOwned).not.toHaveBeenCalled();
  });
});

describe('logo API authorization', () => {
  it('requires a verified session before reserving or discarding uploads', async () => {
    expect((await handler(request('POST', { extension: 'webp' }, undefined, 'logos'))).status).toBe(
      401,
    );
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401 } });
    expect((await handler(request('DELETE', { path: 'ignored' }, 'expired', 'logos'))).status).toBe(
      401,
    );
    expect(reserveLogo).not.toHaveBeenCalled();
    expect(retireDraft).not.toHaveBeenCalled();
  });
  it('reserves an optimized-image path for the verified user only', async () => {
    vi.mocked(reserveLogo).mockResolvedValueOnce('reserved.webp');
    expect(
      (await handler(request('POST', { extension: 'webp' }, 'valid', 'logos?owner=other'))).status,
    ).toBe(201);
    expect(reserveLogo).toHaveBeenCalledWith(owner, 'webp');
    expect((await handler(request('POST', { extension: 'svg' }, 'valid', 'logos'))).status).toBe(
      422,
    );
    expect(
      (await handler(request('POST', { extension: 'png', owner: 'other' }, 'valid', 'logos')))
        .status,
    ).toBe(422);
    expect(reserveLogo).toHaveBeenCalledOnce();
  });
  it('scopes discard to the authenticated owner and rejects malformed paths', async () => {
    const path = `${crypto.randomUUID()}/${crypto.randomUUID()}.webp`;
    expect((await handler(request('DELETE', { path }, 'valid', 'logos'))).status).toBe(200);
    expect(retireDraft).toHaveBeenCalledWith(owner, path);
    expect(
      (await handler(request('DELETE', { path: '../some-file' }, 'valid', 'logos'))).status,
    ).toBe(422);
  });
  it('runs cleanup after a successful tournament deletion but never after a denied deletion', async () => {
    mocks.deleteOwned.mockResolvedValueOnce(false);
    expect((await handler(request('DELETE', { confirmation: 'DELETE' }, 'valid'))).status).toBe(
      404,
    );
    expect(cleanupLogos).not.toHaveBeenCalled();
    mocks.deleteOwned.mockResolvedValueOnce(true);
    expect((await handler(request('DELETE', { confirmation: 'DELETE' }, 'valid'))).status).toBe(
      200,
    );
    expect(cleanupLogos).toHaveBeenCalledWith(owner, expect.any(Request));
  });
});

describe('automatic completion API', () => {
  it('persists completion on final score and keeps the full tournament publicly viewable', async () => {
    const { reachFinal } = await import('./tournamentStatus.fixture');
    const t = reachFinal();
    mocks.load.mockResolvedValue({ owner, t });
    const final = t.matches.at(-1)!;
    const response = await handler(
      request(
        'PATCH',
        {
          version: t.version,
          action: {
            type: 'score',
            matchId: final.id,
            home: 2,
            away: 1,
            confirmEdit: false,
          },
        },
        'valid',
      ),
    );
    expect(response.status).toBe(200);
    const { tournament } = await response.json();
    expect(tournament.status).toBe('completed');
    expect(mocks.save).toHaveBeenCalledWith(expect.anything(), tournament, owner);
    mocks.load.mockResolvedValue({ owner, t: tournament });
    const publicResponse = await handler(request('GET'));
    expect(publicResponse.status).toBe(200);
    expect(await publicResponse.json()).toEqual({ tournament, canEdit: false });
    expect(tournament.players).toEqual(t.players);
    expect(tournament.matches).toHaveLength(t.matches.length);
  });
  it.each([
    { version: 2, status: 'completed', action: { type: 'start' } },
    { version: 2, action: { type: 'complete' } },
    { version: 2, action: { type: 'start', status: 'completed' } },
  ])('rejects arbitrary status writes: %j', async (payload) => {
    expect((await handler(request('PATCH', payload, 'valid'))).status).toBe(422);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('rejects another user attempting to complete the final', async () => {
    const { reachFinal } = await import('./tournamentStatus.fixture');
    const t = reachFinal();
    mocks.load.mockResolvedValue({ owner, t });
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'another-owner' } }, error: null });
    expect(
      (
        await handler(
          request(
            'PATCH',
            {
              version: t.version,
              action: {
                type: 'score',
                matchId: t.matches.at(-1)!.id,
                home: 2,
                away: 1,
                confirmEdit: false,
              },
            },
            'valid',
          ),
        )
      ).status,
    ).toBe(403);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});

describe('version-aware refresh', () => {
  const conditional = (version: string, token?: string, suffix = '') =>
    new Request(`https://example.com/api/tournaments/${code}${suffix}`, {
      headers: {
        'X-Tournament-Version': version,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  it('returns only current version and permissions without loading children when unchanged', async () => {
    mocks.sql.mockResolvedValue([{ version: 2, owner_id: owner }]);
    const response = await handler(conditional('2', 'valid'));
    expect(await response.json()).toEqual({ unchanged: true, version: 2, canEdit: true });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(mocks.getUser).toHaveBeenCalledWith('valid');
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.sql).toHaveBeenCalledTimes(1);
  });
  it.each([undefined, 'other'])(
    'does not trust matching client versions for ownership: %s',
    async (token) => {
      mocks.sql.mockResolvedValue([{ version: 2, owner_id: owner }]);
      if (token)
        mocks.getUser.mockResolvedValue({ data: { user: { id: 'different-owner' } }, error: null });
      expect(await (await handler(conditional('2', token))).json()).toEqual({
        unchanged: true,
        version: 2,
        canEdit: false,
      });
      expect(mocks.load).not.toHaveBeenCalled();
    },
  );
  it('updates permissions for revoked sessions without downloading unchanged children', async () => {
    mocks.sql.mockResolvedValue([{ version: 2, owner_id: owner }]);
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401 } });
    expect(await (await handler(conditional('2', 'revoked'))).json()).toEqual({
      unchanged: true,
      version: 2,
      canEdit: false,
    });
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it('still reports authentication outages before database access', async () => {
    mocks.getUser.mockRejectedValue(new Error('unavailable'));
    expect((await handler(conditional('2', 'valid'))).status).toBe(503);
    expect(mocks.begin).not.toHaveBeenCalled();
  });
  it('loads the normal complete snapshot in the same repeatable-read transaction when changed', async () => {
    mocks.sql.mockResolvedValue([{ version: 3, owner_id: owner }]);
    const response = await handler(conditional('2', 'valid'));
    expect((await response.json()).tournament).toBeDefined();
    expect(mocks.load).toHaveBeenCalledOnce();
    expect(mocks.begin).toHaveBeenCalledOnce();
    expect(mocks.begin.mock.calls[0][0]).toBe('isolation level repeatable read read only');
  });
  it('returns 404 for a deleted tournament even when a client supplies a version', async () => {
    mocks.sql.mockResolvedValue([]);
    expect((await handler(conditional('2'))).status).toBe(404);
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it.each(['0', '-1', 'NaN', '2x', '1.5', '99999999999999999999'])(
    'ignores invalid version hint %s',
    async (value) => {
      expect((await (await handler(conditional(value))).json()).tournament).toBeDefined();
      expect(mocks.load).toHaveBeenCalledOnce();
      expect(mocks.sql).not.toHaveBeenCalled();
    },
  );
  it('never uses the version shortcut to bypass audit authorization', async () => {
    expect((await handler(conditional('2', undefined, '/audit'))).status).toBe(403);
    expect(mocks.load).toHaveBeenCalledOnce();
  });
});

it('registers list maintenance with the managed defer hook rather than awaiting it', async () => {
  mocks.listOwned.mockResolvedValue([]);
  const tasks: (() => Promise<void>)[] = [];
  const req = request('GET', undefined, 'valid', 'tournaments');
  const response = await handler(req, (task) => tasks.push(task));
  expect(response.status).toBe(200);
  expect(cleanupLogos).not.toHaveBeenCalled();
  expect(tasks).toHaveLength(1);
  await tasks[0]();
  expect(cleanupLogos).toHaveBeenCalledWith(owner, req);
});
