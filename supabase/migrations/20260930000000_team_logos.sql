begin;
-- Compact references only. Image bytes live in Supabase Storage.
create table public.team_logo_assets (
  path text primary key check (path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|png)$'),
  owner_id uuid not null references auth.users(id),
  state text not null default 'pending' check (state in ('pending','active','retired')),
  created_at timestamptz not null default now()
);
create index team_logo_assets_owner on public.team_logo_assets(owner_id,state);
alter table public.team_logo_assets enable row level security;
revoke all on public.team_logo_assets from anon, authenticated;
alter table public.players drop constraint players_avatar_check;
alter table public.players add constraint players_avatar_check check (
  (length(avatar) between 1 and 16 and avatar not like 'logo:%') or
  avatar ~ '^logo:[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|png)$'
);
create index players_logo_reference on public.players(avatar) where avatar like 'logo:%';

-- Lock the registry row so attachment and cleanup cannot race.
create function public.check_team_logo() returns trigger language plpgsql security definer
set search_path = '' as $$
declare asset public.team_logo_assets; tournament_owner uuid;
begin
  if new.avatar not like 'logo:%' then return new; end if;
  select * into asset from public.team_logo_assets where path=substring(new.avatar from 6) for update;
  select owner_id into tournament_owner from public.tournaments where id=new.tournament_id;
  if asset.path is null or asset.owner_id <> tournament_owner or asset.state='retired' then
    raise exception 'Logo is unavailable or belongs to another user';
  end if;
  if asset.state='pending' and not exists (select 1 from storage.objects where bucket_id='team-logos' and name=asset.path) then
    raise exception 'Logo upload is incomplete';
  end if;
  update public.team_logo_assets set state='active' where path=asset.path and state='pending';
  return new;
end $$;
create trigger check_team_logo before insert or update of avatar on public.players
for each row when (new.avatar like 'logo:%') execute function public.check_team_logo();

-- Deferred until the snapshot replacement finishes: ordinary result saves retain logos.
create function public.retire_team_logo() returns trigger language plpgsql security definer
set search_path = '' as $$
begin
  if old.avatar like 'logo:%' then
    perform 1 from public.team_logo_assets where path=substring(old.avatar from 6) for update;
    if not exists(select 1 from public.players where avatar=old.avatar) then
      update public.team_logo_assets set state='retired' where path=substring(old.avatar from 6);
    end if;
  end if;
  return null;
end $$;
create constraint trigger retire_team_logo after delete or update of avatar on public.players
 deferrable initially deferred for each row when (old.avatar like 'logo:%') execute function public.retire_team_logo();
revoke all on function public.check_team_logo(), public.retire_team_logo() from public;
commit;
