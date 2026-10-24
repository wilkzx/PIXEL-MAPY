-- PixelMapy: baza danych dla Supabase.
-- Wklej CAŁOŚĆ w Supabase -> SQL Editor -> New query -> Run.

-- ========== PROFILE ==========
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  bio text not null default '' check (char_length(bio) <= 300),
  avatar int not null default 0 check (avatar between 0 and 11),
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now()
);
create unique index profiles_username_lower on public.profiles (lower(username));

-- ========== MAPY ==========
create table public.maps (
  id bigint generated always as identity primary key,
  author_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 3 and 60),
  description text not null check (char_length(description) between 10 and 2000),
  link text not null check (link ~* '^https?://' and char_length(link) <= 500),
  image text not null default '' check (image = '' or (image ~* '^https?://' and char_length(image) <= 500)),
  category text not null default 'Inne',
  version text not null default '' check (char_length(version) <= 20),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  downloads int not null default 0,
  like_count int not null default 0,
  created_at timestamptz not null default now()
);
create index maps_status_created on public.maps (status, created_at desc);

-- ========== POLUBIENIA ==========
create table public.likes (
  map_id bigint not null references public.maps(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (map_id, user_id)
);

-- ========== FUNKCJE ==========
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- Po rejestracji tworzy profil. Konto z emailem admina dostaje rolę admin.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'username', 'user' || substr(new.id::text, 1, 6)),
    case when lower(new.email) = 'brajangrochal@gmail.com' then 'admin' else 'user' end
  );
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.sync_like_count() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.maps set like_count = like_count + 1 where id = new.map_id;
  else
    update public.maps set like_count = greatest(like_count - 1, 0) where id = old.map_id;
  end if;
  return null;
end $$;
create trigger likes_count after insert or delete on public.likes
  for each row execute function public.sync_like_count();

create or replace function public.register_download(p_id bigint) returns void
language sql security definer set search_path = public as $$
  update public.maps set downloads = downloads + 1 where id = p_id and status = 'approved';
$$;

create or replace function public.set_map_status(p_id bigint, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Brak dostepu'; end if;
  if p_status not in ('pending', 'approved', 'rejected') then raise exception 'Zly status'; end if;
  update public.maps set status = p_status where id = p_id;
end $$;

-- ========== UPRAWNIENIA (RLS) ==========
alter table public.profiles enable row level security;
alter table public.maps enable row level security;
alter table public.likes enable row level security;

-- profile: publiczne do odczytu, edytować można tylko swój (username, bio, avatar – NIE rolę)
create policy "profiles_read" on public.profiles for select using (true);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (username, bio, avatar) on public.profiles to authenticated;

-- mapy: wszyscy widzą zaakceptowane; autor swoje; admin wszystkie
create policy "maps_read" on public.maps for select
  using (status = 'approved' or author_id = auth.uid() or public.is_admin());
create policy "maps_insert" on public.maps for insert to authenticated
  with check (author_id = auth.uid() and (status = 'pending' or public.is_admin()));
create policy "maps_delete" on public.maps for delete to authenticated
  using (author_id = auth.uid() or public.is_admin());
revoke insert, update on public.maps from anon, authenticated;
grant insert (author_id, name, description, link, image, category, version, status) on public.maps to authenticated;
revoke delete on public.maps from anon;

-- polubienia: tylko zalogowani, tylko zaakceptowane mapy
create policy "likes_read" on public.likes for select using (true);
create policy "likes_insert" on public.likes for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.maps m where m.id = map_id and m.status = 'approved'));
create policy "likes_delete" on public.likes for delete to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.likes from anon;
revoke update on public.likes from authenticated;

grant execute on function public.register_download(bigint) to anon, authenticated;
grant execute on function public.set_map_status(bigint, text) to authenticated;

-- ================= AKTUALIZACJA: bany, konta, eventy =================

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
