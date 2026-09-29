-- Run once in the Supabase SQL editor. All writes go through the Netlify API.
begin;
create table public.tournaments (
 id uuid primary key,
 public_code text not null unique check (public_code ~ '^EFC-[A-Z2-9]{8}$'),
 owner_id uuid not null references auth.users(id),
 name text not null check (length(trim(name)) between 1 and 70),
 settings jsonb not null,
 status text not null check (status in ('setup','league_active','league_complete','knockout_active','final','completed')),
 champion_id uuid,
 manual_order jsonb not null default '[]',
 version integer not null default 1 check (version > 0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check ((status = 'completed') = (champion_id is not null))
);
create index tournaments_owner on public.tournaments(owner_id);
create table public.players (
 id uuid primary key,
 tournament_id uuid not null references public.tournaments(id) on delete cascade,
 name text not null check (length(trim(name)) between 1 and 48),
 avatar text not null check (length(avatar) between 1 and 16),
 position integer not null,
 unique(tournament_id,id)
);
create unique index unique_player_name on public.players(tournament_id,lower(trim(name)));
alter table public.tournaments add constraint champion_in_tournament foreign key(id,champion_id) references public.players(tournament_id,id) deferrable initially deferred;
create table public.knockout_ties (
 id uuid primary key,
 tournament_id uuid not null references public.tournaments(id) on delete cascade,
 round integer not null check (round between 1 and 3),
 position integer not null check (position between 0 and 3),
 player_a_id uuid not null,
 player_b_id uuid not null,
 winner_id uuid,
 resolution jsonb,
 unique(tournament_id,id),
 unique(tournament_id,round,position),
 foreign key(tournament_id,player_a_id) references public.players(tournament_id,id),
 foreign key(tournament_id,player_b_id) references public.players(tournament_id,id),
 check(player_a_id <> player_b_id),
 check(winner_id is null or winner_id in (player_a_id,player_b_id))
);
create table public.matches (
 id uuid primary key,
 tournament_id uuid not null references public.tournaments(id) on delete cascade,
 home_player_id uuid not null,
 away_player_id uuid not null,
 stage text not null check(stage in ('league','knockout')),
 round integer not null,
 leg integer not null check(leg between 1 and 4),
 matchday integer not null check(matchday between 1 and 32),
 tie_id uuid,
 home_score integer check(home_score between 0 and 999),
 away_score integer check(away_score between 0 and 999),
 updated_at timestamptz,
 foreign key(tournament_id,home_player_id) references public.players(tournament_id,id),
 foreign key(tournament_id,away_player_id) references public.players(tournament_id,id),
 foreign key(tournament_id,tie_id) references public.knockout_ties(tournament_id,id),
 check(home_player_id <> away_player_id),
 check((home_score is null) = (away_score is null)),
 check((stage='league' and tie_id is null and round=0) or (stage='knockout' and tie_id is not null and round between 1 and 3 and leg<=2))
);
create unique index unique_league_fixture on public.matches(tournament_id,leg,least(home_player_id,away_player_id),greatest(home_player_id,away_player_id)) where stage='league';
create unique index unique_knockout_leg on public.matches(tie_id,leg) where stage='knockout';
create index matches_tournament on public.matches(tournament_id);
create table public.audit_log (
 id bigint generated always as identity primary key,
 tournament_id uuid not null references public.tournaments(id) on delete cascade,
 actor_id uuid not null references auth.users(id),
 action jsonb not null,
 previous_state jsonb not null,
 created_at timestamptz not null default now()
);
create index audit_tournament on public.audit_log(tournament_id,created_at desc);
-- Deny ALL direct browser access, even to authenticated users. No permissive
-- policies are intentional. Public responses are sanitized by the server API.
alter table public.tournaments enable row level security;
alter table public.players enable row level security;
alter table public.matches enable row level security;
alter table public.knockout_ties enable row level security;
alter table public.audit_log enable row level security;
revoke all on public.tournaments, public.players, public.matches, public.knockout_ties, public.audit_log from anon, authenticated;
commit;
