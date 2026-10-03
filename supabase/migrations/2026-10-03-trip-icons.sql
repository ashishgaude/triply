begin;

alter table triply.trips add column if not exists icon text not null default 'plane'
check (icon in ('plane', 'car', 'train', 'beach', 'mountain', 'camping', 'city', 'boat'));

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
      p_trip ->> 'currency' is distinct from previous.currency or
      coalesce(nullif(p_trip ->> 'icon', ''), previous.icon) is distinct from previous.icon
    ) then raise exception 'Only the trip owner can change trip details or travelers'; end if;
    if p_trip ->> 'currency' is distinct from previous.currency then raise exception 'Trip currency cannot be changed'; end if;
    saved_version := previous.version + 1;
    update triply.trips t set name = trim(p_trip ->> 'name'), destination = coalesce(p_trip ->> 'destination', ''),
      icon = coalesce(nullif(p_trip ->> 'icon', ''), previous.icon), version = saved_version, updated_at = now()
      where t.id = requested_trip_id;
    delete from triply.payments p where p.trip_id = requested_trip_id;
    delete from triply.expenses e where e.trip_id = requested_trip_id;
    delete from triply.trip_members m where m.trip_id = requested_trip_id;
  else
    if p_expected_version is not null then raise exception 'Trip no longer exists'; end if;
    saved_version := 1;
    insert into triply.trips(id, owner_id, name, destination, currency, icon)
    values (requested_trip_id, caller, trim(p_trip ->> 'name'), coalesce(p_trip ->> 'destination', ''),
      p_trip ->> 'currency', coalesce(nullif(p_trip ->> 'icon', ''), 'plane'));
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
    values ((expense ->> 'id')::uuid, requested_trip_id, trim(expense ->> 'title'), expense_amount,
      (expense ->> 'payer')::uuid, expense ->> 'category', (expense ->> 'date')::date);
    insert into triply.expense_participants(trip_id, expense_id, user_id, share_cents, position)
    select requested_trip_id, (expense ->> 'id')::uuid, participant::uuid,
      expense_amount / participant_count + case when ordinal <= expense_amount % participant_count then 1 else 0 end,
      ordinal - 1
    from jsonb_array_elements_text(expense -> 'participants') with ordinality as participants(participant, ordinal);
  end loop;

  insert into triply.payments(id, trip_id, from_user_id, to_user_id, amount_cents)
  select (payment ->> 'id')::uuid, requested_trip_id, (payment ->> 'from')::uuid,
    (payment ->> 'to')::uuid, (payment ->> 'amount')::bigint
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
    'id', t.id, 'ownerId', t.owner_id, 'version', t.version, 'icon', t.icon,
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