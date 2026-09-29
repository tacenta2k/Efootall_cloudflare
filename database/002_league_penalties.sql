-- Additive migration: run after 001_initial.sql, before deploying this code.
-- League draw/points policies live in tournaments.settings (JSONB).
-- Missing leagueDrawsAllowed means true; missing leaguePenaltyPoints means
-- unconfigured, NEVER an implicit points split. Existing results are unchanged.
begin;
alter table public.matches add column league_penalties jsonb;
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
commit;
