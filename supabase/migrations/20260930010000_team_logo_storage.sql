begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('team-logos','team-logos',true,131072,array['image/webp','image/png']);
-- No UPDATE policy: an existing logo can never be overwritten in place.
create function public.can_upload_team_logo(object_name text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare permitted boolean;
begin
  select (owner_id=auth.uid() and state='pending') into permitted
  from public.team_logo_assets where path=object_name for update;
  return coalesce(permitted,false);
end $$;
create function public.can_remove_team_logo(object_name text) returns boolean
language sql security definer set search_path = '' as $$
  select exists(select 1 from public.team_logo_assets
    where path=object_name and owner_id=auth.uid() and state='retired');
$$;
revoke all on function public.can_upload_team_logo(text), public.can_remove_team_logo(text) from public;
grant execute on function public.can_upload_team_logo(text), public.can_remove_team_logo(text) to authenticated;
create policy team_logo_insert on storage.objects for insert to authenticated
with check(bucket_id='team-logos' and public.can_upload_team_logo(name));
-- SELECT is needed for Storage API removal; public image GETs use the public bucket.
create policy team_logo_select on storage.objects for select to authenticated
using(bucket_id='team-logos' and owner_id=auth.uid()::text);
create policy team_logo_delete on storage.objects for delete to authenticated
using(bucket_id='team-logos' and public.can_remove_team_logo(name));
commit;
