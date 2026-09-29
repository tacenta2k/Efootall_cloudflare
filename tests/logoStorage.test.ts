import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { beforeAll, afterAll, expect, it } from 'vitest';
let db: PGlite;
const owner = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const tournament = '00000000-0000-4000-8000-000000000003';
const second = '00000000-0000-4000-8000-000000000004';
const player = '00000000-0000-4000-8000-000000000005';
const path = `${owner}/00000000-0000-4000-8000-000000000006.webp`;
const replacement = `${owner}/00000000-0000-4000-8000-000000000007.webp`;
const foreign = `${other}/00000000-0000-4000-8000-000000000008.webp`;
beforeAll(async () => {
  db = new PGlite();
  // Minimal Supabase-owned schemas for exercising our real policies and triggers locally.
  await db.exec(`create schema auth; create table auth.users(id uuid primary key);
    create role anon; create role authenticated;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid() primary key,bucket_id text references storage.buckets(id),name text,owner_id text,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant usage on schema auth,storage to authenticated,anon;
    grant select,insert,update,delete on storage.objects to authenticated;
  `);
  for (const name of [
    '20260927000000_initial_tournament',
    '20260927010000_league_penalties',
    '20260930000000_team_logos',
    '20260930010000_team_logo_storage',
  ]) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8'));
  }
  await db.query('insert into auth.users values($1),($2)', [owner, other]);
  for (const [id, code] of [
    [tournament, 'EFC-ABCDEFGH'],
    [second, 'EFC-ABCDEFGJ'],
  ])
    await db.query(
      "insert into tournaments(id,public_code,owner_id,name,settings,status) values($1,$2,$3,'Logo cup','{}','setup')",
      [id, code, owner],
    );
  await db.query(
    "insert into players(id,tournament_id,name,avatar,position) values($1,$2,'Team','⚽',0)",
    [player, tournament],
  );
  for (const [p, user] of [
    [path, owner],
    [replacement, owner],
    [foreign, other],
  ])
    await db.query('insert into team_logo_assets(path,owner_id) values($1,$2)', [p, user]);
}, 30000);
afterAll(async () => db.close());
async function asUser(user: string, query: string, values: unknown[] = []) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
    await tx.exec('set local role authenticated');
    return tx.query(query, values);
  });
}
it('configures a public bucket limited to optimized PNG/WebP and 128 KB', async () => {
  expect(
    (await db.query('select public,file_size_limit,allowed_mime_types from storage.buckets')).rows,
  ).toEqual([
    { public: true, file_size_limit: 131072, allowed_mime_types: ['image/webp', 'image/png'] },
  ]);
});
it('only permits an authenticated owner to upload to a reserved path, without overwrite', async () => {
  await expect(
    asUser(
      other,
      "insert into storage.objects(bucket_id,name,owner_id) values('team-logos',$1,$2)",
      [path, other],
    ),
  ).rejects.toThrow();
  await expect(
    asUser(
      owner,
      "insert into storage.objects(bucket_id,name,owner_id) values('team-logos',$1,$2)",
      [`${owner}/${crypto.randomUUID()}.webp`, owner],
    ),
  ).rejects.toThrow();
  for (const [p, user] of [
    [path, owner],
    [replacement, owner],
    [foreign, other],
  ])
    await asUser(
      user,
      "insert into storage.objects(bucket_id,name,owner_id) values('team-logos',$1,$2)",
      [p, user],
    );
  expect(
    (
      await asUser(
        owner,
        "update storage.objects set name='overwritten' where name=$1 returning id",
        [path],
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    (await asUser(other, 'select * from storage.objects where name=$1', [path])).rows,
  ).toHaveLength(0);
});
it('denies browser access to the asset registry and tournament rows', async () => {
  await expect(
    asUser(owner, "update team_logo_assets set state='retired' where path=$1", [path]),
  ).rejects.toThrow();
  await expect(asUser(other, 'delete from players where id=$1', [player])).rejects.toThrow();
});
it('accepts existing emoji values and rejects foreign and incomplete image references', async () => {
  expect((await db.query('select avatar from players where id=$1', [player])).rows).toEqual([
    { avatar: '⚽' },
  ]);
  await expect(
    db.query('update players set avatar=$1 where id=$2', ['logo:' + foreign, player]),
  ).rejects.toThrow('belongs to another user');
  const missing = `${owner}/${crypto.randomUUID()}.png`;
  await db.query('insert into team_logo_assets(path,owner_id) values($1,$2)', [missing, owner]);
  await expect(
    db.query('update players set avatar=$1 where id=$2', ['logo:' + missing, player]),
  ).rejects.toThrow('incomplete');
  await db.query('update players set avatar=$1 where id=$2', ['logo:' + path, player]);
  expect((await db.query('select avatar from players where id=$1', [player])).rows).toEqual([
    { avatar: 'logo:' + path },
  ]);
  expect(
    (await asUser(owner, 'delete from storage.objects where name=$1 returning id', [path])).rows,
  ).toHaveLength(0);
});
it('keeps images through snapshot replacement and retires only unreferenced images', async () => {
  await db.transaction(async (tx) => {
    await tx.query('delete from players where id=$1', [player]);
    await tx.query(
      "insert into players(id,tournament_id,name,avatar,position) values($1,$2,'Team',$3,0)",
      [player, tournament, 'logo:' + path],
    );
  });
  expect((await db.query('select state from team_logo_assets where path=$1', [path])).rows).toEqual(
    [{ state: 'active' }],
  );
  await expect(
    db.transaction(async (tx) => {
      await tx.query("update players set avatar='🐺' where id=$1", [player]);
      throw new Error('Rollback logo edit');
    }),
  ).rejects.toThrow('Rollback logo edit');
  expect((await db.query('select avatar from players where id=$1', [player])).rows).toEqual([
    { avatar: 'logo:' + path },
  ]);
  const sharedPlayer = crypto.randomUUID();
  await db.query(
    "insert into players(id,tournament_id,name,avatar,position) values($1,$2,'Shared logo',$3,0)",
    [sharedPlayer, second, 'logo:' + path],
  );
  await db.query('update players set avatar=$1 where id=$2', ['logo:' + replacement, player]);
  expect((await db.query('select state from team_logo_assets where path=$1', [path])).rows).toEqual(
    [{ state: 'active' }],
  );
  await db.query('delete from players where id=$1', [sharedPlayer]);
  expect((await db.query('select state from team_logo_assets where path=$1', [path])).rows).toEqual(
    [{ state: 'retired' }],
  );
  await expect(
    db.query('update players set avatar=$1 where id=$2', ['logo:' + path, player]),
  ).rejects.toThrow('unavailable');
  expect(
    (await asUser(other, 'delete from storage.objects where name=$1 returning id', [path])).rows,
  ).toHaveLength(0);
  expect(
    (await asUser(owner, 'delete from storage.objects where name=$1 returning id', [path])).rows,
  ).toHaveLength(1);
  await db.query("update players set avatar='🔥' where id=$1", [player]);
  expect(
    (await db.query('select state from team_logo_assets where path=$1', [replacement])).rows,
  ).toEqual([{ state: 'retired' }]);
});
it('tournament deletion retires its images without deleting another tournament or storage metadata directly', async () => {
  const next = `${owner}/${crypto.randomUUID()}.webp`;
  await db.query('insert into team_logo_assets(path,owner_id) values($1,$2)', [next, owner]);
  await asUser(
    owner,
    "insert into storage.objects(bucket_id,name,owner_id) values('team-logos',$1,$2)",
    [next, owner],
  );
  await db.query('update players set avatar=$1 where id=$2', ['logo:' + next, player]);
  await db.query('delete from tournaments where id=$1', [tournament]);
  expect((await db.query('select state from team_logo_assets where path=$1', [next])).rows).toEqual(
    [{ state: 'retired' }],
  );
  expect((await db.query('select id from tournaments')).rows).toEqual([{ id: second }]);
  expect(
    (await db.query('select name from storage.objects where name=$1', [next])).rows,
  ).toHaveLength(1);
});
