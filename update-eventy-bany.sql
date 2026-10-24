-- PixelMapy: AKTUALIZACJA – bany, widok kont dla admina, eventy.
-- Wklej CAŁOŚĆ w Supabase -> SQL Editor -> New query -> Run.
-- (Bezpieczne do uruchomienia po pierwszym supabase.sql.)

-- ========== WYNIK (pobrania + polubienia) ==========
alter table public.maps add column if not exists score int generated always as (downloads + like_count) stored;

-- ========== BANY ==========
create table if not exists public.bans (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  until timestamptz not null,
  reason text not null default '' check (char_length(reason) <= 200),
  created_at timestamptz not null default now()
);
alter table public.bans enable row level security;
drop policy if exists "bans_read" on public.bans;
create policy "bans_read" on public.bans for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
revoke all on public.bans from anon, authenticated;
grant select on public.bans to authenticated;

create or replace function public.is_banned() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.bans where user_id = auth.uid() and until > now());
$$;

-- p_days: 1,3,7,30... = na tyle dni; -1 = na stałe; 0 = odbanuj
create or replace function public.set_ban(p_user uuid, p_days int, p_reason text default '') returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Brak dostepu'; end if;
  if exists (select 1 from public.profiles where id = p_user and role = 'admin') then
    raise exception 'Nie mozna zbanowac admina';
  end if;
  if p_days is null or p_days = 0 then
    delete from public.bans where user_id = p_user;
  else
    insert into public.bans (user_id, until, reason)
    values (
      p_user,
      case when p_days < 0 then timestamptz '9999-12-31 00:00:00+00' else now() + make_interval(days => p_days) end,
      left(coalesce(p_reason, ''), 200)
    )
    on conflict (user_id) do update set until = excluded.until, reason = excluded.reason, created_at = now();
  end if;
end $$;
grant execute on function public.set_ban(uuid, int, text) to authenticated;

-- Zbanowany nie może: dodawać map, lubić, edytować profilu
drop policy if exists "maps_insert" on public.maps;
create policy "maps_insert" on public.maps for insert to authenticated
  with check (author_id = auth.uid() and not public.is_banned() and (status = 'pending' or public.is_admin()));

drop policy if exists "likes_insert" on public.likes;
create policy "likes_insert" on public.likes for insert to authenticated
  with check (user_id = auth.uid() and not public.is_banned()
    and exists (select 1 from public.maps m where m.id = map_id and m.status = 'approved'));

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update to authenticated
  using (auth.uid() = id and not public.is_banned())
  with check (auth.uid() = id and not public.is_banned());

-- ========== LISTA KONT DLA ADMINA (z emailami) ==========
create or replace function public.admin_list_users() returns table (
  id uuid, username text, email text, role text, created_at timestamptz,
  last_sign_in_at timestamptz, maps_count bigint, banned_until timestamptz, ban_reason text
)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Brak dostepu'; end if;
  return query
  select p.id, p.username, u.email::text, p.role, p.created_at, u.last_sign_in_at,
         (select count(*) from public.maps m where m.author_id = p.id),
         case when b.until > now() then b.until end,
         case when b.until > now() then b.reason end
  from public.profiles p
  join auth.users u on u.id = p.id
  left join public.bans b on b.user_id = p.id
  order by p.created_at desc;
end $$;
grant execute on function public.admin_list_users() to authenticated;

-- ========== EVENTY ==========
create table if not exists public.events (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 3 and 60),
  theme text not null default 'end' check (theme in ('end', 'nether', 'winter', 'default')),
  description text not null default '' check (char_length(description) <= 300),
  ends_at timestamptz not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.events enable row level security;
drop policy if exists "events_read" on public.events;
create policy "events_read" on public.events for select using (true);
revoke all on public.events from anon, authenticated;
grant select on public.events to anon, authenticated;

create or replace function public.admin_save_event(p_name text, p_theme text, p_description text, p_days int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Brak dostepu'; end if;
  if p_days is null or p_days < 1 or p_days > 365 then raise exception 'Liczba dni: 1-365'; end if;
  update public.events set active = false where active;
  insert into public.events (name, theme, description, ends_at)
  values (trim(p_name), p_theme, left(coalesce(p_description, ''), 300), now() + make_interval(days => p_days));
end $$;

create or replace function public.admin_set_event_active(p_id bigint, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Brak dostepu'; end if;
  if p_active then update public.events set active = false where active and id <> p_id; end if;
  update public.events set active = p_active where id = p_id;
end $$;

create or replace function public.admin_delete_event(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Brak dostepu'; end if;
  delete from public.events where id = p_id;
end $$;

grant execute on function public.admin_save_event(text, text, text, int) to authenticated;
grant execute on function public.admin_set_event_active(bigint, boolean) to authenticated;
grant execute on function public.admin_delete_event(bigint) to authenticated;
