-- ARENA · seguridad: roles, RLS, bitácora privada con deshacer y RPC públicas.
-- Los permisos se aplican en la base de datos, no solo en la interfaz (sección 15).

-- ─────────────────────────────────────────────────────────────
-- Funciones auxiliares
-- ─────────────────────────────────────────────────────────────
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin')
     and (
       -- Verificación adicional: el administrador debe haber pasado el segundo factor (TOTP).
       coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
       or coalesce((select (value)::text::boolean from settings where key = 'admin_require_mfa'), true) = false
     );
$$;

create or replace function public.my_club() returns uuid
language sql stable security definer set search_path = public as $$
  select club_team_id from profiles where id = auth.uid() and role = 'owner';
$$;

-- ─────────────────────────────────────────────────────────────
-- RLS en todas las tablas
-- ─────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'seasons','competitions','editions','teams','team_private','edition_teams','players',
    'matches','match_secrets','match_team_stats','match_player_stats','match_timelines',
    'competition_days','schedule_items','transfers','draft_picks','finance_entries','stadiums',
    'profiles','odds_offers','bets','bet_leagues','bet_league_members','achievements',
    'news','chat_messages','notifications','owner_wishlist','ranking_entries',
    'probability_snapshots','legacy_editions','classics','settings',
    'admin_biases','admin_log','admin_ranking_adjustments','ai_usage'
  ] loop
    execute format('alter table %I enable row level security', t);
    -- El administrador puede todo.
    execute format('create policy admin_all on %I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
    -- Nadie sin sesión lee nada.
    execute format('revoke all on %I from anon', t);
  end loop;
end $$;

-- Datos públicos (cualquier usuario con sesión).
do $$
declare t text;
begin
  foreach t in array array[
    'seasons','competitions','editions','teams','edition_teams','players','matches',
    'match_team_stats','match_player_stats','competition_days','schedule_items',
    'draft_picks','stadiums','odds_offers','ranking_entries','probability_snapshots',
    'legacy_editions','classics','achievements'
  ] loop
    execute format('create policy public_read on %I for select to authenticated using (true)', t);
  end loop;
end $$;

-- Tablas exclusivas del administrador: además de RLS, sin permisos para roles públicos
-- salvo los que pasan por la política admin_all.
revoke all on admin_biases, admin_log, admin_ranking_adjustments, ai_usage, match_secrets from anon;

-- Línea de tiempo: solo cuando el partido terminó (durante el vivo se usa live_timeline()).
create policy timeline_finished on match_timelines for select to authenticated
  using (exists (select 1 from matches m where m.id = match_id and m.status = 'finished'));

-- Configuración: solo claves públicas.
create policy settings_public on settings for select to authenticated using (is_public);

-- Noticias publicadas.
create policy news_published on news for select to authenticated using (status = 'published');

-- Fichajes: los completados son públicos; el dueño ve los de su club.
create policy transfers_public on transfers for select to authenticated
  using (status = 'completed' or from_team_id = public.my_club() or to_team_id = public.my_club());

-- Datos del club: solo su dueño.
create policy team_private_owner on team_private for select to authenticated using (team_id = public.my_club());
create policy finance_owner on finance_entries for select to authenticated using (team_id = public.my_club());
create policy wishlist_owner_read on owner_wishlist for select to authenticated using (team_id = public.my_club());
create policy wishlist_owner_write on owner_wishlist for insert to authenticated with check (team_id = public.my_club());
create policy wishlist_owner_update on owner_wishlist for update to authenticated
  using (team_id = public.my_club()) with check (team_id = public.my_club());
create policy wishlist_owner_delete on owner_wishlist for delete to authenticated using (team_id = public.my_club());

-- Perfiles: cada quien el suyo (los demás se ven por la vista public_profiles).
create policy profiles_self_read on profiles for select to authenticated using (id = auth.uid());
create policy profiles_self_update on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Solo se pueden cambiar equipos favoritos y estelar; el resto lo controla el servidor.
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() or auth.uid() is null then
    return new; -- administrador o servidor (service_role)
  end if;
  if new.role is distinct from old.role
     or new.credits is distinct from old.credits
     or new.club_team_id is distinct from old.club_team_id
     or new.login_slug is distinct from old.login_slug
     or new.display_name is distinct from old.display_name
     or new.muted_until is distinct from old.muted_until
     or new.last_bonus_day is distinct from old.last_bonus_day then
    raise exception 'Solo puedes cambiar tus equipos favoritos y tu estelar';
  end if;
  return new;
end $$;
create trigger profiles_guard before update on profiles
  for each row execute function public.guard_profile_update();

create or replace view public.public_profiles with (security_barrier) as
  select id, display_name, role, star_team_id, favorite_team_ids, created_at from profiles;
revoke all on public.public_profiles from anon;
grant select on public.public_profiles to authenticated;

-- Apuestas: cada quien las suyas (se crean solo por RPC place_bet).
create policy bets_own on bets for select to authenticated
  using (user_id = auth.uid() or (source = 'club' and club_team_id = public.my_club()));

create policy bet_leagues_member on bet_leagues for select to authenticated
  using (owner_id = auth.uid() or exists (select 1 from bet_league_members m where m.league_id = id and m.user_id = auth.uid()));
create policy bet_league_members_read on bet_league_members for select to authenticated
  using (user_id = auth.uid() or exists (
    select 1 from bet_league_members m where m.league_id = bet_league_members.league_id and m.user_id = auth.uid()));

-- Avisos propios.
create policy notifications_own on notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_mark_read on notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Chat: leer todo; escribir como uno mismo si no está silenciado.
create policy chat_read on chat_messages for select to authenticated using (true);
create policy chat_write on chat_messages for insert to authenticated with check (
  user_id = auth.uid()
  and (channel = 'general' or channel like 'match:%')
  and not exists (select 1 from profiles p where p.id = auth.uid() and p.muted_until > now())
);

-- ─────────────────────────────────────────────────────────────
-- Bitácora privada del administrador con opción de deshacer
-- ─────────────────────────────────────────────────────────────
create or replace function public.log_admin_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  pk text := coalesce(tg_argv[0], 'id');
  rec jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  if current_setting('arena.skip_log', true) = 'on' or not public.is_admin() then
    return coalesce(new, old);
  end if;
  insert into admin_log (actor, action, entity, entity_id, before, after)
  values (
    auth.uid(), tg_op, tg_table_name, rec ->> pk,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('UPDATE', 'INSERT') then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

do $$
declare
  t text;
  pk text;
  tables text[][] := array[
    ['teams','id'], ['team_private','team_id'], ['players','id'], ['matches','id'],
    ['competitions','id'], ['editions','id'], ['edition_teams','team_id'], ['settings','key'],
    ['admin_biases','id'], ['admin_ranking_adjustments','id'], ['news','id'], ['profiles','id'],
    ['transfers','id'], ['stadiums','id'], ['ranking_entries','id'], ['classics','id'],
    ['competition_days','id'], ['schedule_items','id'], ['draft_picks','id'], ['finance_entries','id'],
    ['odds_offers','id'], ['legacy_editions','id'], ['seasons','id']
  ];
  i int;
begin
  for i in 1 .. array_length(tables, 1) loop
    t := tables[i][1];
    pk := tables[i][2];
    execute format(
      'create trigger admin_log_%1$s after insert or update or delete on %1$I for each row execute function public.log_admin_change(%2$L)',
      t, pk);
  end loop;
end $$;

-- Deshace un cambio de la bitácora.
create or replace function public.undo_admin_change(p_log_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  l admin_log;
  pk text;
  cols text;
begin
  if not public.is_admin() then
    raise exception 'No autorizado';
  end if;
  select * into l from admin_log where id = p_log_id and undone_at is null for update;
  if not found then
    raise exception 'Cambio no encontrado o ya deshecho';
  end if;
  pk := case l.entity when 'team_private' then 'team_id' when 'settings' then 'key'
                      when 'edition_teams' then 'team_id' else 'id' end;
  perform set_config('arena.skip_log', 'on', true);

  if l.action = 'INSERT' then
    if l.entity = 'edition_teams' then
      execute 'delete from edition_teams where edition_id::text = $1 and team_id::text = $2'
        using l.after ->> 'edition_id', l.after ->> 'team_id';
    else
      execute format('delete from %I where %I::text = $1', l.entity, pk) using l.entity_id;
    end if;
  elsif l.action = 'DELETE' then
    execute format('insert into %1$I select * from jsonb_populate_record(null::%1$I, $1)', l.entity) using l.before;
  elsif l.action = 'UPDATE' then
    select string_agg(format('%1$I = r.%1$I', k), ', ') into cols from jsonb_object_keys(l.before) k;
    if l.entity = 'edition_teams' then
      execute format('update edition_teams t set %s from jsonb_populate_record(null::edition_teams, $1) r
                      where t.edition_id::text = $2 and t.team_id::text = $3', cols)
        using l.before, l.before ->> 'edition_id', l.before ->> 'team_id';
    else
      execute format('update %1$I t set %2$s from jsonb_populate_record(null::%1$I, $1) r where t.%3$I::text = $2',
                     l.entity, cols, pk) using l.before, l.entity_id;
    end if;
  else
    raise exception 'Acción % no se puede deshacer automáticamente', l.action;
  end if;

  update admin_log set undone_at = now() where id = p_log_id;
  perform set_config('arena.skip_log', 'off', true);
end $$;
revoke all on function public.undo_admin_change(bigint) from public, anon;
grant execute on function public.undo_admin_change(bigint) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- RPC públicas
-- ─────────────────────────────────────────────────────────────

-- Reproducción en vivo sincronizada con el reloj del servidor: entrega solo las
-- jugadas que ya ocurrieron, para no revelar el resultado antes de tiempo.
create or replace function public.live_timeline(p_match uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  m matches;
  t match_timelines;
  elapsed numeric;
begin
  if auth.uid() is null then raise exception 'Sin sesión'; end if;
  select * into m from matches where id = p_match;
  if not found or not m.is_main_event then return null; end if;
  select * into t from match_timelines where match_id = p_match;
  if not found or m.started_at is null then
    return jsonb_build_object('status', m.status, 'server_now', now(), 'events', '[]'::jsonb);
  end if;
  elapsed := extract(epoch from (now() - m.started_at));
  return jsonb_build_object(
    'status', m.status,
    'server_now', now(),
    'started_at', m.started_at,
    'elapsed', elapsed,
    'duration', t.duration_seconds,
    'events', coalesce((
      select jsonb_agg(e order by (e ->> 'second')::numeric)
      from jsonb_array_elements(t.events) e
      where (e ->> 'second')::numeric <= elapsed or m.status = 'finished'
    ), '[]'::jsonb)
  );
end $$;
revoke all on function public.live_timeline(uuid) from public, anon;
grant execute on function public.live_timeline(uuid) to authenticated;

-- El dueño elige el estilo de juego mientras no empiece el día de competencia.
create or replace function public.set_play_style(p_style play_style) returns void
language plpgsql security definer set search_path = public as $$
declare club uuid := public.my_club();
begin
  if club is null then raise exception 'No tienes un club asignado'; end if;
  update teams set play_style = p_style where id = club and not play_style_locked;
  if not found then raise exception 'El estilo está bloqueado durante el día de competencia'; end if;
end $$;
revoke all on function public.set_play_style(play_style) from public, anon;
grant execute on function public.set_play_style(play_style) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- Tiempo real: tablas que se emiten por el canal de Supabase Realtime
-- ─────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table matches, chat_messages, notifications, news, schedule_items, competition_days;
  end if;
end $$;
