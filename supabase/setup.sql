-- DuoFin — configuração segura para Supabase (base da versão 3 preservada)
-- Executar integralmente no SQL Editor do projeto Supabase.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Orçamento do casal',
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  joined_at timestamptz not null default now(),
  primary key (household_id,user_id)
);
create table if not exists public.household_data (
  household_id uuid primary key references public.households(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  revision bigint not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
create table if not exists public.household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  code_hash bytea not null unique,
  expires_at timestamptz not null,
  uses integer not null default 0,
  max_uses integer not null default 1,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_data enable row level security;
alter table public.household_invites enable row level security;

create or replace function public.is_household_member(p_household_id uuid)
returns boolean language sql stable security definer set search_path = public, extensions
as $$ select exists (select 1 from public.household_members m where m.household_id=p_household_id and m.user_id=auth.uid()) $$;
revoke all on function public.is_household_member(uuid) from public;
grant execute on function public.is_household_member(uuid) to authenticated;

drop policy if exists household_select_members on public.households;
create policy household_select_members on public.households for select to authenticated using (public.is_household_member(id));
drop policy if exists members_select_own_households on public.household_members;
create policy members_select_own_households on public.household_members for select to authenticated using (user_id=auth.uid() or public.is_household_member(household_id));
drop policy if exists data_select_members on public.household_data;
create policy data_select_members on public.household_data for select to authenticated using (public.is_household_member(household_id));
-- Não são criadas políticas de escrita direta. As alterações passam pelas funções RPC abaixo.

create or replace function public.create_household(p_name text)
returns uuid language plpgsql security definer set search_path = public, extensions
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'É necessário iniciar sessão.'; end if;
  insert into public.households(name,created_by) values (coalesce(nullif(trim(p_name),''),'Orçamento do casal'),auth.uid()) returning id into v_id;
  insert into public.household_members(household_id,user_id,role) values (v_id,auth.uid(),'owner');
  insert into public.household_data(household_id,payload,revision,updated_by) values (v_id,'{}'::jsonb,0,auth.uid());
  return v_id;
end; $$;

create or replace function public.create_invite(p_household_id uuid)
returns text language plpgsql security definer set search_path = public, extensions
as $$
declare v_code text;
begin
  if not public.is_household_member(p_household_id) then raise exception 'Não tens acesso a este orçamento.'; end if;
  v_code := upper(substr(encode(gen_random_bytes(8),'hex'),1,12));
  insert into public.household_invites(household_id,code_hash,expires_at,max_uses,created_by)
  values (p_household_id,digest(convert_to(v_code,'UTF8'),'sha256'),now()+interval '48 hours',1,auth.uid());
  return v_code;
end; $$;

create or replace function public.join_household(p_code text)
returns uuid language plpgsql security definer set search_path = public, extensions
as $$
declare v_inv public.household_invites%rowtype;
begin
  if auth.uid() is null then raise exception 'É necessário iniciar sessão.'; end if;
  select * into v_inv from public.household_invites
   where code_hash=digest(convert_to(upper(trim(p_code)),'UTF8'),'sha256')
     and expires_at>now() and uses<max_uses for update;
  if not found then raise exception 'Código inválido, expirado ou já utilizado.'; end if;
  insert into public.household_members(household_id,user_id,role) values(v_inv.household_id,auth.uid(),'member') on conflict do nothing;
  update public.household_invites set uses=uses+1 where id=v_inv.id;
  return v_inv.household_id;
end; $$;

create or replace function public.save_household_data(p_household_id uuid,p_payload jsonb,p_expected_revision bigint)
returns table(ok boolean,revision bigint,payload jsonb,updated_at timestamptz)
language plpgsql security definer set search_path = public, extensions
as $$
declare v_row public.household_data%rowtype;
begin
  if not public.is_household_member(p_household_id) then raise exception 'Não tens acesso a este orçamento.'; end if;
  update public.household_data d set payload=p_payload,revision=d.revision+1,updated_at=now(),updated_by=auth.uid()
   where d.household_id=p_household_id and d.revision=p_expected_revision returning d.* into v_row;
  if found then return query select true,v_row.revision,v_row.payload,v_row.updated_at; return; end if;
  select * into v_row from public.household_data d where d.household_id=p_household_id;
  return query select false,v_row.revision,v_row.payload,v_row.updated_at;
end; $$;

revoke all on function public.create_household(text) from public;
revoke all on function public.create_invite(uuid) from public;
revoke all on function public.join_household(text) from public;
revoke all on function public.save_household_data(uuid,jsonb,bigint) from public;
grant execute on function public.create_household(text) to authenticated;
grant execute on function public.create_invite(uuid) to authenticated;
grant execute on function public.join_household(text) to authenticated;
grant execute on function public.save_household_data(uuid,jsonb,bigint) to authenticated;

-- As tabelas não devem ser expostas para escrita direta via API.
grant select on public.households, public.household_members, public.household_data to authenticated;
