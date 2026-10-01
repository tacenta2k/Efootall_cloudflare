import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { expect, it } from 'vitest';
import { load, save, listOwned } from '../server/store';
import { createTournament, applyAction } from '../src/lib/engine';
import { defaultSettings } from '../src/lib/types';

// Opt in explicitly. All DDL and test records roll back, including on failure.
it.skipIf(process.env.PES_VERIFY_LINKED_DB !== '1')(
  'round-trips settings, fixtures and shootouts through the real store on linked PostgreSQL',
  async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for this check.');
    const sql = postgres(process.env.DATABASE_URL, {
      ssl: 'require',
      max: 1,
      prepare: false,
      connect_timeout: 10,
    });
    const rollback = new Error('Verification complete: roll back all changes.');
    const migration = (
      await readFile(
        new URL('../supabase/migrations/20260927010000_league_penalties.sql', import.meta.url),
        'utf8',
      )
    )
      .replace(/^begin;\s*$/m, '')
      .replace(/^commit;\s*$/m, '');
    try {
      await sql.begin(async (tx) => {
        await tx`set local lock_timeout = '3s'`;
        await tx`set local statement_timeout = '10s'`;
        await tx.unsafe(migration);
        console.info('Linked verification: migration applied inside rollback transaction.');
        const owner = crypto.randomUUID();
        await tx`insert into auth.users (id) values (${owner})`;
        const now = new Date().toISOString();
        const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        const code =
          'EFC-' +
          Array.from(
            crypto.getRandomValues(new Uint8Array(8)),
            (n) => alphabet[n % alphabet.length],
          ).join('');
        let t = createTournament(
          { ...defaultSettings, name: 'Rollback verification', knockout: 0 },
          ['One', 'Two'].map((name) => ({ id: crypto.randomUUID(), name, avatar: '⚽' })),
          code,
          now,
        );
        await save(tx, t, owner, true);
        console.info('Linked verification: tournament created.');
        const second = createTournament(
          { ...defaultSettings, name: 'Second rollback cup', knockout: 0 },
          ['Three', 'Four'].map((name) => ({ id: crypto.randomUUID(), name, avatar: '⚽' })),
          code.slice(0, -1) + (code.endsWith('A') ? 'B' : 'A'),
          now,
        );
        await save(tx, second, owner, true);
        expect(await listOwned(tx, owner)).toHaveLength(2);
        expect(await listOwned(tx, crypto.randomUUID())).toEqual([]);
        expect((await load(tx, code))?.owner).toBe(owner);
        t = applyAction(
          t,
          {
            type: 'settings',
            settings: {
              ...t.settings,
              leagueDrawsAllowed: false,
              leaguePenaltyPoints: { winner: 4, loser: 2 },
            },
            players: t.players,
          },
          now,
        );
        await save(tx, t, owner);
        expect((await load(tx, code))?.t.settings).toEqual(t.settings);
        console.info('Linked verification: settings saved and loaded.');
        t = applyAction(t, { type: 'start' }, now);
        await save(tx, t, owner);
        expect((await load(tx, code))?.t.matches.every((m) => m.leaguePenalties === null)).toBe(
          true,
        );
        console.info('Linked verification: fixtures saved and loaded.');
        t = applyAction(
          t,
          {
            type: 'score',
            matchId: t.matches[0].id,
            home: 2,
            away: 2,
            leaguePenalties: { home: 4, away: 3 },
            confirmEdit: false,
          },
          now,
        );
        await save(tx, t, owner);
        // Reapplying the forward migration must also preserve stored results.
        await tx.unsafe(migration);
        const found = await load(tx, code);
        expect(found?.owner).toBe(owner);
        expect(found?.t.settings).toEqual(t.settings);
        expect(found?.t.version).toBe(t.version);
        expect(found?.t.matches.find((m) => m.id === t.matches[0].id)).toMatchObject({
          homeScore: 2,
          awayScore: 2,
          leaguePenalties: { home: 4, away: 3 },
        });
        t = applyAction(t, { type: 'avatar', playerId: t.players[0].id, avatar: '🔥' }, now);
        await save(tx, t, owner, false, {
          type: 'avatar',
          playerId: t.players[0].id,
          avatar: '🔥',
        });
        expect((await load(tx, code))?.t).toMatchObject({
          version: t.version,
          players: expect.arrayContaining([
            expect.objectContaining({ id: t.players[0].id, avatar: '🔥' }),
          ]),
        });
        console.info('Linked verification: avatar update saved without replacing fixtures.');
        console.info('Linked verification: shootout saved and loaded; rolling back.');
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      await sql.end({ timeout: 1 });
    }
  },
  120000,
);
