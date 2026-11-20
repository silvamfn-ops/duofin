-- ============================================================================
-- DUOFIN v6.10.0 · SCRIPT SQL DE CONFIGURAÇÃO DO SUPABASE
-- Executa este script no SQL Editor do teu projeto Supabase (app.supabase.com)
-- ============================================================================

create extension if not exists pgcrypto;

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Orçamento do casal',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table if not exists public.household_state (
  household_id uuid primary key references public.households(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  revision integer not null default 1,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.household_invites (
  code text primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null,
  used_by uuid references auth.users(id) on delete set null,
  used_at timestamptz
);

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_state enable row level security;
alter table public.household_invites enable row level security;

create or replace function public.is_household_member(p_household uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.household_members
    where household_id = p_household and user_id = auth.uid()
  );
$$;

drop policy if exists "members_select_households" on public.households;
create policy "members_select_households" on public.households
  for select using (public.is_household_member(id));

drop policy if exists "members_select_members" on public.household_members;
create policy "members_select_members" on public.household_members
  for select using (public.is_household_member(household_id));

drop policy if exists "members_select_state" on public.household_state;
create policy "members_select_state" on public.household_state
  for select using (public.is_household_member(household_id));

drop policy if exists "members_update_state" on public.household_state;
create policy "members_update_state" on public.household_state
  for update using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

drop policy if exists "members_insert_state" on public.household_state;
create policy "members_insert_state" on public.household_state
  for insert with check (public.is_household_member(household_id));

create or replace function public.create_household(p_name text, p_payload jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_hid uuid;
begin
  if v_uid is null then
    raise exception 'Utilizador não autenticado.';
  end if;
  insert into public.households (name, created_by)
  values (coalesce(nullif(trim(p_name), ''), 'Orçamento do casal'), v_uid)
  returning id into v_hid;

  insert into public.household_members (household_id, user_id, role)
  values (v_hid, v_uid, 'owner');

  insert into public.household_state (household_id, payload, revision, updated_by, updated_at)
  values (v_hid, coalesce(p_payload, '{}'::jsonb), 1, v_uid, now());

  return v_hid;
end;
$$;

create or replace function public.create_household_invite(p_household uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_code text;
begin
  if v_uid is null or not public.is_household_member(p_household) then
    raise exception 'Sem permissão para gerar convite.';
  end if;
  v_code := upper(substr(encode(gen_random_bytes(5), 'hex'), 1, 8));
  insert into public.household_invites (code, household_id, created_by, expires_at)
  values (v_code, p_household, v_uid, now() + interval '7 days');
  return v_code;
end;
$$;

create or replace function public.accept_household_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_inv public.household_invites%rowtype;
begin
  if v_uid is null then
    raise exception 'Utilizador não autenticado.';
  end if;
  select * into v_inv
  from public.household_invites
  where code = upper(trim(p_code))
    and used_at is null
    and expires_at > now();

  if not found then
    raise exception 'Código de convite inválido ou expirado.';
  end if;

  insert into public.household_members (household_id, user_id, role)
  values (v_inv.household_id, v_uid, 'member')
  on conflict (household_id, user_id) do nothing;

  update public.household_invites
  set used_by = v_uid, used_at = now()
  where code = v_inv.code;

  return v_inv.household_id;
end;
$$;

grant execute on function public.is_household_member(uuid) to authenticated;
grant execute on function public.create_household(text, jsonb) to authenticated;
grant execute on function public.create_household_invite(uuid) to authenticated;
grant execute on function public.accept_household_invite(text) to authenticated;

notify pgrst, 'reload schema';
