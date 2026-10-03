begin;

create table if not exists triply.trips (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  destination text not null default '' check (length(destination) <= 80),
  currency text not null check (currency in ('EUR', 'USD', 'GBP', 'INR', 'CAD', 'AUD')),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists triply.trip_members (
  trip_id uuid not null references triply.trips(id) on delete cascade,
  user_id uuid not null references triply.users(id) on delete restrict,
  position integer not null check (position >= 0),
  primary key (trip_id, user_id),
  unique (trip_id, position)
);

create table if not exists triply.expenses (
  id uuid primary key,
  trip_id uuid not null references triply.trips(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 100),
  amount_cents bigint not null check (amount_cents between 1 and 9999999999),
  payer_id uuid not null,
  category text not null check (category in ('Food & drinks', 'Stay', 'Transport', 'Activities', 'Other')),
  spent_on date not null,
  unique (trip_id, id),
  foreign key (trip_id, payer_id) references triply.trip_members(trip_id, user_id)
);

create table if not exists triply.expense_participants (
  trip_id uuid not null,
  expense_id uuid not null,
  user_id uuid not null,
  share_cents bigint not null check (share_cents >= 0),
  position integer not null check (position >= 0),
  primary key (expense_id, user_id),
  unique (expense_id, position),
  foreign key (trip_id, expense_id) references triply.expenses(trip_id, id) on delete cascade,
  foreign key (trip_id, user_id) references triply.trip_members(trip_id, user_id)
);

create table if not exists triply.payments (
  id uuid primary key,
  trip_id uuid not null references triply.trips(id) on delete cascade,
  from_user_id uuid not null,
  to_user_id uuid not null,
  amount_cents bigint not null check (amount_cents between 1 and 9999999999),
  check (from_user_id <> to_user_id),
  foreign key (trip_id, from_user_id) references triply.trip_members(trip_id, user_id),
  foreign key (trip_id, to_user_id) references triply.trip_members(trip_id, user_id)
);

create index if not exists trip_members_user_idx on triply.trip_members(user_id);
create index if not exists trips_owner_idx on triply.trips(owner_id);
create index if not exists expenses_trip_date_idx on triply.expenses(trip_id, spent_on);
create index if not exists expense_participants_trip_idx on triply.expense_participants(trip_id);
create index if not exists payments_trip_idx on triply.payments(trip_id);

create or replace function triply.can_access_trip(p_trip_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from triply.trips t where t.id = p_trip_id and (
      t.owner_id = auth.uid() or exists (
        select 1 from triply.trip_members m where m.trip_id = t.id and m.user_id = auth.uid()
      )
    )
  );
$$;

revoke all on function triply.can_access_trip(uuid) from public, anon, authenticated;
grant execute on function triply.can_access_trip(uuid) to authenticated;

alter table triply.trips enable row level security;
alter table triply.trip_members enable row level security;
alter table triply.expenses enable row level security;
alter table triply.expense_participants enable row level security;
alter table triply.payments enable row level security;

revoke all on triply.trips, triply.trip_members, triply.expenses, triply.expense_participants, triply.payments from public, anon, authenticated;
grant select on triply.trips, triply.trip_members, triply.expenses, triply.expense_participants, triply.payments to authenticated;

drop policy if exists "Triply trip access" on triply.trips;
create policy "Triply trip access" on triply.trips for select to authenticated using (triply.can_access_trip(id));
drop policy if exists "Triply member access" on triply.trip_members;
create policy "Triply member access" on triply.trip_members for select to authenticated using (triply.can_access_trip(trip_id));
drop policy if exists "Triply expense access" on triply.expenses;
create policy "Triply expense access" on triply.expenses for select to authenticated using (triply.can_access_trip(trip_id));
drop policy if exists "Triply participant access" on triply.expense_participants;
create policy "Triply participant access" on triply.expense_participants for select to authenticated using (triply.can_access_trip(trip_id));
drop policy if exists "Triply payment access" on triply.payments;
create policy "Triply payment access" on triply.payments for select to authenticated using (triply.can_access_trip(trip_id));

create or replace function triply.save_trip(p_trip jsonb, p_expected_version integer default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  requested_trip_id uuid := (p_trip ->> 'id')::uuid;
  previous triply.trips%rowtype;
  old_members uuid[];
  new_members uuid[];
  expense jsonb;
  expense_amount bigint;
  participant_count integer;
  saved_version integer;
begin
  if caller is null then raise exception 'Sign in to save a trip'; end if;
  if requested_trip_id is null or jsonb_typeof(p_trip -> 'members') is distinct from 'array'
    or jsonb_array_length(p_trip -> 'members') = 0
    or jsonb_typeof(p_trip -> 'expenses') is distinct from 'array'
    or jsonb_typeof(p_trip -> 'payments') is distinct from 'array'
  then raise exception 'Invalid trip data'; end if;

  select array_agg((member ->> 'id')::uuid order by member ->> 'id') into new_members
  from jsonb_array_elements(p_trip -> 'members') member;
  if cardinality(new_members) <> (select count(distinct member_id) from unnest(new_members) member_id)
  then raise exception 'Duplicate or invalid travelers'; end if;

  select * into previous from triply.trips t where t.id = requested_trip_id for update;
  if found then
    if not triply.can_access_trip(requested_trip_id) then raise exception 'Trip access denied'; end if;
    if p_expected_version is distinct from previous.version then
      raise exception 'This trip changed on another device. Refresh and try again';
    end if;
    select array_agg(m.user_id order by m.user_id::text) into old_members from triply.trip_members m where m.trip_id = requested_trip_id;
    if caller <> previous.owner_id and (
      new_members is distinct from old_members or
      p_trip ->> 'name' is distinct from previous.name or
      p_trip ->> 'destination' is distinct from previous.destination or
      p_trip ->> 'currency' is distinct from previous.currency
    ) then raise exception 'Only the trip owner can change trip details or travelers'; end if;
    if p_trip ->> 'currency' is distinct from previous.currency then raise exception 'Trip currency cannot be changed'; end if;
    saved_version := previous.version + 1;
    update triply.trips t set name = trim(p_trip ->> 'name'), destination = coalesce(p_trip ->> 'destination', ''), version = saved_version, updated_at = now() where t.id = requested_trip_id;
    delete from triply.payments p where p.trip_id = requested_trip_id;
    delete from triply.expenses e where e.trip_id = requested_trip_id;
    delete from triply.trip_members m where m.trip_id = requested_trip_id;
  else
    if p_expected_version is not null then raise exception 'Trip no longer exists'; end if;
    saved_version := 1;
    insert into triply.trips(id, owner_id, name, destination, currency)
    values (requested_trip_id, caller, trim(p_trip ->> 'name'), coalesce(p_trip ->> 'destination', ''), p_trip ->> 'currency');
  end if;

  insert into triply.trip_members(trip_id, user_id, position)
  select requested_trip_id, (member ->> 'id')::uuid, ordinal - 1
  from jsonb_array_elements(p_trip -> 'members') with ordinality as members(member, ordinal);

  for expense in select value from jsonb_array_elements(p_trip -> 'expenses') loop
    if jsonb_typeof(expense -> 'participants') is distinct from 'array' or jsonb_array_length(expense -> 'participants') = 0
    then raise exception 'An expense needs at least one participant'; end if;
    participant_count := jsonb_array_length(expense -> 'participants');
    if participant_count <> (select count(distinct value) from jsonb_array_elements_text(expense -> 'participants'))
    then raise exception 'Duplicate expense participants'; end if;
    expense_amount := (expense ->> 'amount')::bigint;
    insert into triply.expenses(id, trip_id, title, amount_cents, payer_id, category, spent_on)
    values ((expense ->> 'id')::uuid, requested_trip_id, trim(expense ->> 'title'), expense_amount, (expense ->> 'payer')::uuid, expense ->> 'category', (expense ->> 'date')::date);
    insert into triply.expense_participants(trip_id, expense_id, user_id, share_cents, position)
    select requested_trip_id, (expense ->> 'id')::uuid, participant::uuid,
      expense_amount / participant_count + case when ordinal <= expense_amount % participant_count then 1 else 0 end,
      ordinal - 1
    from jsonb_array_elements_text(expense -> 'participants') with ordinality as participants(participant, ordinal);
  end loop;

  insert into triply.payments(id, trip_id, from_user_id, to_user_id, amount_cents)
  select (payment ->> 'id')::uuid, requested_trip_id, (payment ->> 'from')::uuid, (payment ->> 'to')::uuid, (payment ->> 'amount')::bigint
  from jsonb_array_elements(p_trip -> 'payments') payment;

  return jsonb_build_object('id', requested_trip_id, 'version', saved_version);
end;
$$;

revoke all on function triply.save_trip(jsonb, integer) from public, anon, authenticated;
grant execute on function triply.save_trip(jsonb, integer) to authenticated;

create or replace function triply.get_workspace()
returns jsonb language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object('trips', coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'ownerId', t.owner_id, 'version', t.version,
    'name', t.name, 'destination', t.destination, 'currency', t.currency, 'sample', false,
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', m.user_id, 'name', u.display_name) order by m.position)
      from triply.trip_members m join triply.users u on u.id = m.user_id where m.trip_id = t.id), '[]'::jsonb),
    'expenses', coalesce((select jsonb_agg(jsonb_build_object(
      'id', e.id, 'title', e.title, 'amount', e.amount_cents, 'payer', e.payer_id,
      'category', e.category, 'date', e.spent_on,
      'participants', coalesce((select jsonb_agg(p.user_id order by p.position) from triply.expense_participants p where p.expense_id = e.id), '[]'::jsonb)
    ) order by e.spent_on desc, e.id) from triply.expenses e where e.trip_id = t.id), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'from', p.from_user_id, 'to', p.to_user_id, 'amount', p.amount_cents) order by p.id)
      from triply.payments p where p.trip_id = t.id), '[]'::jsonb)
  ) order by t.created_at desc, t.id), '[]'::jsonb)) from triply.trips t;
$$;

revoke all on function triply.get_workspace() from public, anon, authenticated;
grant execute on function triply.get_workspace() to authenticated;

commit;