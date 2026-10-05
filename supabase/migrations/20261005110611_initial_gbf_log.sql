-- v0.1: immutable observations; client builds drop/damage projections.
-- Serialize each user's profile writes so a sync cursor cannot pass an uncommitted insert.
create table public.gbf_profiles (
  owner_id uuid not null references auth.users(id) on delete cascade,
  profile_id text not null check (profile_id ~ '^[a-zA-Z0-9_-]{1,50}$'),
  next_sequence bigint not null default 0 check (next_sequence >= 0),
  primary key (owner_id, profile_id)
);
create table public.gbf_observations (
  owner_id uuid not null default auth.uid(),
  profile_id text not null,
  operation_id uuid not null,
  sequence bigint not null default 0,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, operation_id),
  unique (owner_id, profile_id, sequence),
  foreign key (owner_id, profile_id) references public.gbf_profiles(owner_id, profile_id) on delete cascade,
  check (octet_length(payload::text) <= 250000),
  check (jsonb_typeof(payload) = 'object' and payload @> '{"schemaVersion":1,"demo":false}'),
  check (payload ?& array['captureKey','battleKey','identity','quest','route','capturedAt','adapter','drops','dropState','damage','issues']),
  check (jsonb_typeof(payload->'drops') = 'array' and jsonb_array_length(payload->'drops') <= 500),
  check (jsonb_typeof(payload->'issues') = 'array' and jsonb_array_length(payload->'issues') <= 50),
  check (jsonb_typeof(payload->'damage') = 'object'),
  check (payload->>'identity' in ('candidate','weak','verified')),
  check (payload->>'dropState' in ('partial','complete'))
);
alter table public.gbf_profiles enable row level security;
alter table public.gbf_observations enable row level security;
create policy profiles_select on public.gbf_profiles for select to authenticated using (owner_id = (select auth.uid()));
create policy profiles_insert on public.gbf_profiles for insert to authenticated with check (owner_id = (select auth.uid()));
create policy profiles_update on public.gbf_profiles for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy observations_select on public.gbf_observations for select to authenticated using (owner_id = (select auth.uid()));
create policy observations_insert on public.gbf_observations for insert to authenticated with check (owner_id = (select auth.uid()));
revoke all on public.gbf_profiles, public.gbf_observations from anon, authenticated;
grant select, insert, update on public.gbf_profiles to authenticated;
grant select, insert on public.gbf_observations to authenticated;

create function public.gbf_assign_sequence() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.owner_id is distinct from auth.uid() then raise exception 'owner mismatch' using errcode = '42501'; end if;
  insert into public.gbf_profiles(owner_id, profile_id) values(new.owner_id, new.profile_id) on conflict do nothing;
  update public.gbf_profiles set next_sequence = next_sequence + 1
    where owner_id = new.owner_id and profile_id = new.profile_id
    returning next_sequence into new.sequence;
  return new;
end;
$$;
revoke all on function public.gbf_assign_sequence() from public, anon, authenticated;
create trigger assign_sequence before insert on public.gbf_observations for each row execute function public.gbf_assign_sequence();

create function public.gbf_append_observation(p_profile text, p_operation uuid, p_payload jsonb) returns bigint
language plpgsql security invoker set search_path = '' as $$
declare
  v_owner uuid := auth.uid();
  v_existing public.gbf_observations;
  v_sequence bigint;
begin
  if v_owner is null then raise exception 'authentication required' using errcode = '42501'; end if;
  insert into public.gbf_profiles(owner_id, profile_id) values(v_owner, p_profile) on conflict do nothing;
  -- Lock before idempotency check. Lock is held until the surrounding transaction commits.
  perform 1 from public.gbf_profiles where owner_id = v_owner and profile_id = p_profile for update;
  select * into v_existing from public.gbf_observations where owner_id = v_owner and operation_id = p_operation;
  if found then
    if v_existing.profile_id is distinct from p_profile or v_existing.payload is distinct from p_payload then
      raise exception 'operation id already used for different content' using errcode = '23000';
    end if;
    return v_existing.sequence;
  end if;
  insert into public.gbf_observations(owner_id, profile_id, operation_id, payload)
    values(v_owner, p_profile, p_operation, p_payload) returning sequence into v_sequence;
  return v_sequence;
end;
$$;
revoke all on function public.gbf_append_observation(text, uuid, jsonb) from public, anon;
grant execute on function public.gbf_append_observation(text, uuid, jsonb) to authenticated;
