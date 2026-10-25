-- Courtside Live · schema Supabase
-- Esegui tutto questo file una volta nel SQL Editor del tuo progetto Supabase.
-- Lettura pubblica (i genitori non devono accedere), scrittura solo per
-- il proprietario della squadra e per gli email aggiunti come segnapunti.

create extension if not exists pgcrypto;

create table if not exists public.teams (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  owner       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

create table if not exists public.team_editors (
  team_id  uuid not null references public.teams(id) on delete cascade,
  email    text not null,
  primary key (team_id, email)
);

create table if not exists public.games (
  id          text primary key,
  team_id     uuid not null references public.teams(id) on delete cascade,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);
create index if not exists games_team_id_idx on public.games(team_id);

-- Chi può modificare una squadra: il proprietario o un segnapunti invitato.
create or replace function public.can_edit_team(t uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from teams where id = t and owner = auth.uid())
      or exists (select 1 from team_editors
                 where team_id = t and lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
grant execute on function public.can_edit_team(uuid) to anon, authenticated;

-- Permessi di base per l'API (le righe visibili/modificabili le decidono le policy RLS sotto)
grant usage on schema public to anon, authenticated;
grant select on public.teams, public.games to anon, authenticated;
grant insert, update, delete on public.teams, public.games to authenticated;
grant select, insert, update, delete on public.team_editors to authenticated;

alter table public.teams        enable row level security;
alter table public.team_editors enable row level security;
alter table public.games        enable row level security;

-- teams
drop policy if exists teams_read   on public.teams;
drop policy if exists teams_insert on public.teams;
drop policy if exists teams_update on public.teams;
drop policy if exists teams_delete on public.teams;
create policy teams_read   on public.teams for select using (true);
create policy teams_insert on public.teams for insert to authenticated with check (owner = auth.uid());
create policy teams_update on public.teams for update to authenticated using (public.can_edit_team(id)) with check (public.can_edit_team(id));
create policy teams_delete on public.teams for delete to authenticated using (owner = auth.uid());

-- team_editors: li vede chi può modificare, li gestisce solo il proprietario
drop policy if exists editors_read  on public.team_editors;
drop policy if exists editors_write on public.team_editors;
create policy editors_read  on public.team_editors for select to authenticated using (public.can_edit_team(team_id));
create policy editors_write on public.team_editors for all to authenticated
  using (exists (select 1 from public.teams where id = team_id and owner = auth.uid()))
  with check (exists (select 1 from public.teams where id = team_id and owner = auth.uid()));

-- games
drop policy if exists games_read   on public.games;
drop policy if exists games_insert on public.games;
drop policy if exists games_update on public.games;
drop policy if exists games_delete on public.games;
create policy games_read   on public.games for select using (true);
create policy games_insert on public.games for insert to authenticated with check (public.can_edit_team(team_id));
create policy games_update on public.games for update to authenticated using (public.can_edit_team(team_id)) with check (public.can_edit_team(team_id));
create policy games_delete on public.games for delete to authenticated using (public.can_edit_team(team_id));

-- Realtime: i genitori ricevono gli aggiornamenti live
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'games') then
    alter publication supabase_realtime add table public.games;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'teams') then
    alter publication supabase_realtime add table public.teams;
  end if;
end $$;
