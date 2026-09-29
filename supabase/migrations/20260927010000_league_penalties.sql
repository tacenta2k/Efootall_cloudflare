-- Forward migration for CLI deployments, including installations that already
-- ran database/002_league_penalties.sql manually. Preserve all existing data.
-- Rules/points stay in tournaments.settings; this stores match shootout scores.
begin;
alter table public.matches add column if not exists league_penalties jsonb;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.matches'::regclass
      and conname = 'valid_league_penalties'
  ) then
    alter table public.matches add constraint valid_league_penalties check (
      league_penalties is null or coalesce((
        stage = 'league'
        and home_score is not null and away_score is not null
        and home_score = away_score
        and jsonb_typeof(league_penalties) = 'object'
        and jsonb_typeof(league_penalties->'home') = 'number'
        and jsonb_typeof(league_penalties->'away') = 'number'
        and (league_penalties->>'home') ~ '^[0-9]{1,3}$'
        and (league_penalties->>'away') ~ '^[0-9]{1,3}$'
        and (league_penalties->>'home') <> (league_penalties->>'away')
      ), false)
    );
  end if;
end $$;
commit;
