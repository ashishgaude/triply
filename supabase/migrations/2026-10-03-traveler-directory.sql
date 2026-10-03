begin;

create schema if not exists triply;
revoke all on schema triply from public, anon;
grant usage on schema triply to authenticated;

create table if not exists triply.users (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(trim(display_name)) between 1 and 80)
);

alter table triply.users enable row level security;
revoke all on triply.users from public, anon, authenticated;
grant select on triply.users to authenticated;

drop policy if exists "Triply users can read traveler directory" on triply.users;
create policy "Triply users can read traveler directory"
on triply.users for select to authenticated using (true);

create or replace function triply.sync_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into triply.users (id, display_name)
  values (
    new.id,
    left(coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
      nullif(split_part(new.email, '@', 1), ''),
      'Traveler ' || left(new.id::text, 8)
    ), 80)
  )
  on conflict (id) do update set display_name = excluded.display_name;
  return new;
end;
$$;

revoke all on function triply.sync_user() from public, anon, authenticated;

drop trigger if exists triply_user_directory_sync on auth.users;
create trigger triply_user_directory_sync
after insert or update of email, raw_user_meta_data on auth.users
for each row execute function triply.sync_user();

insert into triply.users (id, display_name)
select id, left(coalesce(
  nullif(trim(raw_user_meta_data ->> 'full_name'), ''),
  nullif(trim(raw_user_meta_data ->> 'name'), ''),
  nullif(split_part(email, '@', 1), ''),
  'Traveler ' || left(id::text, 8)
), 80)
from auth.users
on conflict (id) do update set display_name = excluded.display_name;

commit;