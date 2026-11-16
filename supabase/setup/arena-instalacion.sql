-- ARENA · instalación completa en un solo archivo (pegar en Supabase → SQL Editor → Run)
-- Generado por scripts/build-setup-sql.sh. Contiene: esquema, seguridad, atributos, equipos, jugadores e historial.

-- ═══ supabase/migrations/20261115000001_schema.sql ═══
-- ARENA · esquema base (sección 16)
-- Criterio único: tablas y columnas en inglés, snake_case. Textos de la app en español.

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────
-- Tipos
-- ─────────────────────────────────────────────────────────────
create type user_role as enum ('admin', 'owner', 'spectator');
create type season_status as enum ('active', 'closed');
create type competition_format as enum ('league', 'groups_knockout', 'knockout', 'swiss', 'two_legged');
create type edition_status as enum ('setup', 'in_progress', 'playoffs', 'finished');
create type match_status as enum ('scheduled', 'live', 'finished', 'cancelled');
create type day_status as enum ('planned', 'running', 'paused', 'closed');
create type schedule_kind as enum ('burst', 'event', 'draft', 'market', 'summary');
create type schedule_status as enum ('pending', 'running', 'done', 'cancelled');
create type player_position as enum ('G', 'D', 'F');
create type play_style as enum ('equilibrado', 'ofensivo', 'defensivo', 'presion', 'contraataque');
create type sim_mode as enum ('realista', 'balanceado', 'aleatorio');
create type ai_strategy as enum ('estrella', 'cantera', 'defensivo', 'equilibrado', 'austeridad');
create type transfer_status as enum ('offer', 'counter', 'accepted', 'rejected', 'completed', 'vetoed');
create type bet_status as enum ('open', 'won', 'lost', 'void');
create type bet_source as enum ('credits', 'club');
create type news_status as enum ('draft', 'pending', 'published', 'hidden');
create type news_tone as enum ('suave', 'medio', 'picante');
create type rumor_status as enum ('none', 'rumor', 'confirmed', 'denied');

-- ─────────────────────────────────────────────────────────────
-- Temporadas, competiciones y ediciones
-- ─────────────────────────────────────────────────────────────
create table seasons (
  id uuid primary key default gen_random_uuid(),
  number int not null unique,
  status season_status not null default 'active',
  started_at timestamptz not null default now(),
  closed_at timestamptz
);

create table competitions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  format competition_format not null,
  -- Regla de participantes: {"type":"all"} | {"type":"historical_top","n":32}
  -- | {"type":"season_top","n":32} | {"type":"division","division":1}
  -- | {"type":"competition_top","competition":"ohl","n":8} | {"type":"invite"}
  -- | {"type":"draw","n":22} | {"type":"combo","parts":[...]}
  participant_rule jsonb not null default '{"type":"all"}',
  -- partidos por rival, clasificados, puntos, desempates, aleatoriedad, modo,
  -- tiempo extra, gol de visitante, rondas, etc.
  config jsonb not null default '{}',
  ranking_weight numeric(5,2) not null default 1,
  permanent boolean not null default true,
  active boolean not null default true,
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);

create table editions (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references competitions(id) on delete cascade,
  season_id uuid not null references seasons(id) on delete cascade,
  name text not null,
  status edition_status not null default 'setup',
  config jsonb not null default '{}', -- copia congelada de la configuración
  champion_team_id uuid,
  runner_up_team_id uuid,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique (competition_id, season_id)
);

-- ─────────────────────────────────────────────────────────────
-- Equipos y jugadores
-- ─────────────────────────────────────────────────────────────
create table teams (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null unique,
  short_name text not null,
  primary_color text not null,
  secondary_color text not null,
  crest_url text,
  -- Atributos derivados de la alineación titular (los recalcula el servidor).
  attack numeric(5,2) not null default 50,
  defense numeric(5,2) not null default 50,
  goalie numeric(5,2) not null default 50,
  play_style play_style not null default 'equilibrado',
  play_style_locked boolean not null default false,
  division smallint check (division in (1, 2)),
  fan_base int not null default 50, -- tamaño de la afición 0-100
  initial_rank int,
  created_at timestamptz not null default now()
);

-- Datos privados del club: solo administrador y dueño.
create table team_private (
  team_id uuid primary key references teams(id) on delete cascade,
  budget bigint not null default 50000000,
  ai_strategy ai_strategy not null default 'equilibrado'
);

create table edition_teams (
  edition_id uuid not null references editions(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  group_label text,
  seed int,
  eliminated_round text,
  primary key (edition_id, team_id)
);

create table players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id) on delete set null,
  first_name text not null,
  last_name text not null,
  number smallint not null check (number between 0 and 99),
  position player_position not null,
  rating smallint not null check (rating between 1 and 100),
  age smallint not null check (age between 15 and 45),
  potential smallint not null check (potential between 1 and 100),
  form smallint not null default 50 check (form between 0 and 100),
  morale smallint not null default 50 check (morale between 0 and 100),
  salary bigint not null default 0,
  contract_years smallint not null default 1 check (contract_years between 0 and 5),
  injury_days smallint not null default 0,
  retired boolean not null default false,
  draft_season_id uuid references seasons(id),
  created_at timestamptz not null default now()
);
create index players_team_idx on players(team_id) where not retired;

-- ─────────────────────────────────────────────────────────────
-- Partidos y box scores
-- ─────────────────────────────────────────────────────────────
create table matches (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references editions(id) on delete cascade,
  stage text not null default 'regular', -- regular | group | swiss | playoff
  round text, -- previa, dieciseisavos, octavos, cuartos, semifinal, final
  matchday int,
  group_label text,
  tie_key text, -- agrupa ida y vuelta de una eliminatoria
  leg smallint, -- 1 ida, 2 vuelta
  home_team_id uuid not null references teams(id),
  away_team_id uuid not null references teams(id),
  status match_status not null default 'scheduled',
  scheduled_at timestamptz,
  neutral_venue boolean not null default false,
  is_final boolean not null default false,
  home_score smallint,
  away_score smallint,
  period_scores jsonb, -- [[h,a],[h,a],[h,a],[h,a ot]]
  overtime boolean not null default false,
  expected_home numeric(5,3),
  expected_away numeric(5,3),
  is_main_event boolean not null default false,
  event_name text,
  derby_score smallint,
  mvp_player_id uuid references players(id) on delete set null,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
create index matches_edition_idx on matches(edition_id);
create index matches_status_time_idx on matches(status, scheduled_at);
create index matches_home_idx on matches(home_team_id);
create index matches_away_idx on matches(away_team_id);

-- Semilla y sesgo aplicados: solo administrador (permitiría recalcular sesgos).
create table match_secrets (
  match_id uuid primary key references matches(id) on delete cascade,
  seed bigint not null,
  home_bias numeric(4,3) not null default 1,
  away_bias numeric(4,3) not null default 1,
  -- Resultado completo de un evento en vivo antes de que termine la reproducción.
  pending_result jsonb
);

create table match_team_stats (
  match_id uuid not null references matches(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  is_home boolean not null,
  goals smallint not null,
  shots smallint not null,
  saves smallint not null,
  penalties smallint not null,
  pim smallint not null,
  power_plays smallint not null,
  power_play_goals smallint not null,
  period_goals smallint[] not null,
  play_style play_style not null default 'equilibrado',
  primary key (match_id, team_id)
);

create table match_player_stats (
  match_id uuid not null references matches(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  goals smallint not null default 0,
  assists smallint not null default 0,
  plus_minus smallint not null default 0,
  shots smallint not null default 0,
  pim smallint not null default 0,
  saves smallint not null default 0,
  goals_against smallint not null default 0,
  game_winning_goals smallint not null default 0,
  is_mvp boolean not null default false,
  primary key (match_id, player_id)
);
create index mps_player_idx on match_player_stats(player_id);

create table match_timelines (
  match_id uuid primary key references matches(id) on delete cascade,
  events jsonb not null,
  duration_seconds int not null
);

-- ─────────────────────────────────────────────────────────────
-- Calendario
-- ─────────────────────────────────────────────────────────────
create table competition_days (
  id uuid primary key default gen_random_uuid(),
  date date not null unique,
  status day_status not null default 'planned',
  announced jsonb not null default '[]',
  merged_dates date[] not null default '{}',
  interest numeric(6,2),
  started_at timestamptz,
  closed_at timestamptz,
  summary_news_id uuid
);

create table schedule_items (
  id uuid primary key default gen_random_uuid(),
  day_id uuid not null references competition_days(id) on delete cascade,
  kind schedule_kind not null,
  match_ids uuid[] not null default '{}',
  scheduled_at timestamptz not null,
  sort_order int not null default 0,
  status schedule_status not null default 'pending',
  interest numeric(6,2),
  label text
);
create index schedule_items_day_idx on schedule_items(day_id, scheduled_at);

-- ─────────────────────────────────────────────────────────────
-- Mercado, draft y economía
-- ─────────────────────────────────────────────────────────────
create table transfers (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  from_team_id uuid references teams(id),
  to_team_id uuid references teams(id),
  fee bigint not null default 0,
  salary bigint,
  season_id uuid references seasons(id),
  window_label text not null, -- pretemporada | invierno
  status transfer_status not null default 'offer',
  negotiation_round smallint not null default 1,
  parent_id uuid references transfers(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table draft_picks (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id) on delete cascade,
  round smallint not null,
  pick_number smallint not null,
  team_id uuid not null references teams(id),
  player_id uuid references players(id),
  mode text not null default 'auto' check (mode in ('owner', 'auto')),
  deadline timestamptz,
  picked_at timestamptz,
  unique (season_id, pick_number)
);

create table finance_entries (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  season_id uuid references seasons(id),
  concept text not null, -- taquilla, camisetas, venta_fichaje, premio, salarios, compra_fichaje, apuestas
  amount bigint not null, -- positivo ingreso, negativo gasto
  match_id uuid references matches(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);
create index finance_team_idx on finance_entries(team_id, created_at);

create table stadiums (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null unique references teams(id) on delete cascade,
  name text not null,
  capacity int not null,
  level smallint not null default 1,
  upgrades jsonb not null default '{"capacity":0,"comfort":0,"lighting":0}',
  image_url text,
  color text,
  home_bonus numeric(4,3) not null default 0
);

-- ─────────────────────────────────────────────────────────────
-- Usuarios
-- ─────────────────────────────────────────────────────────────
create table profiles (
  id uuid primary key, -- = auth.users.id
  display_name text not null,
  login_slug text not null unique,
  role user_role not null default 'spectator',
  club_team_id uuid references teams(id) on delete set null,
  favorite_team_ids uuid[] not null default '{}' check (cardinality(favorite_team_ids) <= 3),
  star_team_id uuid references teams(id) on delete set null,
  credits bigint not null default 1000 check (credits >= 0),
  last_bonus_day date,
  muted_until timestamptz,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- Apuestas
-- ─────────────────────────────────────────────────────────────
create table odds_offers (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references matches(id) on delete cascade,
  edition_id uuid references editions(id) on delete cascade,
  market text not null, -- winner, exact_score, total, scorer, champion, playoffs, promotion, relegation, mvp
  selection jsonb not null,
  odds numeric(8,3) not null check (odds > 1),
  closes_at timestamptz,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
create index odds_match_idx on odds_offers(match_id) where active;

create table bets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  source bet_source not null default 'credits',
  club_team_id uuid references teams(id),
  parlay_id uuid, -- combinadas: varias filas con el mismo parlay_id
  offer_id uuid references odds_offers(id),
  match_id uuid references matches(id) on delete set null,
  edition_id uuid references editions(id) on delete set null,
  market text not null,
  selection jsonb not null,
  odds numeric(8,3) not null,
  stake bigint not null check (stake > 0),
  status bet_status not null default 'open',
  payout bigint,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index bets_user_idx on bets(user_id, created_at desc);
create index bets_open_match_idx on bets(match_id) where status = 'open';

create table bet_leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references profiles(id) on delete cascade,
  join_code text not null unique,
  created_at timestamptz not null default now()
);
create table bet_league_members (
  league_id uuid not null references bet_leagues(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (league_id, user_id)
);
create table achievements (
  user_id uuid not null references profiles(id) on delete cascade,
  key text not null,
  earned_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- ─────────────────────────────────────────────────────────────
-- Prensa, chat y avisos
-- ─────────────────────────────────────────────────────────────
create table news (
  id uuid primary key default gen_random_uuid(),
  kind text not null, -- jornada, cierre_dia, semanal, cronica, historia, rumor, fichaje, manual
  tone news_tone not null default 'medio',
  title text not null,
  body text not null,
  status news_status not null default 'draft',
  rumor_status rumor_status not null default 'none',
  team_id uuid references teams(id) on delete set null,
  player_id uuid references players(id) on delete set null,
  match_id uuid references matches(id) on delete set null,
  edition_id uuid references editions(id) on delete set null,
  pinned boolean not null default false,
  ai_generated boolean not null default false,
  facts jsonb,
  published_at timestamptz,
  created_at timestamptz not null default now()
);
create index news_published_idx on news(published_at desc) where status = 'published';

create table chat_messages (
  id bigint generated always as identity primary key,
  channel text not null, -- 'general' o 'match:<uuid>'
  user_id uuid not null references profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 300),
  created_at timestamptz not null default now()
);
create index chat_channel_idx on chat_messages(channel, created_at desc);

create table notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on notifications(user_id, created_at desc);

create table owner_wishlist (
  team_id uuid not null references teams(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  priority smallint not null check (priority between 1 and 5),
  created_at timestamptz not null default now(),
  primary key (team_id, player_id),
  unique (team_id, priority)
);

-- ─────────────────────────────────────────────────────────────
-- Ranking, probabilidades, historial, clásicos y configuración
-- ─────────────────────────────────────────────────────────────
create table ranking_entries (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  season_id uuid references seasons(id) on delete cascade, -- null = histórico
  points numeric(10,2) not null default 0,
  titles int not null default 0,
  runners_up int not null default 0,
  breakdown jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
create unique index ranking_unique_idx
  on ranking_entries(team_id, coalesce(season_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table probability_snapshots (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references editions(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  champion numeric(6,5) not null default 0,
  playoffs numeric(6,5) not null default 0,
  promotion numeric(6,5) not null default 0,
  relegation numeric(6,5) not null default 0,
  iterations int not null,
  created_at timestamptz not null default now()
);
create index prob_edition_idx on probability_snapshots(edition_id, created_at desc);

create table legacy_editions (
  id uuid primary key default gen_random_uuid(),
  competition_name text not null,
  season_label text,
  champion_team_id uuid references teams(id) on delete set null,
  champion_name text,
  runner_up_team_id uuid references teams(id) on delete set null,
  runner_up_name text,
  top3 jsonb,
  standings jsonb,
  import_order int
);

create table classics (
  id uuid primary key default gen_random_uuid(),
  team_a uuid not null references teams(id) on delete cascade,
  team_b uuid not null references teams(id) on delete cascade,
  competition_id uuid references competitions(id) on delete cascade, -- null = global
  name text,
  check (team_a <> team_b)
);

create table settings (
  key text primary key,
  value jsonb not null,
  is_public boolean not null default false,
  updated_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- Solo administrador
-- ─────────────────────────────────────────────────────────────
create table admin_biases (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  scope text not null check (scope in ('competition', 'matchday_range', 'match')),
  competition_id uuid references competitions(id) on delete cascade,
  edition_id uuid references editions(id) on delete cascade,
  from_matchday int,
  to_matchday int,
  match_id uuid references matches(id) on delete cascade,
  multiplier numeric(4,3) not null check (multiplier between 0.7 and 1.3),
  active boolean not null default true,
  note text,
  created_at timestamptz not null default now()
);

create table admin_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor uuid,
  action text not null, -- INSERT | UPDATE | DELETE | custom
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  undone_at timestamptz
);
create index admin_log_created_idx on admin_log(created_at desc);

create table admin_ranking_adjustments (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  season_id uuid references seasons(id) on delete cascade,
  points numeric(10,2) not null,
  note text,
  created_at timestamptz not null default now()
);

create table ai_usage (
  day date primary key,
  requests int not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cost_usd numeric(10,4) not null default 0
);

-- ═══ supabase/migrations/20261115000002_security.sql ═══
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

-- ═══ supabase/migrations/20261115000003_team_ratings.sql ═══
-- Atributos derivados del equipo a partir de la alineación titular (sección 2).
-- Misma regla que shared/engine/rating.ts: mejores sanos por posición,
-- 4 líneas de delanteros (0.40/0.30/0.20/0.10), 3 parejas de defensas
-- (0.45/0.35/0.20) y el portero titular. Forma y moral mueven hasta ±5 %.

create or replace function public.recompute_team_ratings(p_team uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  eng jsonb := coalesce((select value from settings where key = 'engine'), '{}'::jsonb);
  lw numeric[] := coalesce(array(select jsonb_array_elements_text(eng -> 'lineWeights')::numeric), array[0.4, 0.3, 0.2, 0.1]);
  pw numeric[] := coalesce(array(select jsonb_array_elements_text(eng -> 'pairWeights')::numeric), array[0.45, 0.35, 0.2]);
  rng numeric := coalesce((eng ->> 'formMoraleRange')::numeric, 0.05);
  lw_total numeric;
  pw_total numeric;
  v_attack numeric;
  v_defense numeric;
  v_goalie numeric;
begin
  if p_team is null then return; end if;
  if cardinality(lw) = 0 then lw := array[0.4, 0.3, 0.2, 0.1]; end if;
  if cardinality(pw) = 0 then pw := array[0.45, 0.35, 0.2]; end if;
  select sum(x) into lw_total from unnest(lw) x;
  select sum(x) into pw_total from unnest(pw) x;

  with eff as (
    select position,
           rating * (1 + (((least(greatest(form, 0), 100) - 50) / 50.0 + (least(greatest(morale, 0), 100) - 50) / 50.0) / 2) * rng) as r
    from players
    where team_id = p_team and not retired and injury_days <= 0
  ),
  f as (select r, row_number() over (order by r desc) - 1 as i from eff where position = 'F'),
  d as (select r, row_number() over (order by r desc) - 1 as i from eff where position = 'D'),
  g as (select r from eff where position = 'G' order by r desc limit 1)
  select
    (select sum(r * lw[(i / 3)::int + 1] / lw_total / 3) from f where i < 12),
    (select sum(r * pw[(i / 2)::int + 1] / pw_total / 2) from d where i < 6),
    (select r from g)
  into v_attack, v_defense, v_goalie;

  perform set_config('arena.skip_log', 'on', true);
  update teams
     set attack = coalesce(round(v_attack, 2), attack),
         defense = coalesce(round(v_defense, 2), defense),
         goalie = coalesce(round(v_goalie, 2), goalie)
   where id = p_team;
  perform set_config('arena.skip_log', 'off', true);
end $$;
revoke all on function public.recompute_team_ratings(uuid) from public, anon, authenticated;

create or replace function public.players_recompute_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then perform public.recompute_team_ratings(old.team_id); end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.team_id is distinct from old.team_id) then
    perform public.recompute_team_ratings(new.team_id);
  end if;
  return null;
end $$;

-- Por sentencia sería más eficiente en cargas masivas; el servidor desactiva el
-- trigger con session_replication_role cuando importa miles de filas.
create trigger players_recompute after insert or update or delete on players
  for each row execute function public.players_recompute_trigger();

-- ═══ supabase/migrations/20261116000004_gameplay.sql ═══
-- ARENA · núcleo jugable: unidades de calendario, tablas guardadas, box scores
-- compactos, estadísticas acumuladas y funciones transaccionales del servidor.

-- ─────────────────────────────────────────────────────────────
-- Columnas nuevas
-- ─────────────────────────────────────────────────────────────
alter table matches add column if not exists bracket_slot int;
alter table matches add column if not exists unit_index int;
create index if not exists matches_unit_idx on matches(edition_id, unit_index);

-- state: { units: [...], seeds: [...], groups: {...} }
alter table editions add column if not exists state jsonb not null default '{}';

alter table competition_days add column if not exists mode text not null default 'real'; -- real | now
alter table competition_days add column if not exists published boolean not null default false;

-- ─────────────────────────────────────────────────────────────
-- Planificación: un bloque es una jornada o una ronda de una edición en un día
-- ─────────────────────────────────────────────────────────────
create table if not exists plan_blocks (
  id uuid primary key default gen_random_uuid(),
  day_id uuid not null references competition_days(id) on delete cascade,
  edition_id uuid references editions(id) on delete cascade,
  kind text not null default 'unit' check (kind in ('unit', 'draft', 'market')),
  unit_index int,
  label text not null,
  sort_order int not null default 0,
  interest numeric(6,2) not null default 0,
  matches_count int not null default 0,
  live_count int not null default 0,
  status text not null default 'pending' check (status in ('pending', 'running', 'done')),
  unique (edition_id, unit_index)
);
create index if not exists plan_blocks_day_idx on plan_blocks(day_id, sort_order);

alter table schedule_items add column if not exists block_id uuid references plan_blocks(id) on delete cascade;
alter table schedule_items add column if not exists edition_id uuid references editions(id) on delete cascade;
alter table schedule_items add column if not exists match_id uuid references matches(id) on delete set null;
alter table schedule_items add column if not exists unit_index int;
alter table schedule_items add column if not exists burst_size int;
alter table schedule_items add column if not exists result jsonb;

-- ─────────────────────────────────────────────────────────────
-- Tabla de posiciones guardada (la recalcula el servidor)
-- ─────────────────────────────────────────────────────────────
create table if not exists edition_standings (
  edition_id uuid not null references editions(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  group_label text not null default '',
  position int not null,
  prev_position int,
  played int not null default 0,
  wins int not null default 0,
  ot_wins int not null default 0,
  draws int not null default 0,
  ot_losses int not null default 0,
  losses int not null default 0,
  goals_for int not null default 0,
  goals_against int not null default 0,
  points int not null default 0,
  form text not null default '',
  primary key (edition_id, team_id)
);

-- Box score por partido en una sola fila (jugadores, goles y penalizaciones).
create table if not exists match_boxes (
  match_id uuid primary key references matches(id) on delete cascade,
  players jsonb not null default '[]',
  goals jsonb not null default '[]',
  penalties jsonb not null default '[]'
);

-- Estadísticas acumuladas por jugador y edición.
create table if not exists player_edition_stats (
  player_id uuid not null references players(id) on delete cascade,
  edition_id uuid not null references editions(id) on delete cascade,
  team_id uuid references teams(id) on delete set null,
  gp int not null default 0,
  goals int not null default 0,
  assists int not null default 0,
  plus_minus int not null default 0,
  shots int not null default 0,
  pim int not null default 0,
  gwg int not null default 0,
  hat_tricks int not null default 0,
  mvps int not null default 0,
  saves int not null default 0,
  goals_against int not null default 0,
  shutouts int not null default 0,
  wins int not null default 0,
  goalie_gp int not null default 0,
  primary key (player_id, edition_id)
);
create index if not exists pes_edition_goals_idx on player_edition_stats(edition_id, goals desc);

-- Configuración privada del servidor (secreto del cron, etc.).
create table if not exists private_config (
  key text primary key,
  value text not null
);
insert into private_config (key, value) values ('cron_secret', encode(gen_random_bytes(24), 'hex'))
on conflict (key) do nothing;

-- ─────────────────────────────────────────────────────────────
-- RLS de las tablas nuevas
-- ─────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['plan_blocks','edition_standings','match_boxes','player_edition_stats','private_config'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists admin_all on %I', t);
    execute format('create policy admin_all on %I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
    execute format('revoke all on %I from anon', t);
  end loop;
  foreach t in array array['edition_standings','player_edition_stats'] loop
    execute format('drop policy if exists public_read on %I', t);
    execute format('create policy public_read on %I for select to authenticated using (true)', t);
  end loop;
end $$;

-- El plan solo es público cuando el administrador publica el día.
drop policy if exists plan_public on plan_blocks;
create policy plan_public on plan_blocks for select to authenticated
  using (exists (select 1 from competition_days d where d.id = day_id and (d.published or d.status <> 'planned')));

drop policy if exists public_read on competition_days;
create policy public_read on competition_days for select to authenticated using (published or status <> 'planned');
drop policy if exists public_read on schedule_items;
create policy public_read on schedule_items for select to authenticated
  using (exists (select 1 from competition_days d where d.id = day_id and d.status <> 'planned'));

-- El box score solo cuando el partido terminó.
drop policy if exists box_finished on match_boxes;
create policy box_finished on match_boxes for select to authenticated
  using (exists (select 1 from matches m where m.id = match_id and m.status = 'finished'));

-- El marcador de un partido en vivo no se publica en la fila hasta que termina;
-- la reproducción usa live_timeline().

-- ─────────────────────────────────────────────────────────────
-- Atributos: permitir saltar el recálculo en cargas masivas
-- ─────────────────────────────────────────────────────────────
create or replace function public.players_recompute_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('arena.skip_ratings', true) = 'on' then return null; end if;
  if tg_op in ('UPDATE', 'DELETE') then perform public.recompute_team_ratings(old.team_id); end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.team_id is distinct from old.team_id) then
    perform public.recompute_team_ratings(new.team_id);
  end if;
  return null;
end $$;

create or replace function public.recompute_all_ratings() returns void
language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  for t in select id from teams loop perform public.recompute_team_ratings(t); end loop;
end $$;
revoke all on function public.recompute_all_ratings() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- Aplicar resultados de partidos (una sola transacción por ráfaga)
-- p_results: [{ matchId, editionId, homeTeamId, awayTeamId, homeScore, awayScore,
--   overtime, periodScores, expectedHome, expectedAway, mvpId, seed, homeBias, awayBias,
--   home: {...box}, away: {...box}, homeStyle, awayStyle, players: [...], goals: [...],
--   penalties: [...], injuries: [{playerId, days}], gate: {amount}, winnerSide }]
-- ─────────────────────────────────────────────────────────────
create or replace function public.apply_match_results(p_results jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  mid uuid;
  eid uuid;
  hid uuid;
  aid uuid;
  side jsonb;
  is_home boolean;
  x jsonb;
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  winner text;
begin
  perform set_config('arena.skip_ratings', 'on', true);
  perform set_config('arena.skip_log', 'on', true);
  for r in select * from jsonb_array_elements(p_results) loop
    mid := (r ->> 'matchId')::uuid;
    eid := (r ->> 'editionId')::uuid;
    hid := (r ->> 'homeTeamId')::uuid;
    aid := (r ->> 'awayTeamId')::uuid;
    winner := r ->> 'winner';

    update matches set
      status = 'finished',
      home_score = (r ->> 'homeScore')::int,
      away_score = (r ->> 'awayScore')::int,
      overtime = coalesce((r ->> 'overtime')::boolean, false),
      period_scores = r -> 'periodScores',
      expected_home = (r ->> 'expectedHome')::numeric,
      expected_away = (r ->> 'expectedAway')::numeric,
      mvp_player_id = case when (r ->> 'mvpId') ~ uuid_re then (r ->> 'mvpId')::uuid end,
      started_at = coalesce(started_at, now()),
      finished_at = now()
    where id = mid and status <> 'finished';
    if not found then continue; end if;

    insert into match_secrets (match_id, seed, home_bias, away_bias)
    values (mid, (r ->> 'seed')::bigint, coalesce((r ->> 'homeBias')::numeric, 1), coalesce((r ->> 'awayBias')::numeric, 1))
    on conflict (match_id) do update set pending_result = null;

    foreach is_home in array array[true, false] loop
      side := case when is_home then r -> 'home' else r -> 'away' end;
      insert into match_team_stats (match_id, team_id, is_home, goals, shots, saves, penalties, pim, power_plays, power_play_goals, period_goals, play_style)
      values (
        mid, case when is_home then hid else aid end, is_home,
        (side ->> 'goals')::int, (side ->> 'shots')::int, (side ->> 'saves')::int, (side ->> 'penalties')::int,
        (side ->> 'pim')::int, (side ->> 'powerPlays')::int, (side ->> 'powerPlayGoals')::int,
        array(select jsonb_array_elements_text(side -> 'periodGoals')::smallint),
        coalesce(nullif(case when is_home then r ->> 'homeStyle' else r ->> 'awayStyle' end, ''), 'equilibrado')::play_style
      ) on conflict do nothing;
    end loop;

    insert into match_boxes (match_id, players, goals, penalties)
    values (mid, coalesce(r -> 'players', '[]'), coalesce(r -> 'goals', '[]'), coalesce(r -> 'penalties', '[]'))
    on conflict (match_id) do nothing;

    insert into player_edition_stats as s
      (player_id, edition_id, team_id, gp, goals, assists, plus_minus, shots, pim, gwg, hat_tricks, mvps, saves, goals_against, shutouts, wins, goalie_gp)
    select
      (p ->> 'playerId')::uuid, eid,
      case when p ->> 'side' = 'home' then hid else aid end,
      1, (p ->> 'goals')::int, (p ->> 'assists')::int, (p ->> 'plusMinus')::int, (p ->> 'shots')::int, (p ->> 'pim')::int,
      (p ->> 'gameWinningGoals')::int,
      case when (p ->> 'goals')::int >= 3 then 1 else 0 end,
      case when (p ->> 'isMvp')::boolean then 1 else 0 end,
      (p ->> 'saves')::int, (p ->> 'goalsAgainst')::int,
      case when coalesce((p ->> 'isGoalie')::boolean, false) and (p ->> 'goalsAgainst')::int = 0 then 1 else 0 end,
      case when coalesce((p ->> 'isGoalie')::boolean, false) and p ->> 'side' = winner then 1 else 0 end,
      case when coalesce((p ->> 'isGoalie')::boolean, false) then 1 else 0 end
    from jsonb_array_elements(coalesce(r -> 'players', '[]')) p
    where (p ->> 'playerId') ~ uuid_re
    on conflict (player_id, edition_id) do update set
      gp = s.gp + 1, goals = s.goals + excluded.goals, assists = s.assists + excluded.assists,
      plus_minus = s.plus_minus + excluded.plus_minus, shots = s.shots + excluded.shots, pim = s.pim + excluded.pim,
      gwg = s.gwg + excluded.gwg, hat_tricks = s.hat_tricks + excluded.hat_tricks, mvps = s.mvps + excluded.mvps,
      saves = s.saves + excluded.saves, goals_against = s.goals_against + excluded.goals_against,
      shutouts = s.shutouts + excluded.shutouts, wins = s.wins + excluded.wins, goalie_gp = s.goalie_gp + excluded.goalie_gp,
      team_id = excluded.team_id;

    -- Lesiones
    for x in select * from jsonb_array_elements(coalesce(r -> 'injuries', '[]')) loop
      if (x ->> 'playerId') ~ uuid_re then
        update players set injury_days = greatest(injury_days, (x ->> 'days')::int) where id = (x ->> 'playerId')::uuid;
      end if;
    end loop;

    -- Moral: sube al ganar, baja al perder
    if winner in ('home', 'away') then
      update players set morale = least(100, morale + 2)
        where team_id = case when winner = 'home' then hid else aid end and not retired;
      update players set morale = greatest(0, morale - 2)
        where team_id = case when winner = 'home' then aid else hid end and not retired;
    end if;

    -- Taquilla del local
    if coalesce((r -> 'gate' ->> 'amount')::bigint, 0) > 0 then
      insert into finance_entries (team_id, season_id, concept, amount, match_id)
      select hid, e.season_id, 'taquilla', (r -> 'gate' ->> 'amount')::bigint, mid from editions e where e.id = eid;
      update team_private set budget = budget + (r -> 'gate' ->> 'amount')::bigint where team_id = hid;
    end if;

    perform public.recompute_team_ratings(hid);
    perform public.recompute_team_ratings(aid);
  end loop;
end $$;
revoke all on function public.apply_match_results(jsonb) from public, anon, authenticated;

-- Inicio del día: bajan las lesiones, la forma se mueve y se bloquean los estilos.
create or replace function public.begin_competition_day() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('arena.skip_ratings', 'on', true);
  perform set_config('arena.skip_log', 'on', true);
  update players set
    injury_days = greatest(0, injury_days - 1),
    form = least(100, greatest(0, form + (floor(random() * 13) - 6)::int + case when form < 40 then 2 when form > 70 then -2 else 0 end)),
    morale = morale + case when morale > 55 then -1 when morale < 45 then 1 else 0 end
  where not retired;
  update teams set play_style_locked = true where true;
  perform set_config('arena.skip_ratings', 'off', true);
  perform public.recompute_all_ratings();
end $$;
revoke all on function public.begin_competition_day() from public, anon, authenticated;

create or replace function public.end_competition_day() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('arena.skip_log', 'on', true);
  update teams set play_style_locked = false where true;
end $$;
revoke all on function public.end_competition_day() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- Apuestas (transaccional; las cuotas las valida el servidor antes de llamar)
-- p_legs: [{ matchId?, editionId?, market, selection, odds }]
-- ─────────────────────────────────────────────────────────────
create or replace function public.place_bet_tx(p_user uuid, p_source bet_source, p_legs jsonb, p_stake bigint)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  club uuid;
  budget_now bigint;
  cap numeric := coalesce((select (value ->> 'clubStakeCap')::numeric from settings where key = 'betting'), 0.1);
  parlay uuid := case when jsonb_array_length(p_legs) > 1 then gen_random_uuid() end;
  first_id uuid;
  new_id uuid;
  leg jsonb;
begin
  if p_stake <= 0 then raise exception 'El monto debe ser mayor a cero'; end if;
  if jsonb_array_length(p_legs) = 0 then raise exception 'La boleta está vacía'; end if;

  if p_source = 'club' then
    select club_team_id into club from profiles where id = p_user and role = 'owner';
    if club is null then raise exception 'No tienes un club'; end if;
    select budget into budget_now from team_private where team_id = club for update;
    if p_stake > budget_now * cap then raise exception 'Supera el tope por apuesta del club'; end if;
    update team_private set budget = budget - p_stake where team_id = club;
    insert into finance_entries (team_id, concept, amount, note) values (club, 'apuestas', -p_stake, 'Apuesta del dueño');
  else
    update profiles set credits = credits - p_stake where id = p_user and credits >= p_stake;
    if not found then raise exception 'No tienes créditos suficientes'; end if;
  end if;

  for leg in select * from jsonb_array_elements(p_legs) loop
    insert into bets (user_id, source, club_team_id, parlay_id, match_id, edition_id, market, selection, odds, stake)
    values (p_user, p_source, club, parlay, nullif(leg ->> 'matchId', '')::uuid, nullif(leg ->> 'editionId', '')::uuid,
            leg ->> 'market', leg -> 'selection', (leg ->> 'odds')::numeric, p_stake)
    returning id into new_id;
    first_id := coalesce(first_id, new_id);
  end loop;
  return coalesce(parlay, first_id);
end $$;
revoke all on function public.place_bet_tx(uuid, bet_source, jsonb, bigint) from public, anon, authenticated;

-- Paga una apuesta (o combinada) ganada o anulada.
create or replace function public.pay_bet(p_user uuid, p_source bet_source, p_club uuid, p_amount bigint, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_amount <= 0 then return; end if;
  if p_source = 'club' and p_club is not null then
    update team_private set budget = budget + p_amount where team_id = p_club;
    insert into finance_entries (team_id, concept, amount, note) values (p_club, 'apuestas', p_amount, coalesce(p_note, 'Apuesta ganada'));
  else
    update profiles set credits = credits + p_amount where id = p_user;
  end if;
end $$;
revoke all on function public.pay_bet(uuid, bet_source, uuid, bigint, text) from public, anon, authenticated;

-- Bono por entrar en un día de competencia (una vez por día).
create or replace function public.claim_daily_bonus() returns bigint
language plpgsql security definer set search_path = public as $$
declare
  d date := (select date from competition_days where status in ('running', 'paused') order by date desc limit 1);
  bonus bigint := coalesce((select (value ->> 'dailyBonus')::bigint from settings where key = 'betting'), 100);
begin
  if auth.uid() is null or d is null then return 0; end if;
  update profiles set credits = credits + bonus, last_bonus_day = d
   where id = auth.uid() and (last_bonus_day is null or last_bonus_day < d);
  if not found then return 0; end if;
  return bonus;
end $$;
revoke all on function public.claim_daily_bonus() from public, anon;
grant execute on function public.claim_daily_bonus() to authenticated;

-- Ranking de apostadores (ganancia neta por usuario).
create or replace function public.bettor_leaderboard() returns table (user_id uuid, display_name text, bets bigint, won bigint, net bigint)
language sql stable security definer set search_path = public as $$
  with singles as (
    select b.user_id, coalesce(b.parlay_id, b.id) as ticket,
           max(b.stake) as stake, max(coalesce(b.payout, 0)) as payout,
           bool_and(b.status in ('won', 'void')) and bool_or(b.status = 'won') as is_won,
           bool_or(b.status = 'open') as is_open
    from bets b where b.source = 'credits' group by b.user_id, coalesce(b.parlay_id, b.id)
  )
  select s.user_id, p.display_name, count(*) filter (where not s.is_open), count(*) filter (where s.is_won),
         coalesce(sum(s.payout - s.stake) filter (where not s.is_open), 0)::bigint
  from singles s join profiles p on p.id = s.user_id
  group by s.user_id, p.display_name
  order by 5 desc
  limit 100;
$$;
revoke all on function public.bettor_leaderboard() from public, anon;
grant execute on function public.bettor_leaderboard() to authenticated;

-- Reproducción en vivo: además de las jugadas, datos de los jugadores implicados.
create or replace function public.live_matches() returns setof matches
language sql stable security definer set search_path = public as $$
  select * from matches where status = 'live' order by started_at;
$$;
revoke all on function public.live_matches() from public, anon;
grant execute on function public.live_matches() to authenticated;

-- Tiempo real para las tablas nuevas
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table edition_standings, plan_blocks;
    exception when duplicate_object then null;
    end;
  end if;
end $$;

-- ═══ supabase/migrations/20261116000005_fixes.sql ═══
-- Las funciones del servidor que modifican perfiles se marcan como confiables
-- para pasar la protección de columnas (créditos, rol, club).
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() or auth.uid() is null or current_setting('arena.trusted', true) = 'on' then
    return new;
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

create or replace function public.claim_daily_bonus() returns bigint
language plpgsql security definer set search_path = public as $$
declare
  d date := (select date from competition_days where status in ('running', 'paused') order by date desc limit 1);
  bonus bigint := coalesce((select (value ->> 'dailyBonus')::bigint from settings where key = 'betting'), 100);
begin
  if auth.uid() is null or d is null then return 0; end if;
  perform set_config('arena.trusted', 'on', true);
  update profiles set credits = credits + bonus, last_bonus_day = d
   where id = auth.uid() and role <> 'admin' and (last_bonus_day is null or last_bonus_day < d);
  perform set_config('arena.trusted', 'off', true);
  if not found then return 0; end if;
  return bonus;
end $$;

-- Tiempo real del draft y del mercado.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table draft_picks;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table transfers;
    exception when duplicate_object then null;
    end;
  end if;
end $$;

-- ═══ supabase/seed.sql ═══
-- Generado por scripts/generate-seed.ts. No editar a mano.
begin;
select set_config('arena.skip_log', 'on', true);
insert into settings (key, value, is_public) values ('app_name', '"ARENA"'::jsonb, true) on conflict (key) do nothing;
insert into settings (key, value, is_public) values ('stadiums_enabled', 'false'::jsonb, true) on conflict (key) do nothing;
insert into settings (key, value, is_public) values ('admin_require_mfa', 'true'::jsonb, false) on conflict (key) do nothing;
insert into settings (key, value, is_public) values ('engine', '{"baseGoals":2.8,"scale":0.06,"minLambda":0.2,"maxLambda":8,"maxGoals":12,"homeAdvantage":1.1,"finalRandomnessMultiplier":1.3,"modeScale":{"realista":0.4,"balanceado":0.7,"aleatorio":1.2},"lineWeights":[0.4,0.3,0.2,0.1],"pairWeights":[0.45,0.35,0.2],"styles":{"equilibrado":{"attack":1,"defense":1,"shots":1,"penalties":1,"periodWeights":[1,1,1]},"ofensivo":{"attack":1.04,"defense":0.96,"shots":1.15,"penalties":1,"periodWeights":[1,1,1]},"defensivo":{"attack":0.96,"defense":1.04,"shots":0.85,"penalties":1,"periodWeights":[1,1,1]},"presion":{"attack":1.03,"defense":0.98,"shots":1.05,"penalties":1.2,"periodWeights":[1,1,1]},"contraataque":{"attack":0.98,"defense":1.03,"shots":1,"penalties":1,"periodWeights":[0.85,0.95,1.3]}},"formMoraleRange":0.05,"fatiguePerExtraGame":0.01,"injuryChancePerMatch":0.005,"injuryDays":[1,10],"periodSeconds":300,"overtimeSeconds":120}'::jsonb, false) on conflict (key) do nothing;
insert into settings (key, value, is_public) values ('ranking', '{"base":{"champion":100,"runnerUp":70,"semifinal":50,"quarterfinal":35,"roundOf16":25,"playoffs":15,"leagueMax":20},"customWeight":1}'::jsonb, true) on conflict (key) do nothing;
insert into settings (key, value, is_public) values ('calendar', '{"burstEveryMinutes":5,"burstMin":3,"burstMax":6,"liveEventMinutes":15,"maxLiveEventsPerDay":24,"maxEventsPerDay":24,"derbyThreshold":70,"derbyWeights":{"rivalry":0.35,"form":0.25,"closeness":0.2,"importance":0.2}}'::jsonb, true) on conflict (key) do nothing;
insert into settings (key, value, is_public) values ('economy', '{"initialBudget":50000000,"ticketPrice":45,"genericCapacityByLevel":{"1":6000,"2":9000,"3":12000,"4":16000},"baseOccupancy":0.55,"jerseyPerFame":22000,"prizeByRound":{"champion":3000000,"runnerUp":1800000,"semifinal":1000000,"quarterfinal":600000,"roundOf16":350000,"playoffs":200000},"salaryCap":{"enabled":false,"cap":22000000,"luxuryTaxRate":0.5}}'::jsonb, false) on conflict (key) do nothing;
insert into settings (key, value, is_public) values ('betting', '{"initialCredits":1000,"dailyBonus":100,"houseMargin":0.06,"clubStakeCap":0.1,"maxParlayLegs":5}'::jsonb, true) on conflict (key) do nothing;
insert into settings (key, value, is_public) values ('press', '{"tone":"medio","autoPublish":{"suave":true,"medio":true,"picante":false},"dailyBudgetUsd":1,"aiEnabled":true}'::jsonb, false) on conflict (key) do nothing;
insert into settings (key, value, is_public) values ('probabilities', '{"iterations":10000}'::jsonb, false) on conflict (key) do nothing;
insert into settings (key, value, is_public) values ('market', '{"maxNegotiationRounds":3,"wishlistWeight":1.5}'::jsonb, false) on conflict (key) do nothing;
insert into settings (key, value, is_public) values ('draft', '{"minRookies":60,"maxRookies":80,"rounds":3,"turnSeconds":60}'::jsonb, true) on conflict (key) do nothing;
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('e6e7d9ed-5e3c-43f4-8249-66103868c11b', 'kings', 'Kings', 'KIN', '#bd2020', '#5ae2e2', 93, 93, 92, 1, 100, 1);
insert into team_private (team_id, budget, ai_strategy) values ('e6e7d9ed-5e3c-43f4-8249-66103868c11b', 50000000, 'estrella');
insert into stadiums (id, team_id, name, capacity, level, color) values ('431a8921-0518-47a5-b3f1-8868ffa3c64d', 'e6e7d9ed-5e3c-43f4-8249-66103868c11b', 'Arena Kings', 16000, 4, '#bd2020');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('bb6d0a9c-9752-4fd4-b19c-5bb4ef131b87', 'e6e7d9ed-5e3c-43f4-8249-66103868c11b', null, 2820, 17, 16, '{"legacy":2820}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('8c26f56f-6d17-4a54-8b1d-097b293e1126', 'ducks', 'Ducks', 'DUC', '#28b852', '#e6f0e8', 93, 93, 92, 1, 97, 2);
insert into team_private (team_id, budget, ai_strategy) values ('8c26f56f-6d17-4a54-8b1d-097b293e1126', 50000000, 'equilibrado');
insert into stadiums (id, team_id, name, capacity, level, color) values ('b273ba96-4bb3-4010-8425-42ccee927b24', '8c26f56f-6d17-4a54-8b1d-097b293e1126', 'Arena Ducks', 16000, 4, '#28b852');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('d85bd3d6-6f60-45e4-ae07-98df9b4eaf12', '8c26f56f-6d17-4a54-8b1d-097b293e1126', null, 2550, 15, 15, '{"legacy":2550}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('39d58b9c-37a7-4a4a-8bff-c4e48a7165f2', 'ice-breakers', 'Ice Breakers', 'IB', '#7b2ab6', '#ea3ebf', 93, 92, 90, 1, 89, 3);
insert into team_private (team_id, budget, ai_strategy) values ('39d58b9c-37a7-4a4a-8bff-c4e48a7165f2', 50000000, 'equilibrado');
insert into stadiums (id, team_id, name, capacity, level, color) values ('51121b83-578c-4b15-b28f-1a0aeede3c38', '39d58b9c-37a7-4a4a-8bff-c4e48a7165f2', 'Arena Ice Breakers', 16000, 4, '#7b2ab6');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('3d425ed7-262e-4139-988a-d31e5437c78c', '39d58b9c-37a7-4a4a-8bff-c4e48a7165f2', null, 1980, 10, 14, '{"legacy":1980}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('3ad3f472-bbd9-4b96-943f-a29f58eec741', 'ice-dragons', 'Ice Dragons', 'ID', '#e0c823', '#5a6be2', 93, 93, 92, 1, 87, 4);
insert into team_private (team_id, budget, ai_strategy) values ('3ad3f472-bbd9-4b96-943f-a29f58eec741', 50000000, 'estrella');
insert into stadiums (id, team_id, name, capacity, level, color) values ('7f541798-1b53-46c0-b525-7ac6deabda9a', '3ad3f472-bbd9-4b96-943f-a29f58eec741', 'Arena Ice Dragons', 16000, 4, '#e0c823');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('e95c33cd-757b-4ea8-a4f0-2ca4f968d4ed', '3ad3f472-bbd9-4b96-943f-a29f58eec741', null, 1870, 11, 11, '{"legacy":1870}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('d1e889e1-4405-4986-a8be-a9728da62a1b', 'the-lightnings', 'The Lightnings', 'TL', '#2ab5d1', '#e6eef0', 93, 91, 95, 1, 87, 5);
insert into team_private (team_id, budget, ai_strategy) values ('d1e889e1-4405-4986-a8be-a9728da62a1b', 50000000, 'austeridad');
insert into stadiums (id, team_id, name, capacity, level, color) values ('52b1b2c7-af6d-4160-b9e7-60eedeb3dcc0', 'd1e889e1-4405-4986-a8be-a9728da62a1b', 'Arena The Lightnings', 16000, 4, '#2ab5d1');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('4d33f954-eee5-47ef-ae81-112b86690bc0', 'd1e889e1-4405-4986-a8be-a9728da62a1b', null, 1860, 13, 8, '{"legacy":1860}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('d8194b46-f35a-4031-9d7d-7f6eeaab838c', 'imalayas-hc', 'IMALAYAS HC', 'IH', '#c91d7a', '#ea543e', 92, 93, 92, 1, 84, 6);
insert into team_private (team_id, budget, ai_strategy) values ('d8194b46-f35a-4031-9d7d-7f6eeaab838c', 50000000, 'estrella');
insert into stadiums (id, team_id, name, capacity, level, color) values ('25b915f4-1e0a-4aea-837b-09e4ee9ff7f0', 'd8194b46-f35a-4031-9d7d-7f6eeaab838c', 'Arena IMALAYAS HC', 16000, 4, '#c91d7a');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('4e9c7c4c-2137-4f47-ab5e-be2b32a3c5b7', 'd8194b46-f35a-4031-9d7d-7f6eeaab838c', null, 1660, 11, 8, '{"legacy":1660}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('5739084e-e631-4394-9af3-28cc642e43bd', 'teletes', 'Teletes', 'TEL', '#54e325', '#c05ae2', 94, 92, 94, 1, 83, 7);
insert into team_private (team_id, budget, ai_strategy) values ('5739084e-e631-4394-9af3-28cc642e43bd', 50000000, 'defensivo');
insert into stadiums (id, team_id, name, capacity, level, color) values ('2c0282da-c7af-4a0e-8478-b7896fcc7d36', '5739084e-e631-4394-9af3-28cc642e43bd', 'Arena Teletes', 16000, 4, '#54e325');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('cbc8d076-e5c9-4be0-b724-61cac8eb5899', '5739084e-e631-4394-9af3-28cc642e43bd', null, 1590, 11, 7, '{"legacy":1590}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('ecdc2554-7356-4447-b070-c514585ece0e', 'falcons', 'Falcons', 'FAL', '#2d25dd', '#e6e6f0', 94, 93, 92, 1, 81, 8);
insert into team_private (team_id, budget, ai_strategy) values ('ecdc2554-7356-4447-b070-c514585ece0e', 50000000, 'estrella');
insert into stadiums (id, team_id, name, capacity, level, color) values ('6e0be100-968c-41ec-9ed5-d1ab8190448e', 'ecdc2554-7356-4447-b070-c514585ece0e', 'Arena Falcons', 16000, 4, '#2d25dd');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('adf58e56-f708-4add-ab9c-60dc1c679152', 'ecdc2554-7356-4447-b070-c514585ece0e', null, 1520, 11, 6, '{"legacy":1520}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('430b152c-a4a7-41ea-b0f3-050e6c005ebb', 'penguins', 'Penguins', 'PEN', '#ce5e25', '#e9ea3e', 90, 90, 95, 1, 75, 9);
insert into team_private (team_id, budget, ai_strategy) values ('430b152c-a4a7-41ea-b0f3-050e6c005ebb', 50000000, 'austeridad');
insert into stadiums (id, team_id, name, capacity, level, color) values ('de9b611b-6b9b-45cb-883a-ab3f4584b7ff', '430b152c-a4a7-41ea-b0f3-050e6c005ebb', 'Arena Penguins', 16000, 4, '#ce5e25');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('0b3a6df0-7dc1-451b-a8dd-37c177152355', '430b152c-a4a7-41ea-b0f3-050e6c005ebb', null, 1190, 7, 7, '{"legacy":1190}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('00d080ec-672b-4ca8-a634-156c7bcadc4a', 'aletico-metropolitano', 'Aletico Metropolitano', 'AM', '#2bc78d', '#e25a8d', 93, 88, 89, 1, 74, 10);
insert into team_private (team_id, budget, ai_strategy) values ('00d080ec-672b-4ca8-a634-156c7bcadc4a', 50000000, 'cantera');
insert into stadiums (id, team_id, name, capacity, level, color) values ('e090fba2-dafb-4f3c-8101-ce6cbb534f50', '00d080ec-672b-4ca8-a634-156c7bcadc4a', 'Arena Aletico Metropolitano', 16000, 4, '#2bc78d');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('5d32c4b8-23ab-4bc8-8db0-350d729fa9ab', '00d080ec-672b-4ca8-a634-156c7bcadc4a', null, 1110, 9, 3, '{"legacy":1110}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('47c957f0-e9c3-4647-bbea-7d816b97f3d9', 'horizon', 'Horizon', 'HOR', '#cb21da', '#efe6f0', 93, 91, 92, 1, 72, 11);
insert into team_private (team_id, budget, ai_strategy) values ('47c957f0-e9c3-4647-bbea-7d816b97f3d9', 50000000, 'defensivo');
insert into stadiums (id, team_id, name, capacity, level, color) values ('7cb81ca5-033e-4b26-a55c-47c83e154036', '47c957f0-e9c3-4647-bbea-7d816b97f3d9', 'Arena Horizon', 12000, 3, '#cb21da');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('c7d295f3-b551-475c-91d3-3d1ce07ca851', '47c957f0-e9c3-4647-bbea-7d816b97f3d9', null, 1020, 6, 6, '{"legacy":1020}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('f28259c3-6c4b-47f1-b129-4609980b5af7', 'cuervos', 'Cuervos', 'CUE', '#b9df29', '#53ea3e', 93, 88, 88, 1, 71, 12);
insert into team_private (team_id, budget, ai_strategy) values ('f28259c3-6c4b-47f1-b129-4609980b5af7', 50000000, 'defensivo');
insert into stadiums (id, team_id, name, capacity, level, color) values ('011c9b66-4ee6-454c-a624-4fbecac9d861', 'f28259c3-6c4b-47f1-b129-4609980b5af7', 'Arena Cuervos', 12000, 3, '#b9df29');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('77a6c8d6-d4f1-4e8a-af6f-6e3049b1e56c', 'f28259c3-6c4b-47f1-b129-4609980b5af7', null, 950, 6, 5, '{"legacy":950}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('e7194683-1269-4e1c-beb0-19a91809954c', 'berserkers', 'Berserkers', 'BER', '#2981da', '#e29e5a', 97, 87, 87, 1, 64, 13);
insert into team_private (team_id, budget, ai_strategy) values ('e7194683-1269-4e1c-beb0-19a91809954c', 50000000, 'equilibrado');
insert into stadiums (id, team_id, name, capacity, level, color) values ('c7533ae8-cdfc-4bc0-8fad-aa21b8cfcc7f', 'e7194683-1269-4e1c-beb0-19a91809954c', 'Arena Berserkers', 12000, 3, '#2981da');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('7c4260b8-d6d2-4a8e-b263-66eb752ae1a5', 'e7194683-1269-4e1c-beb0-19a91809954c', null, 660, 1, 8, '{"legacy":660}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('a9e905a3-45e0-477d-a805-d5fb32fb7db1', 'titans', 'Titans', 'TIT', '#c12747', '#f0e6e8', 90, 96, 89, 1, 63, 14);
insert into team_private (team_id, budget, ai_strategy) values ('a9e905a3-45e0-477d-a805-d5fb32fb7db1', 50000000, 'austeridad');
insert into stadiums (id, team_id, name, capacity, level, color) values ('bc034187-6a8f-4ccb-9e27-0b92c1704ded', 'a9e905a3-45e0-477d-a805-d5fb32fb7db1', 'Arena Titans', 12000, 3, '#c12747');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('2658075e-fc18-41ba-9fd4-5b73d83bbe87', 'a9e905a3-45e0-477d-a805-d5fb32fb7db1', null, 620, 2, 6, '{"legacy":620}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('fdcd04d7-7ae9-4ee6-8f61-59d5d517eaa3', 'vikings', 'Vikings', 'VIK', '#20cd2f', '#3eeabf', 90, 83, 90, 1, 63, 15);
insert into team_private (team_id, budget, ai_strategy) values ('fdcd04d7-7ae9-4ee6-8f61-59d5d517eaa3', 50000000, 'defensivo');
insert into stadiums (id, team_id, name, capacity, level, color) values ('8f8983f5-5b4b-457b-b396-d2cabc8dd719', 'fdcd04d7-7ae9-4ee6-8f61-59d5d517eaa3', 'Arena Vikings', 12000, 3, '#20cd2f');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('fb4e1204-6496-4925-bd7f-000cf264ac0c', 'fdcd04d7-7ae9-4ee6-8f61-59d5d517eaa3', null, 620, 2, 6, '{"legacy":620}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('ab65c071-e40a-409c-9c6f-8085d7b8d38e', 'wolves', 'Wolves', 'WOL', '#5d24bc', '#afe25a', 94, 85, 86, 1, 63, 16);
insert into team_private (team_id, budget, ai_strategy) values ('ab65c071-e40a-409c-9c6f-8085d7b8d38e', 50000000, 'cantera');
insert into stadiums (id, team_id, name, capacity, level, color) values ('12650352-4f1c-4d5a-8884-39041d6919f6', 'ab65c071-e40a-409c-9c6f-8085d7b8d38e', 'Arena Wolves', 12000, 3, '#5d24bc');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('85599c19-8dc1-418a-8858-4ea525664bb7', 'ab65c071-e40a-409c-9c6f-8085d7b8d38e', null, 610, 4, 3, '{"legacy":610}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('d7e75bf7-96fb-4ea8-a32e-396539466278', 'panthers', 'Panthers', 'PAN', '#e5a420', '#f0ece6', 93, 87, 85, 1, 62, 17);
insert into team_private (team_id, budget, ai_strategy) values ('d7e75bf7-96fb-4ea8-a32e-396539466278', 50000000, 'equilibrado');
insert into stadiums (id, team_id, name, capacity, level, color) values ('22a5bc8e-6571-4e21-9141-0539a2f6d64a', 'd7e75bf7-96fb-4ea8-a32e-396539466278', 'Arena Panthers', 12000, 3, '#e5a420');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('f31cd218-39b1-4839-8d18-14275917bfbb', 'd7e75bf7-96fb-4ea8-a32e-396539466278', null, 580, 3, 4, '{"legacy":580}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('0a30423d-9ecb-4d25-ace8-5a29ff022275', 'dolphins', 'Dolphins', 'DOL', '#2abdb7', '#3e7eea', 84, 86, 89, 1, 60, 18);
insert into team_private (team_id, budget, ai_strategy) values ('0a30423d-9ecb-4d25-ace8-5a29ff022275', 50000000, 'austeridad');
insert into stadiums (id, team_id, name, capacity, level, color) values ('cef4d1b2-bf80-416b-8d84-fa1ada871a31', '0a30423d-9ecb-4d25-ace8-5a29ff022275', 'Arena Dolphins', 12000, 3, '#2abdb7');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('7317fbb0-c200-4477-85cd-aff5a22b7b13', '0a30423d-9ecb-4d25-ace8-5a29ff022275', null, 510, 3, 3, '{"legacy":510}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('3159934e-02d3-434d-b04f-4be7485dd9aa', 'bears', 'Bears', 'BEA', '#c42c9d', '#5ae27d', 91, 88, 90, 1, 59, 19);
insert into team_private (team_id, budget, ai_strategy) values ('3159934e-02d3-434d-b04f-4be7485dd9aa', 50000000, 'cantera');
insert into stadiums (id, team_id, name, capacity, level, color) values ('478b0677-4c28-44ed-a81e-9725acfac3bd', '3159934e-02d3-434d-b04f-4be7485dd9aa', 'Arena Bears', 12000, 3, '#c42c9d');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('2f6284e8-2b2e-42dc-90f4-9f9aae982d75', '3159934e-02d3-434d-b04f-4be7485dd9aa', null, 480, 2, 4, '{"legacy":480}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('5ace9bc5-8a92-4be6-b9b1-29a8cfb471d0', 'raptors', 'Raptors', 'RAP', '#69b727', '#eaf0e6', 94, 92, 93, 1, 57, 20);
insert into team_private (team_id, budget, ai_strategy) values ('5ace9bc5-8a92-4be6-b9b1-29a8cfb471d0', 50000000, 'equilibrado');
insert into stadiums (id, team_id, name, capacity, level, color) values ('58736d38-39c9-4a36-9c91-79eaee76569a', '5ace9bc5-8a92-4be6-b9b1-29a8cfb471d0', 'Arena Raptors', 12000, 3, '#69b727');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('757eab12-91ac-47a9-a3eb-b1000a857c2b', '5ace9bc5-8a92-4be6-b9b1-29a8cfb471d0', null, 410, 2, 3, '{"legacy":410}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('21dcec66-6d40-4314-ab04-7d35bad33373', 'boing', 'Boing', 'BOI', '#2946d8', '#943eea', 93, 95, 90, 1, 56, 21);
insert into team_private (team_id, budget, ai_strategy) values ('21dcec66-6d40-4314-ab04-7d35bad33373', 50000000, 'defensivo');
insert into stadiums (id, team_id, name, capacity, level, color) values ('17e16e6f-2ea1-4f66-b0fc-a89481a71315', '21dcec66-6d40-4314-ab04-7d35bad33373', 'Arena Boing', 12000, 3, '#2946d8');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('b37ef427-ea5e-4a78-aac3-cc0f311bbb4b', '21dcec66-6d40-4314-ab04-7d35bad33373', null, 380, 1, 4, '{"legacy":380}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('1c00ae7a-a8cc-4503-afd8-ab119e8cf03c', 'angels', 'Angels', 'ANG', '#c3402d', '#5ad1e2', 87, 83, 96, 1, 55, 22);
insert into team_private (team_id, budget, ai_strategy) values ('1c00ae7a-a8cc-4503-afd8-ab119e8cf03c', 50000000, 'equilibrado');
insert into stadiums (id, team_id, name, capacity, level, color) values ('eb5049d3-53bf-4fed-be1c-c8d2a7815006', '1c00ae7a-a8cc-4503-afd8-ab119e8cf03c', 'Arena Angels', 12000, 3, '#c3402d');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('f6f9d78f-e90c-4827-8c89-012f16741599', '1c00ae7a-a8cc-4503-afd8-ab119e8cf03c', null, 370, 3, 1, '{"legacy":370}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('b7276902-2001-41d4-a4eb-b240579845f3', 'axolotls', 'Axolotls', 'AXO', '#2dd875', '#e6f0ea', 88, 91, 88, 1, 54, 23);
insert into team_private (team_id, budget, ai_strategy) values ('b7276902-2001-41d4-a4eb-b240579845f3', 50000000, 'equilibrado');
insert into stadiums (id, team_id, name, capacity, level, color) values ('54be3e3e-9da7-47a4-a505-0f52abdc6ccd', 'b7276902-2001-41d4-a4eb-b240579845f3', 'Arena Axolotls', 12000, 3, '#2dd875');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('69bf1169-a1ae-40b3-bce9-af9ca3cee754', 'b7276902-2001-41d4-a4eb-b240579845f3', null, 340, 2, 2, '{"legacy":340}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('e34a4cd2-1c04-4f5d-98fc-cbdbe44520ef', 'demons', 'Demons', 'DEM', '#9f1ed3', '#ea3ea9', 87, 100, 85, 1, 54, 24);
insert into team_private (team_id, budget, ai_strategy) values ('e34a4cd2-1c04-4f5d-98fc-cbdbe44520ef', 50000000, 'cantera');
insert into stadiums (id, team_id, name, capacity, level, color) values ('d35bab9c-e43f-4e0c-98ce-de44597cda22', 'e34a4cd2-1c04-4f5d-98fc-cbdbe44520ef', 'Arena Demons', 12000, 3, '#9f1ed3');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('18b70581-96b7-46c8-a245-718035855c05', 'e34a4cd2-1c04-4f5d-98fc-cbdbe44520ef', null, 340, 2, 2, '{"legacy":340}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('6ee88a33-553e-4d2a-9288-124bacd7cddb', 'salamaders', 'Salamaders', 'SAL', '#e4e519', '#5b5ae2', 91, 82, 88, 1, 53, 25);
insert into team_private (team_id, budget, ai_strategy) values ('6ee88a33-553e-4d2a-9288-124bacd7cddb', 50000000, 'austeridad');
insert into stadiums (id, team_id, name, capacity, level, color) values ('fed3eca3-b38c-460e-a23e-24777e7bd419', '6ee88a33-553e-4d2a-9288-124bacd7cddb', 'Arena Salamaders', 12000, 3, '#e4e519');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('7186da78-af7f-4fe3-b201-c9acba822d80', '6ee88a33-553e-4d2a-9288-124bacd7cddb', null, 310, 1, 3, '{"legacy":310}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('9cca4d3e-b45e-45c1-8cda-270a54fe3669', 'black-horses', 'Black Horses', 'BH', '#1796cb', '#e6edf0', 95, 88, 85, 1, 53, 26);
insert into team_private (team_id, budget, ai_strategy) values ('9cca4d3e-b45e-45c1-8cda-270a54fe3669', 50000000, 'estrella');
insert into stadiums (id, team_id, name, capacity, level, color) values ('fc11fb08-4f53-4933-89bc-f57ad9c52e36', '9cca4d3e-b45e-45c1-8cda-270a54fe3669', 'Arena Black Horses', 9000, 2, '#1796cb');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('3894e144-f67d-4a0a-8984-16b168d7844d', '9cca4d3e-b45e-45c1-8cda-270a54fe3669', null, 300, 3, 0, '{"legacy":300}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('2b160a2b-433d-4794-adb6-e8835c6b4463', 'rhinos', 'RHINOS', 'RHI', '#c21f62', '#ea6a3e', 92, 84, 75, 1, 53, 27);
insert into team_private (team_id, budget, ai_strategy) values ('2b160a2b-433d-4794-adb6-e8835c6b4463', 50000000, 'estrella');
insert into stadiums (id, team_id, name, capacity, level, color) values ('ab0124e4-ad41-47b6-91b8-73516a4243cd', '2b160a2b-433d-4794-adb6-e8835c6b4463', 'Arena RHINOS', 9000, 2, '#c21f62');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('ecd0a4f3-ad74-4eec-82a2-cc1c78c40deb', '2b160a2b-433d-4794-adb6-e8835c6b4463', null, 300, 3, 0, '{"legacy":300}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('6d2bedd3-0746-4328-b1c8-7bd8af1f07c2', 'aztecz', 'AZTECZ', 'AZT', '#2dd416', '#d15ae2', 91, 88, 85, 2, 52, 28);
insert into team_private (team_id, budget, ai_strategy) values ('6d2bedd3-0746-4328-b1c8-7bd8af1f07c2', 50000000, 'defensivo');
insert into stadiums (id, team_id, name, capacity, level, color) values ('729d80ba-3d54-42b2-8405-efebda90c613', '6d2bedd3-0746-4328-b1c8-7bd8af1f07c2', 'Arena AZTECZ', 9000, 2, '#2dd416');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('19b319bc-ed97-4c88-8005-f420a98e44be', '6d2bedd3-0746-4328-b1c8-7bd8af1f07c2', null, 270, 2, 1, '{"legacy":270}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('17de141f-4ca9-4f73-98f4-4010e6a97b97', 'foxes', 'Foxes', 'FOX', '#482adc', '#e7e6f0', 87, 87, 92, 2, 50, 29);
insert into team_private (team_id, budget, ai_strategy) values ('17de141f-4ca9-4f73-98f4-4010e6a97b97', 50000000, 'austeridad');
insert into stadiums (id, team_id, name, capacity, level, color) values ('2e2f1797-a107-4077-b3aa-38b3a63df8eb', '17de141f-4ca9-4f73-98f4-4010e6a97b97', 'Arena Foxes', 9000, 2, '#482adc');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('2a548c19-5916-496e-9d7c-43b5157ddcc1', '17de141f-4ca9-4f73-98f4-4010e6a97b97', null, 240, 1, 2, '{"legacy":240}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('e8e8fb72-04ba-477d-a4a7-0c298e8e4809', 'yetis', 'YETIS', 'YET', '#be661b', '#d3ea3e', 88, 89, 90, 2, 50, 30);
insert into team_private (team_id, budget, ai_strategy) values ('e8e8fb72-04ba-477d-a4a7-0c298e8e4809', 50000000, 'defensivo');
insert into stadiums (id, team_id, name, capacity, level, color) values ('0f9502cf-59f4-49cc-9134-b1a8180604a3', 'e8e8fb72-04ba-477d-a4a7-0c298e8e4809', 'Arena YETIS', 9000, 2, '#be661b');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('f057af26-3f84-48e3-b46f-75c244161bf9', 'e8e8fb72-04ba-477d-a4a7-0c298e8e4809', null, 240, 1, 2, '{"legacy":240}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('da8bc0b2-2c80-4317-9038-fba29f048450', 'owls', 'OWLS', 'OWL', '#26e0b2', '#e25a7c', 90, 84, 93, 2, 47, 31);
insert into team_private (team_id, budget, ai_strategy) values ('da8bc0b2-2c80-4317-9038-fba29f048450', 50000000, 'cantera');
insert into stadiums (id, team_id, name, capacity, level, color) values ('c2d96899-44f6-4de1-9128-300ccb1f5d73', 'da8bc0b2-2c80-4317-9038-fba29f048450', 'Arena OWLS', 9000, 2, '#26e0b2');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('543b1e34-8461-4d24-8918-ab85cb6e556f', 'da8bc0b2-2c80-4317-9038-fba29f048450', null, 170, 1, 1, '{"legacy":170}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('52040607-bbc9-4231-9779-b850e3e9901b', 'perry-the-platypus', 'Perry the platypus', 'PTP', '#d829d0', '#f0e6ef', 93, 89, 89, 2, 47, 32);
insert into team_private (team_id, budget, ai_strategy) values ('52040607-bbc9-4231-9779-b850e3e9901b', 50000000, 'austeridad');
insert into stadiums (id, team_id, name, capacity, level, color) values ('e4c142d5-6912-4f24-a958-edfe4a07f3eb', '52040607-bbc9-4231-9779-b850e3e9901b', 'Arena Perry the platypus', 9000, 2, '#d829d0');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('1b7aa5fb-6a19-4359-aa46-409f8e488501', '52040607-bbc9-4231-9779-b850e3e9901b', null, 170, 1, 1, '{"legacy":170}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('4fa9e7b4-5d05-4de4-bfd2-06acb3a828d4', 'salmons', 'Salmons', 'SAL', '#95d517', '#3eea3f', 88, 86, 87, 2, 47, 33);
insert into team_private (team_id, budget, ai_strategy) values ('4fa9e7b4-5d05-4de4-bfd2-06acb3a828d4', 50000000, 'defensivo');
insert into stadiums (id, team_id, name, capacity, level, color) values ('1719f930-bc52-4cd7-a2ac-4f2d7dc8afa5', '4fa9e7b4-5d05-4de4-bfd2-06acb3a828d4', 'Arena Salmons', 9000, 2, '#95d517');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('55691f4e-9139-458d-ba48-8a054617e438', '4fa9e7b4-5d05-4de4-bfd2-06acb3a828d4', null, 170, 1, 1, '{"legacy":170}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('6845f9ab-2286-4175-824e-9698719e9b6e', 'phantoms', 'Phantoms', 'PHA', '#285eb9', '#e2b05a', 93, 91, 91, 2, 46, 34);
insert into team_private (team_id, budget, ai_strategy) values ('6845f9ab-2286-4175-824e-9698719e9b6e', 50000000, 'equilibrado');
insert into stadiums (id, team_id, name, capacity, level, color) values ('8945fbde-535d-4b9f-9b2e-22c04c8cf4f6', '6845f9ab-2286-4175-824e-9698719e9b6e', 'Arena Phantoms', 9000, 2, '#285eb9');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('d147ab24-7d44-4768-bd0d-43cfe32326f2', '6845f9ab-2286-4175-824e-9698719e9b6e', null, 140, 0, 2, '{"legacy":140}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('b26f44fe-3dd3-4be9-9c69-a5ebfc330ac3', 'cobras', 'Cobras', 'COB', '#c12834', '#f0e6e6', 90, 84, 89, 2, 43, 35);
insert into team_private (team_id, budget, ai_strategy) values ('b26f44fe-3dd3-4be9-9c69-a5ebfc330ac3', 50000000, 'cantera');
insert into stadiums (id, team_id, name, capacity, level, color) values ('fa7a6f6e-bb2d-4865-a8a7-6d994ef52186', 'b26f44fe-3dd3-4be9-9c69-a5ebfc330ac3', 'Arena Cobras', 9000, 2, '#c12834');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('ea98b7a8-c70e-404c-9d01-8146f3765fd6', 'b26f44fe-3dd3-4be9-9c69-a5ebfc330ac3', null, 100, 1, 0, '{"legacy":100}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('e4698f56-ae91-4920-a6db-6ecbd26daf9e', 'krakens', 'Krakens', 'KRA', '#24be44', '#3eead5', 91, 89, 95, 2, 43, 36);
insert into team_private (team_id, budget, ai_strategy) values ('e4698f56-ae91-4920-a6db-6ecbd26daf9e', 50000000, 'equilibrado');
insert into stadiums (id, team_id, name, capacity, level, color) values ('fce23bb6-6828-4146-9be1-caadca34cbe2', 'e4698f56-ae91-4920-a6db-6ecbd26daf9e', 'Arena Krakens', 9000, 2, '#24be44');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('b7b0f880-9999-4653-9b2f-6907abd56827', 'e4698f56-ae91-4920-a6db-6ecbd26daf9e', null, 100, 1, 0, '{"legacy":100}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('2bd0821d-b1f1-4380-94c1-6e55e7aa7f0f', 'toros', 'Toros', 'TOR', '#7c1ed8', '#9de25a', 88, 91, 88, 2, 43, 37);
insert into team_private (team_id, budget, ai_strategy) values ('2bd0821d-b1f1-4380-94c1-6e55e7aa7f0f', 50000000, 'austeridad');
insert into stadiums (id, team_id, name, capacity, level, color) values ('989f3f29-2a7d-451a-b83f-1f3058c565d6', '2bd0821d-b1f1-4380-94c1-6e55e7aa7f0f', 'Arena Toros', 9000, 2, '#7c1ed8');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('e53f446d-d949-48d0-871e-103932dd5ebb', '2bd0821d-b1f1-4380-94c1-6e55e7aa7f0f', null, 100, 1, 0, '{"legacy":100}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('fde34d04-6ab9-41f3-b94b-7599272243b0', 'hex-clankers', 'HEX Clankers', 'HC', '#c2a224', '#f0eee6', 88, 83, 81, 2, 41, 38);
insert into team_private (team_id, budget, ai_strategy) values ('fde34d04-6ab9-41f3-b94b-7599272243b0', 50000000, 'estrella');
insert into stadiums (id, team_id, name, capacity, level, color) values ('3a5a1de5-434c-4bb6-b745-a66dbbf4c213', 'fde34d04-6ab9-41f3-b94b-7599272243b0', 'Arena HEX Clankers', 9000, 2, '#c2a224');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('3069687b-1863-4914-9f85-d7f02788f6c9', 'fde34d04-6ab9-41f3-b94b-7599272243b0', null, 70, 0, 1, '{"legacy":70}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('ca9e4115-7162-409f-984a-f89155680263', 'huskys', 'Huskys', 'HUS', '#21d3e4', '#3e68ea', 87, 91, 89, 2, 41, 39);
insert into team_private (team_id, budget, ai_strategy) values ('ca9e4115-7162-409f-984a-f89155680263', 50000000, 'estrella');
insert into stadiums (id, team_id, name, capacity, level, color) values ('11f701c8-8823-44d3-bae3-d9035bbde409', 'ca9e4115-7162-409f-984a-f89155680263', 'Arena Huskys', 9000, 2, '#21d3e4');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('f5f01d73-e8b1-47fe-b65d-163ab69560b0', 'ca9e4115-7162-409f-984a-f89155680263', null, 70, 0, 1, '{"legacy":70}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('91c32b14-5622-46a9-9519-43c7a027834d', 'pirates', 'Pirates', 'PIR', '#c41e85', '#5ae28e', 88, 97, 86, 2, 41, 40);
insert into team_private (team_id, budget, ai_strategy) values ('91c32b14-5622-46a9-9519-43c7a027834d', 50000000, 'cantera');
insert into stadiums (id, team_id, name, capacity, level, color) values ('5e3fb33d-f865-4cfc-889e-744f85f982ba', '91c32b14-5622-46a9-9519-43c7a027834d', 'Arena Pirates', 9000, 2, '#c41e85');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('c2ea119f-fc9c-4744-be2a-2cd8e3ebac11', '91c32b14-5622-46a9-9519-43c7a027834d', null, 70, 0, 1, '{"legacy":70}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('f924e118-f3d3-432a-ae0b-5e3c96e1538d', 'tigers', 'Tigers', 'TIG', '#53c11c', '#e9f0e6', 86, 86, 89, 2, 41, 41);
insert into team_private (team_id, budget, ai_strategy) values ('f924e118-f3d3-432a-ae0b-5e3c96e1538d', 50000000, 'austeridad');
insert into stadiums (id, team_id, name, capacity, level, color) values ('43f4b5be-08c5-41d8-acab-b177c410f630', 'f924e118-f3d3-432a-ae0b-5e3c96e1538d', 'Arena Tigers', 6000, 1, '#53c11c');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('26ae652f-5cf8-48d6-b0b9-f447c873aefa', 'f924e118-f3d3-432a-ae0b-5e3c96e1538d', null, 70, 0, 1, '{"legacy":70}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('c538e4c4-00fd-41e5-8092-7076d5e610f3', 'united', 'United', 'UNI', '#262cca', '#aa3eea', 92, 89, 93, 2, 41, 42);
insert into team_private (team_id, budget, ai_strategy) values ('c538e4c4-00fd-41e5-8092-7076d5e610f3', 50000000, 'cantera');
insert into stadiums (id, team_id, name, capacity, level, color) values ('cbbe61c5-9647-40cb-85c7-b8f244d610f0', 'c538e4c4-00fd-41e5-8092-7076d5e610f3', 'Arena United', 6000, 1, '#262cca');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('9410ecf0-c40e-4445-a773-67763cb325c1', 'c538e4c4-00fd-41e5-8092-7076d5e610f3', null, 70, 0, 1, '{"legacy":70}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('790b2315-fabf-4b3d-b1b2-300de999524a', 'wyvers', 'Wyvers', 'WYV', '#c2461c', '#5abfe2', 87, 91, 82, 2, 41, 43);
insert into team_private (team_id, budget, ai_strategy) values ('790b2315-fabf-4b3d-b1b2-300de999524a', 50000000, 'austeridad');
insert into stadiums (id, team_id, name, capacity, level, color) values ('4660a4bc-f149-4cc8-9607-31aeab3a6912', '790b2315-fabf-4b3d-b1b2-300de999524a', 'Arena Wyvers', 6000, 1, '#c2461c');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('120daa88-7eab-4401-a7a9-ccaa4fa68751', '790b2315-fabf-4b3d-b1b2-300de999524a', null, 70, 0, 1, '{"legacy":70}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('78ebfc07-101e-48c3-98ac-758f8ccaebf1', 'coyotes', 'Coyotes', 'COY', '#21b874', '#e6f0eb', 86, 88, 88, 2, 30, 44);
insert into team_private (team_id, budget, ai_strategy) values ('78ebfc07-101e-48c3-98ac-758f8ccaebf1', 50000000, 'equilibrado');
insert into stadiums (id, team_id, name, capacity, level, color) values ('c5021fde-2ed1-4de2-950c-056605ada9cc', '78ebfc07-101e-48c3-98ac-758f8ccaebf1', 'Arena Coyotes', 6000, 1, '#21b874');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('c7597401-c621-431b-a93e-76c372d78df3', '78ebfc07-101e-48c3-98ac-758f8ccaebf1', null, 0, 0, 0, '{"legacy":0}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('b4f47315-8e06-478e-a9b5-d7bd849f7ba9', 'griffins', 'Griffins', 'GRI', '#c220e1', '#ea3e93', 89, 89, 93, 2, 30, 45);
insert into team_private (team_id, budget, ai_strategy) values ('b4f47315-8e06-478e-a9b5-d7bd849f7ba9', 50000000, 'austeridad');
insert into stadiums (id, team_id, name, capacity, level, color) values ('7b842d57-9aed-4ac6-b40f-d5ce55d76207', 'b4f47315-8e06-478e-a9b5-d7bd849f7ba9', 'Arena Griffins', 6000, 1, '#c220e1');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('2f2847fb-cdbe-411d-b663-2c3ca212b1c9', 'b4f47315-8e06-478e-a9b5-d7bd849f7ba9', null, 0, 0, 0, '{"legacy":0}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('ba1f9b8a-ff83-447d-83a8-7df3ca9181ca', 'knights', 'Knights', 'KNI', '#a7ba2b', '#6c5ae2', 93, 91, 93, 2, 30, 46);
insert into team_private (team_id, budget, ai_strategy) values ('ba1f9b8a-ff83-447d-83a8-7df3ca9181ca', 50000000, 'equilibrado');
insert into stadiums (id, team_id, name, capacity, level, color) values ('80e3c08f-a44a-4e80-aedc-a05f0702c1c2', 'ba1f9b8a-ff83-447d-83a8-7df3ca9181ca', 'Arena Knights', 6000, 1, '#a7ba2b');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('34d25a2a-64c1-4dc6-a0a2-483c21c9c6b8', 'ba1f9b8a-ff83-447d-83a8-7df3ca9181ca', null, 0, 0, 0, '{"legacy":0}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('8118ce0c-ee6f-4c60-9598-c71b95717d42', 'mamuts', 'Mamuts', 'MAM', '#1f91e5', '#e6ebf0', 81, 94, 90, 2, 30, 47);
insert into team_private (team_id, budget, ai_strategy) values ('8118ce0c-ee6f-4c60-9598-c71b95717d42', 50000000, 'estrella');
insert into stadiums (id, team_id, name, capacity, level, color) values ('37842b67-857c-416a-a4ff-2529161c3d5f', '8118ce0c-ee6f-4c60-9598-c71b95717d42', 'Arena Mamuts', 6000, 1, '#1f91e5');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('48fab202-5f80-4055-871a-bd13081ef1eb', '8118ce0c-ee6f-4c60-9598-c71b95717d42', null, 0, 0, 0, '{"legacy":0}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('754b47e4-eb06-45f3-a690-a3d6616d8c8f', 'only', 'Only', 'ONL', '#d0305e', '#ea803e', 81, 79, 100, 2, 30, 48);
insert into team_private (team_id, budget, ai_strategy) values ('754b47e4-eb06-45f3-a690-a3d6616d8c8f', 50000000, 'austeridad');
insert into stadiums (id, team_id, name, capacity, level, color) values ('ac9fe97a-bd7e-4fa9-bbea-867bad159076', '754b47e4-eb06-45f3-a690-a3d6616d8c8f', 'Arena Only', 6000, 1, '#d0305e');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('bb578986-23e7-4c0d-9b1a-f2e2cae5a523', '754b47e4-eb06-45f3-a690-a3d6616d8c8f', null, 0, 0, 0, '{"legacy":0}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('8281cbfd-1e58-488d-91a8-a58fa18787d8', 'ronins', 'Ronins', 'RON', '#29cf2a', '#e25ae1', 94, 88, 89, 2, 30, 49);
insert into team_private (team_id, budget, ai_strategy) values ('8281cbfd-1e58-488d-91a8-a58fa18787d8', 50000000, 'equilibrado');
insert into stadiums (id, team_id, name, capacity, level, color) values ('021e46b3-dd89-49b7-9532-1183eb4d074e', '8281cbfd-1e58-488d-91a8-a58fa18787d8', 'Arena Ronins', 6000, 1, '#29cf2a');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('21449903-8057-425e-8c91-32a6f7d39d4c', '8281cbfd-1e58-488d-91a8-a58fa18787d8', null, 0, 0, 0, '{"legacy":0}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('d3935206-b888-435c-8498-eb1c2babde43', 'scorpions', 'Scorpions', 'SCO', '#4915c5', '#e9e6f0', 93, 89, 82, 2, 30, 50);
insert into team_private (team_id, budget, ai_strategy) values ('d3935206-b888-435c-8498-eb1c2babde43', 50000000, 'cantera');
insert into stadiums (id, team_id, name, capacity, level, color) values ('41082b07-49d9-45f9-9475-7dffa8574d34', 'd3935206-b888-435c-8498-eb1c2babde43', 'Arena Scorpions', 6000, 1, '#4915c5');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('fbb49746-3d3f-41be-b434-1f89897558a7', 'd3935206-b888-435c-8498-eb1c2babde43', null, 0, 0, 0, '{"legacy":0}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('725ad4e0-326d-479e-8795-60fb2d9b023c', 'sharks', 'Sharks', 'SHA', '#d18d2b', '#beea3e', 92, 80, 85, 2, 30, 51);
insert into team_private (team_id, budget, ai_strategy) values ('725ad4e0-326d-479e-8795-60fb2d9b023c', 50000000, 'defensivo');
insert into stadiums (id, team_id, name, capacity, level, color) values ('5120e5e9-5c6a-4c0b-b845-02d4c0e2a920', '725ad4e0-326d-479e-8795-60fb2d9b023c', 'Arena Sharks', 6000, 1, '#d18d2b');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('759d6ed4-15b1-46be-8dd4-1bfed9d001af', '725ad4e0-326d-479e-8795-60fb2d9b023c', null, 0, 0, 0, '{"legacy":0}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('b668868f-bf60-4ac3-b2b1-422f8ce1f8cd', 'spartans', 'Spartans', 'SPA', '#15c8b3', '#e25a6a', 86, 88, 90, 2, 30, 52);
insert into team_private (team_id, budget, ai_strategy) values ('b668868f-bf60-4ac3-b2b1-422f8ce1f8cd', 50000000, 'defensivo');
insert into stadiums (id, team_id, name, capacity, level, color) values ('e53818b1-3338-42c6-86e7-f042cc0ffb80', 'b668868f-bf60-4ac3-b2b1-422f8ce1f8cd', 'Arena Spartans', 6000, 1, '#15c8b3');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('42d0e768-15c5-4bbe-b2c4-f47c252a6b5d', 'b668868f-bf60-4ac3-b2b1-422f8ce1f8cd', null, 0, 0, 0, '{"legacy":0}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('91fbbaad-ee73-47da-bd4b-716768c12235', 'whales', 'Whales', 'WHA', '#c62eac', '#f0e6ee', 87, 92, 86, 2, 30, 53);
insert into team_private (team_id, budget, ai_strategy) values ('91fbbaad-ee73-47da-bd4b-716768c12235', 50000000, 'cantera');
insert into stadiums (id, team_id, name, capacity, level, color) values ('49d41c5e-8f2c-4f0b-87a6-39505766d777', '91fbbaad-ee73-47da-bd4b-716768c12235', 'Arena Whales', 6000, 1, '#c62eac');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('7a558891-fa1f-4c7d-98bb-dea8a5a12d4e', '91fbbaad-ee73-47da-bd4b-716768c12235', null, 0, 0, 0, '{"legacy":0}'::jsonb);
insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values ('4eecd7bb-d0c8-4ce3-8b35-4735528793cf', 'zuricatas', 'Zuricatas', 'ZUR', '#78c81c', '#3eea55', 93, 84, 87, 2, 30, 54);
insert into team_private (team_id, budget, ai_strategy) values ('4eecd7bb-d0c8-4ce3-8b35-4735528793cf', 50000000, 'equilibrado');
insert into stadiums (id, team_id, name, capacity, level, color) values ('3799268e-3665-4c66-9431-b18e60a79f29', '4eecd7bb-d0c8-4ce3-8b35-4735528793cf', 'Arena Zuricatas', 6000, 1, '#78c81c');
insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values ('c0b2d3a0-ae78-47cb-9874-86b22869004c', '4eecd7bb-d0c8-4ce3-8b35-4735528793cf', null, 0, 0, 0, '{"legacy":0}'::jsonb);
insert into players (id, team_id, first_name, last_name, number, position, rating, age, potential, form, morale, salary, contract_years) values
('c7b58d96-d3af-42d5-8f8c-a56b06f2c098', 'e6e7d9ed-5e3c-43f4-8249-66103868c11b', 'Quentin', 'Ordaz', 50, 'G', 92, 25, 96, 50, 50, 1090000, 4),
('e62dcdf7-f43d-4854-b334-e46aa8135b46', 'e6e7d9ed-5e3c-43f4-8249-66103868c11b', 'Otto', 'Garmendia', 47, 'G', 83, 29, 85, 50, 50, 560000, 2),
('a8ab000e-d5db-4f2c-a09a-bc398647fdc6', 'e6e7d9ed-5e3c-43f4-8249-66103868c11b', 'Hakon', 'Albrecht', 40, 'D', 96, 32, 97, 50, 50, 1440000, 4),
('b3270366-c8ff-4794-8b5a-7d2296572141', 'e6e7d9ed-5e3c-43f4-8249-66103868c11b', 'Felix', 'Villaseñor', 37, 'D', 95, 28, 95, 50, 50, 1340000, 2),
('7fb12a51-7a5d-4d41-a203-b8a7b5b575d0', 'e6e7d9ed-5e3c-43f4-8249-66103868c11b', 'Ulises', 'Abarca', 74, 'D', 93, 34, 93, 50, 50, 1000000, 1),
('766173bc-9ae7-4273-9ff2-a8117df2dd76', 'e6e7d9ed-5e3c-43f4-8249-66103868c11b', 'Nahuel', 'Karlsen', 2, 'D', 92, 23, 96, 50, 50, 1090000, 5),
('19794527-1947-4f08-859e-6207a602679d', 'e6e7d9ed-5e3c-43f4-8249-66103868c11b', 'Benicio', 'Castellví', 55, 'D', 90, 28, 91, 50, 50, 950000, 1),
('547e77e7-de18-4dd0-bc90-c28396ab90cc', 'e6e7d9ed-5e3c-43f4-8249-66103868c11b', 'Tobías', 'Ferrán', 98, 'D', 89, 20, 100, 50, 50, 530000, 4),
('d4634ed5-49ec-4a9c-bd83-67983460f2ea', 'e6e7d9ed-5e3c-43f4-8249-66103868c11b', 'Amadeo', 'Zapatero', 89, 'F', 97, 32, 98, 50, 50, 1530000, 3),
('89a0aacf-6c1e-429c-ace2-94f578e7550d', 'e6e7d9ed-5e3c-43f4-8249-66103868c11b', 'Marek', 'Sundqvist', 39, 'F', 96, 31, 98, 50, 50, 1440000, 2),
('66683d5a-aae0-42e1-9c4a-5218f36ce2e4', 'e6e7d9ed-5e3c-43f4-8249-66103868c11b', 'Valtteri', 'Bergkvist', 64, 'F', 95, 35, 96, 50, 50, 1140000, 5),
('9ca7dafb-04ed-4896-b397-4ba7d1146dd0', 'e6e7d9ed-5e3c-43f4-8249-66103868c11b', 'Leandro', 'Villaseñor', 68, 'F', 93, 28, 95, 50, 50, 1170000, 5),
('a903d1e0-1a3b-4794-92d9-3663d41a1d41', 'e6e7d9ed-5e3c-43f4-8249-66103868c11b', 'Vicente', 'Lindqvist', 65, 'F', 93, 32, 93, 50, 50, 1170000, 2),
('be77d86f-d119-45b9-99cc-487f30423ca0', 'e6e7d9ed-5e3c-43f4-8249-66103868c11b', 'Benicio', 'Marklund', 20, 'F', 92, 28, 93, 50, 50, 1090000, 5),
('ac3c514f-af2e-47db-8452-c233498af43c', 'e6e7d9ed-5e3c-43f4-8249-66103868c11b', 'Ulises', 'Calderas', 77, 'F', 91, 23, 97, 50, 50, 1020000, 2),
('0493cf5f-b765-4e77-82c5-8338fe19d2fc', 'e6e7d9ed-5e3c-43f4-8249-66103868c11b', 'Aldo', 'Karlsen', 73, 'F', 90, 32, 91, 50, 50, 950000, 5),
('50361332-f3ee-4a29-8e7a-665f1a43cba4', 'e6e7d9ed-5e3c-43f4-8249-66103868c11b', 'Nahuel', 'Saarinen', 59, 'F', 89, 23, 92, 50, 50, 880000, 3),
('ba255239-40f8-4aab-8954-fcc273d7a5f7', 'e6e7d9ed-5e3c-43f4-8249-66103868c11b', 'Rasmus', 'Granqvist', 25, 'F', 88, 28, 90, 50, 50, 820000, 5),
('30a91ccf-a7db-46e4-a349-2cb9d58cabe0', 'e6e7d9ed-5e3c-43f4-8249-66103868c11b', 'Jonas', 'Urquiza', 14, 'F', 87, 23, 90, 50, 50, 760000, 4),
('3055776d-4825-493f-b154-5d32f172e04c', 'e6e7d9ed-5e3c-43f4-8249-66103868c11b', 'Rodrigo', 'Halvorsen', 67, 'F', 86, 31, 88, 50, 50, 710000, 4),
('0027c28d-8203-4399-9cac-718dfb6458f1', '8c26f56f-6d17-4a54-8b1d-097b293e1126', 'Anders', 'Holmqvist', 87, 'G', 92, 28, 94, 50, 50, 1090000, 2),
('d3bc588b-dab7-4219-b14b-4651f0e84c0e', '8c26f56f-6d17-4a54-8b1d-097b293e1126', 'Kai', 'Halvorsen', 77, 'G', 82, 24, 86, 50, 50, 520000, 1),
('8b4c8657-ae1e-4025-9ab8-f3a589042544', '8c26f56f-6d17-4a54-8b1d-097b293e1126', 'Matías', 'Quintanar', 30, 'D', 96, 28, 97, 50, 50, 1440000, 3),
('f66cd5ed-d1c3-4930-aa03-2f36373262e8', '8c26f56f-6d17-4a54-8b1d-097b293e1126', 'Ivo', 'Brandt', 52, 'D', 95, 22, 100, 50, 50, 1340000, 5),
('53804794-270b-43f1-9cd9-45f32fca0d4e', '8c26f56f-6d17-4a54-8b1d-097b293e1126', 'Nahuel', 'Landeros', 69, 'D', 93, 25, 95, 50, 50, 1170000, 2),
('099ed68a-b6a7-4adc-b0a0-9709d6d667ca', '8c26f56f-6d17-4a54-8b1d-097b293e1126', 'Thiago', 'Jansky', 64, 'D', 92, 29, 94, 50, 50, 1090000, 4),
('9b8d2e72-37dc-4e4f-8722-673cc9efc22b', '8c26f56f-6d17-4a54-8b1d-097b293e1126', 'Kai', 'Ostrowski', 95, 'D', 90, 29, 91, 50, 50, 950000, 2),
('16f17ee1-a6b9-4353-bb9b-85a08bb4336e', '8c26f56f-6d17-4a54-8b1d-097b293e1126', 'Tobías', 'Ordaz', 29, 'D', 89, 31, 90, 50, 50, 880000, 1),
('977b6668-1c1e-4682-8b26-dba3b9562492', '8c26f56f-6d17-4a54-8b1d-097b293e1126', 'Pablo', 'Bergkvist', 34, 'F', 97, 27, 98, 50, 50, 1530000, 1),
('e7a821ef-9aa6-43df-93c4-8ec2b6008df0', '8c26f56f-6d17-4a54-8b1d-097b293e1126', 'Lucas', 'Delacroix', 72, 'F', 96, 25, 97, 50, 50, 1440000, 2),
('6c72482c-5a7e-4189-953d-46fc370992f8', '8c26f56f-6d17-4a54-8b1d-097b293e1126', 'Renzo', 'Ostrowski', 74, 'F', 95, 31, 96, 50, 50, 1340000, 5),
('cf30de82-25de-4591-a40d-8e34945eaca3', '8c26f56f-6d17-4a54-8b1d-097b293e1126', 'Silas', 'Zelenka', 17, 'F', 94, 25, 97, 50, 50, 1260000, 2),
('b95b0fc6-5068-4106-8e85-7f34c2a65858', '8c26f56f-6d17-4a54-8b1d-097b293e1126', 'Zoltan', 'Calderas', 62, 'F', 93, 33, 93, 50, 50, 1000000, 1),
('88ba3a05-dc8c-4d8d-a0f9-90669a97990d', '8c26f56f-6d17-4a54-8b1d-097b293e1126', 'Bruno', 'Saarinen', 98, 'F', 92, 28, 93, 50, 50, 1090000, 5),
('a5a6cc08-4598-489b-9751-ec4e12ed7106', '8c26f56f-6d17-4a54-8b1d-097b293e1126', 'Fabián', 'Vikström', 73, 'F', 91, 29, 92, 50, 50, 1020000, 5),
('78bc69ef-1e08-40b2-b560-06cafd95ce4b', '8c26f56f-6d17-4a54-8b1d-097b293e1126', 'Rune', 'Kovář', 48, 'F', 90, 29, 90, 50, 50, 950000, 5),
('519ebd5b-738a-4515-93b2-ea3f26252d13', '8c26f56f-6d17-4a54-8b1d-097b293e1126', 'Yannick', 'Zapatero', 11, 'F', 89, 26, 89, 50, 50, 880000, 2),
('6594108c-e2b9-4647-b93c-580c94cd64aa', '8c26f56f-6d17-4a54-8b1d-097b293e1126', 'Rasmus', 'Rautio', 20, 'F', 88, 29, 89, 50, 50, 820000, 5),
('2bd3a09d-01ac-4770-a8de-bb27731e2113', '8c26f56f-6d17-4a54-8b1d-097b293e1126', 'Lauri', 'Tamayo', 96, 'F', 87, 24, 91, 50, 50, 760000, 4),
('4894c434-9930-46ad-b8e3-10544c2fc769', '8c26f56f-6d17-4a54-8b1d-097b293e1126', 'Rune', 'Saarinen', 97, 'F', 86, 21, 95, 50, 50, 420000, 4),
('eb1972f7-fa12-4d00-b561-798ed70bfde0', '39d58b9c-37a7-4a4a-8bff-c4e48a7165f2', 'Leandro', 'Belmonte', 48, 'G', 90, 20, 100, 50, 50, 570000, 1),
('f72ae850-5f82-45ee-a751-6045aa61a095', '39d58b9c-37a7-4a4a-8bff-c4e48a7165f2', 'Cedric', 'Pellerin', 1, 'G', 79, 27, 80, 50, 50, 410000, 5),
('c61e1a77-cd32-46ca-9687-06a5f706ee3e', '39d58b9c-37a7-4a4a-8bff-c4e48a7165f2', 'Sebastián', 'Vikström', 8, 'D', 95, 20, 100, 50, 50, 810000, 3),
('07a1e94a-c0fa-402c-9e10-d1ab9ec02162', '39d58b9c-37a7-4a4a-8bff-c4e48a7165f2', 'Casimir', 'Echeverri', 68, 'D', 94, 26, 96, 50, 50, 1260000, 5),
('4bc5815f-630c-436e-9816-f2d4e55c9e3e', '39d58b9c-37a7-4a4a-8bff-c4e48a7165f2', 'Valtteri', 'Jansky', 29, 'D', 92, 32, 93, 50, 50, 1090000, 3),
('ac9d5580-5b09-4c7f-82b4-626fb188018c', '39d58b9c-37a7-4a4a-8bff-c4e48a7165f2', 'Fabián', 'Rautio', 71, 'D', 91, 22, 95, 50, 50, 1020000, 1),
('c56a3030-0916-4b72-b242-c23be9088eb9', '39d58b9c-37a7-4a4a-8bff-c4e48a7165f2', 'Benicio', 'Zapatero', 12, 'D', 89, 28, 89, 50, 50, 880000, 5),
('7ddd6fed-b478-4045-ad1c-9609b23bad0a', '39d58b9c-37a7-4a4a-8bff-c4e48a7165f2', 'Ivo', 'Galindo', 70, 'D', 88, 34, 89, 50, 50, 700000, 2),
('2c7aa9ab-75b7-4235-888d-901fda568410', '39d58b9c-37a7-4a4a-8bff-c4e48a7165f2', 'Cedric', 'Gallardo', 86, 'F', 97, 23, 100, 50, 50, 1530000, 5),
('66ee9ea0-b841-427c-9e61-e5c41ae9cc15', '39d58b9c-37a7-4a4a-8bff-c4e48a7165f2', 'Gustavo', 'Halvorsen', 11, 'F', 96, 33, 98, 50, 50, 1220000, 3),
('b5c095eb-84e4-471c-9fac-6f3d8985ea94', '39d58b9c-37a7-4a4a-8bff-c4e48a7165f2', 'Gael', 'Arriaga', 26, 'F', 95, 25, 97, 50, 50, 1340000, 3),
('8d404133-d034-4c09-8d77-cd830a90a22d', '39d58b9c-37a7-4a4a-8bff-c4e48a7165f2', 'Rasmus', 'Quiroga', 95, 'F', 94, 27, 94, 50, 50, 1260000, 3),
('501e307c-4161-4dad-b166-10e223b733d9', '39d58b9c-37a7-4a4a-8bff-c4e48a7165f2', 'Ilan', 'Westerlund', 55, 'F', 93, 28, 94, 50, 50, 1170000, 4),
('dd243362-3609-4aa2-8470-d2a98ddab3b7', '39d58b9c-37a7-4a4a-8bff-c4e48a7165f2', 'Elio', 'Lindahl', 7, 'F', 92, 26, 93, 50, 50, 1090000, 5),
('d4909f30-4231-4bbd-95a5-f63812a13047', '39d58b9c-37a7-4a4a-8bff-c4e48a7165f2', 'Leandro', 'Jurado', 46, 'F', 90, 30, 90, 50, 50, 950000, 5),
('a4fbae0d-8ff0-4fba-b45a-2a47d9a5bdb6', '39d58b9c-37a7-4a4a-8bff-c4e48a7165f2', 'Damián', 'Brandt', 85, 'F', 90, 26, 90, 50, 50, 950000, 3),
('db018121-783c-465d-976b-357300aac8e9', '39d58b9c-37a7-4a4a-8bff-c4e48a7165f2', 'Dagur', 'Pellerin', 5, 'F', 89, 33, 89, 50, 50, 750000, 5),
('81fa4f57-3a07-4aa0-9290-ab8df0cd492c', '39d58b9c-37a7-4a4a-8bff-c4e48a7165f2', 'Lenny', 'Valdivia', 39, 'F', 88, 28, 90, 50, 50, 820000, 4),
('db4156c5-463c-4ec8-85d1-e1f999fd69c6', '39d58b9c-37a7-4a4a-8bff-c4e48a7165f2', 'Yago', 'Corvalán', 34, 'F', 87, 22, 95, 50, 50, 760000, 1),
('d90e9743-21c1-4030-a248-384834850d05', '39d58b9c-37a7-4a4a-8bff-c4e48a7165f2', 'Hakon', 'Kallio', 83, 'F', 86, 22, 94, 50, 50, 710000, 1),
('e5bc3553-51f5-446b-9e30-9f9a14ae95d0', '3ad3f472-bbd9-4b96-943f-a29f58eec741', 'Oskar', 'Zamora', 56, 'G', 92, 31, 94, 50, 50, 1090000, 4),
('3db46604-1658-47b3-abc6-23baf402d7ad', '3ad3f472-bbd9-4b96-943f-a29f58eec741', 'Lenny', 'Holmqvist', 20, 'G', 80, 30, 81, 50, 50, 440000, 3),
('6210ace7-429c-4f39-8889-9a30733dcc31', '3ad3f472-bbd9-4b96-943f-a29f58eec741', 'Hugo', 'Hidalgo', 60, 'D', 96, 24, 100, 50, 50, 1440000, 4),
('d2d7f8c3-c07f-4377-b9a9-317ec4f8bdc3', '3ad3f472-bbd9-4b96-943f-a29f58eec741', 'Caio', 'Iturbe', 33, 'D', 95, 31, 96, 50, 50, 1340000, 4),
('bb49ef36-9346-49ed-980d-ba2e58580bde', '3ad3f472-bbd9-4b96-943f-a29f58eec741', 'Anders', 'Vallejo', 41, 'D', 93, 23, 98, 50, 50, 1170000, 1),
('af4c3374-8e1a-4610-b81d-6b7733fbf89a', '3ad3f472-bbd9-4b96-943f-a29f58eec741', 'Hakon', 'Duarte', 74, 'D', 92, 26, 92, 50, 50, 1090000, 2),
('162a525c-65c6-4e02-9b29-babc282c45f1', '3ad3f472-bbd9-4b96-943f-a29f58eec741', 'Ciro', 'Fjeldstad', 64, 'D', 90, 30, 92, 50, 50, 950000, 1),
('a85a60ae-3e60-4167-a44f-2244f89d592a', '3ad3f472-bbd9-4b96-943f-a29f58eec741', 'Lucas', 'Montalvo', 78, 'D', 89, 25, 92, 50, 50, 880000, 3),
('a634f938-fbe4-424e-b49c-7411610b6373', '3ad3f472-bbd9-4b96-943f-a29f58eec741', 'Kasper', 'Wahlgren', 25, 'F', 97, 26, 98, 50, 50, 1530000, 2),
('6b06093b-f9e4-4171-a084-885509e968fe', '3ad3f472-bbd9-4b96-943f-a29f58eec741', 'Olaf', 'Abarca', 71, 'F', 96, 25, 98, 50, 50, 1440000, 3),
('e058bdfd-e2b8-4814-803c-e8836c4521bd', '3ad3f472-bbd9-4b96-943f-a29f58eec741', 'Teo', 'Valdivia', 34, 'F', 95, 34, 95, 50, 50, 1140000, 4),
('42360cf1-b19d-47c5-bc87-1e62e6a9798e', '3ad3f472-bbd9-4b96-943f-a29f58eec741', 'Santino', 'Kovář', 86, 'F', 94, 19, 100, 50, 50, 750000, 5),
('5f3f918d-ff06-4361-b740-1bfb6a406872', '3ad3f472-bbd9-4b96-943f-a29f58eec741', 'Matías', 'Duarte', 51, 'F', 93, 30, 94, 50, 50, 1170000, 5),
('06aaf204-618a-4594-baff-4a604be2b2bd', '3ad3f472-bbd9-4b96-943f-a29f58eec741', 'Samuel', 'Riquelme', 38, 'F', 92, 24, 95, 50, 50, 1090000, 2),
('618d7807-54b7-4cd9-bab8-d438bfff7507', '3ad3f472-bbd9-4b96-943f-a29f58eec741', 'Hakon', 'Salazar', 19, 'F', 90, 24, 94, 50, 50, 950000, 2),
('688979b7-ca93-4e9b-8789-a0d14589b0f2', '3ad3f472-bbd9-4b96-943f-a29f58eec741', 'Silas', 'Kovář', 85, 'F', 90, 22, 95, 50, 50, 950000, 4),
('8fa8bfed-e383-4a6d-acc7-58b81bd46621', '3ad3f472-bbd9-4b96-943f-a29f58eec741', 'Tobías', 'Brandt', 40, 'F', 89, 25, 91, 50, 50, 880000, 4),
('be88459e-a55f-43d5-a33e-a02facb15e21', '3ad3f472-bbd9-4b96-943f-a29f58eec741', 'Nikolai', 'Carvajal', 87, 'F', 88, 26, 88, 50, 50, 820000, 4),
('72f637d4-d59b-4b18-bf3f-f2f8324d2bf6', '3ad3f472-bbd9-4b96-943f-a29f58eec741', 'Fausto', 'Montalvo', 66, 'F', 87, 27, 89, 50, 50, 760000, 5),
('c48c520a-f9b4-4bae-b991-269adcb8497e', '3ad3f472-bbd9-4b96-943f-a29f58eec741', 'Teo', 'Zelenka', 8, 'F', 86, 27, 88, 50, 50, 710000, 2),
('139e31a6-0ada-4115-86bc-0e025974d4be', 'd1e889e1-4405-4986-a8be-a9728da62a1b', 'Vicente', 'Castellví', 23, 'G', 95, 22, 100, 50, 50, 1340000, 1),
('4ab9ca42-9beb-4f3e-a5b0-6434988f85c3', 'd1e889e1-4405-4986-a8be-a9728da62a1b', 'Otto', 'Toivonen', 71, 'G', 85, 26, 86, 50, 50, 650000, 3),
('4957210c-cd15-4c12-b492-896babb5e292', 'd1e889e1-4405-4986-a8be-a9728da62a1b', 'Noel', 'Ferrán', 69, 'D', 94, 29, 96, 50, 50, 1260000, 5),
('40832889-fb36-49a7-89ae-f70411bab3b5', 'd1e889e1-4405-4986-a8be-a9728da62a1b', 'Oskar', 'Galindo', 85, 'D', 93, 23, 97, 50, 50, 1170000, 3),
('a658db12-8cbc-4fd4-bc9d-2c2254ad6853', 'd1e889e1-4405-4986-a8be-a9728da62a1b', 'Valtteri', 'Rautio', 43, 'D', 91, 28, 92, 50, 50, 1020000, 4),
('90b61408-da3c-49dc-adeb-688a76d874f0', 'd1e889e1-4405-4986-a8be-a9728da62a1b', 'Vicente', 'Corvalán', 54, 'D', 90, 26, 90, 50, 50, 950000, 4),
('8c27ca1c-d220-446c-a585-6eb84130e491', 'd1e889e1-4405-4986-a8be-a9728da62a1b', 'Felix', 'Bramante', 73, 'D', 88, 29, 88, 50, 50, 820000, 4),
('3ea4a683-b9a7-494b-923c-18a32f06729d', 'd1e889e1-4405-4986-a8be-a9728da62a1b', 'Renzo', 'Dahlberg', 55, 'D', 87, 29, 87, 50, 50, 760000, 3),
('3790a27d-9ba6-4e5c-8ced-2491500b6785', 'd1e889e1-4405-4986-a8be-a9728da62a1b', 'Rune', 'Wahlgren', 35, 'F', 97, 30, 99, 50, 50, 1530000, 5),
('db10201c-7036-42ce-b07c-f024383d0c37', 'd1e889e1-4405-4986-a8be-a9728da62a1b', 'Nikolai', 'Escalante', 70, 'F', 96, 27, 97, 50, 50, 1440000, 5),
('cb2d03bf-af04-4227-90ec-29b009b198cb', 'd1e889e1-4405-4986-a8be-a9728da62a1b', 'Vicente', 'Kallio', 74, 'F', 95, 22, 100, 50, 50, 1340000, 2),
('a5ecc15b-2102-44f0-ba01-9f59f5a83b65', 'd1e889e1-4405-4986-a8be-a9728da62a1b', 'Emil', 'Karlsen', 41, 'F', 94, 30, 95, 50, 50, 1260000, 5),
('726a93a3-4033-40e9-8e73-737dfcd44b07', 'd1e889e1-4405-4986-a8be-a9728da62a1b', 'Alvar', 'Echeverri', 68, 'F', 93, 27, 94, 50, 50, 1170000, 2),
('051b79c6-beca-4c6c-a841-f1d768b47b60', 'd1e889e1-4405-4986-a8be-a9728da62a1b', 'Lisandro', 'Holmqvist', 27, 'F', 92, 23, 95, 50, 50, 1090000, 1),
('354a3e8c-389d-4f21-8943-de2bc9f6d850', 'd1e889e1-4405-4986-a8be-a9728da62a1b', 'Matías', 'Castellví', 94, 'F', 91, 23, 95, 50, 50, 1020000, 1),
('0fbe7c8a-3f4c-400d-8389-8530ae956653', 'd1e889e1-4405-4986-a8be-a9728da62a1b', 'Zoltan', 'Toivonen', 98, 'F', 90, 22, 97, 50, 50, 950000, 1),
('ffdda05c-0ead-46d2-a70e-e3a61ee1ee4d', 'd1e889e1-4405-4986-a8be-a9728da62a1b', 'Quentin', 'Lagarde', 9, 'F', 89, 24, 94, 50, 50, 880000, 4),
('794b2fbf-4a7b-4ed1-8f62-6c7c18ef0f7d', 'd1e889e1-4405-4986-a8be-a9728da62a1b', 'Ilan', 'Olmedo', 50, 'F', 87, 30, 88, 50, 50, 760000, 4),
('df276818-c1e2-4609-bf9d-bbd021a5b1bc', 'd1e889e1-4405-4986-a8be-a9728da62a1b', 'Matías', 'Sundqvist', 65, 'F', 87, 33, 89, 50, 50, 650000, 4),
('f67f0b4a-6b8f-4a78-a921-c97ef67cf887', 'd1e889e1-4405-4986-a8be-a9728da62a1b', 'Lauri', 'Salazar', 86, 'F', 86, 24, 90, 50, 50, 710000, 5),
('9bfc3a51-3703-4116-850a-cae24547a158', 'd8194b46-f35a-4031-9d7d-7f6eeaab838c', 'Adrián', 'Renteria', 71, 'G', 92, 31, 94, 50, 50, 1090000, 2),
('ef8fd277-174f-4d7b-8956-2a1ceb1424d9', 'd8194b46-f35a-4031-9d7d-7f6eeaab838c', 'Pavel', 'Calderas', 93, 'G', 79, 29, 79, 50, 50, 410000, 3),
('78e4de92-a637-45f7-83a7-08eac4891ee7', 'd8194b46-f35a-4031-9d7d-7f6eeaab838c', 'Pablo', 'Jurado', 95, 'D', 96, 22, 100, 50, 50, 1440000, 2),
('5f09c363-9aae-48dc-891f-7caf795797d9', 'd8194b46-f35a-4031-9d7d-7f6eeaab838c', 'Ciro', 'Echeverri', 72, 'D', 95, 29, 96, 50, 50, 1340000, 4),
('487a5edf-44d8-4866-be20-c3669bea8343', 'd8194b46-f35a-4031-9d7d-7f6eeaab838c', 'Pavel', 'Valdivia', 70, 'D', 93, 27, 93, 50, 50, 1170000, 3),
('6914d5bb-6df4-48fb-8922-408fa7f7fa79', 'd8194b46-f35a-4031-9d7d-7f6eeaab838c', 'Enzo', 'Halvorsen', 90, 'D', 92, 32, 93, 50, 50, 1090000, 2),
('96edf80d-7328-45f8-acbc-51acc2b03ed8', 'd8194b46-f35a-4031-9d7d-7f6eeaab838c', 'Bruno', 'Belmonte', 47, 'D', 90, 30, 91, 50, 50, 950000, 3),
('4a2bd770-b0f3-4d6b-8d28-e02608d43aaa', 'd8194b46-f35a-4031-9d7d-7f6eeaab838c', 'Thiago', 'Hidalgo', 62, 'D', 89, 26, 90, 50, 50, 880000, 4),
('e16f35e0-fbec-490d-8b28-25064f1ad74d', 'd8194b46-f35a-4031-9d7d-7f6eeaab838c', 'Leandro', 'Ordaz', 28, 'F', 95, 31, 95, 50, 50, 1340000, 5),
('e9541087-2ba8-4695-8c75-4d49ec1209ab', 'd8194b46-f35a-4031-9d7d-7f6eeaab838c', 'Ivo', 'Kallio', 53, 'F', 95, 21, 100, 50, 50, 810000, 1),
('a96c53a5-aafe-4a5c-ae91-342c9229c57c', 'd8194b46-f35a-4031-9d7d-7f6eeaab838c', 'Casimir', 'Iturbe', 80, 'F', 94, 22, 100, 50, 50, 1260000, 4),
('e084cdc2-fc93-4a20-87a5-9dcb49f2b7bd', 'd8194b46-f35a-4031-9d7d-7f6eeaab838c', 'Yannick', 'Haldane', 18, 'F', 93, 24, 95, 50, 50, 1170000, 4),
('8bf560cc-e3ed-4f1f-bf2b-523f8d662dc5', 'd8194b46-f35a-4031-9d7d-7f6eeaab838c', 'Damián', 'Almonte', 61, 'F', 92, 31, 92, 50, 50, 1090000, 5),
('b53b0afe-7c4a-44d1-abac-a34cf8f070dd', 'd8194b46-f35a-4031-9d7d-7f6eeaab838c', 'Andrés', 'Kallio', 59, 'F', 91, 25, 93, 50, 50, 1020000, 4),
('aa931b2e-7f7e-43e7-8ddf-8a9badcb4a99', 'd8194b46-f35a-4031-9d7d-7f6eeaab838c', 'Dorian', 'Arnesen', 16, 'F', 90, 21, 94, 50, 50, 570000, 4),
('27f6ee2b-6509-404a-8c0e-bdad75c0da84', 'd8194b46-f35a-4031-9d7d-7f6eeaab838c', 'Ilan', 'Bergkvist', 25, 'F', 89, 34, 90, 50, 50, 750000, 2),
('674fca75-2266-4147-aaad-9a7db82a91d4', 'd8194b46-f35a-4031-9d7d-7f6eeaab838c', 'Ilan', 'Sundqvist', 91, 'F', 88, 24, 92, 50, 50, 820000, 2),
('77722d40-33c8-4435-8943-7d70c216700a', 'd8194b46-f35a-4031-9d7d-7f6eeaab838c', 'Zoltan', 'Bergkvist', 49, 'F', 87, 22, 92, 50, 50, 760000, 4),
('50d57200-e3d9-4a75-b100-8beca94e2063', 'd8194b46-f35a-4031-9d7d-7f6eeaab838c', 'Casimir', 'Ordaz', 86, 'F', 86, 24, 88, 50, 50, 710000, 2),
('ac3d4a5b-32c8-497c-a6aa-3bc09414bc37', 'd8194b46-f35a-4031-9d7d-7f6eeaab838c', 'Casimir', 'Landeros', 75, 'F', 85, 24, 88, 50, 50, 650000, 5),
('e0e8e0bd-1aaa-418d-9955-c776ccc66833', '5739084e-e631-4394-9af3-28cc642e43bd', 'Arvid', 'Valdivia', 45, 'G', 94, 19, 100, 50, 50, 750000, 3),
('3f9dae93-9e1c-4d01-bb8e-99d952ee09f7', '5739084e-e631-4394-9af3-28cc642e43bd', 'Bastian', 'Galindo', 75, 'G', 82, 25, 85, 50, 50, 520000, 3),
('9f655fde-3b30-48b8-b8d1-56280b4229b0', '5739084e-e631-4394-9af3-28cc642e43bd', 'Thiago', 'Dahlberg', 62, 'D', 95, 27, 97, 50, 50, 1340000, 5),
('28c90883-3494-4437-9f57-16b93bfc2684', '5739084e-e631-4394-9af3-28cc642e43bd', 'Rasmus', 'Norberg', 55, 'D', 94, 25, 95, 50, 50, 1260000, 2),
('697cab5e-8716-49a1-9aa7-b02221c1e078', '5739084e-e631-4394-9af3-28cc642e43bd', 'Lauri', 'Vallejo', 71, 'D', 92, 22, 99, 50, 50, 1090000, 2),
('19326049-ce86-41c5-bf43-76362be04977', '5739084e-e631-4394-9af3-28cc642e43bd', 'Aksel', 'Hidalgo', 30, 'D', 91, 29, 92, 50, 50, 1020000, 1),
('b6fea200-9809-44e1-8e34-7d1615c4ee06', '5739084e-e631-4394-9af3-28cc642e43bd', 'Bastian', 'Ybarra', 65, 'D', 89, 23, 93, 50, 50, 880000, 2),
('def9fd90-0cce-4405-b453-104736298de0', '5739084e-e631-4394-9af3-28cc642e43bd', 'Esteban', 'Lindahl', 96, 'D', 88, 27, 89, 50, 50, 820000, 4),
('c509c570-9a4d-4479-95bd-69d6908914e1', '5739084e-e631-4394-9af3-28cc642e43bd', 'Yannick', 'Granqvist', 4, 'F', 98, 23, 100, 50, 50, 1630000, 1),
('13ddf556-8f38-4fa7-bc88-e98c53e736b0', '5739084e-e631-4394-9af3-28cc642e43bd', 'Zoltan', 'Palacios', 41, 'F', 97, 34, 99, 50, 50, 1300000, 1),
('e6bb161a-66db-4e1b-82b0-562b22543775', '5739084e-e631-4394-9af3-28cc642e43bd', 'Rafael', 'Arnesen', 9, 'F', 96, 23, 99, 50, 50, 1440000, 5),
('f437a07f-0b2a-4283-b244-1e623b31ec1f', '5739084e-e631-4394-9af3-28cc642e43bd', 'Ciro', 'Zamora', 61, 'F', 95, 21, 100, 50, 50, 810000, 4),
('c1043c0c-ea32-4b0d-a99d-6c0f44216300', '5739084e-e631-4394-9af3-28cc642e43bd', 'Lauri', 'Navarrete', 21, 'F', 94, 26, 95, 50, 50, 1260000, 1),
('834edbdc-dfeb-4f96-ac3d-1f413c92e963', '5739084e-e631-4394-9af3-28cc642e43bd', 'Ivo', 'Landeros', 36, 'F', 93, 25, 95, 50, 50, 1170000, 4),
('33f45afa-915b-4648-b9f4-5dda1148e1d3', '5739084e-e631-4394-9af3-28cc642e43bd', 'Zeno', 'Granqvist', 92, 'F', 92, 26, 93, 50, 50, 1090000, 2),
('6ee42f80-72ae-45a8-a8e1-ec4689f54bd0', '5739084e-e631-4394-9af3-28cc642e43bd', 'Milo', 'Lindqvist', 38, 'F', 91, 19, 97, 50, 50, 610000, 5),
('ab9ba24d-8499-4947-8f4e-587107c77166', '5739084e-e631-4394-9af3-28cc642e43bd', 'Quentin', 'Vallejo', 51, 'F', 90, 27, 91, 50, 50, 950000, 3),
('3bd0f7eb-c023-433b-88ad-c2808c4da958', '5739084e-e631-4394-9af3-28cc642e43bd', 'Oskar', 'Abarca', 43, 'F', 89, 25, 92, 50, 50, 880000, 3),
('592a0a31-79f3-4f7c-98ac-91ee419a42ca', '5739084e-e631-4394-9af3-28cc642e43bd', 'Elio', 'Rautio', 34, 'F', 88, 26, 90, 50, 50, 820000, 3),
('c63c7696-dd87-4ae6-9500-9d4e305bc98c', '5739084e-e631-4394-9af3-28cc642e43bd', 'Aldo', 'Vikström', 57, 'F', 87, 27, 89, 50, 50, 760000, 4),
('2a169619-4945-47ef-a5c0-559b9348c6c3', 'ecdc2554-7356-4447-b070-c514585ece0e', 'Dorian', 'Riquelme', 24, 'G', 92, 24, 94, 50, 50, 1090000, 5),
('162937fd-f0c0-4a44-b9dc-3aed1992b802', 'ecdc2554-7356-4447-b070-c514585ece0e', 'Nahuel', 'Palacios', 38, 'G', 80, 19, 87, 50, 50, 260000, 4),
('b9098567-5ea0-47b6-9be5-48b713476a76', 'ecdc2554-7356-4447-b070-c514585ece0e', 'Gael', 'Karlsen', 51, 'D', 96, 27, 96, 50, 50, 1440000, 4),
('2a69a420-0cb8-4d03-8290-c8e6fc215ad6', 'ecdc2554-7356-4447-b070-c514585ece0e', 'Felix', 'Cabrales', 15, 'D', 95, 24, 100, 50, 50, 1340000, 4),
('70a25dd8-71f9-42d4-8b4d-0e89b69386bf', 'ecdc2554-7356-4447-b070-c514585ece0e', 'Andrés', 'Vallejo', 28, 'D', 93, 27, 94, 50, 50, 1170000, 1),
('634fb949-f166-4556-bc07-759460aee06d', 'ecdc2554-7356-4447-b070-c514585ece0e', 'Esteban', 'Almonte', 35, 'D', 92, 22, 100, 50, 50, 1090000, 3),
('2448f9e8-594f-45f3-93f9-2975cd9a076e', 'ecdc2554-7356-4447-b070-c514585ece0e', 'Sebastián', 'Borrego', 52, 'D', 90, 23, 96, 50, 50, 950000, 2),
('a5aef232-d626-4af4-bdea-e126ac2ad9c2', 'ecdc2554-7356-4447-b070-c514585ece0e', 'Aksel', 'Galindo', 85, 'D', 89, 29, 89, 50, 50, 880000, 2),
('003496a1-cbac-4e1d-a5bf-ed294f65d4e4', 'ecdc2554-7356-4447-b070-c514585ece0e', 'Aldo', 'Garmendia', 74, 'F', 98, 22, 100, 50, 50, 1630000, 3),
('238bb801-190d-4b6d-86e8-1cdb492da0b1', 'ecdc2554-7356-4447-b070-c514585ece0e', 'Santino', 'Gallardo', 14, 'F', 97, 23, 100, 50, 50, 1530000, 1),
('4218cde3-73c1-491e-97c4-fec935bde5bd', 'ecdc2554-7356-4447-b070-c514585ece0e', 'Lauri', 'Granqvist', 42, 'F', 96, 28, 97, 50, 50, 1440000, 2),
('f2af2138-03e5-4c8d-84f1-cbaba9aa968f', 'ecdc2554-7356-4447-b070-c514585ece0e', 'Olaf', 'Kallio', 62, 'F', 94, 22, 97, 50, 50, 1260000, 2),
('5e1fc3d2-cc9e-4ea5-ab86-67897b4169ef', 'ecdc2554-7356-4447-b070-c514585ece0e', 'Fausto', 'Hidalgo', 33, 'F', 94, 28, 95, 50, 50, 1260000, 2),
('daa87f1c-8f69-4505-a0ab-25f885c14365', 'ecdc2554-7356-4447-b070-c514585ece0e', 'Aldo', 'Haldane', 45, 'F', 93, 29, 93, 50, 50, 1170000, 4),
('68107cfc-bfa0-4ee9-a8cf-ae03351e379d', 'ecdc2554-7356-4447-b070-c514585ece0e', 'Cedric', 'Karlsen', 58, 'F', 92, 28, 93, 50, 50, 1090000, 2),
('4ed674e0-075e-43a5-8d50-1c39edab1411', 'ecdc2554-7356-4447-b070-c514585ece0e', 'Rune', 'Haldane', 86, 'F', 91, 27, 93, 50, 50, 1020000, 2),
('f5024ef7-97ba-41ed-8d44-a3fdb2f5b4bc', 'ecdc2554-7356-4447-b070-c514585ece0e', 'Lauri', 'Escalante', 23, 'F', 90, 24, 94, 50, 50, 950000, 1),
('7e1725e2-04a0-40c3-95c5-22d9f6c4aae0', 'ecdc2554-7356-4447-b070-c514585ece0e', 'Ivo', 'Bramante', 21, 'F', 89, 26, 90, 50, 50, 880000, 1),
('d719d012-61b3-4cec-a1bd-336a5fff915a', 'ecdc2554-7356-4447-b070-c514585ece0e', 'Milo', 'Borrego', 88, 'F', 88, 23, 91, 50, 50, 820000, 5),
('bccfbc09-7e46-45de-b5f6-a1ca30b31174', 'ecdc2554-7356-4447-b070-c514585ece0e', 'Mattis', 'Cabrales', 37, 'F', 88, 26, 89, 50, 50, 820000, 2),
('afc74e41-6738-43c0-b8cf-4a95abacc631', '430b152c-a4a7-41ea-b0f3-050e6c005ebb', 'Elio', 'Quiroga', 46, 'G', 95, 31, 97, 50, 50, 1340000, 3),
('49a2e63f-a2a3-497b-bb17-5a8ab5f5e134', '430b152c-a4a7-41ea-b0f3-050e6c005ebb', 'Gustavo', 'Kallio', 8, 'G', 80, 28, 80, 50, 50, 440000, 2),
('0470bb8a-39f6-42a0-81e7-946e4b1650a3', '430b152c-a4a7-41ea-b0f3-050e6c005ebb', 'Jonas', 'Báthory', 5, 'D', 93, 20, 97, 50, 50, 700000, 5),
('b933a9fd-9c30-4462-bf0f-6bd08bab06c3', '430b152c-a4a7-41ea-b0f3-050e6c005ebb', 'Casimir', 'Arriaga', 98, 'D', 92, 27, 93, 50, 50, 1090000, 3),
('c9aeefa6-898d-48f5-beb7-affaf6b5e3dd', '430b152c-a4a7-41ea-b0f3-050e6c005ebb', 'Alvar', 'Palacios', 87, 'D', 90, 25, 91, 50, 50, 950000, 4),
('4b79168b-b541-45ff-8de8-dc93190ada66', '430b152c-a4a7-41ea-b0f3-050e6c005ebb', 'Julián', 'Echeverri', 12, 'D', 89, 29, 90, 50, 50, 880000, 4),
('b1fdf570-c99f-44cd-9055-eca8fbaa2f3c', '430b152c-a4a7-41ea-b0f3-050e6c005ebb', 'Pavel', 'Montalvo', 65, 'D', 87, 20, 97, 50, 50, 460000, 3),
('a96d9b0a-03c8-4135-8d4a-fdd547eb4c27', '430b152c-a4a7-41ea-b0f3-050e6c005ebb', 'Aldo', 'Zelenka', 56, 'D', 86, 28, 86, 50, 50, 710000, 1),
('60ab7c8c-31f2-402c-ad18-9c42b8e3c18c', '430b152c-a4a7-41ea-b0f3-050e6c005ebb', 'Samuel', 'Kovář', 30, 'F', 94, 19, 100, 50, 50, 750000, 5),
('eb72437a-ff64-4ef9-9a11-6289e3f88556', '430b152c-a4a7-41ea-b0f3-050e6c005ebb', 'Esteban', 'Valdivia', 39, 'F', 93, 22, 100, 50, 50, 1170000, 2),
('e89e4102-7b6a-496d-acba-8f8df2fb91b1', '430b152c-a4a7-41ea-b0f3-050e6c005ebb', 'Alvar', 'Ostrowski', 44, 'F', 92, 28, 92, 50, 50, 1090000, 4),
('9b3d80b3-b27e-49b5-bb97-00917f4375cd', '430b152c-a4a7-41ea-b0f3-050e6c005ebb', 'Marek', 'Fjeldstad', 84, 'F', 91, 26, 92, 50, 50, 1020000, 3),
('255b5f56-06b9-4cdb-b26c-e3c93ea1737a', '430b152c-a4a7-41ea-b0f3-050e6c005ebb', 'Teo', 'Salazar', 64, 'F', 90, 28, 90, 50, 50, 950000, 2),
('78c21e98-b713-433d-82c5-beb8dfced576', '430b152c-a4a7-41ea-b0f3-050e6c005ebb', 'Ulises', 'Riquelme', 17, 'F', 89, 25, 92, 50, 50, 880000, 1),
('b5f3428a-11fc-4c12-bbb3-af4f3ba5bfd7', '430b152c-a4a7-41ea-b0f3-050e6c005ebb', 'Fabián', 'Escalante', 66, 'F', 88, 22, 97, 50, 50, 820000, 3),
('dc2b1c8a-0c3e-4983-9351-74535bab9b04', '430b152c-a4a7-41ea-b0f3-050e6c005ebb', 'Gustavo', 'Lagarde', 4, 'F', 87, 22, 91, 50, 50, 760000, 3),
('0bc7a315-75f4-443d-9411-0c2d4144463c', '430b152c-a4a7-41ea-b0f3-050e6c005ebb', 'Santino', 'Quiroga', 60, 'F', 86, 26, 88, 50, 50, 710000, 2),
('4c6f92d3-e617-4f63-9600-c3ec2e3ece76', '430b152c-a4a7-41ea-b0f3-050e6c005ebb', 'Leandro', 'Zamora', 18, 'F', 85, 20, 91, 50, 50, 390000, 5),
('a9f558d5-71ee-4f74-9091-d247f6b7c501', '430b152c-a4a7-41ea-b0f3-050e6c005ebb', 'Fabián', 'Lindahl', 11, 'F', 84, 31, 84, 50, 50, 600000, 1),
('b69edd23-020e-47cc-8db4-f56907626ebf', '430b152c-a4a7-41ea-b0f3-050e6c005ebb', 'Hakon', 'Escalante', 58, 'F', 83, 36, 84, 50, 50, 480000, 2),
('76485015-8863-4e38-b436-0ddce9120b5a', '00d080ec-672b-4ca8-a634-156c7bcadc4a', 'Emil', 'Almonte', 60, 'G', 89, 30, 90, 50, 50, 880000, 5),
('ebf939f2-549a-481c-86c4-a5fee61fec4f', '00d080ec-672b-4ca8-a634-156c7bcadc4a', 'Ilan', 'Granqvist', 94, 'G', 79, 29, 80, 50, 50, 410000, 3),
('d1c994a7-bc32-44f6-bfce-83b59596ca1c', '00d080ec-672b-4ca8-a634-156c7bcadc4a', 'Anders', 'Sandoval', 83, 'D', 91, 28, 91, 50, 50, 1020000, 4),
('58525724-1e77-4f6b-b4c6-452b5f0e2040', '00d080ec-672b-4ca8-a634-156c7bcadc4a', 'Jonas', 'Arriaga', 19, 'D', 90, 29, 92, 50, 50, 950000, 2),
('5760e313-66bc-4b57-af5a-dbdb50b61fae', '00d080ec-672b-4ca8-a634-156c7bcadc4a', 'Hugo', 'Lozano', 82, 'D', 88, 19, 100, 50, 50, 490000, 1),
('e6966574-af92-4ac0-8c73-a3aac9e1af95', '00d080ec-672b-4ca8-a634-156c7bcadc4a', 'Enzo', 'Lagarde', 37, 'D', 87, 28, 88, 50, 50, 760000, 4),
('e6d307f0-e4c0-45f7-8708-6b54900e7edb', '00d080ec-672b-4ca8-a634-156c7bcadc4a', 'Amadeo', 'Ordaz', 63, 'D', 85, 28, 86, 50, 50, 650000, 4),
('14a72aab-3977-4a77-bbd9-013a1607a606', '00d080ec-672b-4ca8-a634-156c7bcadc4a', 'Milo', 'Falkner', 29, 'D', 84, 22, 88, 50, 50, 600000, 1),
('ee5ede27-ff8c-452d-88cd-2e9d0d20fe15', '00d080ec-672b-4ca8-a634-156c7bcadc4a', 'Lenny', 'Urquiza', 14, 'F', 97, 25, 98, 50, 50, 1530000, 4),
('2706ef14-a845-4563-a818-7b7747f83dce', '00d080ec-672b-4ca8-a634-156c7bcadc4a', 'Magnus', 'Vikström', 32, 'F', 96, 25, 98, 50, 50, 1440000, 4),
('828505cf-40f9-4fad-ae20-8947e188b448', '00d080ec-672b-4ca8-a634-156c7bcadc4a', 'Santino', 'Nieminen', 96, 'F', 96, 32, 98, 50, 50, 1440000, 4),
('cc2f8cde-d47a-4eac-b95d-3c3be189dec3', '00d080ec-672b-4ca8-a634-156c7bcadc4a', 'Dagur', 'Granqvist', 68, 'F', 94, 26, 96, 50, 50, 1260000, 5),
('9f37be3b-c98d-4410-b539-182aad7aaf0f', '00d080ec-672b-4ca8-a634-156c7bcadc4a', 'Quentin', 'Lindqvist', 41, 'F', 93, 31, 94, 50, 50, 1170000, 3),
('bafbf107-4161-4e05-bbdf-8f367695dc9d', '00d080ec-672b-4ca8-a634-156c7bcadc4a', 'Thiago', 'Duarte', 24, 'F', 92, 24, 95, 50, 50, 1090000, 4),
('393977de-a6a4-4d2b-80d3-06cd91d67b97', '00d080ec-672b-4ca8-a634-156c7bcadc4a', 'Thiago', 'Marklund', 40, 'F', 90, 25, 93, 50, 50, 950000, 5),
('30148dc1-16a2-4168-8188-b5dcf673de50', '00d080ec-672b-4ca8-a634-156c7bcadc4a', 'Alvar', 'Lagarde', 61, 'F', 90, 32, 91, 50, 50, 950000, 1),
('07e09df4-0d73-41f8-a596-6c5daa3bff0f', '00d080ec-672b-4ca8-a634-156c7bcadc4a', 'Ilan', 'Wahlgren', 42, 'F', 89, 26, 90, 50, 50, 880000, 1),
('22a8bf4a-5ce7-4584-85ed-eb671fc596a9', '00d080ec-672b-4ca8-a634-156c7bcadc4a', 'Oskar', 'Ordaz', 38, 'F', 88, 24, 94, 50, 50, 820000, 3),
('b1df1598-7372-4f3d-ba38-07a6bce8f491', '00d080ec-672b-4ca8-a634-156c7bcadc4a', 'Esteban', 'Albrecht', 35, 'F', 87, 24, 90, 50, 50, 760000, 2),
('6e54484a-cf0b-44bb-bf3d-2c87f37cbb7a', '00d080ec-672b-4ca8-a634-156c7bcadc4a', 'Andrés', 'Landeros', 2, 'F', 87, 24, 90, 50, 50, 760000, 3);
insert into players (id, team_id, first_name, last_name, number, position, rating, age, potential, form, morale, salary, contract_years) values
('c195e9a9-aba1-4682-9202-142d436ec075', '47c957f0-e9c3-4647-bbea-7d816b97f3d9', 'Zeno', 'Norberg', 97, 'G', 92, 31, 93, 50, 50, 1090000, 5),
('75b63acd-2516-4841-81c0-af5f4a52fc24', '47c957f0-e9c3-4647-bbea-7d816b97f3d9', 'Andrés', 'Saarinen', 3, 'G', 80, 35, 81, 50, 50, 380000, 2),
('122fff88-1b4b-4f23-add5-7f87f72f6882', '47c957f0-e9c3-4647-bbea-7d816b97f3d9', 'Renzo', 'Abarca', 36, 'D', 94, 30, 94, 50, 50, 1260000, 1),
('acef4c80-b73c-40b2-8944-f4d1a76d2908', '47c957f0-e9c3-4647-bbea-7d816b97f3d9', 'Gael', 'Pellerin', 41, 'D', 93, 27, 93, 50, 50, 1170000, 4),
('391082be-fed8-45ad-91f4-96dac5f38078', '47c957f0-e9c3-4647-bbea-7d816b97f3d9', 'Damián', 'Saarinen', 82, 'D', 91, 24, 93, 50, 50, 1020000, 3),
('6895854c-778e-4431-9c05-ab1f61039004', '47c957f0-e9c3-4647-bbea-7d816b97f3d9', 'Vicente', 'Jansky', 9, 'D', 90, 24, 93, 50, 50, 950000, 2),
('2beaa767-2425-4f9c-b21f-a8722b36baa1', '47c957f0-e9c3-4647-bbea-7d816b97f3d9', 'Santino', 'Báthory', 6, 'D', 88, 25, 91, 50, 50, 820000, 5),
('0f38e3ec-639c-4527-8ba3-d932f5ca14f4', '47c957f0-e9c3-4647-bbea-7d816b97f3d9', 'Noel', 'Kovář', 50, 'D', 87, 28, 89, 50, 50, 760000, 3),
('7dc8ab49-d1d4-4b78-a86d-64a281d6d8f7', '47c957f0-e9c3-4647-bbea-7d816b97f3d9', 'Benicio', 'Bergkvist', 28, 'F', 97, 28, 98, 50, 50, 1530000, 3),
('7ca2ef4d-85bb-49aa-8551-6de539f30daa', '47c957f0-e9c3-4647-bbea-7d816b97f3d9', 'Renzo', 'Lindqvist', 57, 'F', 96, 21, 100, 50, 50, 860000, 5),
('d8b878f3-477e-4df8-90e4-f841a3553374', '47c957f0-e9c3-4647-bbea-7d816b97f3d9', 'Ivo', 'Kovář', 21, 'F', 95, 25, 99, 50, 50, 1340000, 1),
('ed9d95ac-636c-4db7-95d6-392f42dd50eb', '47c957f0-e9c3-4647-bbea-7d816b97f3d9', 'Rasmus', 'Gallardo', 1, 'F', 93, 30, 94, 50, 50, 1170000, 4),
('3cc70d5a-7fa8-409a-8657-f48d2c032a45', '47c957f0-e9c3-4647-bbea-7d816b97f3d9', 'Magnus', 'Echeverri', 60, 'F', 93, 29, 93, 50, 50, 1170000, 3),
('0daa78a2-7f4c-4411-8cf7-3d3c5b86265a', '47c957f0-e9c3-4647-bbea-7d816b97f3d9', 'Esteban', 'Arriaga', 13, 'F', 92, 29, 93, 50, 50, 1090000, 2),
('407111fd-267e-428c-b5f8-343d4c3ffedf', '47c957f0-e9c3-4647-bbea-7d816b97f3d9', 'Arvid', 'Lozano', 27, 'F', 90, 34, 91, 50, 50, 810000, 4),
('81095ef3-3c2d-4115-9289-e4d0344be58b', '47c957f0-e9c3-4647-bbea-7d816b97f3d9', 'Rafael', 'Carvajal', 34, 'F', 90, 27, 90, 50, 50, 950000, 3),
('9952fc25-d9e5-45d9-aff3-d0fa9405755b', '47c957f0-e9c3-4647-bbea-7d816b97f3d9', 'Eero', 'Belmonte', 71, 'F', 90, 27, 91, 50, 50, 950000, 2),
('7a15b235-6413-4abf-9af4-001aa73bec76', '47c957f0-e9c3-4647-bbea-7d816b97f3d9', 'Leandro', 'Tamayo', 30, 'F', 88, 22, 93, 50, 50, 820000, 4),
('26a30ca3-20a6-42ff-a3d8-45e24f7019e7', '47c957f0-e9c3-4647-bbea-7d816b97f3d9', 'Aksel', 'Westerlund', 91, 'F', 87, 28, 89, 50, 50, 760000, 4),
('3e76a511-e992-4a37-a13a-bd9f8b64e6ba', '47c957f0-e9c3-4647-bbea-7d816b97f3d9', 'Teo', 'Sandoval', 52, 'F', 86, 29, 86, 50, 50, 710000, 5),
('52289d8a-ec7c-457d-bd9c-61cb9b7fcb37', 'f28259c3-6c4b-47f1-b129-4609980b5af7', 'Gideon', 'Holmqvist', 55, 'G', 88, 25, 91, 50, 50, 820000, 3),
('0d19a27e-dfcf-408b-a4df-a3a73736b8d1', 'f28259c3-6c4b-47f1-b129-4609980b5af7', 'Oskar', 'Halvorsen', 48, 'G', 76, 31, 76, 50, 50, 320000, 1),
('7e93f161-146c-4778-87c1-b354ae02f26f', 'f28259c3-6c4b-47f1-b129-4609980b5af7', 'Pavel', 'Arnesen', 79, 'D', 91, 25, 94, 50, 50, 1020000, 2),
('ea7e2d48-ca67-46b5-afd4-b6d11d6b3270', 'f28259c3-6c4b-47f1-b129-4609980b5af7', 'Tobías', 'Echeverri', 63, 'D', 90, 25, 92, 50, 50, 950000, 1),
('ce8e844f-b1df-48b0-8be7-442aea1e5bb7', 'f28259c3-6c4b-47f1-b129-4609980b5af7', 'Zeno', 'Corvalán', 68, 'D', 88, 26, 89, 50, 50, 820000, 2),
('e9572ad1-e848-4e5b-826b-ed7b0e3f2649', 'f28259c3-6c4b-47f1-b129-4609980b5af7', 'Adrián', 'Zamora', 37, 'D', 87, 35, 87, 50, 50, 650000, 2),
('98e0798e-d662-4b59-a389-cb2f381734c3', 'f28259c3-6c4b-47f1-b129-4609980b5af7', 'Samuel', 'Lindahl', 76, 'D', 85, 31, 86, 50, 50, 650000, 4),
('5501bad1-ae52-4deb-ab31-46a97f2d37a5', 'f28259c3-6c4b-47f1-b129-4609980b5af7', 'Vicente', 'Lindahl', 80, 'D', 84, 24, 87, 50, 50, 600000, 2),
('5669397e-4035-4ddd-9d05-63e9f51d5862', 'f28259c3-6c4b-47f1-b129-4609980b5af7', 'Yago', 'Falkner', 38, 'F', 97, 35, 98, 50, 50, 1300000, 4),
('ff8db913-130e-472e-a032-5b160b9a8b7a', 'f28259c3-6c4b-47f1-b129-4609980b5af7', 'Dagur', 'Jurado', 1, 'F', 96, 29, 98, 50, 50, 1440000, 5),
('3449611e-7bee-4b54-a40f-6f5d652de5ca', 'f28259c3-6c4b-47f1-b129-4609980b5af7', 'Amadeo', 'Lindqvist', 90, 'F', 95, 30, 97, 50, 50, 1340000, 1),
('02a1b034-728a-407a-92aa-9e8a82a15443', 'f28259c3-6c4b-47f1-b129-4609980b5af7', 'Adrián', 'Hidalgo', 36, 'F', 93, 27, 94, 50, 50, 1170000, 1),
('eb3976e8-4670-49bd-8d42-ae109e20865e', 'f28259c3-6c4b-47f1-b129-4609980b5af7', 'Enzo', 'Quintanar', 41, 'F', 93, 21, 99, 50, 50, 700000, 3),
('c2cebc07-f39b-42d9-98ea-cb0f15b6a75a', 'f28259c3-6c4b-47f1-b129-4609980b5af7', 'Yago', 'Bramante', 95, 'F', 92, 23, 96, 50, 50, 1090000, 3),
('68654788-e222-4917-8eef-af2647ca09b4', 'f28259c3-6c4b-47f1-b129-4609980b5af7', 'Anders', 'Urquiza', 4, 'F', 91, 29, 91, 50, 50, 1020000, 3),
('306bf354-4ff0-4a28-a3ad-43be2dbf5fa0', 'f28259c3-6c4b-47f1-b129-4609980b5af7', 'Santino', 'Duarte', 8, 'F', 90, 25, 92, 50, 50, 950000, 2),
('ebf26c4f-3cdd-40b7-b885-813dfa9e788d', 'f28259c3-6c4b-47f1-b129-4609980b5af7', 'Zoltan', 'Pellerin', 81, 'F', 90, 23, 93, 50, 50, 950000, 3),
('9abfa114-4cf5-4b4b-b99d-ee7c8e6a5827', 'f28259c3-6c4b-47f1-b129-4609980b5af7', 'Zoltan', 'Ordaz', 57, 'F', 88, 24, 93, 50, 50, 820000, 5),
('6d72666e-6639-4b2e-a583-212bd0a3b6b0', 'f28259c3-6c4b-47f1-b129-4609980b5af7', 'Gideon', 'Zelenka', 74, 'F', 87, 29, 88, 50, 50, 760000, 3),
('a6be4812-5eda-4a1d-80d4-688d75cf9a75', 'f28259c3-6c4b-47f1-b129-4609980b5af7', 'Yannick', 'Iturbe', 84, 'F', 86, 25, 89, 50, 50, 710000, 2),
('6a072835-464f-4747-a591-0b94c42e955b', 'e7194683-1269-4e1c-beb0-19a91809954c', 'Kai', 'Bergkvist', 48, 'G', 87, 28, 88, 50, 50, 760000, 1),
('0e9e932c-46a5-4d1e-b40c-3b86c812a219', 'e7194683-1269-4e1c-beb0-19a91809954c', 'Matías', 'Zapatero', 78, 'G', 77, 26, 77, 50, 50, 350000, 5),
('56d5a8a5-6d5f-4f21-88f1-572eb4e052fd', 'e7194683-1269-4e1c-beb0-19a91809954c', 'Vicente', 'Fonteyne', 8, 'D', 90, 27, 92, 50, 50, 950000, 2),
('1dcc13be-5fb1-4d97-8981-b3273a7cd9f1', 'e7194683-1269-4e1c-beb0-19a91809954c', 'Quentin', 'Ybarra', 17, 'D', 89, 29, 90, 50, 50, 880000, 5),
('b50e3c60-d96a-453f-a7e7-1adb14d975df', 'e7194683-1269-4e1c-beb0-19a91809954c', 'Ilan', 'Dahlberg', 24, 'D', 87, 27, 88, 50, 50, 760000, 4),
('aec44919-679a-4851-9355-a06161e33d38', 'e7194683-1269-4e1c-beb0-19a91809954c', 'Ciro', 'Carvajal', 88, 'D', 86, 25, 88, 50, 50, 710000, 2),
('4b8e899c-d582-43e4-9df7-ab0f229d077c', 'e7194683-1269-4e1c-beb0-19a91809954c', 'Mattis', 'Wahlgren', 28, 'D', 84, 32, 85, 50, 50, 600000, 1),
('1e2ca694-afa3-4ada-a376-c401a4379b82', 'e7194683-1269-4e1c-beb0-19a91809954c', 'Viggo', 'Maravilla', 35, 'D', 83, 27, 85, 50, 50, 560000, 5),
('6cea0fee-fef6-48b1-b2a0-e48f6518b796', 'e7194683-1269-4e1c-beb0-19a91809954c', 'Bastian', 'Borrego', 47, 'F', 100, 28, 100, 50, 50, 1850000, 4),
('ce52e565-4e37-4431-9c6f-408510c8684a', 'e7194683-1269-4e1c-beb0-19a91809954c', 'Amadeo', 'Abarca', 71, 'F', 100, 28, 100, 50, 50, 1850000, 1),
('c1382063-ffae-40ff-974b-764613818036', 'e7194683-1269-4e1c-beb0-19a91809954c', 'Benicio', 'Ybarra', 86, 'F', 99, 29, 99, 50, 50, 1740000, 3),
('b85e6ac8-31b6-4e28-b069-f3494c9b6938', 'e7194683-1269-4e1c-beb0-19a91809954c', 'Dagur', 'Escalante', 6, 'F', 98, 30, 99, 50, 50, 1630000, 4),
('40feb288-013a-49ed-a759-9bda690ad74e', 'e7194683-1269-4e1c-beb0-19a91809954c', 'Jaakko', 'Báthory', 20, 'F', 97, 30, 97, 50, 50, 1530000, 2),
('6acd6be2-790a-43ac-a80e-bfbb3f6347c8', 'e7194683-1269-4e1c-beb0-19a91809954c', 'Rodrigo', 'Karlsen', 80, 'F', 97, 27, 98, 50, 50, 1530000, 1),
('2f90ddcb-a19a-4f9b-88d3-48dd7bbc105a', 'e7194683-1269-4e1c-beb0-19a91809954c', 'Rasmus', 'Bramante', 74, 'F', 95, 26, 96, 50, 50, 1340000, 4),
('9b7e0204-d8ac-4dab-bdb7-1f238bb60208', 'e7194683-1269-4e1c-beb0-19a91809954c', 'Yannick', 'Echeverri', 26, 'F', 94, 21, 99, 50, 50, 750000, 3),
('2792b4cb-119e-46e1-bc53-71c4d92c387f', 'e7194683-1269-4e1c-beb0-19a91809954c', 'Matías', 'Villaseñor', 38, 'F', 94, 33, 95, 50, 50, 1070000, 3),
('7a9efe8f-6189-4cf3-aa3b-72a8450e7584', 'e7194683-1269-4e1c-beb0-19a91809954c', 'Julián', 'Zelenka', 44, 'F', 92, 25, 95, 50, 50, 1090000, 2),
('079f4c16-29cc-4a23-af6f-aff9a5616295', 'e7194683-1269-4e1c-beb0-19a91809954c', 'Eero', 'Nieminen', 65, 'F', 91, 30, 92, 50, 50, 1020000, 4),
('c4d305a9-9b1e-4e27-b018-129e00f11248', 'e7194683-1269-4e1c-beb0-19a91809954c', 'Lenny', 'Fonteyne', 58, 'F', 90, 30, 91, 50, 50, 950000, 3),
('8735c19e-de66-4583-b249-57d8141b2864', 'a9e905a3-45e0-477d-a805-d5fb32fb7db1', 'Sven', 'Tamayo', 25, 'G', 89, 27, 90, 50, 50, 880000, 4),
('1ea53052-98ff-4e24-ba31-04e351dc6820', 'a9e905a3-45e0-477d-a805-d5fb32fb7db1', 'Alvar', 'Westerlund', 80, 'G', 77, 33, 77, 50, 50, 300000, 2),
('476e22bd-3fd6-4de1-954f-2252d25fd11f', 'a9e905a3-45e0-477d-a805-d5fb32fb7db1', 'Silas', 'Echeverri', 12, 'D', 99, 30, 100, 50, 50, 1740000, 3),
('a7b8fe9e-e70a-4281-bc0e-3f355c55cc43', 'a9e905a3-45e0-477d-a805-d5fb32fb7db1', 'Magnus', 'Jurado', 50, 'D', 98, 30, 100, 50, 50, 1630000, 5),
('2a016436-01d8-4700-bcc9-3f953bcc5994', 'a9e905a3-45e0-477d-a805-d5fb32fb7db1', 'Oskar', 'Kovář', 66, 'D', 96, 26, 97, 50, 50, 1440000, 5),
('9da5d136-a69f-4e65-8ae6-b433eeb390f6', 'a9e905a3-45e0-477d-a805-d5fb32fb7db1', 'Thiago', 'Wahlgren', 97, 'D', 95, 19, 100, 50, 50, 810000, 4),
('3e97182c-2bd8-4ddd-89c3-4289acb71720', 'a9e905a3-45e0-477d-a805-d5fb32fb7db1', 'Mattis', 'Vasquez', 76, 'D', 93, 31, 94, 50, 50, 1170000, 2),
('07d6a0b6-9475-4376-ad1d-bcc5e67f1fda', 'a9e905a3-45e0-477d-a805-d5fb32fb7db1', 'Rafael', 'Villaseñor', 82, 'D', 92, 36, 93, 50, 50, 930000, 4),
('57aa7b7c-e2c6-4ae6-ae43-d24f5ca8dc28', 'a9e905a3-45e0-477d-a805-d5fb32fb7db1', 'Anders', 'Renteria', 17, 'F', 94, 24, 96, 50, 50, 1260000, 2),
('a57f12e1-2870-4fe8-9fad-8b5dbd07fd16', 'a9e905a3-45e0-477d-a805-d5fb32fb7db1', 'Jonas', 'Bramante', 93, 'F', 93, 28, 94, 50, 50, 1170000, 4),
('551a72bf-cfee-43ef-b82e-22f3e2631bd7', 'a9e905a3-45e0-477d-a805-d5fb32fb7db1', 'Rasmus', 'Lindahl', 52, 'F', 92, 28, 94, 50, 50, 1090000, 5),
('8181d78d-581a-4251-bc54-b0aada30269d', 'a9e905a3-45e0-477d-a805-d5fb32fb7db1', 'Zoltan', 'Gallardo', 89, 'F', 91, 23, 94, 50, 50, 1020000, 4),
('26c3acb6-cd58-4355-819f-3748164375a0', 'a9e905a3-45e0-477d-a805-d5fb32fb7db1', 'Thiago', 'Vasquez', 1, 'F', 90, 24, 95, 50, 50, 950000, 2),
('99d55fa3-85bc-4d28-af75-978b12f5a5bc', 'a9e905a3-45e0-477d-a805-d5fb32fb7db1', 'Ulises', 'Holmqvist', 85, 'F', 89, 28, 90, 50, 50, 880000, 4),
('2c535908-03e9-49e3-9c04-44f3a6f74717', 'a9e905a3-45e0-477d-a805-d5fb32fb7db1', 'Renzo', 'Saarinen', 15, 'F', 88, 26, 90, 50, 50, 820000, 1),
('34734116-3e19-41fc-9ad3-fbf3311ce1bd', 'a9e905a3-45e0-477d-a805-d5fb32fb7db1', 'Nikolai', 'Sundqvist', 37, 'F', 87, 21, 93, 50, 50, 460000, 4),
('1b518dc8-c00c-4a94-85e4-8531782895fe', 'a9e905a3-45e0-477d-a805-d5fb32fb7db1', 'Casimir', 'Halvorsen', 4, 'F', 86, 27, 87, 50, 50, 710000, 5),
('a7e77cf5-2d6a-48ff-888b-21c5019b4f0f', 'a9e905a3-45e0-477d-a805-d5fb32fb7db1', 'Lucas', 'Fjeldstad', 44, 'F', 85, 28, 85, 50, 50, 650000, 5),
('5eafd062-8d90-478f-a5ec-12508ffb0b3b', 'a9e905a3-45e0-477d-a805-d5fb32fb7db1', 'Amadeo', 'Castellví', 31, 'F', 84, 29, 85, 50, 50, 600000, 2),
('b18b2b77-c0e1-4b13-90f9-927dfb4b8ff6', 'a9e905a3-45e0-477d-a805-d5fb32fb7db1', 'Tobías', 'Holmqvist', 61, 'F', 83, 31, 84, 50, 50, 560000, 4),
('9c222027-ad46-46b9-a1e6-dbd1c1fd6093', 'fdcd04d7-7ae9-4ee6-8f61-59d5d517eaa3', 'Matías', 'Lindqvist', 82, 'G', 90, 27, 91, 50, 50, 950000, 5),
('978e9bdf-efb2-40a1-9c37-be500645658c', 'fdcd04d7-7ae9-4ee6-8f61-59d5d517eaa3', 'Fausto', 'Lozano', 22, 'G', 76, 31, 77, 50, 50, 320000, 3),
('959b4fe3-4e34-4db4-8452-3b13a7f51de8', 'fdcd04d7-7ae9-4ee6-8f61-59d5d517eaa3', 'Tadeo', 'Echeverri', 31, 'D', 86, 23, 90, 50, 50, 710000, 5),
('cf2dafee-6bc8-4403-b4ba-055109214719', 'fdcd04d7-7ae9-4ee6-8f61-59d5d517eaa3', 'Felix', 'Montalvo', 79, 'D', 85, 29, 85, 50, 50, 650000, 1),
('626eb4b0-cc9e-4c19-8858-d52580403a24', 'fdcd04d7-7ae9-4ee6-8f61-59d5d517eaa3', 'Rafael', 'Salazar', 1, 'D', 83, 30, 83, 50, 50, 560000, 1),
('40db2f53-090c-4c3d-a3e8-c346687bed34', 'fdcd04d7-7ae9-4ee6-8f61-59d5d517eaa3', 'Magnus', 'Arnesen', 37, 'D', 82, 30, 83, 50, 50, 520000, 3),
('1d2090e0-1554-46d6-9ef3-41ee44528a24', 'fdcd04d7-7ae9-4ee6-8f61-59d5d517eaa3', 'Gideon', 'Lagarde', 83, 'D', 80, 26, 81, 50, 50, 440000, 2),
('1453e893-5543-4605-a995-c48f1dbbb30a', 'fdcd04d7-7ae9-4ee6-8f61-59d5d517eaa3', 'Thiago', 'Lindahl', 86, 'D', 79, 24, 82, 50, 50, 410000, 3),
('49114fe5-8332-4600-902a-58e8ccdae34a', 'fdcd04d7-7ae9-4ee6-8f61-59d5d517eaa3', 'Oskar', 'Hidalgo', 33, 'F', 94, 30, 95, 50, 50, 1260000, 4),
('6c0bfbc9-7a5c-426f-b0cd-84d3aa174434', 'fdcd04d7-7ae9-4ee6-8f61-59d5d517eaa3', 'Hugo', 'Halvorsen', 81, 'F', 93, 23, 97, 50, 50, 1170000, 1),
('5a32e903-024a-4773-bac4-494243687b9a', 'fdcd04d7-7ae9-4ee6-8f61-59d5d517eaa3', 'Hakon', 'Lindqvist', 42, 'F', 92, 21, 98, 50, 50, 660000, 2),
('1d701da5-fdc8-4ba8-ae6b-83ec69bc8d0d', 'fdcd04d7-7ae9-4ee6-8f61-59d5d517eaa3', 'Magnus', 'Landeros', 24, 'F', 91, 29, 93, 50, 50, 1020000, 5),
('33460e08-8ea8-47a4-a755-6941b7b72048', 'fdcd04d7-7ae9-4ee6-8f61-59d5d517eaa3', 'Fausto', 'Navarrete', 80, 'F', 90, 25, 92, 50, 50, 950000, 5),
('ede71341-9924-4433-af52-b7e391774e72', 'fdcd04d7-7ae9-4ee6-8f61-59d5d517eaa3', 'Quentin', 'Borrego', 39, 'F', 89, 19, 94, 50, 50, 530000, 2),
('d50278b9-ce82-407b-b944-474f5f8900fe', 'fdcd04d7-7ae9-4ee6-8f61-59d5d517eaa3', 'Benicio', 'Jurado', 19, 'F', 88, 26, 90, 50, 50, 820000, 5),
('6b5baadd-c6b5-461e-891c-aa7e13ebeac6', 'fdcd04d7-7ae9-4ee6-8f61-59d5d517eaa3', 'Esteban', 'Escalante', 74, 'F', 87, 21, 93, 50, 50, 460000, 1),
('dea541c0-3d3c-46eb-888c-3d9c506e072b', 'fdcd04d7-7ae9-4ee6-8f61-59d5d517eaa3', 'Mattis', 'Ferrán', 44, 'F', 86, 31, 87, 50, 50, 710000, 5),
('dc57e1f6-9a0e-4faf-934d-097da0e343f4', 'fdcd04d7-7ae9-4ee6-8f61-59d5d517eaa3', 'Silas', 'Quiroga', 98, 'F', 84, 26, 85, 50, 50, 600000, 5),
('4625cf9b-6e5f-46ad-8203-ee4c2b36b448', 'fdcd04d7-7ae9-4ee6-8f61-59d5d517eaa3', 'Lisandro', 'Olmedo', 63, 'F', 84, 32, 84, 50, 50, 600000, 4),
('697489cd-c2aa-4a7b-99ab-b8a56a4bde8d', 'fdcd04d7-7ae9-4ee6-8f61-59d5d517eaa3', 'Cedric', 'Garmendia', 73, 'F', 83, 22, 91, 50, 50, 560000, 1),
('487eba6f-21e7-40c7-bb98-6ef02b8045b9', 'ab65c071-e40a-409c-9c6f-8085d7b8d38e', 'Silas', 'Corvalán', 92, 'G', 86, 22, 89, 50, 50, 710000, 5),
('53bd6ccb-5e55-47b8-b6f5-be8f29a882bb', 'ab65c071-e40a-409c-9c6f-8085d7b8d38e', 'Santino', 'Riquelme', 39, 'G', 71, 27, 72, 50, 50, 230000, 3),
('6cad8adb-4e5c-4fe4-959b-6a3e3fedf84e', 'ab65c071-e40a-409c-9c6f-8085d7b8d38e', 'Aldo', 'Arriaga', 32, 'D', 88, 29, 90, 50, 50, 820000, 4),
('28e77646-4026-4bb7-8c9c-912d337f4efe', 'ab65c071-e40a-409c-9c6f-8085d7b8d38e', 'Felix', 'Kovář', 4, 'D', 87, 29, 87, 50, 50, 760000, 5),
('50b21c3d-0368-4732-8f14-9a2a89a917ac', 'ab65c071-e40a-409c-9c6f-8085d7b8d38e', 'Arvid', 'Cabrales', 88, 'D', 85, 28, 85, 50, 50, 650000, 5),
('99a2ca5e-9096-4330-a6da-62681bf1da58', 'ab65c071-e40a-409c-9c6f-8085d7b8d38e', 'Zeno', 'Rautio', 26, 'D', 84, 25, 86, 50, 50, 600000, 1),
('7a9244fd-6489-4055-ba65-168a4b563cdc', 'ab65c071-e40a-409c-9c6f-8085d7b8d38e', 'Julián', 'Borrego', 73, 'D', 82, 23, 88, 50, 50, 520000, 5),
('bdfdce2a-7e9e-4cdb-b5e9-3f19632ecec9', 'ab65c071-e40a-409c-9c6f-8085d7b8d38e', 'Yago', 'Belmonte', 10, 'D', 81, 28, 83, 50, 50, 480000, 3),
('e1e7c989-d591-4eec-92f1-8cd790052de4', 'ab65c071-e40a-409c-9c6f-8085d7b8d38e', 'Teo', 'Lozano', 82, 'F', 98, 27, 98, 50, 50, 1630000, 4),
('21123e86-f0d8-4c08-93e5-4c1932a0b514', 'ab65c071-e40a-409c-9c6f-8085d7b8d38e', 'Fabián', 'Galindo', 5, 'F', 97, 31, 97, 50, 50, 1530000, 5),
('447ecac8-1dc0-49b8-972d-d735d5d99b72', 'ab65c071-e40a-409c-9c6f-8085d7b8d38e', 'Lenny', 'Arriaga', 27, 'F', 96, 27, 97, 50, 50, 1440000, 4),
('6335852f-c39f-452d-874b-f2892013ef7d', 'ab65c071-e40a-409c-9c6f-8085d7b8d38e', 'Kasper', 'Iturbe', 98, 'F', 95, 28, 97, 50, 50, 1340000, 2),
('cacaf129-c54d-46c0-adb3-2636d8f2df00', 'ab65c071-e40a-409c-9c6f-8085d7b8d38e', 'Ulises', 'Arnesen', 80, 'F', 94, 24, 98, 50, 50, 1260000, 5),
('a20ab40f-a64e-4ba8-a052-155f4a49c9a0', 'ab65c071-e40a-409c-9c6f-8085d7b8d38e', 'Esteban', 'Zamora', 41, 'F', 93, 25, 94, 50, 50, 1170000, 2),
('d5fb355d-da59-4a43-9971-c5217049fe94', 'ab65c071-e40a-409c-9c6f-8085d7b8d38e', 'Eero', 'Westerlund', 68, 'F', 92, 25, 95, 50, 50, 1090000, 4),
('98b64352-80e4-4c6b-9145-f1205cf3892f', 'ab65c071-e40a-409c-9c6f-8085d7b8d38e', 'Gael', 'Falkner', 69, 'F', 91, 27, 92, 50, 50, 1020000, 3),
('4a299b52-7816-4af0-9ff7-bd278975cf7f', 'ab65c071-e40a-409c-9c6f-8085d7b8d38e', 'Viggo', 'Kallio', 19, 'F', 90, 28, 91, 50, 50, 950000, 2),
('8811b911-6afc-49b5-9a43-2c59a09070aa', 'ab65c071-e40a-409c-9c6f-8085d7b8d38e', 'Marek', 'Arnesen', 47, 'F', 89, 26, 91, 50, 50, 880000, 5),
('32f44170-9b86-4fa6-95e6-7c97eee19c2c', 'ab65c071-e40a-409c-9c6f-8085d7b8d38e', 'Otto', 'Nieminen', 24, 'F', 88, 27, 88, 50, 50, 820000, 5),
('5ccf6b25-0427-4bda-ae27-0d3c2b3154cb', 'ab65c071-e40a-409c-9c6f-8085d7b8d38e', 'Zeno', 'Ekholm', 52, 'F', 88, 20, 94, 50, 50, 490000, 1),
('1007d692-5278-4b67-938e-9aa0d2295c8c', 'd7e75bf7-96fb-4ea8-a32e-396539466278', 'Esteban', 'Calderas', 15, 'G', 85, 28, 87, 50, 50, 650000, 3),
('62abbaf1-ce5b-4881-96ca-a3f51b935a2e', 'd7e75bf7-96fb-4ea8-a32e-396539466278', 'Dorian', 'Norberg', 6, 'G', 70, 25, 72, 50, 50, 210000, 4),
('fb016826-453f-4a80-9ecc-dace690d8de8', 'd7e75bf7-96fb-4ea8-a32e-396539466278', 'Rodrigo', 'Zelenka', 58, 'D', 90, 31, 91, 50, 50, 950000, 1),
('ce304fd5-be21-4aaf-9036-322172c15679', 'd7e75bf7-96fb-4ea8-a32e-396539466278', 'Aldo', 'Rautio', 37, 'D', 89, 25, 90, 50, 50, 880000, 2),
('b5a8c6dc-da3d-4898-94b2-472cb30b2738', 'd7e75bf7-96fb-4ea8-a32e-396539466278', 'Viggo', 'Garmendia', 57, 'D', 87, 25, 89, 50, 50, 760000, 1),
('a858fc65-3305-47ab-83e8-65f74803c937', 'd7e75bf7-96fb-4ea8-a32e-396539466278', 'Silas', 'Riquelme', 9, 'D', 86, 21, 90, 50, 50, 420000, 2),
('060d8898-0644-407d-a0d7-26a440b84ffa', 'd7e75bf7-96fb-4ea8-a32e-396539466278', 'Jaakko', 'Cabrales', 10, 'D', 84, 25, 86, 50, 50, 600000, 4),
('9f369b87-844f-4c28-8a7a-816aa2299018', 'd7e75bf7-96fb-4ea8-a32e-396539466278', 'Magnus', 'Albrecht', 48, 'D', 83, 32, 84, 50, 50, 560000, 1),
('ce9bd374-28af-4aa9-a730-2ce216a8d0cd', 'd7e75bf7-96fb-4ea8-a32e-396539466278', 'Anders', 'Cabrales', 21, 'F', 96, 26, 96, 50, 50, 1440000, 5),
('cf67a049-ea82-4178-90ff-898558920898', 'd7e75bf7-96fb-4ea8-a32e-396539466278', 'Amadeo', 'Lagarde', 1, 'F', 96, 30, 97, 50, 50, 1440000, 1),
('9b327d30-1336-476e-8da8-2f3cb101d663', 'd7e75bf7-96fb-4ea8-a32e-396539466278', 'Eero', 'Sandoval', 56, 'F', 95, 24, 99, 50, 50, 1340000, 1),
('3be63d68-977c-4d3a-9b17-1176706f6a1b', 'd7e75bf7-96fb-4ea8-a32e-396539466278', 'Zoltan', 'Bramante', 24, 'F', 94, 32, 94, 50, 50, 1260000, 2),
('9869351f-3b07-4c7a-85fa-e7b5326f1776', 'd7e75bf7-96fb-4ea8-a32e-396539466278', 'Hakon', 'Quiroga', 86, 'F', 93, 22, 95, 50, 50, 1170000, 4),
('28400041-21d2-4b91-967f-b3841aba9810', 'd7e75bf7-96fb-4ea8-a32e-396539466278', 'Santino', 'Aaltonen', 43, 'F', 92, 31, 93, 50, 50, 1090000, 2),
('33400d0c-f61d-425f-b6c8-08a66c855991', 'd7e75bf7-96fb-4ea8-a32e-396539466278', 'Aldo', 'Kovář', 95, 'F', 91, 25, 94, 50, 50, 1020000, 5),
('dbdf217e-d010-4ad8-9fd7-84c8d0f05c90', 'd7e75bf7-96fb-4ea8-a32e-396539466278', 'Lenny', 'Quiroga', 85, 'F', 90, 26, 90, 50, 50, 950000, 2),
('83509678-d93e-4940-a616-2a929a71d463', 'd7e75bf7-96fb-4ea8-a32e-396539466278', 'Dagur', 'Zamora', 75, 'F', 89, 28, 91, 50, 50, 880000, 4),
('a438004c-3f3d-4a84-88cd-bbbaa64568e3', 'd7e75bf7-96fb-4ea8-a32e-396539466278', 'Ciro', 'Lindahl', 39, 'F', 88, 26, 89, 50, 50, 820000, 1),
('96c01c4a-c91b-4851-a550-f446341a6a6c', 'd7e75bf7-96fb-4ea8-a32e-396539466278', 'Noel', 'Rautio', 4, 'F', 87, 22, 93, 50, 50, 760000, 5),
('a452eed7-1f15-46e2-81ea-669a8b764929', 'd7e75bf7-96fb-4ea8-a32e-396539466278', 'Jonas', 'Aaltonen', 49, 'F', 87, 28, 89, 50, 50, 760000, 2),
('2cb8f6da-1d74-4758-aead-84ffea5145bf', '0a30423d-9ecb-4d25-ace8-5a29ff022275', 'Arvid', 'Navarrete', 32, 'G', 89, 22, 92, 50, 50, 880000, 3),
('e69d8d67-124f-497c-be57-2801ebeed1fb', '0a30423d-9ecb-4d25-ace8-5a29ff022275', 'Ivo', 'Falkner', 60, 'G', 76, 26, 77, 50, 50, 320000, 4),
('564f62ca-b57c-4aa8-81f2-c8dadf6922bb', '0a30423d-9ecb-4d25-ace8-5a29ff022275', 'Magnus', 'Lindqvist', 25, 'D', 89, 23, 93, 50, 50, 880000, 3),
('bc97b5ac-83c2-4837-9039-d2e10711c01a', '0a30423d-9ecb-4d25-ace8-5a29ff022275', 'Elio', 'Corvalán', 89, 'D', 88, 26, 89, 50, 50, 820000, 3),
('a5c7aa42-f881-4dfb-a287-642687555594', '0a30423d-9ecb-4d25-ace8-5a29ff022275', 'Viggo', 'Cabrales', 81, 'D', 86, 21, 91, 50, 50, 420000, 4),
('739cb818-1ba2-4fdc-9295-a6f2e49a5533', '0a30423d-9ecb-4d25-ace8-5a29ff022275', 'Marek', 'Echeverri', 11, 'D', 85, 33, 86, 50, 50, 560000, 4),
('1e80a02f-a36a-4f73-b5ba-04c0cb65833a', '0a30423d-9ecb-4d25-ace8-5a29ff022275', 'Matías', 'Pellerin', 12, 'D', 83, 24, 86, 50, 50, 560000, 4),
('b22be11d-e1d3-4ddd-b00c-8f1a9864cf18', '0a30423d-9ecb-4d25-ace8-5a29ff022275', 'Samuel', 'Fonteyne', 39, 'D', 82, 31, 83, 50, 50, 520000, 3),
('2cbd72b6-e8e7-4fe6-9827-bbb25821775d', '0a30423d-9ecb-4d25-ace8-5a29ff022275', 'Nikolai', 'Norberg', 90, 'F', 88, 28, 88, 50, 50, 820000, 1),
('e8e910d4-3e61-49ed-9b87-c3d0a1365b58', '0a30423d-9ecb-4d25-ace8-5a29ff022275', 'Eero', 'Arriaga', 49, 'F', 87, 28, 87, 50, 50, 760000, 3),
('09972de6-c117-4d03-b0be-ad47148a18e7', '0a30423d-9ecb-4d25-ace8-5a29ff022275', 'Kai', 'Carvajal', 45, 'F', 86, 29, 87, 50, 50, 710000, 2),
('c00291e1-c856-4315-a937-19b991e2f2d5', '0a30423d-9ecb-4d25-ace8-5a29ff022275', 'Gael', 'Villaseñor', 40, 'F', 84, 21, 92, 50, 50, 360000, 2),
('6a241ced-7c4f-40c8-9435-a824dc817038', '0a30423d-9ecb-4d25-ace8-5a29ff022275', 'Vicente', 'Sandoval', 78, 'F', 84, 19, 94, 50, 50, 360000, 3),
('21273531-048d-4f2a-83d5-e096f6233d96', '0a30423d-9ecb-4d25-ace8-5a29ff022275', 'Gideon', 'Nieminen', 80, 'F', 83, 30, 85, 50, 50, 560000, 3),
('b93a7328-e16b-48b1-967b-f5b6a3f1c759', '0a30423d-9ecb-4d25-ace8-5a29ff022275', 'Adrián', 'Nieminen', 48, 'F', 82, 22, 89, 50, 50, 520000, 2),
('05a51fdd-f049-47a6-bdca-d4b19c391441', '0a30423d-9ecb-4d25-ace8-5a29ff022275', 'Fabián', 'Zamora', 52, 'F', 81, 25, 82, 50, 50, 480000, 5),
('0fcfe225-281e-4cba-86be-3e51e609bbb3', '0a30423d-9ecb-4d25-ace8-5a29ff022275', 'Ilan', 'Navarrete', 43, 'F', 80, 27, 82, 50, 50, 440000, 1),
('24ee98cd-bb84-4845-abf5-ffce1986b170', '0a30423d-9ecb-4d25-ace8-5a29ff022275', 'Dorian', 'Tamayo', 53, 'F', 79, 27, 81, 50, 50, 410000, 4),
('d51fe706-52d3-4a17-ba9e-621951188e22', '0a30423d-9ecb-4d25-ace8-5a29ff022275', 'Rasmus', 'Kovář', 2, 'F', 78, 29, 79, 50, 50, 380000, 4),
('80ee2026-d4ac-41c5-88c1-406bedd0b90e', '0a30423d-9ecb-4d25-ace8-5a29ff022275', 'Rodrigo', 'Albrecht', 73, 'F', 78, 26, 79, 50, 50, 380000, 3),
('736a809a-3fdb-4755-9323-b5b5e3a4a8ac', '3159934e-02d3-434d-b04f-4be7485dd9aa', 'Ivo', 'Marklund', 5, 'G', 90, 27, 90, 50, 50, 950000, 3),
('6b687b13-0d7f-46ff-9c30-d3ef0975e3d4', '3159934e-02d3-434d-b04f-4be7485dd9aa', 'Nikolai', 'Quintanar', 75, 'G', 75, 27, 75, 50, 50, 300000, 1),
('9b5caa05-6de4-4061-902b-0e2c9010db94', '3159934e-02d3-434d-b04f-4be7485dd9aa', 'Yannick', 'Vikström', 34, 'D', 91, 25, 94, 50, 50, 1020000, 4),
('86ee0a65-aa9b-40ef-9cfa-39a8de71231c', '3159934e-02d3-434d-b04f-4be7485dd9aa', 'Felix', 'Marklund', 70, 'D', 90, 26, 91, 50, 50, 950000, 1),
('a0a80524-8768-4bab-9da1-8ded4e42eee1', '3159934e-02d3-434d-b04f-4be7485dd9aa', 'Gustavo', 'Brandt', 33, 'D', 88, 25, 92, 50, 50, 820000, 4),
('6c071adb-4354-48d0-90a5-74dea73e0971', '3159934e-02d3-434d-b04f-4be7485dd9aa', 'Gideon', 'Sandoval', 57, 'D', 87, 31, 88, 50, 50, 760000, 1),
('c48a1de0-fc20-4752-8cf8-f135d0e0fdc9', '3159934e-02d3-434d-b04f-4be7485dd9aa', 'Gael', 'Sandoval', 71, 'D', 85, 25, 87, 50, 50, 650000, 1),
('3e376008-2ecd-4cfe-a39b-a64a08234aca', '3159934e-02d3-434d-b04f-4be7485dd9aa', 'Kasper', 'Quintanar', 13, 'D', 84, 26, 86, 50, 50, 600000, 1),
('2d077618-2e75-487b-a0db-73bc4eb216a9', '3159934e-02d3-434d-b04f-4be7485dd9aa', 'Ulises', 'Sundqvist', 24, 'F', 95, 27, 95, 50, 50, 1340000, 4),
('2dad39eb-e439-425d-af8d-a9de9bf03b16', '3159934e-02d3-434d-b04f-4be7485dd9aa', 'Gideon', 'Ferrán', 38, 'F', 94, 30, 96, 50, 50, 1260000, 2),
('090671ec-20af-443b-a6f6-ee2004313c00', '3159934e-02d3-434d-b04f-4be7485dd9aa', 'Sebastián', 'Ordaz', 30, 'F', 94, 34, 95, 50, 50, 1070000, 2),
('63487bfb-d200-4f9d-9d75-4a194760284a', '3159934e-02d3-434d-b04f-4be7485dd9aa', 'Fausto', 'Gallardo', 35, 'F', 92, 24, 95, 50, 50, 1090000, 5),
('f82446e5-db26-4d8e-bcaf-b162726b7d11', '3159934e-02d3-434d-b04f-4be7485dd9aa', 'Leandro', 'Delacroix', 60, 'F', 91, 23, 97, 50, 50, 1020000, 5),
('ce4d5c2b-20de-4797-bc29-6cc3cc6816f8', '3159934e-02d3-434d-b04f-4be7485dd9aa', 'Oskar', 'Aaltonen', 45, 'F', 90, 29, 91, 50, 50, 950000, 2),
('8ec32a15-e965-42de-9616-5f16331b1a8a', '3159934e-02d3-434d-b04f-4be7485dd9aa', 'Bastian', 'Vallejo', 20, 'F', 89, 32, 89, 50, 50, 880000, 2),
('78f9e068-56fc-4a92-a816-5296c20e46f3', '3159934e-02d3-434d-b04f-4be7485dd9aa', 'Viggo', 'Westerlund', 19, 'F', 88, 19, 99, 50, 50, 490000, 1),
('6dfaf7f5-f1a0-4afc-a4ab-57863ab61655', '3159934e-02d3-434d-b04f-4be7485dd9aa', 'Joaquín', 'Lindahl', 25, 'F', 87, 30, 87, 50, 50, 760000, 4),
('00a043b9-b140-4143-a996-0bf88506d242', '3159934e-02d3-434d-b04f-4be7485dd9aa', 'Arvid', 'Karlsen', 78, 'F', 86, 25, 89, 50, 50, 710000, 2),
('c1495a71-19e0-4b01-8008-c706031e0904', '3159934e-02d3-434d-b04f-4be7485dd9aa', 'Casimir', 'Falkner', 28, 'F', 85, 30, 86, 50, 50, 650000, 4),
('4c2143e2-5ed6-4a2b-a2fe-2ef70e2c3f2f', '3159934e-02d3-434d-b04f-4be7485dd9aa', 'Elio', 'Ekholm', 95, 'F', 85, 23, 88, 50, 50, 650000, 1),
('9ca5717e-53ea-4b4a-8dd6-60fa1bd08e44', '5ace9bc5-8a92-4be6-b9b1-29a8cfb471d0', 'Benicio', 'Hidalgo', 52, 'G', 93, 27, 94, 50, 50, 1170000, 1),
('34531b1e-3751-4176-93bb-e41893c04133', '5ace9bc5-8a92-4be6-b9b1-29a8cfb471d0', 'Leandro', 'Karlsen', 22, 'G', 80, 19, 93, 50, 50, 260000, 4),
('0d42442e-b5e7-4d4a-b143-0694476110df', '5ace9bc5-8a92-4be6-b9b1-29a8cfb471d0', 'Marek', 'Zelenka', 59, 'D', 95, 31, 96, 50, 50, 1340000, 3),
('34b0fda0-5bd5-44a2-9e11-542c34a57ab8', '5ace9bc5-8a92-4be6-b9b1-29a8cfb471d0', 'Silas', 'Valdivia', 49, 'D', 94, 20, 100, 50, 50, 750000, 1),
('054be23e-7797-4199-a3bb-4ca71ecd3829', '5ace9bc5-8a92-4be6-b9b1-29a8cfb471d0', 'Samuel', 'Urquiza', 94, 'D', 92, 28, 94, 50, 50, 1090000, 4),
('d18abc8c-cc4a-4cfa-9c7f-c494e732dc16', '5ace9bc5-8a92-4be6-b9b1-29a8cfb471d0', 'Santino', 'Quintanar', 9, 'D', 91, 28, 93, 50, 50, 1020000, 4),
('44aaaac7-1d54-4e93-bbba-098b6cb8851a', '5ace9bc5-8a92-4be6-b9b1-29a8cfb471d0', 'Arvid', 'Lagarde', 90, 'D', 89, 26, 91, 50, 50, 880000, 4),
('4b32d18d-d27c-4282-850a-08b9438abcdd', '5ace9bc5-8a92-4be6-b9b1-29a8cfb471d0', 'Leandro', 'Salazar', 38, 'D', 88, 29, 89, 50, 50, 820000, 3),
('52989f80-ab6d-4a16-b21a-ad05674a322c', '5ace9bc5-8a92-4be6-b9b1-29a8cfb471d0', 'Tobías', 'Salazar', 64, 'F', 98, 24, 100, 50, 50, 1630000, 3),
('2ab726a8-7745-4149-bf3f-fb9579b785ec', '5ace9bc5-8a92-4be6-b9b1-29a8cfb471d0', 'Felix', 'Zapatero', 47, 'F', 97, 25, 100, 50, 50, 1530000, 2),
('5d4af1c6-adbc-4f11-a42e-9475a7653833', '5ace9bc5-8a92-4be6-b9b1-29a8cfb471d0', 'Alvar', 'Ferrán', 58, 'F', 96, 27, 98, 50, 50, 1440000, 3),
('de6e2a6c-b5c7-43c2-80be-640a6f80f396', '5ace9bc5-8a92-4be6-b9b1-29a8cfb471d0', 'Ulises', 'Palacios', 19, 'F', 94, 30, 96, 50, 50, 1260000, 1),
('f4db7bed-c8a1-4ab1-8a60-f89b6a77ae36', '5ace9bc5-8a92-4be6-b9b1-29a8cfb471d0', 'Hakon', 'Villaseñor', 50, 'F', 94, 22, 100, 50, 50, 1260000, 1),
('4e8411cf-3567-44d0-b08c-659b928b770a', '5ace9bc5-8a92-4be6-b9b1-29a8cfb471d0', 'Thiago', 'Delacroix', 97, 'F', 93, 23, 97, 50, 50, 1170000, 3),
('7aaf0feb-6f80-4dae-bdbb-0ba7c325506c', '5ace9bc5-8a92-4be6-b9b1-29a8cfb471d0', 'Fabián', 'Abarca', 83, 'F', 92, 26, 94, 50, 50, 1090000, 3),
('b8107da2-e949-4d70-8b55-8ab7212d34a3', '5ace9bc5-8a92-4be6-b9b1-29a8cfb471d0', 'Rasmus', 'Villaseñor', 7, 'F', 91, 34, 92, 50, 50, 870000, 2),
('0dc36b20-d793-4fe5-8422-c5df17ea39f9', '5ace9bc5-8a92-4be6-b9b1-29a8cfb471d0', 'Lucas', 'Ybarra', 41, 'F', 90, 25, 92, 50, 50, 950000, 3),
('d7f79f85-be1e-45fb-ba65-252aef70003c', '5ace9bc5-8a92-4be6-b9b1-29a8cfb471d0', 'Sven', 'Lagarde', 5, 'F', 89, 25, 92, 50, 50, 880000, 2),
('bd090ec3-45a4-4e02-86cb-0243bdcfcf4a', '5ace9bc5-8a92-4be6-b9b1-29a8cfb471d0', 'Nikolai', 'Jansky', 53, 'F', 88, 35, 90, 50, 50, 700000, 1),
('412f3d76-d1c0-41fe-b331-8041b870ce6d', '5ace9bc5-8a92-4be6-b9b1-29a8cfb471d0', 'Sebastián', 'Abarca', 1, 'F', 88, 32, 90, 50, 50, 820000, 3);
insert into players (id, team_id, first_name, last_name, number, position, rating, age, potential, form, morale, salary, contract_years) values
('e8b52873-92ae-4ada-b260-c453e15d31de', '21dcec66-6d40-4314-ab04-7d35bad33373', 'Teo', 'Ferrán', 63, 'G', 90, 23, 95, 50, 50, 950000, 4),
('ae4194c9-a2bf-455f-8210-00dd93130cdf', '21dcec66-6d40-4314-ab04-7d35bad33373', 'Bastian', 'Bramante', 98, 'G', 77, 28, 78, 50, 50, 350000, 4),
('e97b135d-0ef4-4839-9fc0-54e10f5faa1f', '21dcec66-6d40-4314-ab04-7d35bad33373', 'Quentin', 'Hidalgo', 62, 'D', 98, 34, 99, 50, 50, 1390000, 5),
('883fbdd9-27c4-4d6e-8a51-7f3e145325aa', '21dcec66-6d40-4314-ab04-7d35bad33373', 'Elio', 'Ybarra', 19, 'D', 97, 27, 97, 50, 50, 1530000, 5),
('fb5a0e6c-34e9-461f-89e1-654f94885267', '21dcec66-6d40-4314-ab04-7d35bad33373', 'Damián', 'Borrego', 24, 'D', 95, 24, 98, 50, 50, 1340000, 3),
('117c6280-1ed5-4ace-8858-fc63e3e0e8c2', '21dcec66-6d40-4314-ab04-7d35bad33373', 'Samuel', 'Valdivia', 91, 'D', 94, 31, 95, 50, 50, 1260000, 4),
('33972d76-18de-45f0-ba4e-6b8417e74b7a', '21dcec66-6d40-4314-ab04-7d35bad33373', 'Kai', 'Cabrales', 96, 'D', 92, 23, 98, 50, 50, 1090000, 3),
('8bf50d8d-86d3-4433-9952-db7371bcf1fe', '21dcec66-6d40-4314-ab04-7d35bad33373', 'Anders', 'Zapatero', 35, 'D', 91, 25, 93, 50, 50, 1020000, 1),
('800b41ed-645e-4ce7-b9a7-e5da8fc5b644', '21dcec66-6d40-4314-ab04-7d35bad33373', 'Valtteri', 'Arriaga', 42, 'F', 97, 19, 100, 50, 50, 920000, 3),
('6f3a75d5-4536-43e8-97b5-aa35048d4302', '21dcec66-6d40-4314-ab04-7d35bad33373', 'Bruno', 'Báthory', 90, 'F', 96, 30, 97, 50, 50, 1440000, 2),
('00cac98e-c742-4698-beb3-1dc4aec750cd', '21dcec66-6d40-4314-ab04-7d35bad33373', 'Ulises', 'Cabrales', 6, 'F', 95, 29, 95, 50, 50, 1340000, 4),
('7c70acfa-fbd6-462e-8007-9e92c28a5318', '21dcec66-6d40-4314-ab04-7d35bad33373', 'Renzo', 'Nieminen', 65, 'F', 94, 30, 96, 50, 50, 1260000, 1),
('dd4cc131-e863-409c-b2e7-7423351c5b34', '21dcec66-6d40-4314-ab04-7d35bad33373', 'Teo', 'Bergkvist', 37, 'F', 93, 26, 93, 50, 50, 1170000, 2),
('976874cc-8a34-48d0-9ae6-fadf0f77b7cf', '21dcec66-6d40-4314-ab04-7d35bad33373', 'Yannick', 'Riquelme', 79, 'F', 93, 35, 94, 50, 50, 1000000, 4),
('1c36358d-94ba-482f-94cb-f1776530e588', '21dcec66-6d40-4314-ab04-7d35bad33373', 'Pavel', 'Echeverri', 15, 'F', 91, 28, 93, 50, 50, 1020000, 1),
('32587532-1784-4942-8a18-b34f1fe118e3', '21dcec66-6d40-4314-ab04-7d35bad33373', 'Fausto', 'Castellví', 36, 'F', 90, 28, 91, 50, 50, 950000, 3),
('cefbb24e-256d-4894-b122-7aedd45ca5c6', '21dcec66-6d40-4314-ab04-7d35bad33373', 'Cedric', 'Landeros', 22, 'F', 89, 27, 91, 50, 50, 880000, 1),
('4b25e204-a457-4231-9ea6-b707c4aa1a40', '21dcec66-6d40-4314-ab04-7d35bad33373', 'Pavel', 'Ekholm', 2, 'F', 87, 30, 89, 50, 50, 760000, 4),
('4699aa3a-6f02-4905-96c2-6e945368095c', '21dcec66-6d40-4314-ab04-7d35bad33373', 'Amadeo', 'Palacios', 5, 'F', 87, 25, 91, 50, 50, 760000, 4),
('44860e39-e93d-4e84-96d8-851800c5b612', '21dcec66-6d40-4314-ab04-7d35bad33373', 'Kai', 'Garmendia', 97, 'F', 86, 28, 87, 50, 50, 710000, 5),
('a8e87eb0-fef2-4e59-912d-778568b54a28', '1c00ae7a-a8cc-4503-afd8-ab119e8cf03c', 'Casimir', 'Granqvist', 60, 'G', 96, 24, 100, 50, 50, 1440000, 1),
('2399ccaa-a60d-4079-9217-1cdf6593ffa6', '1c00ae7a-a8cc-4503-afd8-ab119e8cf03c', 'Sven', 'Delacroix', 24, 'G', 88, 35, 89, 50, 50, 700000, 2),
('c0234f9f-4ba6-4e80-9a1a-013cb01c535c', '1c00ae7a-a8cc-4503-afd8-ab119e8cf03c', 'Otto', 'Holmqvist', 90, 'D', 86, 25, 89, 50, 50, 710000, 2),
('a635a249-d43d-46e3-8c61-92427562f932', '1c00ae7a-a8cc-4503-afd8-ab119e8cf03c', 'Lucas', 'Ostrowski', 47, 'D', 85, 25, 87, 50, 50, 650000, 5),
('5fee79d6-da2d-4e56-a682-bec66e693647', '1c00ae7a-a8cc-4503-afd8-ab119e8cf03c', 'Rune', 'Nieminen', 32, 'D', 83, 31, 85, 50, 50, 560000, 1),
('701d5aed-01ce-404e-94e3-eb7349b0a7c8', '1c00ae7a-a8cc-4503-afd8-ab119e8cf03c', 'Oskar', 'Nieminen', 18, 'D', 82, 30, 83, 50, 50, 520000, 5),
('ba85905a-19dc-4a86-952c-432040097c2d', '1c00ae7a-a8cc-4503-afd8-ab119e8cf03c', 'Esteban', 'Halvorsen', 49, 'D', 80, 29, 81, 50, 50, 440000, 1),
('b18265d0-cbde-40d3-a40e-1951ec9fcbb8', '1c00ae7a-a8cc-4503-afd8-ab119e8cf03c', 'Oskar', 'Ekholm', 4, 'D', 79, 30, 80, 50, 50, 410000, 2),
('8ebd2449-6ce8-407c-a91b-00e322526434', '1c00ae7a-a8cc-4503-afd8-ab119e8cf03c', 'Ivo', 'Jurado', 56, 'F', 90, 25, 91, 50, 50, 950000, 5),
('78d8383a-880f-451d-b304-46724eb0f1d2', '1c00ae7a-a8cc-4503-afd8-ab119e8cf03c', 'Caio', 'Arnesen', 21, 'F', 90, 23, 94, 50, 50, 950000, 2),
('70d352b3-13a0-4e7c-af54-7c3f140cca0d', '1c00ae7a-a8cc-4503-afd8-ab119e8cf03c', 'Lucas', 'Villaseñor', 92, 'F', 89, 29, 89, 50, 50, 880000, 5),
('3a9a6a6d-3830-4989-929e-1a3ad80ebdb8', '1c00ae7a-a8cc-4503-afd8-ab119e8cf03c', 'Eero', 'Maravilla', 72, 'F', 88, 22, 94, 50, 50, 820000, 1),
('a2a9a348-75d6-4b06-884d-c360b7bb4bfe', '1c00ae7a-a8cc-4503-afd8-ab119e8cf03c', 'Olaf', 'Fjeldstad', 28, 'F', 87, 26, 89, 50, 50, 760000, 3),
('d3735251-963a-439e-89c1-8e26c69e4477', '1c00ae7a-a8cc-4503-afd8-ab119e8cf03c', 'Sven', 'Haldane', 80, 'F', 86, 32, 88, 50, 50, 710000, 5),
('3a634aef-44de-4c9a-aca5-adbe56a5d3f0', '1c00ae7a-a8cc-4503-afd8-ab119e8cf03c', 'Fabián', 'Bergkvist', 87, 'F', 84, 35, 85, 50, 50, 510000, 3),
('ebf2dd1b-24c0-4574-b30e-c8aa239407a1', '1c00ae7a-a8cc-4503-afd8-ab119e8cf03c', 'Lucas', 'Vasquez', 96, 'F', 84, 29, 85, 50, 50, 600000, 1),
('1566cf0c-07a4-44e6-b05b-66043888bcce', '1c00ae7a-a8cc-4503-afd8-ab119e8cf03c', 'Rodrigo', 'Carvajal', 37, 'F', 84, 27, 85, 50, 50, 600000, 5),
('a8384fab-d545-421a-b977-9c2441a726f5', '1c00ae7a-a8cc-4503-afd8-ab119e8cf03c', 'Esteban', 'Vallejo', 98, 'F', 82, 29, 84, 50, 50, 520000, 4),
('f2eb93cb-5b2a-418a-afaf-b298601152bd', '1c00ae7a-a8cc-4503-afd8-ab119e8cf03c', 'Jaakko', 'Albrecht', 45, 'F', 81, 28, 82, 50, 50, 480000, 5),
('e84dfb0b-83e6-4a7e-a3dd-2950c56390a9', '1c00ae7a-a8cc-4503-afd8-ab119e8cf03c', 'Gustavo', 'Delacroix', 19, 'F', 81, 24, 84, 50, 50, 480000, 5),
('e79a62a5-0199-4d1f-84e9-cb291c3b6f4e', 'b7276902-2001-41d4-a4eb-b240579845f3', 'Esteban', 'Brandt', 42, 'G', 88, 28, 88, 50, 50, 820000, 1),
('0bf2f9c3-6643-4689-a04f-6870bbf6d92d', 'b7276902-2001-41d4-a4eb-b240579845f3', 'Nahuel', 'Toivonen', 10, 'G', 73, 26, 75, 50, 50, 260000, 2),
('61102932-e679-49f7-b885-600880bc3501', 'b7276902-2001-41d4-a4eb-b240579845f3', 'Teo', 'Carvajal', 34, 'D', 94, 33, 95, 50, 50, 1070000, 1),
('5bfd8bb4-9c7a-405e-aae9-e539b085018d', 'b7276902-2001-41d4-a4eb-b240579845f3', 'Alvar', 'Sandoval', 98, 'D', 93, 29, 94, 50, 50, 1170000, 5),
('a53e6b7f-57c1-44dc-8964-ee755b70b8fd', 'b7276902-2001-41d4-a4eb-b240579845f3', 'Ilan', 'Montalvo', 48, 'D', 91, 26, 92, 50, 50, 1020000, 3),
('b9e6849d-5179-40c7-ace0-50ff2711668f', 'b7276902-2001-41d4-a4eb-b240579845f3', 'Felix', 'Arnesen', 41, 'D', 90, 27, 92, 50, 50, 950000, 3),
('e23fb876-9a11-4f77-abb3-6012206f1b9b', 'b7276902-2001-41d4-a4eb-b240579845f3', 'Sebastián', 'Palacios', 8, 'D', 88, 25, 92, 50, 50, 820000, 5),
('25bde3b7-9616-41c7-b478-42cc27de7f00', 'b7276902-2001-41d4-a4eb-b240579845f3', 'Olaf', 'Albrecht', 96, 'D', 87, 25, 91, 50, 50, 760000, 3),
('b6b5c20b-ec45-4a44-ad62-df3bc4ab0a93', 'b7276902-2001-41d4-a4eb-b240579845f3', 'Vicente', 'Riquelme', 66, 'F', 91, 35, 92, 50, 50, 870000, 1),
('5f33c1ff-9369-4747-ab1e-7a58836df25f', 'b7276902-2001-41d4-a4eb-b240579845f3', 'Cedric', 'Maravilla', 15, 'F', 91, 31, 93, 50, 50, 1020000, 3),
('f659c3b5-a938-412b-85a6-0c3d524b7cb9', 'b7276902-2001-41d4-a4eb-b240579845f3', 'Oskar', 'Gallardo', 21, 'F', 90, 27, 91, 50, 50, 950000, 4),
('22503105-5716-46f6-a843-eb09ce4d0b62', 'b7276902-2001-41d4-a4eb-b240579845f3', 'Rasmus', 'Brandt', 55, 'F', 89, 29, 90, 50, 50, 880000, 1),
('9cb7043f-ea26-45bf-a147-de140cbdef56', 'b7276902-2001-41d4-a4eb-b240579845f3', 'Rodrigo', 'Galindo', 58, 'F', 88, 23, 92, 50, 50, 820000, 4),
('099735e1-3b77-4a95-b376-191fd28a28ee', 'b7276902-2001-41d4-a4eb-b240579845f3', 'Pablo', 'Karlsen', 71, 'F', 87, 21, 98, 50, 50, 460000, 5),
('70e066e9-2682-44ec-b585-daa3d2ca99d6', 'b7276902-2001-41d4-a4eb-b240579845f3', 'Leandro', 'Urquiza', 37, 'F', 86, 27, 86, 50, 50, 710000, 5),
('9be635e9-a503-40cb-af7e-d670fee2e20b', 'b7276902-2001-41d4-a4eb-b240579845f3', 'Sven', 'Villaseñor', 45, 'F', 85, 35, 86, 50, 50, 560000, 1),
('9bbb48b9-e80e-406f-a18e-5788d3ed8856', 'b7276902-2001-41d4-a4eb-b240579845f3', 'Gael', 'Bramante', 62, 'F', 85, 26, 86, 50, 50, 650000, 4),
('e87d97ee-8852-4413-bb26-93ae69a08503', 'b7276902-2001-41d4-a4eb-b240579845f3', 'Ivo', 'Salazar', 88, 'F', 83, 30, 84, 50, 50, 560000, 1),
('043ce1a0-096a-4331-bea7-c095cf4f0185', 'b7276902-2001-41d4-a4eb-b240579845f3', 'Pablo', 'Arriaga', 49, 'F', 83, 20, 89, 50, 50, 340000, 3),
('d040026b-4fca-4492-aaeb-c309d7f506fa', 'b7276902-2001-41d4-a4eb-b240579845f3', 'Tobías', 'Lindahl', 75, 'F', 81, 19, 93, 50, 50, 290000, 1),
('ae94fc05-900f-4512-aa32-71919c8bca9a', 'e34a4cd2-1c04-4f5d-98fc-cbdbe44520ef', 'Emil', 'Lozano', 12, 'G', 85, 32, 87, 50, 50, 650000, 3),
('bb2be7d2-97ac-4359-bf08-78a678b385e5', 'e34a4cd2-1c04-4f5d-98fc-cbdbe44520ef', 'Noel', 'Zelenka', 89, 'G', 77, 25, 79, 50, 50, 350000, 4),
('e1e18e8e-e92b-49dd-924a-536ed3e36db3', 'e34a4cd2-1c04-4f5d-98fc-cbdbe44520ef', 'Pablo', 'Saarinen', 34, 'D', 100, 27, 100, 50, 50, 1850000, 3),
('6f0ddaca-22d9-4696-98f5-a90f7194b814', 'e34a4cd2-1c04-4f5d-98fc-cbdbe44520ef', 'Kasper', 'Fjeldstad', 5, 'D', 100, 21, 100, 50, 50, 1110000, 4),
('6e4fcf13-c817-4085-b786-8fb4922125a9', 'e34a4cd2-1c04-4f5d-98fc-cbdbe44520ef', 'Cedric', 'Dahlberg', 78, 'D', 100, 25, 100, 50, 50, 1850000, 2),
('7edbc919-e7ac-493e-9031-aedf884446fd', 'e34a4cd2-1c04-4f5d-98fc-cbdbe44520ef', 'Hugo', 'Pellerin', 55, 'D', 100, 23, 100, 50, 50, 1850000, 1),
('94db9185-45c6-4958-b86c-1b6f76cc0247', 'e34a4cd2-1c04-4f5d-98fc-cbdbe44520ef', 'Gael', 'Quiroga', 40, 'D', 100, 28, 100, 50, 50, 1850000, 2),
('5b4755a4-4a88-4aa3-8a6b-6d4cbdc6da63', 'e34a4cd2-1c04-4f5d-98fc-cbdbe44520ef', 'Andrés', 'Galindo', 65, 'D', 100, 25, 100, 50, 50, 1850000, 2),
('c44d12a2-5ca9-4e5a-818a-ffcc74d89c31', 'e34a4cd2-1c04-4f5d-98fc-cbdbe44520ef', 'Casimir', 'Haldane', 33, 'F', 91, 25, 94, 50, 50, 1020000, 2),
('90c8b3fd-1dca-4229-970a-1e6d2469376a', 'e34a4cd2-1c04-4f5d-98fc-cbdbe44520ef', 'Gustavo', 'Escalante', 75, 'F', 90, 26, 91, 50, 50, 950000, 1),
('35b0a7ac-f433-4d5d-9f28-21f8dc0b083a', 'e34a4cd2-1c04-4f5d-98fc-cbdbe44520ef', 'Rafael', 'Delacroix', 63, 'F', 89, 32, 90, 50, 50, 880000, 2),
('cd8c261d-2771-4174-824c-2caeeaeb6b9f', 'e34a4cd2-1c04-4f5d-98fc-cbdbe44520ef', 'Kai', 'Quintanar', 36, 'F', 88, 20, 95, 50, 50, 490000, 1),
('d070c10c-e9c1-4258-909c-eab4192fc87b', 'e34a4cd2-1c04-4f5d-98fc-cbdbe44520ef', 'Renzo', 'Falkner', 19, 'F', 87, 26, 87, 50, 50, 760000, 5),
('f15f443b-e1ef-4e83-904a-f6fd81a07eb8', 'e34a4cd2-1c04-4f5d-98fc-cbdbe44520ef', 'Yago', 'Arnesen', 38, 'F', 86, 30, 87, 50, 50, 710000, 4),
('21a494ff-4433-44b1-b3c7-45e26e78495a', 'e34a4cd2-1c04-4f5d-98fc-cbdbe44520ef', 'Aksel', 'Quintanar', 90, 'F', 85, 26, 87, 50, 50, 650000, 2),
('57aaf652-1e55-4bca-97a2-6281e9fa081a', 'e34a4cd2-1c04-4f5d-98fc-cbdbe44520ef', 'Fabián', 'Fjeldstad', 58, 'F', 84, 24, 89, 50, 50, 600000, 2),
('71ce8163-e3e6-4731-b599-83f6496a6d39', 'e34a4cd2-1c04-4f5d-98fc-cbdbe44520ef', 'Milo', 'Tamayo', 26, 'F', 84, 28, 85, 50, 50, 600000, 2),
('1926fc8c-a1bb-4025-8779-9af3ba5eee7b', 'e34a4cd2-1c04-4f5d-98fc-cbdbe44520ef', 'Santino', 'Lagarde', 24, 'F', 82, 26, 84, 50, 50, 520000, 2),
('9f50b7a8-d1fc-46d7-8a0f-7f3aa533a354', 'e34a4cd2-1c04-4f5d-98fc-cbdbe44520ef', 'Aldo', 'Almonte', 77, 'F', 81, 21, 85, 50, 50, 290000, 5),
('df998075-bb0d-4fd4-9e44-caa2c9676b39', 'e34a4cd2-1c04-4f5d-98fc-cbdbe44520ef', 'Hakon', 'Valdivia', 85, 'F', 80, 24, 83, 50, 50, 440000, 5),
('ca72adc5-b498-498f-8c91-5a927819e5a8', '6ee88a33-553e-4d2a-9288-124bacd7cddb', 'Esteban', 'Pellerin', 25, 'G', 88, 28, 90, 50, 50, 820000, 3),
('85060638-b585-41de-8963-4502f2913821', '6ee88a33-553e-4d2a-9288-124bacd7cddb', 'Renzo', 'Wahlgren', 54, 'G', 79, 30, 80, 50, 50, 410000, 1),
('22b3c8c3-bf76-41e0-9749-2c5c2d1547d0', '6ee88a33-553e-4d2a-9288-124bacd7cddb', 'Olaf', 'Báthory', 65, 'D', 85, 27, 86, 50, 50, 650000, 3),
('4b5781bd-e75a-44c9-9daf-920ada4a9426', '6ee88a33-553e-4d2a-9288-124bacd7cddb', 'Thiago', 'Lindqvist', 98, 'D', 84, 22, 92, 50, 50, 600000, 1),
('dd0a0f8d-7bf2-4644-96e6-f172ebc61d6c', '6ee88a33-553e-4d2a-9288-124bacd7cddb', 'Fabián', 'Calderas', 59, 'D', 82, 30, 82, 50, 50, 520000, 2),
('6752cbf9-9b8f-4758-ac9a-9ea734aaeeee', '6ee88a33-553e-4d2a-9288-124bacd7cddb', 'Emil', 'Vasquez', 79, 'D', 81, 25, 83, 50, 50, 480000, 1),
('38907d3d-13cc-4974-b23a-f15afeca754f', '6ee88a33-553e-4d2a-9288-124bacd7cddb', 'Adrián', 'Zelenka', 83, 'D', 79, 25, 81, 50, 50, 410000, 4),
('6fc6b396-562d-4441-b217-83c20885e79c', '6ee88a33-553e-4d2a-9288-124bacd7cddb', 'Pavel', 'Almonte', 4, 'D', 78, 29, 80, 50, 50, 380000, 2),
('9b256b95-76eb-4389-b97f-f962d71c16b5', '6ee88a33-553e-4d2a-9288-124bacd7cddb', 'Oskar', 'Valdivia', 2, 'F', 95, 22, 100, 50, 50, 1340000, 5),
('10cd02be-57b6-4d69-aca2-cd3802c1ee90', '6ee88a33-553e-4d2a-9288-124bacd7cddb', 'Gael', 'Toivonen', 44, 'F', 94, 27, 94, 50, 50, 1260000, 4),
('00a5eb5c-c9b3-451d-b4cc-5db764647a5f', '6ee88a33-553e-4d2a-9288-124bacd7cddb', 'Ciro', 'Borrego', 71, 'F', 93, 29, 94, 50, 50, 1170000, 5),
('d42fbc85-53c8-4e83-835a-1938949bbaa6', '6ee88a33-553e-4d2a-9288-124bacd7cddb', 'Rasmus', 'Montalvo', 75, 'F', 92, 28, 92, 50, 50, 1090000, 2),
('330414ab-be3a-4a1b-83ad-fc4a22a1189d', '6ee88a33-553e-4d2a-9288-124bacd7cddb', 'Magnus', 'Ordaz', 33, 'F', 91, 30, 92, 50, 50, 1020000, 5),
('c27dc506-1eeb-43a3-a712-8b4ced5ea477', '6ee88a33-553e-4d2a-9288-124bacd7cddb', 'Nahuel', 'Zamora', 31, 'F', 90, 26, 91, 50, 50, 950000, 2),
('59e5330f-8c80-4725-9cdf-546d1c16633b', '6ee88a33-553e-4d2a-9288-124bacd7cddb', 'Thiago', 'Salazar', 63, 'F', 89, 24, 91, 50, 50, 880000, 4),
('e414678f-7a69-4b5a-be9a-032927e6a206', '6ee88a33-553e-4d2a-9288-124bacd7cddb', 'Kai', 'Pellerin', 70, 'F', 88, 27, 89, 50, 50, 820000, 2),
('15d6ff7c-b15a-4f16-8c18-ec25aaeab355', '6ee88a33-553e-4d2a-9288-124bacd7cddb', 'Marek', 'Ordaz', 20, 'F', 87, 28, 87, 50, 50, 760000, 5),
('6241fb9f-6840-4a60-b4ba-881196bfbeb1', '6ee88a33-553e-4d2a-9288-124bacd7cddb', 'Zeno', 'Lindqvist', 68, 'F', 86, 31, 87, 50, 50, 710000, 4),
('f367f676-5b74-4561-b37e-339386ca4992', '6ee88a33-553e-4d2a-9288-124bacd7cddb', 'Leandro', 'Kovář', 5, 'F', 85, 21, 89, 50, 50, 390000, 4),
('a3299db2-e9ab-4ac4-9b94-3500402a2c3a', '6ee88a33-553e-4d2a-9288-124bacd7cddb', 'Caio', 'Arriaga', 26, 'F', 84, 25, 86, 50, 50, 600000, 5),
('a7fa6ee7-39ee-4bf1-a927-2ec6536393e8', '9cca4d3e-b45e-45c1-8cda-270a54fe3669', 'Hakon', 'Rautio', 61, 'G', 85, 28, 86, 50, 50, 650000, 1),
('a0b8bb49-2fea-41f0-b8dd-c6d680f53ae4', '9cca4d3e-b45e-45c1-8cda-270a54fe3669', 'Nahuel', 'Falkner', 85, 'G', 71, 19, 79, 50, 50, 140000, 1),
('ddc3279e-1384-4c87-9c21-b675a4c4bf77', '9cca4d3e-b45e-45c1-8cda-270a54fe3669', 'Otto', 'Hidalgo', 26, 'D', 91, 26, 93, 50, 50, 1020000, 5),
('b009192e-d1f0-4d6e-a00a-4eea6c5b1eb4', '9cca4d3e-b45e-45c1-8cda-270a54fe3669', 'Lisandro', 'Cabrales', 60, 'D', 90, 29, 91, 50, 50, 950000, 5),
('356f9547-12e8-42d7-bf1b-51301270cfc9', '9cca4d3e-b45e-45c1-8cda-270a54fe3669', 'Olaf', 'Galindo', 34, 'D', 88, 24, 92, 50, 50, 820000, 1),
('a8c13aed-8df6-4a50-a440-97f75b5160f9', '9cca4d3e-b45e-45c1-8cda-270a54fe3669', 'Silas', 'Falkner', 13, 'D', 87, 23, 92, 50, 50, 760000, 2),
('7383057c-c975-4f2c-80df-b25c0080d4a8', '9cca4d3e-b45e-45c1-8cda-270a54fe3669', 'Pablo', 'Quintanar', 33, 'D', 85, 22, 88, 50, 50, 650000, 5),
('297e1da1-b2d4-485f-b8b1-4714d19531bc', '9cca4d3e-b45e-45c1-8cda-270a54fe3669', 'Adrián', 'Borrego', 71, 'D', 84, 31, 85, 50, 50, 600000, 4),
('f81b24d4-d561-4570-ac8f-c192b4469a51', '9cca4d3e-b45e-45c1-8cda-270a54fe3669', 'Casimir', 'Zapatero', 53, 'F', 99, 26, 100, 50, 50, 1740000, 4),
('2aae0e33-a074-4301-9417-236c34488525', '9cca4d3e-b45e-45c1-8cda-270a54fe3669', 'Sebastián', 'Aaltonen', 72, 'F', 98, 27, 99, 50, 50, 1630000, 4),
('fd8167b4-6f59-4c81-90a3-d759b4a795cb', '9cca4d3e-b45e-45c1-8cda-270a54fe3669', 'Lucas', 'Hidalgo', 81, 'F', 97, 21, 100, 50, 50, 920000, 5),
('57aecadf-2414-448f-925b-31c64822ecfb', '9cca4d3e-b45e-45c1-8cda-270a54fe3669', 'Julián', 'Quiroga', 77, 'F', 96, 26, 97, 50, 50, 1440000, 2),
('bf4308b5-924c-45a7-9242-e0e9d9e2530f', '9cca4d3e-b45e-45c1-8cda-270a54fe3669', 'Nahuel', 'Arriaga', 73, 'F', 95, 25, 97, 50, 50, 1340000, 3),
('84b88219-ecf2-44d1-8e68-55a893b11030', '9cca4d3e-b45e-45c1-8cda-270a54fe3669', 'Jaakko', 'Lindqvist', 94, 'F', 94, 27, 94, 50, 50, 1260000, 1),
('900837c5-4fab-47cd-a412-37f1bb430fe8', '9cca4d3e-b45e-45c1-8cda-270a54fe3669', 'Leandro', 'Navarrete', 10, 'F', 93, 30, 94, 50, 50, 1170000, 1),
('7801e954-02a6-4d64-a957-36b5d9ddbed8', '9cca4d3e-b45e-45c1-8cda-270a54fe3669', 'Gustavo', 'Navarrete', 80, 'F', 92, 22, 100, 50, 50, 1090000, 2),
('a6db745f-b5b9-438d-8b3e-c19e4329d075', '9cca4d3e-b45e-45c1-8cda-270a54fe3669', 'Ilan', 'Abarca', 31, 'F', 91, 32, 92, 50, 50, 1020000, 5),
('bdfaa15a-adbd-40c5-9e49-53dd5f53d707', '9cca4d3e-b45e-45c1-8cda-270a54fe3669', 'Matías', 'Lindahl', 16, 'F', 90, 24, 93, 50, 50, 950000, 2),
('1d040400-cf41-4d43-96c9-778239933104', '9cca4d3e-b45e-45c1-8cda-270a54fe3669', 'Benicio', 'Riquelme', 42, 'F', 89, 25, 91, 50, 50, 880000, 3),
('ae38d650-d070-42b5-a16b-960f8efe4eac', '9cca4d3e-b45e-45c1-8cda-270a54fe3669', 'Pavel', 'Saarinen', 93, 'F', 88, 21, 95, 50, 50, 490000, 2),
('21c515c5-8ac5-492f-8f38-5f69b9cdb24a', '2b160a2b-433d-4794-adb6-e8835c6b4463', 'Santino', 'Kallio', 33, 'G', 75, 30, 77, 50, 50, 300000, 5),
('1f171d3e-6664-44ee-a2a3-b2e1259cb19f', '2b160a2b-433d-4794-adb6-e8835c6b4463', 'Bruno', 'Holmqvist', 41, 'G', 64, 27, 65, 50, 50, 160000, 1),
('6e5a4750-2eb5-4e50-bd5c-aefd9ad27770', '2b160a2b-433d-4794-adb6-e8835c6b4463', 'Hugo', 'Borrego', 4, 'D', 87, 30, 88, 50, 50, 760000, 2),
('f490d3f3-c4df-4255-87af-3ef45002483e', '2b160a2b-433d-4794-adb6-e8835c6b4463', 'Otto', 'Aaltonen', 29, 'D', 86, 28, 86, 50, 50, 710000, 3),
('aea89b02-426a-4f71-b138-29fb7db69669', '2b160a2b-433d-4794-adb6-e8835c6b4463', 'Dorian', 'Zelenka', 24, 'D', 84, 27, 85, 50, 50, 600000, 4),
('a4a1a22b-0351-4d30-b5b3-0166325ca26b', '2b160a2b-433d-4794-adb6-e8835c6b4463', 'Fabián', 'Riquelme', 17, 'D', 83, 30, 84, 50, 50, 560000, 3),
('f5542f32-0cba-47c3-92b9-9b8e3eaf015a', '2b160a2b-433d-4794-adb6-e8835c6b4463', 'Anders', 'Delacroix', 31, 'D', 81, 29, 83, 50, 50, 480000, 1),
('1f4e7dec-b403-4cba-b1e8-15c3ddb98503', '2b160a2b-433d-4794-adb6-e8835c6b4463', 'Jonas', 'Ordaz', 64, 'D', 80, 23, 84, 50, 50, 440000, 1),
('0e87d462-29cd-4184-85a4-33c06c3ff50f', '2b160a2b-433d-4794-adb6-e8835c6b4463', 'Quentin', 'Albrecht', 67, 'F', 96, 29, 98, 50, 50, 1440000, 4),
('a14acfd1-374d-4722-b98a-602445cac233', '2b160a2b-433d-4794-adb6-e8835c6b4463', 'Ilan', 'Gallardo', 84, 'F', 95, 26, 97, 50, 50, 1340000, 1),
('4aacaad6-4e48-44a7-8b02-d1b5257a80c4', '2b160a2b-433d-4794-adb6-e8835c6b4463', 'Pavel', 'Duarte', 34, 'F', 94, 32, 96, 50, 50, 1260000, 2),
('8ef9f586-b389-47d6-a6f3-c5dd8d561595', '2b160a2b-433d-4794-adb6-e8835c6b4463', 'Eero', 'Bramante', 60, 'F', 93, 24, 97, 50, 50, 1170000, 1),
('fb221a0f-3fea-44c3-97c3-eb23a10e35c8', '2b160a2b-433d-4794-adb6-e8835c6b4463', 'Rasmus', 'Echeverri', 46, 'F', 91, 28, 91, 50, 50, 1020000, 4),
('61f81c57-8aaa-4a54-857c-31f63435faa7', '2b160a2b-433d-4794-adb6-e8835c6b4463', 'Lauri', 'Renteria', 94, 'F', 91, 29, 92, 50, 50, 1020000, 4),
('2c30b469-2ef0-4aa6-be58-85ed5937734b', '2b160a2b-433d-4794-adb6-e8835c6b4463', 'Santino', 'Valdivia', 5, 'F', 90, 27, 91, 50, 50, 950000, 5),
('7c8d2313-5f44-4102-b806-776909a8c36c', '2b160a2b-433d-4794-adb6-e8835c6b4463', 'Valtteri', 'Ostrowski', 38, 'F', 88, 22, 93, 50, 50, 820000, 2),
('82b7d931-b75c-4c53-bed6-2a76fae06421', '2b160a2b-433d-4794-adb6-e8835c6b4463', 'Lisandro', 'Toivonen', 49, 'F', 88, 32, 88, 50, 50, 820000, 1),
('53b764d2-6524-4903-a8f7-8b3aec178380', '2b160a2b-433d-4794-adb6-e8835c6b4463', 'Eero', 'Escalante', 93, 'F', 87, 27, 89, 50, 50, 760000, 3),
('a6acf572-fe92-4a89-9347-cca80e05e8df', '2b160a2b-433d-4794-adb6-e8835c6b4463', 'Rodrigo', 'Vallejo', 37, 'F', 86, 24, 90, 50, 50, 710000, 5),
('77a1de3b-3d9a-4056-b8d9-5c97e6cdf4ee', '2b160a2b-433d-4794-adb6-e8835c6b4463', 'Renzo', 'Iturbe', 86, 'F', 85, 20, 91, 50, 50, 390000, 2),
('c7e94fb1-58b8-4b56-9d0b-00f1f00adaab', '6d2bedd3-0746-4328-b1c8-7bd8af1f07c2', 'Elio', 'Aaltonen', 66, 'G', 85, 26, 86, 50, 50, 650000, 5),
('be5734f3-1fb4-4a0c-bb58-b471fd899dc0', '6d2bedd3-0746-4328-b1c8-7bd8af1f07c2', 'Magnus', 'Hidalgo', 37, 'G', 74, 31, 74, 50, 50, 280000, 1),
('ae7ef0e0-eb20-4497-9aed-e007f67f04c3', '6d2bedd3-0746-4328-b1c8-7bd8af1f07c2', 'Ivo', 'Lindqvist', 57, 'D', 91, 23, 95, 50, 50, 1020000, 2),
('14068e26-e1b6-4b39-8ded-dfbc5fe14e84', '6d2bedd3-0746-4328-b1c8-7bd8af1f07c2', 'Silas', 'Belmonte', 28, 'D', 90, 27, 91, 50, 50, 950000, 5),
('42e01bdb-80c8-4a72-b8a3-0a80a3064fae', '6d2bedd3-0746-4328-b1c8-7bd8af1f07c2', 'Andrés', 'Almonte', 56, 'D', 88, 24, 89, 50, 50, 820000, 2),
('d68f8514-ebac-479a-a257-efa8c803a57f', '6d2bedd3-0746-4328-b1c8-7bd8af1f07c2', 'Julián', 'Bergkvist', 76, 'D', 87, 27, 88, 50, 50, 760000, 5),
('bcc883fb-6f0a-477f-892e-d5e800fd4617', '6d2bedd3-0746-4328-b1c8-7bd8af1f07c2', 'Amadeo', 'Zelenka', 31, 'D', 85, 27, 86, 50, 50, 650000, 3),
('c2244852-a833-4507-af4a-a1d165c03786', '6d2bedd3-0746-4328-b1c8-7bd8af1f07c2', 'Zeno', 'Almonte', 62, 'D', 84, 32, 84, 50, 50, 600000, 4),
('62496612-e852-458c-9851-514a5240031c', '6d2bedd3-0746-4328-b1c8-7bd8af1f07c2', 'Rasmus', 'Marklund', 87, 'F', 95, 27, 96, 50, 50, 1340000, 1),
('ed188413-2497-420d-898c-67b8e2945f81', '6d2bedd3-0746-4328-b1c8-7bd8af1f07c2', 'Silas', 'Escalante', 81, 'F', 94, 24, 96, 50, 50, 1260000, 2),
('f8955522-84d8-4b46-822c-a749eeed39d1', '6d2bedd3-0746-4328-b1c8-7bd8af1f07c2', 'Bruno', 'Quiroga', 96, 'F', 93, 24, 96, 50, 50, 1170000, 2),
('653d9b02-bb62-4105-a58e-a11c45a37bd4', '6d2bedd3-0746-4328-b1c8-7bd8af1f07c2', 'Aldo', 'Corvalán', 35, 'F', 92, 27, 93, 50, 50, 1090000, 3),
('48a74169-601f-44fd-b644-63221fe44c32', '6d2bedd3-0746-4328-b1c8-7bd8af1f07c2', 'Dorian', 'Jansky', 33, 'F', 91, 24, 95, 50, 50, 1020000, 4),
('d657ce86-b6fb-4728-9112-734e6fb17381', '6d2bedd3-0746-4328-b1c8-7bd8af1f07c2', 'Rune', 'Aaltonen', 22, 'F', 90, 23, 94, 50, 50, 950000, 5),
('9b3f2fd0-1abd-48a5-8fd0-c010c73d2380', '6d2bedd3-0746-4328-b1c8-7bd8af1f07c2', 'Bastian', 'Delacroix', 55, 'F', 89, 23, 95, 50, 50, 880000, 1),
('26f2385f-b3e6-43a9-9674-376cf6a88c8a', '6d2bedd3-0746-4328-b1c8-7bd8af1f07c2', 'Pavel', 'Delacroix', 45, 'F', 88, 29, 90, 50, 50, 820000, 1),
('d442bffc-a9ab-435f-9ed2-80654e3983a3', '6d2bedd3-0746-4328-b1c8-7bd8af1f07c2', 'Otto', 'Pellerin', 47, 'F', 87, 23, 93, 50, 50, 760000, 2),
('54f1511b-62d9-418b-aada-afb2e17422c1', '6d2bedd3-0746-4328-b1c8-7bd8af1f07c2', 'Sven', 'Urquiza', 91, 'F', 86, 22, 88, 50, 50, 710000, 2),
('22206bd7-262f-4e8b-a4c4-6ca8ec94755f', '6d2bedd3-0746-4328-b1c8-7bd8af1f07c2', 'Esteban', 'Dahlberg', 49, 'F', 85, 23, 88, 50, 50, 650000, 1),
('1d995e33-bff2-4631-be9f-c8a2015bc28e', '6d2bedd3-0746-4328-b1c8-7bd8af1f07c2', 'Samuel', 'Villaseñor', 51, 'F', 84, 28, 84, 50, 50, 600000, 3),
('5ecd4bbd-678a-4d1f-a78f-f61a32db56a5', '17de141f-4ca9-4f73-98f4-4010e6a97b97', 'Elio', 'Brandt', 84, 'G', 92, 20, 97, 50, 50, 660000, 4),
('74dbf7c4-013b-4544-b96e-6e5fcefd1157', '17de141f-4ca9-4f73-98f4-4010e6a97b97', 'Silas', 'Marklund', 27, 'G', 83, 28, 84, 50, 50, 560000, 5),
('cfe5b570-cac8-40d5-9bba-ab58e462d833', '17de141f-4ca9-4f73-98f4-4010e6a97b97', 'Mattis', 'Garmendia', 68, 'D', 90, 29, 92, 50, 50, 950000, 3),
('06c301b5-8d86-45ce-8693-136f8ddfd8a3', '17de141f-4ca9-4f73-98f4-4010e6a97b97', 'Marek', 'Wahlgren', 78, 'D', 89, 24, 91, 50, 50, 880000, 4),
('7b6efe92-6e66-45c4-b8f9-c4f573889399', '17de141f-4ca9-4f73-98f4-4010e6a97b97', 'Fabián', 'Quiroga', 32, 'D', 87, 30, 87, 50, 50, 760000, 5),
('5d8fa345-086e-4e1f-b748-d69e7a8ec286', '17de141f-4ca9-4f73-98f4-4010e6a97b97', 'Sebastián', 'Zapatero', 86, 'D', 86, 26, 86, 50, 50, 710000, 4),
('ba7b4762-b427-450f-b59b-8cab60bdd3fa', '17de141f-4ca9-4f73-98f4-4010e6a97b97', 'Tadeo', 'Dahlberg', 23, 'D', 84, 23, 88, 50, 50, 600000, 2),
('54fa3db9-0e16-4e99-84ed-e3a4c97c82ba', '17de141f-4ca9-4f73-98f4-4010e6a97b97', 'Elio', 'Escalante', 65, 'D', 83, 24, 86, 50, 50, 560000, 1),
('d1b3255f-f56f-45e6-86f6-658316d4bbb8', '17de141f-4ca9-4f73-98f4-4010e6a97b97', 'Ivo', 'Vallejo', 18, 'F', 91, 26, 91, 50, 50, 1020000, 1),
('2536bf84-dc41-4464-bea7-a5265a2a147c', '17de141f-4ca9-4f73-98f4-4010e6a97b97', 'Felix', 'Castellví', 53, 'F', 90, 26, 91, 50, 50, 950000, 2),
('5ed7c155-639c-4eed-925b-51b6f5325755', '17de141f-4ca9-4f73-98f4-4010e6a97b97', 'Renzo', 'Vallejo', 95, 'F', 89, 27, 90, 50, 50, 880000, 1),
('9b021a20-3e8e-4c07-9c5c-d8f3c41bc2fa', '17de141f-4ca9-4f73-98f4-4010e6a97b97', 'Anders', 'Abarca', 39, 'F', 88, 28, 88, 50, 50, 820000, 1),
('3bc67b2f-22ea-4c3d-86b9-a2aefb70d4aa', '17de141f-4ca9-4f73-98f4-4010e6a97b97', 'Yannick', 'Kallio', 85, 'F', 87, 31, 87, 50, 50, 760000, 5),
('f513bc28-37b3-4ec1-84dd-c25ad715101b', '17de141f-4ca9-4f73-98f4-4010e6a97b97', 'Bruno', 'Jurado', 47, 'F', 86, 32, 87, 50, 50, 710000, 1),
('0d091544-795d-44a0-82c0-006f7c5a09a6', '17de141f-4ca9-4f73-98f4-4010e6a97b97', 'Marek', 'Renteria', 93, 'F', 84, 31, 85, 50, 50, 600000, 4),
('bad4fdaf-6ef8-4efa-850d-9816312f781b', '17de141f-4ca9-4f73-98f4-4010e6a97b97', 'Magnus', 'Kovář', 52, 'F', 84, 34, 84, 50, 50, 510000, 4),
('0b40dafe-0f64-4279-b9ff-ba5b9dde9e32', '17de141f-4ca9-4f73-98f4-4010e6a97b97', 'Viggo', 'Karlsen', 83, 'F', 83, 19, 93, 50, 50, 340000, 3),
('371c4c27-42a8-437d-ab05-1052db622c92', '17de141f-4ca9-4f73-98f4-4010e6a97b97', 'Aldo', 'Westerlund', 80, 'F', 81, 27, 82, 50, 50, 480000, 1),
('20e309f3-ea6f-4106-8958-3024df57a171', '17de141f-4ca9-4f73-98f4-4010e6a97b97', 'Leandro', 'Zapatero', 61, 'F', 81, 29, 81, 50, 50, 480000, 5),
('257c7372-94e8-41b7-b7e8-ae0ff39e4b50', '17de141f-4ca9-4f73-98f4-4010e6a97b97', 'Ilan', 'Iturbe', 74, 'F', 80, 22, 88, 50, 50, 440000, 2),
('0a2aea87-88e0-4796-9f24-d0f19e32a710', 'e8e8fb72-04ba-477d-a4a7-0c298e8e4809', 'Lisandro', 'Norberg', 10, 'G', 90, 25, 92, 50, 50, 950000, 4),
('2172844a-5ceb-48d8-8168-2e117c92330d', 'e8e8fb72-04ba-477d-a4a7-0c298e8e4809', 'Joaquín', 'Arriaga', 36, 'G', 76, 33, 76, 50, 50, 270000, 1),
('c1cdb66a-bc96-438f-be38-4377b28a9e77', 'e8e8fb72-04ba-477d-a4a7-0c298e8e4809', 'Amadeo', 'Delacroix', 37, 'D', 92, 23, 95, 50, 50, 1090000, 1),
('2cbad3b1-1a26-4bbb-b84f-2aed3b120f81', 'e8e8fb72-04ba-477d-a4a7-0c298e8e4809', 'Damián', 'Ybarra', 49, 'D', 91, 30, 92, 50, 50, 1020000, 1),
('2320ce05-2dd4-40e0-b3aa-eedb53def3fd', 'e8e8fb72-04ba-477d-a4a7-0c298e8e4809', 'Benicio', 'Arnesen', 75, 'D', 89, 26, 90, 50, 50, 880000, 3),
('f1a36d87-7a6f-4dd7-a953-dc4b50dd706d', 'e8e8fb72-04ba-477d-a4a7-0c298e8e4809', 'Hakon', 'Ekholm', 94, 'D', 88, 31, 89, 50, 50, 820000, 3),
('62d79dc1-a579-4c0c-94f3-a2a2cd80b64a', 'e8e8fb72-04ba-477d-a4a7-0c298e8e4809', 'Felix', 'Zamora', 17, 'D', 86, 25, 88, 50, 50, 710000, 1),
('31281e24-073c-4835-a986-e8ebec6f8954', 'e8e8fb72-04ba-477d-a4a7-0c298e8e4809', 'Otto', 'Castellví', 5, 'D', 85, 28, 86, 50, 50, 650000, 3),
('ead1e709-f1b0-431e-af54-7cccf6e64cee', 'e8e8fb72-04ba-477d-a4a7-0c298e8e4809', 'Viggo', 'Fonteyne', 69, 'F', 92, 29, 93, 50, 50, 1090000, 5),
('54c627ca-ec66-4d29-8bb1-bfe06d0ab064', 'e8e8fb72-04ba-477d-a4a7-0c298e8e4809', 'Kai', 'Vikström', 13, 'F', 91, 21, 95, 50, 50, 610000, 4),
('bb5d2f62-3179-4c92-93ce-909483e7f27a', 'e8e8fb72-04ba-477d-a4a7-0c298e8e4809', 'Leandro', 'Westerlund', 88, 'F', 90, 30, 91, 50, 50, 950000, 1),
('87a28df3-2f65-466a-876b-2fbba39047be', 'e8e8fb72-04ba-477d-a4a7-0c298e8e4809', 'Kai', 'Valdivia', 79, 'F', 89, 25, 91, 50, 50, 880000, 5),
('6917d25b-3535-46e3-854c-b951c3c01229', 'e8e8fb72-04ba-477d-a4a7-0c298e8e4809', 'Lenny', 'Sandoval', 58, 'F', 88, 23, 96, 50, 50, 820000, 3),
('cbd3ad63-9750-466e-90cb-adae9f47ed0f', 'e8e8fb72-04ba-477d-a4a7-0c298e8e4809', 'Caio', 'Quiroga', 66, 'F', 87, 32, 88, 50, 50, 760000, 5),
('3dd018e0-87d9-450b-8bac-62b4b843ec4f', 'e8e8fb72-04ba-477d-a4a7-0c298e8e4809', 'Santino', 'Albrecht', 45, 'F', 86, 31, 86, 50, 50, 710000, 1),
('72b58de5-4f74-4442-8617-3512ef5f82e1', 'e8e8fb72-04ba-477d-a4a7-0c298e8e4809', 'Lisandro', 'Almonte', 28, 'F', 85, 24, 89, 50, 50, 650000, 4),
('c61171f6-f5b8-423e-8830-07abbf0626c7', 'e8e8fb72-04ba-477d-a4a7-0c298e8e4809', 'Oskar', 'Riquelme', 64, 'F', 84, 27, 86, 50, 50, 600000, 5),
('9be3215b-00b2-4f40-809e-8b2465666e1c', 'e8e8fb72-04ba-477d-a4a7-0c298e8e4809', 'Kai', 'Holmqvist', 20, 'F', 82, 29, 83, 50, 50, 520000, 1),
('f894c71c-57be-4f46-b4a2-11bd397263ea', 'e8e8fb72-04ba-477d-a4a7-0c298e8e4809', 'Renzo', 'Salazar', 52, 'F', 82, 29, 82, 50, 50, 520000, 2),
('330939e5-0557-4593-803b-05e9aa22aa48', 'e8e8fb72-04ba-477d-a4a7-0c298e8e4809', 'Alvar', 'Renteria', 56, 'F', 81, 25, 84, 50, 50, 480000, 2);
insert into players (id, team_id, first_name, last_name, number, position, rating, age, potential, form, morale, salary, contract_years) values
('9b05d09a-629f-432a-ab18-ea2d84eea9fe', 'da8bc0b2-2c80-4317-9038-fba29f048450', 'Samuel', 'Navarrete', 94, 'G', 93, 28, 95, 50, 50, 1170000, 4),
('2daebe40-8390-441e-a219-e0cc6887cf9d', 'da8bc0b2-2c80-4317-9038-fba29f048450', 'Matías', 'Marklund', 21, 'G', 82, 26, 83, 50, 50, 520000, 1),
('18b7d907-506f-4d48-b9dd-d1a183efc37d', 'da8bc0b2-2c80-4317-9038-fba29f048450', 'Gideon', 'Borrego', 77, 'D', 87, 28, 88, 50, 50, 760000, 2),
('38f09944-08d6-4662-a777-d55201666854', 'da8bc0b2-2c80-4317-9038-fba29f048450', 'Ilan', 'Tamayo', 8, 'D', 86, 26, 87, 50, 50, 710000, 1),
('687bccfc-5d38-481b-821e-91d038912da7', 'da8bc0b2-2c80-4317-9038-fba29f048450', 'Oskar', 'Lozano', 97, 'D', 84, 23, 91, 50, 50, 600000, 4),
('b707dabf-a1a0-40bf-9ea1-620628b1acfd', 'da8bc0b2-2c80-4317-9038-fba29f048450', 'Kai', 'Urquiza', 81, 'D', 83, 27, 85, 50, 50, 560000, 3),
('5ff1463d-14a4-4dc7-a119-12708e5dd1ce', 'da8bc0b2-2c80-4317-9038-fba29f048450', 'Jaakko', 'Ostrowski', 10, 'D', 81, 29, 81, 50, 50, 480000, 2),
('46331845-4ee4-433e-8e9a-00f03f812486', 'da8bc0b2-2c80-4317-9038-fba29f048450', 'Cedric', 'Saarinen', 36, 'D', 80, 26, 81, 50, 50, 440000, 2),
('46f010c4-ba02-439b-8f7f-792e5d3508e1', 'da8bc0b2-2c80-4317-9038-fba29f048450', 'Tadeo', 'Saarinen', 25, 'F', 94, 27, 95, 50, 50, 1260000, 3),
('2cd17257-49aa-44ba-96be-bc90cdbe0dcb', 'da8bc0b2-2c80-4317-9038-fba29f048450', 'Milo', 'Vasquez', 38, 'F', 93, 25, 94, 50, 50, 1170000, 4),
('0b1b345c-4404-4e6f-a820-9a665ecca789', 'da8bc0b2-2c80-4317-9038-fba29f048450', 'Enzo', 'Olmedo', 49, 'F', 92, 20, 96, 50, 50, 660000, 5),
('d3c0092e-ca8c-45e0-b6c8-4f55f1a4e203', 'da8bc0b2-2c80-4317-9038-fba29f048450', 'Nahuel', 'Haldane', 68, 'F', 91, 32, 91, 50, 50, 1020000, 5),
('942472e4-9696-4bc0-acbc-e2b8ffd26441', 'da8bc0b2-2c80-4317-9038-fba29f048450', 'Sven', 'Sandoval', 19, 'F', 90, 29, 91, 50, 50, 950000, 2),
('a9a91afa-ad45-4a34-bb1e-aa5d81004ae8', 'da8bc0b2-2c80-4317-9038-fba29f048450', 'Matías', 'Albrecht', 40, 'F', 89, 32, 90, 50, 50, 880000, 2),
('df543327-3c28-4dc1-b711-7080ac1ad937', 'da8bc0b2-2c80-4317-9038-fba29f048450', 'Bruno', 'Marklund', 83, 'F', 87, 26, 89, 50, 50, 760000, 1),
('0d5f3068-2fe0-4617-afa0-f5f7c63182d7', 'da8bc0b2-2c80-4317-9038-fba29f048450', 'Lauri', 'Jurado', 66, 'F', 86, 27, 87, 50, 50, 710000, 1),
('51b9e5bc-4d1d-42e5-ae0d-f37526650593', 'da8bc0b2-2c80-4317-9038-fba29f048450', 'Pavel', 'Báthory', 41, 'F', 86, 25, 88, 50, 50, 710000, 3),
('aa67a908-73b1-4712-9fd8-d49f517fcb7d', 'da8bc0b2-2c80-4317-9038-fba29f048450', 'Sven', 'Belmonte', 59, 'F', 85, 33, 87, 50, 50, 560000, 4),
('e61afb9c-41ba-41e0-806e-67233db49de6', 'da8bc0b2-2c80-4317-9038-fba29f048450', 'Quentin', 'Garmendia', 18, 'F', 84, 28, 85, 50, 50, 600000, 4),
('e58116d6-6460-4b2b-bac7-2958138f2a8b', 'da8bc0b2-2c80-4317-9038-fba29f048450', 'Teo', 'Albrecht', 46, 'F', 83, 27, 84, 50, 50, 560000, 1),
('178b7bc6-6dac-4ec9-98f9-fbe0ca240b40', '52040607-bbc9-4231-9779-b850e3e9901b', 'Emil', 'Nieminen', 58, 'G', 89, 31, 90, 50, 50, 880000, 5),
('fd56c13a-ec87-4a13-ab3d-fa44e7d9117c', '52040607-bbc9-4231-9779-b850e3e9901b', 'Dagur', 'Salazar', 52, 'G', 79, 25, 81, 50, 50, 410000, 5),
('9b0719d7-8230-4e05-b49a-7a742756dd6a', '52040607-bbc9-4231-9779-b850e3e9901b', 'Hakon', 'Castellví', 11, 'D', 92, 28, 94, 50, 50, 1090000, 3),
('18283f0e-0833-4d02-8cb0-022db3928d51', '52040607-bbc9-4231-9779-b850e3e9901b', 'Tobías', 'Urquiza', 36, 'D', 91, 31, 93, 50, 50, 1020000, 4),
('86fab850-eef4-4d10-92f9-a8173314fe9f', '52040607-bbc9-4231-9779-b850e3e9901b', 'Cedric', 'Norberg', 6, 'D', 89, 24, 91, 50, 50, 880000, 3),
('ac28c89a-d90a-40e4-a4f6-a1dd24ed900f', '52040607-bbc9-4231-9779-b850e3e9901b', 'Ciro', 'Bramante', 24, 'D', 88, 29, 89, 50, 50, 820000, 5),
('4d8dbc56-56c7-408f-887e-e133aee48b7b', '52040607-bbc9-4231-9779-b850e3e9901b', 'Amadeo', 'Brandt', 49, 'D', 86, 23, 91, 50, 50, 710000, 4),
('4a2e0908-c1f2-4cda-8159-88380b68bb1a', '52040607-bbc9-4231-9779-b850e3e9901b', 'Gustavo', 'Pellerin', 5, 'D', 85, 26, 87, 50, 50, 650000, 4),
('bbf087f4-2dd3-49e5-95e3-9f21614bafde', '52040607-bbc9-4231-9779-b850e3e9901b', 'Samuel', 'Zapatero', 60, 'F', 97, 25, 99, 50, 50, 1530000, 3),
('2b27ddd7-524c-4512-a9ef-0db3ec9ddba1', '52040607-bbc9-4231-9779-b850e3e9901b', 'Sven', 'Quintanar', 25, 'F', 96, 29, 97, 50, 50, 1440000, 5),
('4bba8db1-b2f8-472a-af0a-ea88d3d009c1', '52040607-bbc9-4231-9779-b850e3e9901b', 'Nahuel', 'Tamayo', 10, 'F', 95, 20, 100, 50, 50, 810000, 5),
('27b8c757-8326-4d04-bfa1-f7c1acd881fe', '52040607-bbc9-4231-9779-b850e3e9901b', 'Emil', 'Fjeldstad', 15, 'F', 94, 25, 97, 50, 50, 1260000, 1),
('426544e2-e32a-417f-a36b-f025f1dcfe27', '52040607-bbc9-4231-9779-b850e3e9901b', 'Julián', 'Ordaz', 70, 'F', 93, 26, 93, 50, 50, 1170000, 4),
('57b9b3c7-7761-4b30-b7d0-936cda89a365', '52040607-bbc9-4231-9779-b850e3e9901b', 'Sven', 'Albrecht', 82, 'F', 92, 33, 92, 50, 50, 930000, 4),
('4d3d564c-e8c9-47fa-bde4-53cb26293888', '52040607-bbc9-4231-9779-b850e3e9901b', 'Adrián', 'Montalvo', 16, 'F', 90, 24, 94, 50, 50, 950000, 1),
('2ed10542-b192-451e-89ce-7cbf84f0cf46', '52040607-bbc9-4231-9779-b850e3e9901b', 'Marek', 'Lozano', 47, 'F', 90, 24, 95, 50, 50, 950000, 5),
('72fc06a2-fc5c-436c-8516-52c3c214a1e3', '52040607-bbc9-4231-9779-b850e3e9901b', 'Lucas', 'Belmonte', 74, 'F', 89, 28, 90, 50, 50, 880000, 3),
('f5021124-de55-4b98-93f8-a31399022949', '52040607-bbc9-4231-9779-b850e3e9901b', 'Viggo', 'Vallejo', 33, 'F', 88, 25, 90, 50, 50, 820000, 4),
('337fafff-ba2c-4d9a-8185-de41a49a3654', '52040607-bbc9-4231-9779-b850e3e9901b', 'Cedric', 'Sandoval', 31, 'F', 87, 21, 95, 50, 50, 460000, 3),
('47fcab1b-d741-4350-a470-0cbee8208d52', '52040607-bbc9-4231-9779-b850e3e9901b', 'Eero', 'Villaseñor', 50, 'F', 86, 28, 87, 50, 50, 710000, 4),
('f718df59-52e7-42ce-a7ed-6eedf39a9340', '4fa9e7b4-5d05-4de4-bfd2-06acb3a828d4', 'Hakon', 'Fjeldstad', 60, 'G', 87, 31, 88, 50, 50, 760000, 3),
('3a05048c-a377-463e-a556-aeddb5215ba2', '4fa9e7b4-5d05-4de4-bfd2-06acb3a828d4', 'Marek', 'Escalante', 64, 'G', 73, 29, 74, 50, 50, 260000, 4),
('83454ac0-537f-428c-befa-ad6478b02c5a', '4fa9e7b4-5d05-4de4-bfd2-06acb3a828d4', 'Fausto', 'Landeros', 84, 'D', 89, 25, 91, 50, 50, 880000, 1),
('a5a0f331-7f40-4ac9-98ca-bff469dd652f', '4fa9e7b4-5d05-4de4-bfd2-06acb3a828d4', 'Zeno', 'Ostrowski', 80, 'D', 88, 30, 89, 50, 50, 820000, 3),
('0a65626f-0c9d-4d75-abf5-0d6267860f76', '4fa9e7b4-5d05-4de4-bfd2-06acb3a828d4', 'Anders', 'Nieminen', 98, 'D', 86, 30, 87, 50, 50, 710000, 2),
('774e1a26-5204-4c25-8019-a37c5d77a2ac', '4fa9e7b4-5d05-4de4-bfd2-06acb3a828d4', 'Viggo', 'Sundqvist', 32, 'D', 85, 28, 86, 50, 50, 650000, 1),
('63a0189d-cc24-45b6-9a0c-f42774fd66aa', '4fa9e7b4-5d05-4de4-bfd2-06acb3a828d4', 'Jaakko', 'Calderas', 94, 'D', 83, 23, 87, 50, 50, 560000, 2),
('02083aec-788c-419e-8a9b-d3111197104b', '4fa9e7b4-5d05-4de4-bfd2-06acb3a828d4', 'Leandro', 'Aaltonen', 2, 'D', 82, 33, 83, 50, 50, 440000, 2),
('6351173b-6893-4fcb-a81a-53c9a0066f71', '4fa9e7b4-5d05-4de4-bfd2-06acb3a828d4', 'Hugo', 'Rautio', 95, 'F', 92, 34, 94, 50, 50, 930000, 1),
('e38ee99f-168a-4cdc-8e12-580723d2b732', '4fa9e7b4-5d05-4de4-bfd2-06acb3a828d4', 'Esteban', 'Lagarde', 44, 'F', 91, 26, 92, 50, 50, 1020000, 4),
('b7a5890a-bf18-4762-b58f-56789a11994a', '4fa9e7b4-5d05-4de4-bfd2-06acb3a828d4', 'Bastian', 'Abarca', 55, 'F', 91, 23, 93, 50, 50, 1020000, 4),
('e3252bf4-950b-4081-b95c-cf2dbbf39f8b', '4fa9e7b4-5d05-4de4-bfd2-06acb3a828d4', 'Kasper', 'Kallio', 18, 'F', 89, 32, 89, 50, 50, 880000, 4),
('b82eca83-ac5a-4b26-a98c-61807d5bffda', '4fa9e7b4-5d05-4de4-bfd2-06acb3a828d4', 'Caio', 'Vasquez', 65, 'F', 88, 34, 90, 50, 50, 700000, 5),
('5bcaabb8-1ebc-499a-b5fc-a5fb98453982', '4fa9e7b4-5d05-4de4-bfd2-06acb3a828d4', 'Yago', 'Echeverri', 91, 'F', 87, 28, 88, 50, 50, 760000, 1),
('fea3014e-831a-4b90-ba9a-cb33ac5a1a0d', '4fa9e7b4-5d05-4de4-bfd2-06acb3a828d4', 'Elio', 'Vasquez', 25, 'F', 86, 26, 87, 50, 50, 710000, 4),
('5bb09692-aaf0-4bf0-a535-49a624e39919', '4fa9e7b4-5d05-4de4-bfd2-06acb3a828d4', 'Milo', 'Hidalgo', 57, 'F', 85, 24, 87, 50, 50, 650000, 5),
('24a25322-49a3-47cb-9be0-3c9ebcf692c9', '4fa9e7b4-5d05-4de4-bfd2-06acb3a828d4', 'Enzo', 'Escalante', 72, 'F', 84, 23, 89, 50, 50, 600000, 4),
('56ba6e47-76ac-4679-a885-6fc61c4b9516', '4fa9e7b4-5d05-4de4-bfd2-06acb3a828d4', 'Pavel', 'Zamora', 28, 'F', 83, 27, 84, 50, 50, 560000, 4),
('5920b9bd-2338-4288-aa07-8c495c675158', '4fa9e7b4-5d05-4de4-bfd2-06acb3a828d4', 'Ulises', 'Quintanar', 52, 'F', 82, 34, 83, 50, 50, 440000, 1),
('ca5b234d-e453-422e-bc6a-18bef95cba6b', '4fa9e7b4-5d05-4de4-bfd2-06acb3a828d4', 'Lenny', 'Quintanar', 90, 'F', 82, 26, 83, 50, 50, 520000, 5),
('911b53be-dc32-49ff-a06b-22d9c2dcd26a', '6845f9ab-2286-4175-824e-9698719e9b6e', 'Mattis', 'Urquiza', 89, 'G', 91, 24, 95, 50, 50, 1020000, 2),
('9745c30c-05e6-410a-8a5a-294ee67f45a9', '6845f9ab-2286-4175-824e-9698719e9b6e', 'Rasmus', 'Zamora', 24, 'G', 78, 28, 79, 50, 50, 380000, 2),
('e20e0ed0-5468-4fe8-a671-a4d76be73372', '6845f9ab-2286-4175-824e-9698719e9b6e', 'Leandro', 'Albrecht', 15, 'D', 94, 27, 95, 50, 50, 1260000, 4),
('a3dff9e9-e363-4e96-ab7f-808a70218a23', '6845f9ab-2286-4175-824e-9698719e9b6e', 'Lucas', 'Garmendia', 43, 'D', 93, 29, 95, 50, 50, 1170000, 3),
('c7a3d077-b164-453d-9e4a-487baf4738b7', '6845f9ab-2286-4175-824e-9698719e9b6e', 'Yago', 'Ostrowski', 30, 'D', 91, 27, 92, 50, 50, 1020000, 3),
('c2ca7f45-625b-4a56-8dc7-f47c7d86797a', '6845f9ab-2286-4175-824e-9698719e9b6e', 'Ciro', 'Salazar', 14, 'D', 90, 23, 94, 50, 50, 950000, 5),
('47f4490c-1e13-49a6-9f67-58797fd08e9c', '6845f9ab-2286-4175-824e-9698719e9b6e', 'Oskar', 'Maravilla', 29, 'D', 88, 24, 91, 50, 50, 820000, 5),
('90eea467-b369-483b-96a3-40c11b7c2e4d', '6845f9ab-2286-4175-824e-9698719e9b6e', 'Lauri', 'Sundqvist', 13, 'D', 87, 25, 90, 50, 50, 760000, 4),
('f8465963-4cac-4ac0-a0a4-938b1f06a76e', '6845f9ab-2286-4175-824e-9698719e9b6e', 'Gustavo', 'Villaseñor', 1, 'F', 97, 29, 98, 50, 50, 1530000, 2),
('220a04ad-04b1-4731-aaa0-0fa863f81f6f', '6845f9ab-2286-4175-824e-9698719e9b6e', 'Sven', 'Zapatero', 92, 'F', 96, 27, 98, 50, 50, 1440000, 5),
('4e1c67ac-2784-46cf-a22a-cfc0f45fadf6', '6845f9ab-2286-4175-824e-9698719e9b6e', 'Hakon', 'Ferrán', 20, 'F', 95, 26, 96, 50, 50, 1340000, 2),
('60de1487-6bc1-4b09-b510-425c7bfb50f1', '6845f9ab-2286-4175-824e-9698719e9b6e', 'Julián', 'Wahlgren', 31, 'F', 94, 29, 95, 50, 50, 1260000, 5),
('d47a9fb6-4303-45ef-940c-c78e1024f43b', '6845f9ab-2286-4175-824e-9698719e9b6e', 'Jaakko', 'Lindahl', 81, 'F', 93, 24, 96, 50, 50, 1170000, 3),
('e9df5b33-9860-4d75-9882-87e7fffe61c9', '6845f9ab-2286-4175-824e-9698719e9b6e', 'Noel', 'Sundqvist', 2, 'F', 92, 24, 97, 50, 50, 1090000, 4),
('cc52ac6e-c091-4fde-99fe-7a791a83c34d', '6845f9ab-2286-4175-824e-9698719e9b6e', 'Marek', 'Lagarde', 88, 'F', 91, 30, 91, 50, 50, 1020000, 2),
('ea6109e9-5fff-412c-ba08-ec2dffdb7c1d', '6845f9ab-2286-4175-824e-9698719e9b6e', 'Kasper', 'Lindahl', 58, 'F', 90, 25, 93, 50, 50, 950000, 2),
('ce03bc0c-6988-41b4-978f-965012ee2ccf', '6845f9ab-2286-4175-824e-9698719e9b6e', 'Jaakko', 'Norberg', 21, 'F', 90, 30, 91, 50, 50, 950000, 3),
('c54f56a8-f818-404e-a779-5cefbf679f1b', '6845f9ab-2286-4175-824e-9698719e9b6e', 'Julián', 'Toivonen', 42, 'F', 88, 22, 93, 50, 50, 820000, 1),
('391a499b-6839-4a73-b860-b7dcc6bfb558', '6845f9ab-2286-4175-824e-9698719e9b6e', 'Amadeo', 'Quiroga', 54, 'F', 87, 26, 87, 50, 50, 760000, 1),
('5ba1389c-3693-4482-b079-737ab1b6e6df', '6845f9ab-2286-4175-824e-9698719e9b6e', 'Alvar', 'Valdivia', 87, 'F', 86, 26, 87, 50, 50, 710000, 1),
('50855386-688b-4c45-8240-2242698dbdd6', 'b26f44fe-3dd3-4be9-9c69-a5ebfc330ac3', 'Anders', 'Landeros', 82, 'G', 89, 24, 92, 50, 50, 880000, 1),
('18c16d5e-58a3-4e48-a5e1-f566e7d0775c', 'b26f44fe-3dd3-4be9-9c69-a5ebfc330ac3', 'Rasmus', 'Jansky', 12, 'G', 79, 26, 80, 50, 50, 410000, 2),
('0cd2262b-df5e-4624-8242-9d0158a5412d', 'b26f44fe-3dd3-4be9-9c69-a5ebfc330ac3', 'Oskar', 'Holmqvist', 62, 'D', 87, 27, 88, 50, 50, 760000, 2),
('848b9af6-f193-4ee9-b350-4b67baa0af67', 'b26f44fe-3dd3-4be9-9c69-a5ebfc330ac3', 'Lenny', 'Navarrete', 48, 'D', 86, 27, 86, 50, 50, 710000, 3),
('b4de4cd4-09fe-4612-bb93-775725e3ad60', 'b26f44fe-3dd3-4be9-9c69-a5ebfc330ac3', 'Leandro', 'Ferrán', 7, 'D', 84, 25, 86, 50, 50, 600000, 1),
('9d77a1c3-d6e6-4714-bcb8-f020a8987a9c', 'b26f44fe-3dd3-4be9-9c69-a5ebfc330ac3', 'Fausto', 'Sundqvist', 91, 'D', 83, 26, 84, 50, 50, 560000, 1),
('38694aed-5b3b-4349-8274-ba907f712189', 'b26f44fe-3dd3-4be9-9c69-a5ebfc330ac3', 'Nikolai', 'Westerlund', 52, 'D', 81, 25, 83, 50, 50, 480000, 5),
('ad4e84ba-d1e4-4ae1-a398-d96744bbde6c', 'b26f44fe-3dd3-4be9-9c69-a5ebfc330ac3', 'Oskar', 'Zelenka', 79, 'D', 80, 31, 81, 50, 50, 440000, 2),
('46ec029f-2b51-4d2d-85af-2fdc147582c8', 'b26f44fe-3dd3-4be9-9c69-a5ebfc330ac3', 'Adrián', 'Cabrales', 78, 'F', 94, 28, 95, 50, 50, 1260000, 5),
('13c9e5c6-a690-4e35-99cf-d25a9a923ad0', 'b26f44fe-3dd3-4be9-9c69-a5ebfc330ac3', 'Sebastián', 'Lozano', 23, 'F', 93, 29, 94, 50, 50, 1170000, 3),
('edf98b88-2ce0-48ba-9d89-0a164b635168', 'b26f44fe-3dd3-4be9-9c69-a5ebfc330ac3', 'Bastian', 'Jansky', 75, 'F', 92, 33, 93, 50, 50, 930000, 2),
('d4e2648e-72ba-40bb-99f4-02d68cd207cd', 'b26f44fe-3dd3-4be9-9c69-a5ebfc330ac3', 'Gael', 'Arnesen', 4, 'F', 91, 27, 93, 50, 50, 1020000, 3),
('1a99fe80-9ccb-47fc-8446-14013034120a', 'b26f44fe-3dd3-4be9-9c69-a5ebfc330ac3', 'Sebastián', 'Corvalán', 44, 'F', 90, 27, 91, 50, 50, 950000, 3),
('69ae87f1-d6fc-4c8f-b6b6-1bde874a575a', 'b26f44fe-3dd3-4be9-9c69-a5ebfc330ac3', 'Thiago', 'Escalante', 19, 'F', 90, 36, 90, 50, 50, 810000, 2),
('7601b570-f56e-456c-8d65-9c8d5eebd116', 'b26f44fe-3dd3-4be9-9c69-a5ebfc330ac3', 'Sven', 'Ostrowski', 14, 'F', 88, 28, 89, 50, 50, 820000, 1),
('de12673b-3964-45dd-a34c-d8d9516aa3ea', 'b26f44fe-3dd3-4be9-9c69-a5ebfc330ac3', 'Gideon', 'Duarte', 68, 'F', 87, 19, 97, 50, 50, 460000, 3),
('15fa6cc0-3f7d-4ac7-9d2c-7570557bdbca', 'b26f44fe-3dd3-4be9-9c69-a5ebfc330ac3', 'Alvar', 'Ekholm', 27, 'F', 86, 28, 87, 50, 50, 710000, 5),
('e48ad3cc-aac7-47d8-a3fc-50244b4d2327', 'b26f44fe-3dd3-4be9-9c69-a5ebfc330ac3', 'Ciro', 'Delacroix', 89, 'F', 85, 33, 86, 50, 50, 560000, 2),
('eb847eb6-7528-4e9e-ba8a-14020a66abf6', 'b26f44fe-3dd3-4be9-9c69-a5ebfc330ac3', 'Rodrigo', 'Aaltonen', 56, 'F', 84, 29, 86, 50, 50, 600000, 4),
('a9a548d2-9f61-493a-92a9-a5a49a4cda92', 'b26f44fe-3dd3-4be9-9c69-a5ebfc330ac3', 'Gael', 'Wahlgren', 32, 'F', 83, 24, 86, 50, 50, 560000, 1),
('40c9ed05-c641-4591-befa-2f30e522fed5', 'e4698f56-ae91-4920-a6db-6ecbd26daf9e', 'Bastian', 'Quiroga', 90, 'G', 95, 27, 96, 50, 50, 1340000, 4),
('dd8809b6-21cb-4118-8db7-b48bc4c8293e', 'e4698f56-ae91-4920-a6db-6ecbd26daf9e', 'Magnus', 'Escalante', 6, 'G', 84, 27, 84, 50, 50, 600000, 1),
('14fd19fe-e7e0-4b0b-ab71-fe2a19e5973b', 'e4698f56-ae91-4920-a6db-6ecbd26daf9e', 'Ivo', 'Pellerin', 41, 'D', 92, 27, 93, 50, 50, 1090000, 4),
('c49e8f4d-2a1d-4a2b-8d89-515cace1890b', 'e4698f56-ae91-4920-a6db-6ecbd26daf9e', 'Jonas', 'Vikström', 84, 'D', 91, 25, 94, 50, 50, 1020000, 2),
('82e53c37-243f-43a1-a8f3-66ea7067781b', 'e4698f56-ae91-4920-a6db-6ecbd26daf9e', 'Tobías', 'Olmedo', 38, 'D', 89, 21, 97, 50, 50, 530000, 2),
('394b5bb1-378d-49ee-a73c-1edc96684390', 'e4698f56-ae91-4920-a6db-6ecbd26daf9e', 'Rune', 'Iturbe', 50, 'D', 88, 29, 88, 50, 50, 820000, 5),
('88409547-898f-4a0b-98ca-5cb8514d2e49', 'e4698f56-ae91-4920-a6db-6ecbd26daf9e', 'Jonas', 'Marklund', 18, 'D', 86, 32, 87, 50, 50, 710000, 5),
('6831077f-016a-4138-a18b-af794d0521e3', 'e4698f56-ae91-4920-a6db-6ecbd26daf9e', 'Vicente', 'Renteria', 59, 'D', 85, 31, 86, 50, 50, 650000, 3),
('2d7b523a-d89d-435d-89e3-208ef31deef5', 'e4698f56-ae91-4920-a6db-6ecbd26daf9e', 'Renzo', 'Bergkvist', 83, 'F', 95, 30, 96, 50, 50, 1340000, 2),
('662713a1-3111-4946-9b72-06b6ce10cb0e', 'e4698f56-ae91-4920-a6db-6ecbd26daf9e', 'Gustavo', 'Salazar', 3, 'F', 94, 27, 95, 50, 50, 1260000, 4),
('0be44be5-9a46-4049-bfde-04dbe0be2dab', 'e4698f56-ae91-4920-a6db-6ecbd26daf9e', 'Rafael', 'Jurado', 8, 'F', 94, 23, 99, 50, 50, 1260000, 1),
('78489903-3987-4739-9139-7b88b0ec28cb', 'e4698f56-ae91-4920-a6db-6ecbd26daf9e', 'Fabián', 'Toivonen', 85, 'F', 92, 28, 94, 50, 50, 1090000, 2),
('cfcd1e6b-5a81-44bb-bdf7-da6446fa60cf', 'e4698f56-ae91-4920-a6db-6ecbd26daf9e', 'Quentin', 'Brandt', 9, 'F', 91, 25, 93, 50, 50, 1020000, 1),
('26c9e870-2285-440a-a784-8bff235d1241', 'e4698f56-ae91-4920-a6db-6ecbd26daf9e', 'Enzo', 'Castellví', 1, 'F', 90, 28, 91, 50, 50, 950000, 2),
('b5b54cb9-190b-4d90-9766-19dc6d178243', 'e4698f56-ae91-4920-a6db-6ecbd26daf9e', 'Julián', 'Garmendia', 30, 'F', 88, 26, 89, 50, 50, 820000, 1),
('41375fb3-5a18-45bc-bfba-a888b1ceee65', 'e4698f56-ae91-4920-a6db-6ecbd26daf9e', 'Valtteri', 'Duarte', 16, 'F', 88, 31, 90, 50, 50, 820000, 4),
('d1e9a34d-2058-4ce2-b489-296617e5eaa4', 'e4698f56-ae91-4920-a6db-6ecbd26daf9e', 'Amadeo', 'Duarte', 96, 'F', 87, 32, 88, 50, 50, 760000, 2),
('2762aed2-4fe4-443e-a59c-bd6f8f46dd31', 'e4698f56-ae91-4920-a6db-6ecbd26daf9e', 'Jaakko', 'Carvajal', 28, 'F', 85, 25, 88, 50, 50, 650000, 4),
('7a5793fd-9581-4048-b8d1-c19f73c98a9f', 'e4698f56-ae91-4920-a6db-6ecbd26daf9e', 'Lisandro', 'Ekholm', 14, 'F', 85, 29, 87, 50, 50, 650000, 5),
('cf61ccd3-1aa2-4c6d-a8ba-62c0ea1f090d', 'e4698f56-ae91-4920-a6db-6ecbd26daf9e', 'Eero', 'Ordaz', 20, 'F', 84, 26, 86, 50, 50, 600000, 2),
('77309015-6216-4aa1-a341-9709a8243f3d', '2bd0821d-b1f1-4380-94c1-6e55e7aa7f0f', 'Yago', 'Ybarra', 84, 'G', 88, 28, 89, 50, 50, 820000, 5),
('2dc32d77-eaed-42b8-8ed4-20a1d77d6fd5', '2bd0821d-b1f1-4380-94c1-6e55e7aa7f0f', 'Adrián', 'Olmedo', 16, 'G', 73, 30, 74, 50, 50, 260000, 2),
('38ddc93a-edd5-48e0-9830-8666e7e4514a', '2bd0821d-b1f1-4380-94c1-6e55e7aa7f0f', 'Yago', 'Vallejo', 74, 'D', 94, 27, 95, 50, 50, 1260000, 3),
('3542308d-f686-4262-a684-d9aeccc9d76d', '2bd0821d-b1f1-4380-94c1-6e55e7aa7f0f', 'Dagur', 'Sundqvist', 55, 'D', 93, 33, 93, 50, 50, 1000000, 3),
('9c41657a-5f8c-4c5b-8ad6-817d294c66f2', '2bd0821d-b1f1-4380-94c1-6e55e7aa7f0f', 'Aldo', 'Maravilla', 73, 'D', 91, 28, 93, 50, 50, 1020000, 1),
('a8d97006-0476-45ff-95d1-dbb9f55cf974', '2bd0821d-b1f1-4380-94c1-6e55e7aa7f0f', 'Emil', 'Olmedo', 8, 'D', 90, 22, 99, 50, 50, 950000, 4),
('362a5e51-2de7-4d3e-a693-062b5d9b4464', '2bd0821d-b1f1-4380-94c1-6e55e7aa7f0f', 'Kai', 'Vallejo', 94, 'D', 88, 27, 88, 50, 50, 820000, 1),
('67155710-6d34-4e03-a392-df15eef9045f', '2bd0821d-b1f1-4380-94c1-6e55e7aa7f0f', 'Hugo', 'Zamora', 82, 'D', 87, 26, 88, 50, 50, 760000, 3),
('34d15878-131a-4196-ac2f-ac68213957a9', '2bd0821d-b1f1-4380-94c1-6e55e7aa7f0f', 'Milo', 'Navarrete', 97, 'F', 92, 29, 94, 50, 50, 1090000, 2),
('73979e36-41d9-4861-887a-5a8c6b29279c', '2bd0821d-b1f1-4380-94c1-6e55e7aa7f0f', 'Yannick', 'Renteria', 81, 'F', 91, 31, 91, 50, 50, 1020000, 1),
('a9b94153-7cb0-4caa-92a4-07c483b2fa7f', '2bd0821d-b1f1-4380-94c1-6e55e7aa7f0f', 'Oskar', 'Lindahl', 13, 'F', 91, 31, 92, 50, 50, 1020000, 2),
('97215dc4-eda7-4ac1-ace1-4b51a1db85b4', '2bd0821d-b1f1-4380-94c1-6e55e7aa7f0f', 'Lisandro', 'Halvorsen', 12, 'F', 88, 22, 96, 50, 50, 820000, 3),
('b9fe8210-9644-4726-b534-ca5e69ac16ee', '2bd0821d-b1f1-4380-94c1-6e55e7aa7f0f', 'Ivo', 'Montalvo', 17, 'F', 88, 32, 89, 50, 50, 820000, 3),
('5122c4c1-face-47e0-a5b5-de70ee65aa4d', '2bd0821d-b1f1-4380-94c1-6e55e7aa7f0f', 'Kasper', 'Ybarra', 93, 'F', 87, 19, 97, 50, 50, 460000, 1),
('a4a6e49c-75ac-46d1-9c53-f40c04e4654c', '2bd0821d-b1f1-4380-94c1-6e55e7aa7f0f', 'Dorian', 'Pellerin', 72, 'F', 86, 29, 86, 50, 50, 710000, 1),
('3baa84fa-fc9e-40b3-9802-d9e69d952c2a', '2bd0821d-b1f1-4380-94c1-6e55e7aa7f0f', 'Ilan', 'Cabrales', 35, 'F', 85, 27, 85, 50, 50, 650000, 5),
('dcc468ed-2864-410f-aaac-a439c2d2fdcc', '2bd0821d-b1f1-4380-94c1-6e55e7aa7f0f', 'Fausto', 'Maravilla', 49, 'F', 84, 25, 86, 50, 50, 600000, 4),
('abc3ce45-f605-4516-96da-b0bded30c2f3', '2bd0821d-b1f1-4380-94c1-6e55e7aa7f0f', 'Samuel', 'Vasquez', 40, 'F', 83, 24, 86, 50, 50, 560000, 5),
('cfbc5351-9df3-4c62-8745-150139bcd7a8', '2bd0821d-b1f1-4380-94c1-6e55e7aa7f0f', 'Anders', 'Calderas', 77, 'F', 82, 29, 83, 50, 50, 520000, 3),
('16f6d74c-da6f-49d4-b3c4-010ea7d6a542', '2bd0821d-b1f1-4380-94c1-6e55e7aa7f0f', 'Ciro', 'Kovář', 64, 'F', 81, 33, 82, 50, 50, 410000, 2),
('6722f8a2-d5da-45cc-866f-0ae59a1ca50f', 'fde34d04-6ab9-41f3-b94b-7599272243b0', 'Dorian', 'Bergkvist', 42, 'G', 81, 32, 83, 50, 50, 480000, 2),
('29862ea3-3e35-45d9-95fa-07ee2a1b3a4c', 'fde34d04-6ab9-41f3-b94b-7599272243b0', 'Pavel', 'Vallejo', 7, 'G', 71, 24, 74, 50, 50, 230000, 5),
('abdd1aae-b907-42de-a98e-5af4bd848eee', 'fde34d04-6ab9-41f3-b94b-7599272243b0', 'Yago', 'Delacroix', 70, 'D', 86, 29, 88, 50, 50, 710000, 5),
('ed073092-cc1e-4a47-877e-f270336b8152', 'fde34d04-6ab9-41f3-b94b-7599272243b0', 'Tadeo', 'Valdivia', 89, 'D', 85, 26, 87, 50, 50, 650000, 4),
('091454fc-deed-4b02-9fc3-f6e153a84198', 'fde34d04-6ab9-41f3-b94b-7599272243b0', 'Ulises', 'Gallardo', 82, 'D', 83, 25, 85, 50, 50, 560000, 5),
('35b06a9b-4655-493b-a907-a7aa608c5258', 'fde34d04-6ab9-41f3-b94b-7599272243b0', 'Jonas', 'Belmonte', 98, 'D', 82, 30, 83, 50, 50, 520000, 4),
('41d37d86-ed15-4d67-8d42-a04aae7b5e32', 'fde34d04-6ab9-41f3-b94b-7599272243b0', 'Sebastián', 'Olmedo', 72, 'D', 80, 26, 82, 50, 50, 440000, 1),
('b25d0734-5051-48c2-b6c6-67f6e9d2f7a5', 'fde34d04-6ab9-41f3-b94b-7599272243b0', 'Rodrigo', 'Calderas', 85, 'D', 79, 26, 80, 50, 50, 410000, 2),
('bd771f83-3f4c-476e-8f8f-1b7118ae4b4b', 'fde34d04-6ab9-41f3-b94b-7599272243b0', 'Lisandro', 'Sundqvist', 91, 'F', 92, 36, 93, 50, 50, 930000, 4),
('cf3c8384-fdc0-487c-a40e-99af41bc40ec', 'fde34d04-6ab9-41f3-b94b-7599272243b0', 'Lucas', 'Granqvist', 16, 'F', 91, 26, 93, 50, 50, 1020000, 4),
('ebcdd52e-dacf-485f-930d-03d8c6d10cf8', 'fde34d04-6ab9-41f3-b94b-7599272243b0', 'Elio', 'Borrego', 22, 'F', 90, 23, 95, 50, 50, 950000, 3),
('aeae19a8-fe52-4342-9a67-c141cfd982ae', 'fde34d04-6ab9-41f3-b94b-7599272243b0', 'Kasper', 'Escalante', 80, 'F', 89, 28, 90, 50, 50, 880000, 3),
('09fd02ea-a074-47b8-ba3d-fd6364371d06', 'fde34d04-6ab9-41f3-b94b-7599272243b0', 'Enzo', 'Brandt', 39, 'F', 88, 26, 89, 50, 50, 820000, 3),
('285b9547-7be0-404c-ba92-17325c650cc8', 'fde34d04-6ab9-41f3-b94b-7599272243b0', 'Leandro', 'Renteria', 11, 'F', 87, 27, 89, 50, 50, 760000, 1),
('03adb653-910f-47ff-90cd-32fa9b4c1d8e', 'fde34d04-6ab9-41f3-b94b-7599272243b0', 'Felix', 'Toivonen', 17, 'F', 86, 32, 87, 50, 50, 710000, 1),
('adf5ad1d-d09b-4fa0-8fea-e7642bf3f8d4', 'fde34d04-6ab9-41f3-b94b-7599272243b0', 'Tadeo', 'Sundqvist', 55, 'F', 85, 29, 87, 50, 50, 650000, 5),
('e20ccdfe-0897-4f1d-912b-f27393f8f8bb', 'fde34d04-6ab9-41f3-b94b-7599272243b0', 'Dorian', 'Escalante', 40, 'F', 84, 25, 87, 50, 50, 600000, 2),
('00bd242b-9e33-470e-8fc2-14afbceeed96', 'fde34d04-6ab9-41f3-b94b-7599272243b0', 'Bastian', 'Toivonen', 49, 'F', 83, 26, 84, 50, 50, 560000, 1),
('41ccf75a-7f59-40bb-bbce-b019e0efe32d', 'fde34d04-6ab9-41f3-b94b-7599272243b0', 'Milo', 'Westerlund', 57, 'F', 82, 27, 84, 50, 50, 520000, 2),
('65f457cd-51a6-472b-9caf-105731be5275', 'fde34d04-6ab9-41f3-b94b-7599272243b0', 'Arvid', 'Fonteyne', 90, 'F', 82, 27, 83, 50, 50, 520000, 3),
('150a6b8f-e9b3-4520-8021-2f2b398ea9e4', 'ca9e4115-7162-409f-984a-f89155680263', 'Gideon', 'Corvalán', 13, 'G', 89, 26, 89, 50, 50, 880000, 3),
('40f39562-68c6-4ab3-bd3a-401b9d10d6d5', 'ca9e4115-7162-409f-984a-f89155680263', 'Damián', 'Marklund', 78, 'G', 81, 27, 82, 50, 50, 480000, 4),
('ed843f61-8cbe-4df8-80be-2341e2703db0', 'ca9e4115-7162-409f-984a-f89155680263', 'Elio', 'Vikström', 74, 'D', 94, 22, 99, 50, 50, 1260000, 4),
('2e562977-4626-4aa6-b7a1-5b7bf343bd3d', 'ca9e4115-7162-409f-984a-f89155680263', 'Ciro', 'Arriaga', 30, 'D', 93, 23, 96, 50, 50, 1170000, 4),
('51a5e1ca-c006-4ec4-a7aa-985b6fcbc096', 'ca9e4115-7162-409f-984a-f89155680263', 'Fausto', 'Lindqvist', 66, 'D', 91, 27, 92, 50, 50, 1020000, 5),
('7be72def-2678-4e29-bb80-4a08d56c6d2b', 'ca9e4115-7162-409f-984a-f89155680263', 'Adrián', 'Falkner', 58, 'D', 90, 29, 91, 50, 50, 950000, 4),
('ac58920c-f8b8-487d-9bde-21b11404082e', 'ca9e4115-7162-409f-984a-f89155680263', 'Lucas', 'Ordaz', 49, 'D', 88, 30, 89, 50, 50, 820000, 3),
('17b3f759-d3b0-43fd-843e-094cbf9e52f0', 'ca9e4115-7162-409f-984a-f89155680263', 'Sebastián', 'Lindahl', 80, 'D', 87, 24, 90, 50, 50, 760000, 3),
('a9d5fbe6-9479-4b55-9267-f7384beee9b5', 'ca9e4115-7162-409f-984a-f89155680263', 'Jonas', 'Zapatero', 61, 'F', 91, 32, 92, 50, 50, 1020000, 1),
('0e4d9bbf-bae5-4d40-82ac-c2c77e445fb8', 'ca9e4115-7162-409f-984a-f89155680263', 'Enzo', 'Vallejo', 24, 'F', 90, 29, 91, 50, 50, 950000, 4),
('918b0d0c-4999-403f-b266-0f44a7abd22f', 'ca9e4115-7162-409f-984a-f89155680263', 'Rodrigo', 'Holmqvist', 70, 'F', 89, 25, 91, 50, 50, 880000, 1),
('5153e99a-3632-4d73-8c0e-de43e068e448', 'ca9e4115-7162-409f-984a-f89155680263', 'Elio', 'Ostrowski', 81, 'F', 88, 28, 88, 50, 50, 820000, 1),
('e56219a6-583a-4fdc-87db-e41f84b03843', 'ca9e4115-7162-409f-984a-f89155680263', 'Dagur', 'Lindahl', 35, 'F', 87, 30, 88, 50, 50, 760000, 2),
('0e2de7bc-5ec4-4abc-a73c-98d0707d9d4e', 'ca9e4115-7162-409f-984a-f89155680263', 'Rodrigo', 'Almonte', 88, 'F', 86, 27, 88, 50, 50, 710000, 1),
('ba2206c2-fb71-4850-9b3f-bf926d0602fd', 'ca9e4115-7162-409f-984a-f89155680263', 'Amadeo', 'Ybarra', 92, 'F', 85, 30, 86, 50, 50, 650000, 4),
('412b5267-fedd-4fbf-82ed-9547a646e648', 'ca9e4115-7162-409f-984a-f89155680263', 'Pavel', 'Halvorsen', 60, 'F', 84, 24, 88, 50, 50, 600000, 1),
('9ad63667-96f7-4b8a-8a62-e7fea75d16a3', 'ca9e4115-7162-409f-984a-f89155680263', 'Yannick', 'Pellerin', 10, 'F', 83, 26, 84, 50, 50, 560000, 3),
('c61ab070-a48a-4864-9d8e-02a5e0dec685', 'ca9e4115-7162-409f-984a-f89155680263', 'Lisandro', 'Hidalgo', 55, 'F', 82, 35, 82, 50, 50, 440000, 2),
('732e959d-cff8-4f99-bc3e-336bd8a6739f', 'ca9e4115-7162-409f-984a-f89155680263', 'Casimir', 'Calderas', 25, 'F', 81, 32, 83, 50, 50, 480000, 4),
('55e903be-01ea-4c29-adb4-3661818b9719', 'ca9e4115-7162-409f-984a-f89155680263', 'Hugo', 'Báthory', 29, 'F', 80, 26, 80, 50, 50, 440000, 3),
('48232e0b-68b5-42fd-b19f-21543e72ddc8', '91c32b14-5622-46a9-9519-43c7a027834d', 'Caio', 'Borrego', 55, 'G', 86, 29, 88, 50, 50, 710000, 4),
('5233a10d-efda-49f0-95f7-d256022a38aa', '91c32b14-5622-46a9-9519-43c7a027834d', 'Fausto', 'Renteria', 67, 'G', 77, 24, 80, 50, 50, 350000, 5),
('963fcf69-e69b-4625-92eb-d31c4bc5c5d4', '91c32b14-5622-46a9-9519-43c7a027834d', 'Hakon', 'Ordaz', 63, 'D', 100, 24, 100, 50, 50, 1850000, 5),
('0732782d-2532-4d2c-a513-548300e55b0f', '91c32b14-5622-46a9-9519-43c7a027834d', 'Sebastián', 'Ferrán', 86, 'D', 99, 25, 100, 50, 50, 1740000, 4),
('4c83eb4f-f5a1-40d2-99a5-50be593e55c0', '91c32b14-5622-46a9-9519-43c7a027834d', 'Marek', 'Landeros', 26, 'D', 97, 31, 99, 50, 50, 1530000, 5),
('ee93951e-7009-4200-a626-ffb883b925b2', '91c32b14-5622-46a9-9519-43c7a027834d', 'Pavel', 'Escalante', 20, 'D', 96, 26, 97, 50, 50, 1440000, 2),
('6ccd4db7-2ca0-4f77-bc60-c8302a9129eb', '91c32b14-5622-46a9-9519-43c7a027834d', 'Lenny', 'Lagarde', 90, 'D', 94, 30, 95, 50, 50, 1260000, 4),
('66935089-3204-4391-8eaa-c25f0b7ce67f', '91c32b14-5622-46a9-9519-43c7a027834d', 'Julián', 'Urquiza', 96, 'D', 93, 25, 95, 50, 50, 1170000, 3),
('93012676-815d-4011-979a-31a39f094941', '91c32b14-5622-46a9-9519-43c7a027834d', 'Thiago', 'Galindo', 56, 'F', 92, 35, 93, 50, 50, 930000, 3),
('0a7a66bd-339c-4f8b-b0a6-563b2488cd91', '91c32b14-5622-46a9-9519-43c7a027834d', 'Sven', 'Maravilla', 33, 'F', 91, 33, 93, 50, 50, 870000, 1),
('5d8822bb-eac0-4581-87a9-75e0eff7f02d', '91c32b14-5622-46a9-9519-43c7a027834d', 'Rune', 'Vallejo', 10, 'F', 91, 28, 93, 50, 50, 1020000, 2),
('7a9ffe1a-f57e-406b-95d1-07aedda4df6d', '91c32b14-5622-46a9-9519-43c7a027834d', 'Rafael', 'Valdivia', 5, 'F', 89, 33, 91, 50, 50, 750000, 3),
('b3bf0ca9-d113-4c0f-b329-4cf1c0307ad0', '91c32b14-5622-46a9-9519-43c7a027834d', 'Arvid', 'Holmqvist', 32, 'F', 88, 31, 89, 50, 50, 820000, 2),
('4aa43867-719b-4bce-a62e-a7f9959fb9b9', '91c32b14-5622-46a9-9519-43c7a027834d', 'Lisandro', 'Saarinen', 49, 'F', 87, 30, 88, 50, 50, 760000, 1),
('c24fd2e8-3f72-4866-890e-9a01410a82e1', '91c32b14-5622-46a9-9519-43c7a027834d', 'Nahuel', 'Vikström', 3, 'F', 85, 26, 85, 50, 50, 650000, 1),
('9c54a585-d9f8-4367-8482-bf7d56ee75cb', '91c32b14-5622-46a9-9519-43c7a027834d', 'Sebastián', 'Carvajal', 98, 'F', 85, 26, 86, 50, 50, 650000, 3),
('20f2cee2-5fd0-4d3d-b1ad-7c3d620022f0', '91c32b14-5622-46a9-9519-43c7a027834d', 'Rasmus', 'Ordaz', 42, 'F', 84, 23, 89, 50, 50, 600000, 3),
('0460048f-5301-419f-8947-cec2a85b5000', '91c32b14-5622-46a9-9519-43c7a027834d', 'Andrés', 'Zamora', 75, 'F', 82, 25, 84, 50, 50, 520000, 2),
('b5e49e8b-bb05-4703-ba9c-59a6a8d987a2', '91c32b14-5622-46a9-9519-43c7a027834d', 'Elio', 'Galindo', 17, 'F', 82, 31, 83, 50, 50, 520000, 5),
('20a84313-f008-48d8-bfd8-8722904ad2d6', '91c32b14-5622-46a9-9519-43c7a027834d', 'Nahuel', 'Carvajal', 59, 'F', 81, 26, 81, 50, 50, 480000, 3);
insert into players (id, team_id, first_name, last_name, number, position, rating, age, potential, form, morale, salary, contract_years) values
('eedaed3a-a921-4b20-a503-b95c178fb260', 'f924e118-f3d3-432a-ae0b-5e3c96e1538d', 'Ilan', 'Báthory', 4, 'G', 89, 26, 91, 50, 50, 880000, 1),
('3e88b986-5215-4f76-baed-190b0bf25b4b', 'f924e118-f3d3-432a-ae0b-5e3c96e1538d', 'Amadeo', 'Haldane', 98, 'G', 81, 24, 83, 50, 50, 480000, 3),
('a1d9d9e1-d596-4de9-9e62-3eff5ecb8445', 'f924e118-f3d3-432a-ae0b-5e3c96e1538d', 'Gideon', 'Kovář', 73, 'D', 89, 27, 90, 50, 50, 880000, 4),
('9b0b9023-eb22-442d-b1c6-5bff4d5cba2c', 'f924e118-f3d3-432a-ae0b-5e3c96e1538d', 'Matías', 'Quiroga', 44, 'D', 88, 30, 90, 50, 50, 820000, 2),
('302d8c32-d81a-485b-b741-c8dbef5a9dee', 'f924e118-f3d3-432a-ae0b-5e3c96e1538d', 'Aldo', 'Halvorsen', 17, 'D', 86, 29, 86, 50, 50, 710000, 3),
('82a8e0eb-56ae-4a98-bff3-3f63f58cf921', 'f924e118-f3d3-432a-ae0b-5e3c96e1538d', 'Hakon', 'Aaltonen', 71, 'D', 85, 29, 85, 50, 50, 650000, 3),
('af3eb8f1-8006-4620-aa26-0ca96dac7791', 'f924e118-f3d3-432a-ae0b-5e3c96e1538d', 'Andrés', 'Corvalán', 36, 'D', 83, 27, 84, 50, 50, 560000, 4),
('ce3d48ae-bbda-45b0-b7a2-8691a411707a', 'f924e118-f3d3-432a-ae0b-5e3c96e1538d', 'Anders', 'Bramante', 27, 'D', 82, 31, 83, 50, 50, 520000, 1),
('f2d46ec1-fbd7-4752-a77f-0bf4ffd569b1', 'f924e118-f3d3-432a-ae0b-5e3c96e1538d', 'Pavel', 'Quiroga', 35, 'F', 90, 20, 97, 50, 50, 570000, 4),
('306e47d5-06d9-419e-9b51-d00b40a2d924', 'f924e118-f3d3-432a-ae0b-5e3c96e1538d', 'Casimir', 'Abarca', 50, 'F', 89, 32, 90, 50, 50, 880000, 3),
('e49ce26e-28ac-492f-baf5-2726538b775b', 'f924e118-f3d3-432a-ae0b-5e3c96e1538d', 'Renzo', 'Arriaga', 6, 'F', 88, 25, 90, 50, 50, 820000, 1),
('0aed73e7-b59a-4e96-8fd5-280f8c3c3d92', 'f924e118-f3d3-432a-ae0b-5e3c96e1538d', 'Fabián', 'Zapatero', 22, 'F', 87, 28, 89, 50, 50, 760000, 2),
('013e4e8c-b3b6-4e70-83de-518fa9c07eeb', 'f924e118-f3d3-432a-ae0b-5e3c96e1538d', 'Aksel', 'Arriaga', 61, 'F', 86, 27, 87, 50, 50, 710000, 3),
('bd54b631-da6c-4cf1-92ec-a17cf1cd5299', 'f924e118-f3d3-432a-ae0b-5e3c96e1538d', 'Enzo', 'Villaseñor', 81, 'F', 85, 33, 87, 50, 50, 560000, 3),
('043fe152-48e0-419f-9169-2eae747e457e', 'f924e118-f3d3-432a-ae0b-5e3c96e1538d', 'Adrián', 'Tamayo', 30, 'F', 83, 20, 92, 50, 50, 340000, 5),
('777ae8fe-f088-497c-8d04-d79c66921be1', 'f924e118-f3d3-432a-ae0b-5e3c96e1538d', 'Elio', 'Haldane', 92, 'F', 83, 31, 85, 50, 50, 560000, 3),
('4a5936b2-97af-48f7-9cb9-45a7f4abfabf', 'f924e118-f3d3-432a-ae0b-5e3c96e1538d', 'Bastian', 'Ferrán', 29, 'F', 82, 27, 83, 50, 50, 520000, 1),
('a8c95a3a-5c3b-468d-b4a9-2b57af5055ff', 'f924e118-f3d3-432a-ae0b-5e3c96e1538d', 'Lucas', 'Galindo', 19, 'F', 80, 24, 84, 50, 50, 440000, 4),
('4db44eba-148f-4fb1-bc9d-76f3858f8d4a', 'f924e118-f3d3-432a-ae0b-5e3c96e1538d', 'Lucas', 'Olmedo', 97, 'F', 80, 28, 80, 50, 50, 440000, 4),
('ed4d87f2-a4f1-430d-b0b3-190a692cc19b', 'f924e118-f3d3-432a-ae0b-5e3c96e1538d', 'Vicente', 'Pellerin', 51, 'F', 79, 29, 80, 50, 50, 410000, 4),
('cd397bee-181d-4397-80fe-c8c6a953f193', 'c538e4c4-00fd-41e5-8092-7076d5e610f3', 'Teo', 'Gallardo', 18, 'G', 93, 25, 94, 50, 50, 1170000, 1),
('34074aad-0a96-49e2-8215-d2bb81198acc', 'c538e4c4-00fd-41e5-8092-7076d5e610f3', 'Caio', 'Falkner', 62, 'G', 82, 25, 83, 50, 50, 520000, 5),
('bda8a5df-771c-4539-b230-125a97c7964b', 'c538e4c4-00fd-41e5-8092-7076d5e610f3', 'Eero', 'Abarca', 33, 'D', 92, 32, 94, 50, 50, 1090000, 4),
('e843e3fb-1ca3-4159-87d3-89c7510d79f7', 'c538e4c4-00fd-41e5-8092-7076d5e610f3', 'Milo', 'Belmonte', 73, 'D', 91, 20, 95, 50, 50, 610000, 4),
('89cf9e1d-4fc7-4139-87c1-b4d419035860', 'c538e4c4-00fd-41e5-8092-7076d5e610f3', 'Sven', 'Corvalán', 50, 'D', 89, 24, 92, 50, 50, 880000, 5),
('c35c9c8c-eb15-4397-b755-f56a33d13542', 'c538e4c4-00fd-41e5-8092-7076d5e610f3', 'Santino', 'Bergkvist', 29, 'D', 88, 31, 88, 50, 50, 820000, 5),
('27e37d62-2ef5-44bd-ae9d-e4e5aa357710', 'c538e4c4-00fd-41e5-8092-7076d5e610f3', 'Rune', 'Lozano', 34, 'D', 86, 36, 87, 50, 50, 600000, 1),
('0d086e62-430d-4058-825a-a451ea536b6d', 'c538e4c4-00fd-41e5-8092-7076d5e610f3', 'Matías', 'Norberg', 76, 'D', 85, 31, 86, 50, 50, 650000, 5),
('c65b221b-b618-4d17-88c8-d0f4f33a722b', 'c538e4c4-00fd-41e5-8092-7076d5e610f3', 'Ivo', 'Villaseñor', 74, 'F', 96, 31, 97, 50, 50, 1440000, 4),
('a73c8926-23a9-43e6-a29b-520850635932', 'c538e4c4-00fd-41e5-8092-7076d5e610f3', 'Dorian', 'Lozano', 89, 'F', 95, 33, 95, 50, 50, 1140000, 2),
('30790c3c-0d83-40e8-bdb9-0e73ca28048d', 'c538e4c4-00fd-41e5-8092-7076d5e610f3', 'Fabián', 'Lozano', 31, 'F', 94, 28, 94, 50, 50, 1260000, 4),
('14f7a166-ebb4-401b-9fcb-7094c3f54c5f', 'c538e4c4-00fd-41e5-8092-7076d5e610f3', 'Aksel', 'Jurado', 21, 'F', 93, 27, 94, 50, 50, 1170000, 2),
('f89b7ddd-f06e-481e-80fd-01208c56c163', 'c538e4c4-00fd-41e5-8092-7076d5e610f3', 'Olaf', 'Ybarra', 75, 'F', 92, 19, 98, 50, 50, 660000, 1),
('5aaac768-330c-40ea-8539-d04255efaa0a', 'c538e4c4-00fd-41e5-8092-7076d5e610f3', 'Bastian', 'Hidalgo', 46, 'F', 91, 30, 92, 50, 50, 1020000, 4),
('f42fcad9-3694-4bb1-b6c5-cd486e41765d', 'c538e4c4-00fd-41e5-8092-7076d5e610f3', 'Elio', 'Holmqvist', 92, 'F', 90, 25, 93, 50, 50, 950000, 2),
('6220e9f8-893e-48a6-a27d-92cc0c3ca42a', 'c538e4c4-00fd-41e5-8092-7076d5e610f3', 'Jonas', 'Halvorsen', 94, 'F', 89, 30, 90, 50, 50, 880000, 4),
('74f80e04-b3bc-4ebc-ba88-34ac9c87aea6', 'c538e4c4-00fd-41e5-8092-7076d5e610f3', 'Kasper', 'Pellerin', 68, 'F', 88, 32, 89, 50, 50, 820000, 5),
('c107a44c-7c24-4f65-8e06-859865cebd4a', 'c538e4c4-00fd-41e5-8092-7076d5e610f3', 'Marek', 'Iturbe', 2, 'F', 86, 22, 92, 50, 50, 710000, 3),
('9396fc2d-d1bd-4f79-932f-a7539a0e5739', 'c538e4c4-00fd-41e5-8092-7076d5e610f3', 'Bastian', 'Iturbe', 7, 'F', 86, 31, 87, 50, 50, 710000, 5),
('92fc58fd-9f08-4860-a0d1-f7a9446a1849', 'c538e4c4-00fd-41e5-8092-7076d5e610f3', 'Gideon', 'Castellví', 20, 'F', 85, 30, 86, 50, 50, 650000, 2),
('94570c19-f618-46e9-bba2-a488e9c1db87', '790b2315-fabf-4b3d-b1b2-300de999524a', 'Kasper', 'Dahlberg', 76, 'G', 82, 25, 85, 50, 50, 520000, 2),
('d9b700fa-cbcf-4695-9fd0-78cdf8cee4e5', '790b2315-fabf-4b3d-b1b2-300de999524a', 'Felix', 'Fjeldstad', 29, 'G', 69, 27, 70, 50, 50, 200000, 4),
('ce6f6171-fb67-4cc9-aff7-137a8c48143e', '790b2315-fabf-4b3d-b1b2-300de999524a', 'Nahuel', 'Holmqvist', 80, 'D', 94, 24, 96, 50, 50, 1260000, 2),
('c6c6db23-8dae-4594-bc92-f8d449a62f28', '790b2315-fabf-4b3d-b1b2-300de999524a', 'Aksel', 'Jansky', 26, 'D', 93, 28, 93, 50, 50, 1170000, 3),
('f2e6c3d0-ab9b-4252-9bd2-3de112daafd3', '790b2315-fabf-4b3d-b1b2-300de999524a', 'Gael', 'Delacroix', 98, 'D', 91, 26, 91, 50, 50, 1020000, 5),
('d61d335d-b042-4ce9-93b7-cee0957cb99c', '790b2315-fabf-4b3d-b1b2-300de999524a', 'Magnus', 'Borrego', 70, 'D', 90, 23, 95, 50, 50, 950000, 1),
('746ed390-40ff-4e9c-be8f-779849c30508', '790b2315-fabf-4b3d-b1b2-300de999524a', 'Adrián', 'Lagarde', 63, 'D', 88, 25, 89, 50, 50, 820000, 1),
('addb697c-b2d3-4ba2-ae0d-b312b2abd331', '790b2315-fabf-4b3d-b1b2-300de999524a', 'Pablo', 'Holmqvist', 75, 'D', 87, 32, 87, 50, 50, 760000, 2),
('62c3640e-ad1a-4931-95cf-ba796a3c06ea', '790b2315-fabf-4b3d-b1b2-300de999524a', 'Alvar', 'Montalvo', 19, 'F', 90, 27, 91, 50, 50, 950000, 1),
('af1c4e83-2fa9-41bf-81aa-72085bac3751', '790b2315-fabf-4b3d-b1b2-300de999524a', 'Anders', 'Karlsen', 12, 'F', 90, 32, 91, 50, 50, 950000, 3),
('ff4f119b-9fb8-404c-95f3-24f83dc6996b', '790b2315-fabf-4b3d-b1b2-300de999524a', 'Sebastián', 'Saarinen', 92, 'F', 89, 29, 90, 50, 50, 880000, 5),
('d23ad71c-377f-4b3e-961d-e21a02d44ef9', '790b2315-fabf-4b3d-b1b2-300de999524a', 'Tadeo', 'Corvalán', 96, 'F', 88, 24, 91, 50, 50, 820000, 3),
('c6f8d589-efc2-46af-96ca-03cd01ef3cb9', '790b2315-fabf-4b3d-b1b2-300de999524a', 'Nahuel', 'Valdivia', 8, 'F', 87, 24, 90, 50, 50, 760000, 4),
('6f1696ea-2486-4607-b8d9-36d154e5846e', '790b2315-fabf-4b3d-b1b2-300de999524a', 'Zoltan', 'Carvajal', 51, 'F', 87, 28, 89, 50, 50, 760000, 1),
('3b13be0c-15ca-49af-a80e-38dafe7462ff', '790b2315-fabf-4b3d-b1b2-300de999524a', 'Thiago', 'Haldane', 87, 'F', 85, 22, 89, 50, 50, 650000, 5),
('42aca1ee-2365-452e-989a-319bf46f8aba', '790b2315-fabf-4b3d-b1b2-300de999524a', 'Alvar', 'Borrego', 69, 'F', 84, 33, 85, 50, 50, 510000, 5),
('6e39848a-03c2-41f0-b13b-cd4e1a0e0250', '790b2315-fabf-4b3d-b1b2-300de999524a', 'Cedric', 'Borrego', 27, 'F', 83, 19, 93, 50, 50, 340000, 4),
('425958b4-f664-47e7-93b2-45a2d948721c', '790b2315-fabf-4b3d-b1b2-300de999524a', 'Quentin', 'Marklund', 81, 'F', 82, 28, 83, 50, 50, 520000, 2),
('53baa177-765f-4b15-b6cf-edf8e825cb5e', '790b2315-fabf-4b3d-b1b2-300de999524a', 'Rasmus', 'Carvajal', 72, 'F', 81, 24, 85, 50, 50, 480000, 5),
('38243341-fe3a-40ef-9aaf-860936dd0d6a', '790b2315-fabf-4b3d-b1b2-300de999524a', 'Sven', 'Falkner', 23, 'F', 80, 30, 81, 50, 50, 440000, 1),
('a157b1d0-053d-4f32-b1a1-9fbe673b10c0', '78ebfc07-101e-48c3-98ac-758f8ccaebf1', 'Rafael', 'Belmonte', 17, 'G', 88, 27, 89, 50, 50, 820000, 5),
('db9ebd33-1b2a-4667-90cd-18137f5273f2', '78ebfc07-101e-48c3-98ac-758f8ccaebf1', 'Pablo', 'Lagarde', 74, 'G', 80, 31, 81, 50, 50, 440000, 1),
('5d1d3a51-f6df-48b1-8ab1-c095ae4b56a3', '78ebfc07-101e-48c3-98ac-758f8ccaebf1', 'Jaakko', 'Haldane', 88, 'D', 91, 23, 95, 50, 50, 1020000, 3),
('ed1f899d-1eae-4496-a575-5b8b04729c93', '78ebfc07-101e-48c3-98ac-758f8ccaebf1', 'Lucas', 'Lagarde', 34, 'D', 90, 26, 91, 50, 50, 950000, 2),
('03691240-02e7-424d-9aa6-0e37d64f0cbd', '78ebfc07-101e-48c3-98ac-758f8ccaebf1', 'Pavel', 'Salazar', 76, 'D', 88, 29, 90, 50, 50, 820000, 4),
('a4bd2307-c68d-47ef-876f-d9e0e55753a6', '78ebfc07-101e-48c3-98ac-758f8ccaebf1', 'Gideon', 'Quintanar', 98, 'D', 87, 32, 87, 50, 50, 760000, 3),
('c90bdeea-473e-43a4-814b-3f7fab53a862', '78ebfc07-101e-48c3-98ac-758f8ccaebf1', 'Zeno', 'Iturbe', 86, 'D', 85, 23, 91, 50, 50, 650000, 2),
('a64f2d79-bbf8-4736-991e-ced1b0bb5a56', '78ebfc07-101e-48c3-98ac-758f8ccaebf1', 'Santino', 'Falkner', 49, 'D', 84, 31, 85, 50, 50, 600000, 2),
('a7d62eef-ae82-42e6-9461-e817da4a34f0', '78ebfc07-101e-48c3-98ac-758f8ccaebf1', 'Sven', 'Lozano', 79, 'F', 90, 19, 100, 50, 50, 570000, 4),
('77d2987d-37c9-4074-81d9-8302b5576af3', '78ebfc07-101e-48c3-98ac-758f8ccaebf1', 'Sven', 'Castellví', 6, 'F', 89, 28, 91, 50, 50, 880000, 4),
('b59186fe-fa8c-4219-b01c-2a0b110097f1', '78ebfc07-101e-48c3-98ac-758f8ccaebf1', 'Oskar', 'Brandt', 84, 'F', 88, 27, 89, 50, 50, 820000, 4),
('63a5a8aa-b772-4352-a987-a5db5a8a4f33', '78ebfc07-101e-48c3-98ac-758f8ccaebf1', 'Alvar', 'Belmonte', 96, 'F', 87, 33, 87, 50, 50, 650000, 3),
('bdb2687f-d0da-4b54-8511-f16ddba4ebac', '78ebfc07-101e-48c3-98ac-758f8ccaebf1', 'Tobías', 'Escalante', 81, 'F', 86, 23, 90, 50, 50, 710000, 5),
('8f55940e-11bc-4a83-875b-7e85d9d8aeb3', '78ebfc07-101e-48c3-98ac-758f8ccaebf1', 'Ciro', 'Fonteyne', 38, 'F', 85, 26, 86, 50, 50, 650000, 1),
('f088d3ac-d926-4fee-aba6-7e508ea9d985', '78ebfc07-101e-48c3-98ac-758f8ccaebf1', 'Joaquín', 'Villaseñor', 62, 'F', 84, 26, 86, 50, 50, 600000, 3),
('04ff4d92-914d-42ef-bed5-a8b6f9b1848f', '78ebfc07-101e-48c3-98ac-758f8ccaebf1', 'Milo', 'Zelenka', 78, 'F', 83, 29, 84, 50, 50, 560000, 4),
('b2af4889-0fd6-4253-b076-e9ebe36f01e4', '78ebfc07-101e-48c3-98ac-758f8ccaebf1', 'Quentin', 'Falkner', 32, 'F', 82, 31, 83, 50, 50, 520000, 4),
('1355fd1b-4803-4e3a-b93b-ac0b39679cf1', '78ebfc07-101e-48c3-98ac-758f8ccaebf1', 'Bruno', 'Vikström', 5, 'F', 81, 23, 84, 50, 50, 480000, 2),
('42999fd6-8dd6-4fab-a3cd-0a0f0e1cdd64', '78ebfc07-101e-48c3-98ac-758f8ccaebf1', 'Anders', 'Gallardo', 13, 'F', 80, 19, 93, 50, 50, 260000, 4),
('68a14f97-4ec0-435f-af4b-8fa8a99e31e9', '78ebfc07-101e-48c3-98ac-758f8ccaebf1', 'Dagur', 'Zapatero', 14, 'F', 80, 30, 82, 50, 50, 440000, 3),
('36ad05c3-b318-4bc2-b31b-66f2233bbc46', 'b4f47315-8e06-478e-a9b5-d7bd849f7ba9', 'Lisandro', 'Abarca', 33, 'G', 93, 27, 93, 50, 50, 1170000, 3),
('3dad4b59-04cb-4cc1-b9b8-4475aea7d682', 'b4f47315-8e06-478e-a9b5-d7bd849f7ba9', 'Rune', 'Báthory', 34, 'G', 79, 19, 88, 50, 50, 240000, 1),
('2d4c0921-3ccc-4a29-889f-057840592f51', 'b4f47315-8e06-478e-a9b5-d7bd849f7ba9', 'Tadeo', 'Albrecht', 61, 'D', 92, 28, 92, 50, 50, 1090000, 5),
('76004719-b665-4cb4-8650-2db0b387dcb6', 'b4f47315-8e06-478e-a9b5-d7bd849f7ba9', 'Dorian', 'Maravilla', 97, 'D', 91, 27, 92, 50, 50, 1020000, 1),
('83b731b8-3bfd-4cf7-95ff-9e3f512b076d', 'b4f47315-8e06-478e-a9b5-d7bd849f7ba9', 'Joaquín', 'Belmonte', 40, 'D', 89, 28, 91, 50, 50, 880000, 2),
('d50a7d2d-0b53-4d6f-aae9-47a6cd4204cf', 'b4f47315-8e06-478e-a9b5-d7bd849f7ba9', 'Otto', 'Olmedo', 42, 'D', 88, 19, 100, 50, 50, 490000, 5),
('b998afbc-93be-49f4-b84a-05c42255fb26', 'b4f47315-8e06-478e-a9b5-d7bd849f7ba9', 'Rodrigo', 'Echeverri', 84, 'D', 86, 27, 88, 50, 50, 710000, 5),
('84e954d7-d224-4fdc-9def-da4173b1defd', 'b4f47315-8e06-478e-a9b5-d7bd849f7ba9', 'Felix', 'Delacroix', 41, 'D', 85, 21, 92, 50, 50, 390000, 3),
('0cdb845e-e254-44f4-a152-9b3a335add91', 'b4f47315-8e06-478e-a9b5-d7bd849f7ba9', 'Rasmus', 'Ostrowski', 4, 'F', 93, 21, 100, 50, 50, 700000, 4),
('0ccc056f-aadc-43b7-b5cb-7723a69a8a6a', 'b4f47315-8e06-478e-a9b5-d7bd849f7ba9', 'Gideon', 'Vikström', 87, 'F', 92, 30, 92, 50, 50, 1090000, 5),
('b2a85d18-925b-43cc-8a41-b8cb9c269765', 'b4f47315-8e06-478e-a9b5-d7bd849f7ba9', 'Matías', 'Almonte', 37, 'F', 91, 22, 96, 50, 50, 1020000, 5),
('73504f2b-25b2-4753-be24-75ac96712887', 'b4f47315-8e06-478e-a9b5-d7bd849f7ba9', 'Esteban', 'Kovář', 32, 'F', 90, 23, 94, 50, 50, 950000, 5),
('b64e9d75-d8a9-43e6-8e7f-44857187ebca', 'b4f47315-8e06-478e-a9b5-d7bd849f7ba9', 'Vicente', 'Navarrete', 18, 'F', 89, 19, 100, 50, 50, 530000, 2),
('3d6dc03c-8ab6-4044-8614-0497a75fd328', 'b4f47315-8e06-478e-a9b5-d7bd849f7ba9', 'Rune', 'Ekholm', 79, 'F', 88, 30, 89, 50, 50, 820000, 1),
('3ede65e7-b179-4b98-ae17-1e93ebb794a0', 'b4f47315-8e06-478e-a9b5-d7bd849f7ba9', 'Thiago', 'Zapatero', 70, 'F', 87, 24, 91, 50, 50, 760000, 2),
('fd09b453-bc72-4e76-a297-fd6e0d8eb96a', 'b4f47315-8e06-478e-a9b5-d7bd849f7ba9', 'Samuel', 'Bergkvist', 11, 'F', 86, 24, 91, 50, 50, 710000, 4),
('1d0c1554-7cff-49f1-97b8-5c9074e8994d', 'b4f47315-8e06-478e-a9b5-d7bd849f7ba9', 'Casimir', 'Riquelme', 59, 'F', 85, 24, 88, 50, 50, 650000, 4),
('b6413893-24f9-4423-abe2-e9fa02e3217b', 'b4f47315-8e06-478e-a9b5-d7bd849f7ba9', 'Emil', 'Maravilla', 98, 'F', 84, 27, 86, 50, 50, 600000, 3),
('ab2f1aca-d0f1-4653-bfce-e7e161feddeb', 'b4f47315-8e06-478e-a9b5-d7bd849f7ba9', 'Olaf', 'Jurado', 26, 'F', 83, 24, 86, 50, 50, 560000, 1),
('d94cddc1-57f9-4ddc-9704-b0ecfa32b89d', 'b4f47315-8e06-478e-a9b5-d7bd849f7ba9', 'Magnus', 'Corvalán', 91, 'F', 82, 31, 83, 50, 50, 520000, 4),
('4cf0bc7b-0502-45a0-9578-1693c517d5bf', 'ba1f9b8a-ff83-447d-83a8-7df3ca9181ca', 'Ciro', 'Lindqvist', 82, 'G', 93, 30, 93, 50, 50, 1170000, 1),
('a192ed90-553c-4d99-a578-77943b2fdc02', 'ba1f9b8a-ff83-447d-83a8-7df3ca9181ca', 'Eero', 'Borrego', 29, 'G', 83, 26, 84, 50, 50, 560000, 3),
('f34a6b47-3fb0-4d63-a5d0-d3dfe0e5101c', 'ba1f9b8a-ff83-447d-83a8-7df3ca9181ca', 'Yannick', 'Arnesen', 74, 'D', 94, 24, 97, 50, 50, 1260000, 1),
('8be135a7-b0ef-499e-86ef-849841d33754', 'ba1f9b8a-ff83-447d-83a8-7df3ca9181ca', 'Elio', 'Gallardo', 85, 'D', 93, 36, 94, 50, 50, 1000000, 3),
('cb6d04f9-11bc-4b68-874d-89afb5f81668', 'ba1f9b8a-ff83-447d-83a8-7df3ca9181ca', 'Yago', 'Kovář', 98, 'D', 91, 26, 91, 50, 50, 1020000, 4),
('c12a620c-1869-4b35-8922-632cc2117c72', 'ba1f9b8a-ff83-447d-83a8-7df3ca9181ca', 'Arvid', 'Báthory', 70, 'D', 90, 25, 92, 50, 50, 950000, 2),
('e4f537f8-c06d-4ed6-b869-b6c022e61b00', 'ba1f9b8a-ff83-447d-83a8-7df3ca9181ca', 'Emil', 'Delacroix', 60, 'D', 88, 29, 90, 50, 50, 820000, 5),
('b9c883e5-ecd2-4aba-a00a-f6a4fb5cc358', 'ba1f9b8a-ff83-447d-83a8-7df3ca9181ca', 'Cedric', 'Montalvo', 87, 'D', 87, 25, 89, 50, 50, 760000, 1),
('5c793ac3-9b05-4bfb-b25f-a76114fb25d1', 'ba1f9b8a-ff83-447d-83a8-7df3ca9181ca', 'Dagur', 'Jansky', 10, 'F', 97, 26, 99, 50, 50, 1530000, 4),
('852a93fd-e965-4ecb-9310-1505bdb33fb3', 'ba1f9b8a-ff83-447d-83a8-7df3ca9181ca', 'Santino', 'Navarrete', 92, 'F', 96, 29, 96, 50, 50, 1440000, 4),
('c59412f9-321d-453e-bafb-e2137859fdb6', 'ba1f9b8a-ff83-447d-83a8-7df3ca9181ca', 'Caio', 'Bergkvist', 33, 'F', 95, 24, 99, 50, 50, 1340000, 5),
('b0a20893-b8ee-43fc-9003-dba1f178343a', 'ba1f9b8a-ff83-447d-83a8-7df3ca9181ca', 'Hakon', 'Wahlgren', 8, 'F', 94, 24, 98, 50, 50, 1260000, 1),
('3ea4c223-56d7-43c2-b7cd-0f696e64119c', 'ba1f9b8a-ff83-447d-83a8-7df3ca9181ca', 'Marek', 'Kovář', 56, 'F', 93, 32, 93, 50, 50, 1170000, 3),
('e33d122c-d721-4a24-b9ee-1337e45fc85c', 'ba1f9b8a-ff83-447d-83a8-7df3ca9181ca', 'Kai', 'Navarrete', 55, 'F', 92, 31, 94, 50, 50, 1090000, 2),
('9ecd4cda-c69e-4d43-af80-9698c04d96c5', 'ba1f9b8a-ff83-447d-83a8-7df3ca9181ca', 'Pavel', 'Garmendia', 80, 'F', 91, 28, 92, 50, 50, 1020000, 3),
('2bc82d27-39a6-4c95-b387-15b25bbd35cd', 'ba1f9b8a-ff83-447d-83a8-7df3ca9181ca', 'Marek', 'Halvorsen', 6, 'F', 90, 22, 96, 50, 50, 950000, 3),
('da5795fd-4e5b-496a-9a6d-dbb634b14ded', 'ba1f9b8a-ff83-447d-83a8-7df3ca9181ca', 'Marek', 'Villaseñor', 15, 'F', 89, 25, 91, 50, 50, 880000, 5),
('293cde0a-4dd3-4e21-8711-7eebcc78b538', 'ba1f9b8a-ff83-447d-83a8-7df3ca9181ca', 'Thiago', 'Calderas', 91, 'F', 88, 26, 89, 50, 50, 820000, 4),
('e5270a6c-60aa-4d2c-8a76-81a1f9657e02', 'ba1f9b8a-ff83-447d-83a8-7df3ca9181ca', 'Dorian', 'Abarca', 94, 'F', 87, 27, 88, 50, 50, 760000, 5),
('ed60689a-85e8-495a-ae09-a12950ee4c43', 'ba1f9b8a-ff83-447d-83a8-7df3ca9181ca', 'Adrián', 'Bramante', 75, 'F', 87, 30, 89, 50, 50, 760000, 3),
('52397cc9-3c04-46ab-8b87-c1479147954a', '8118ce0c-ee6f-4c60-9598-c71b95717d42', 'Magnus', 'Galindo', 17, 'G', 90, 23, 93, 50, 50, 950000, 4),
('5a4c33e3-3452-420d-a3bf-a5e4736f96f8', '8118ce0c-ee6f-4c60-9598-c71b95717d42', 'Felix', 'Calderas', 48, 'G', 80, 28, 82, 50, 50, 440000, 4),
('911c1525-b792-4e22-8a4c-71576dd2fc5c', '8118ce0c-ee6f-4c60-9598-c71b95717d42', 'Dorian', 'Vallejo', 18, 'D', 97, 29, 97, 50, 50, 1530000, 2),
('84c0fbe9-9816-4221-96d9-b44439ec108a', '8118ce0c-ee6f-4c60-9598-c71b95717d42', 'Benicio', 'Calderas', 56, 'D', 96, 23, 100, 50, 50, 1440000, 2),
('7755b560-9b99-4925-be37-0c053b41f6b7', '8118ce0c-ee6f-4c60-9598-c71b95717d42', 'Thiago', 'Tamayo', 29, 'D', 94, 36, 96, 50, 50, 1070000, 4),
('70bb21f0-5b3e-4758-aa00-c928f66840e3', '8118ce0c-ee6f-4c60-9598-c71b95717d42', 'Thiago', 'Gallardo', 12, 'D', 93, 20, 100, 50, 50, 700000, 5),
('0be6bd35-800a-4b4e-8716-605e3e07778e', '8118ce0c-ee6f-4c60-9598-c71b95717d42', 'Aldo', 'Carvajal', 38, 'D', 91, 27, 91, 50, 50, 1020000, 5),
('6bc2531b-cb9a-445e-9783-6554d9966646', '8118ce0c-ee6f-4c60-9598-c71b95717d42', 'Leandro', 'Zelenka', 53, 'D', 90, 27, 91, 50, 50, 950000, 1),
('dc8fc469-bf1e-4954-bb80-dbbb4720304d', '8118ce0c-ee6f-4c60-9598-c71b95717d42', 'Vicente', 'Nieminen', 33, 'F', 85, 30, 85, 50, 50, 650000, 5),
('aeb152b9-2450-4c6d-a454-8e6ba56168a0', '8118ce0c-ee6f-4c60-9598-c71b95717d42', 'Valtteri', 'Renteria', 27, 'F', 84, 27, 84, 50, 50, 600000, 1),
('e84a4ffb-f2e3-40cb-ba8c-0e92bb13fb64', '8118ce0c-ee6f-4c60-9598-c71b95717d42', 'Rafael', 'Sandoval', 6, 'F', 83, 30, 84, 50, 50, 560000, 1),
('98f59131-964d-46a9-89d8-cb57f2ea024b', '8118ce0c-ee6f-4c60-9598-c71b95717d42', 'Thiago', 'Zelenka', 50, 'F', 82, 32, 83, 50, 50, 520000, 5),
('dd4efc92-4d95-42c2-9878-e47555f22999', '8118ce0c-ee6f-4c60-9598-c71b95717d42', 'Samuel', 'Holmqvist', 85, 'F', 81, 22, 86, 50, 50, 480000, 4),
('b25ecfa2-a44a-4bb4-a59f-663db5d48fc0', '8118ce0c-ee6f-4c60-9598-c71b95717d42', 'Matías', 'Vasquez', 26, 'F', 81, 24, 85, 50, 50, 480000, 4),
('57fbb779-29e8-4c3d-9bda-e9ecf1901c63', '8118ce0c-ee6f-4c60-9598-c71b95717d42', 'Dagur', 'Hidalgo', 8, 'F', 79, 29, 80, 50, 50, 410000, 4),
('a709ed58-a18d-4f15-b468-bd5419f84e46', '8118ce0c-ee6f-4c60-9598-c71b95717d42', 'Matías', 'Wahlgren', 60, 'F', 78, 27, 78, 50, 50, 380000, 2),
('dca6a5c6-c443-4fc1-a664-c5456066f0c1', '8118ce0c-ee6f-4c60-9598-c71b95717d42', 'Ciro', 'Kallio', 42, 'F', 77, 24, 82, 50, 50, 350000, 2),
('b2dc36a2-12b3-463a-8772-b1abed19c353', '8118ce0c-ee6f-4c60-9598-c71b95717d42', 'Noel', 'Toivonen', 54, 'F', 76, 26, 77, 50, 50, 320000, 5),
('a7feeeb1-5844-405a-ad92-ecc14df934de', '8118ce0c-ee6f-4c60-9598-c71b95717d42', 'Lucas', 'Westerlund', 63, 'F', 75, 33, 76, 50, 50, 250000, 5),
('216e82e8-7352-47c7-9b83-056bb576c0bc', '8118ce0c-ee6f-4c60-9598-c71b95717d42', 'Julián', 'Abarca', 98, 'F', 75, 29, 75, 50, 50, 300000, 5),
('c602253a-e9a8-4262-a494-45ad05fd0e0e', '754b47e4-eb06-45f3-a690-a3d6616d8c8f', 'Ivo', 'Arriaga', 38, 'G', 100, 31, 100, 50, 50, 1850000, 2),
('fa825715-3f71-449d-95b7-746239af163b', '754b47e4-eb06-45f3-a690-a3d6616d8c8f', 'Tobías', 'Halvorsen', 87, 'G', 88, 26, 90, 50, 50, 820000, 5),
('69a73689-505d-4e9b-83da-f3cb65666770', '754b47e4-eb06-45f3-a690-a3d6616d8c8f', 'Arvid', 'Dahlberg', 64, 'D', 82, 29, 83, 50, 50, 520000, 2),
('acaaaaa4-c915-4a8d-8ea1-4803a3118df7', '754b47e4-eb06-45f3-a690-a3d6616d8c8f', 'Rodrigo', 'Salazar', 27, 'D', 81, 25, 84, 50, 50, 480000, 2),
('125b78de-d6af-4a7b-a082-7124abe204d9', '754b47e4-eb06-45f3-a690-a3d6616d8c8f', 'Bastian', 'Lindqvist', 85, 'D', 79, 29, 80, 50, 50, 410000, 4),
('ab60e66f-9436-4f79-bc74-f46a012d73ab', '754b47e4-eb06-45f3-a690-a3d6616d8c8f', 'Rafael', 'Lindahl', 3, 'D', 78, 30, 80, 50, 50, 380000, 5),
('64e47c73-4a59-44eb-86db-b383496d6479', '754b47e4-eb06-45f3-a690-a3d6616d8c8f', 'Caio', 'Belmonte', 17, 'D', 76, 31, 77, 50, 50, 320000, 1),
('732a7443-ff6b-41a3-9962-1b9b86af389d', '754b47e4-eb06-45f3-a690-a3d6616d8c8f', 'Rune', 'Calderas', 4, 'D', 75, 24, 79, 50, 50, 300000, 2),
('2162d213-7718-49d0-ba39-4d09a85803e7', '754b47e4-eb06-45f3-a690-a3d6616d8c8f', 'Mattis', 'Arnesen', 84, 'F', 85, 29, 86, 50, 50, 650000, 5),
('b5ddb0cc-69bf-4c49-87fa-a8f4f23428df', '754b47e4-eb06-45f3-a690-a3d6616d8c8f', 'Emil', 'Saarinen', 32, 'F', 84, 29, 86, 50, 50, 600000, 4),
('c0de2731-4b3f-4db1-8bcb-03e6ebd19bab', '754b47e4-eb06-45f3-a690-a3d6616d8c8f', 'Vicente', 'Jurado', 56, 'F', 83, 26, 84, 50, 50, 560000, 2),
('2f4b3fad-df6f-46b3-acfd-511b65a56322', '754b47e4-eb06-45f3-a690-a3d6616d8c8f', 'Olaf', 'Belmonte', 61, 'F', 81, 28, 81, 50, 50, 480000, 1),
('d5a6f98c-09e9-4b22-9c5f-3de43a50d699', '754b47e4-eb06-45f3-a690-a3d6616d8c8f', 'Matías', 'Aaltonen', 72, 'F', 81, 34, 82, 50, 50, 410000, 4),
('e13561a9-1e16-4118-b345-c66a7df42930', '754b47e4-eb06-45f3-a690-a3d6616d8c8f', 'Emil', 'Westerlund', 2, 'F', 80, 32, 80, 50, 50, 440000, 4),
('15734061-4adc-4db0-b748-5a6428a497a0', '754b47e4-eb06-45f3-a690-a3d6616d8c8f', 'Lauri', 'Olmedo', 1, 'F', 79, 30, 79, 50, 50, 410000, 4),
('19b58de4-a347-46e9-9e79-35d2768693c5', '754b47e4-eb06-45f3-a690-a3d6616d8c8f', 'Dagur', 'Fonteyne', 77, 'F', 78, 33, 78, 50, 50, 320000, 3),
('a55b0b1a-8a01-493c-a9cb-020412bdfcd7', '754b47e4-eb06-45f3-a690-a3d6616d8c8f', 'Gael', 'Lindqvist', 82, 'F', 78, 24, 81, 50, 50, 380000, 5),
('cab3a683-cd2a-4888-a4c3-ad615d173108', '754b47e4-eb06-45f3-a690-a3d6616d8c8f', 'Aldo', 'Riquelme', 86, 'F', 76, 28, 78, 50, 50, 320000, 2),
('69fd9cef-486f-44b6-a792-5bd1d15ad58d', '754b47e4-eb06-45f3-a690-a3d6616d8c8f', 'Ciro', 'Toivonen', 10, 'F', 75, 30, 76, 50, 50, 300000, 5),
('76346da6-b843-4668-be37-0a6bbac2865a', '754b47e4-eb06-45f3-a690-a3d6616d8c8f', 'Anders', 'Ferrán', 18, 'F', 74, 25, 76, 50, 50, 280000, 2),
('a4074eb3-e312-46a8-80be-fe3d5e379c99', '8281cbfd-1e58-488d-91a8-a58fa18787d8', 'Rodrigo', 'Báthory', 12, 'G', 89, 29, 90, 50, 50, 880000, 1),
('86e9d6cf-994d-4fa2-92dc-583e30c107a1', '8281cbfd-1e58-488d-91a8-a58fa18787d8', 'Ciro', 'Iturbe', 51, 'G', 75, 26, 77, 50, 50, 300000, 4),
('5ff75fba-c766-43b1-8c43-cfe8f865339f', '8281cbfd-1e58-488d-91a8-a58fa18787d8', 'Aksel', 'Ordaz', 65, 'D', 91, 24, 95, 50, 50, 1020000, 5),
('c06fc676-af66-4c90-8dd9-167df31c74d3', '8281cbfd-1e58-488d-91a8-a58fa18787d8', 'Gustavo', 'Dahlberg', 64, 'D', 90, 32, 92, 50, 50, 950000, 2),
('73696a27-0384-42bd-957e-35e7a5e20a77', '8281cbfd-1e58-488d-91a8-a58fa18787d8', 'Julián', 'Zapatero', 97, 'D', 88, 22, 95, 50, 50, 820000, 5),
('9f79293a-7d09-46c0-af96-11804bab82c1', '8281cbfd-1e58-488d-91a8-a58fa18787d8', 'Gideon', 'Valdivia', 66, 'D', 87, 29, 89, 50, 50, 760000, 1),
('9e1ef12e-ea43-4d9f-8860-ba3361dbe6ed', '8281cbfd-1e58-488d-91a8-a58fa18787d8', 'Valtteri', 'Ferrán', 98, 'D', 85, 25, 89, 50, 50, 650000, 3),
('fd84edc7-ef37-48ad-bb49-1de75309cd96', '8281cbfd-1e58-488d-91a8-a58fa18787d8', 'Casimir', 'Palacios', 70, 'D', 84, 21, 89, 50, 50, 360000, 3),
('69162097-eb25-4718-8c8d-88a5f8f75fa9', '8281cbfd-1e58-488d-91a8-a58fa18787d8', 'Rafael', 'Sundqvist', 36, 'F', 98, 30, 99, 50, 50, 1630000, 3),
('8438eed7-43c5-46eb-b1cc-ae2309c0f6ab', '8281cbfd-1e58-488d-91a8-a58fa18787d8', 'Samuel', 'Tamayo', 11, 'F', 97, 26, 98, 50, 50, 1530000, 5),
('066b4577-2cd9-4116-bc64-eb66442e1b39', '8281cbfd-1e58-488d-91a8-a58fa18787d8', 'Benicio', 'Ferrán', 42, 'F', 96, 24, 100, 50, 50, 1440000, 1),
('72783423-e0b0-43da-8325-0bbe645f551e', '8281cbfd-1e58-488d-91a8-a58fa18787d8', 'Hugo', 'Norberg', 75, 'F', 95, 24, 100, 50, 50, 1340000, 1),
('2fb9bc92-7633-4360-bf70-4201147ff3e4', '8281cbfd-1e58-488d-91a8-a58fa18787d8', 'Leandro', 'Gallardo', 60, 'F', 94, 23, 100, 50, 50, 1260000, 4),
('0b86e838-b1ae-468c-8748-4c9bcb5849e7', '8281cbfd-1e58-488d-91a8-a58fa18787d8', 'Valtteri', 'Lindahl', 48, 'F', 93, 21, 100, 50, 50, 700000, 1),
('da961f86-0b47-464f-b7d8-aa9123cb4c9f', '8281cbfd-1e58-488d-91a8-a58fa18787d8', 'Alvar', 'Bergkvist', 25, 'F', 92, 29, 93, 50, 50, 1090000, 3),
('3ab7c4a1-aeaf-4b6d-a2de-29366e150952', '8281cbfd-1e58-488d-91a8-a58fa18787d8', 'Viggo', 'Echeverri', 45, 'F', 91, 34, 93, 50, 50, 870000, 2),
('cb4c337b-dc8b-46d6-8959-97d538775eed', '8281cbfd-1e58-488d-91a8-a58fa18787d8', 'Renzo', 'Maravilla', 17, 'F', 90, 27, 91, 50, 50, 950000, 5),
('3b484c0b-3690-41f5-93b4-9365aff89a21', '8281cbfd-1e58-488d-91a8-a58fa18787d8', 'Bruno', 'Arnesen', 92, 'F', 89, 27, 90, 50, 50, 880000, 5),
('606a12c8-2340-4146-93fb-6cfd815d2645', '8281cbfd-1e58-488d-91a8-a58fa18787d8', 'Joaquín', 'Falkner', 61, 'F', 87, 26, 89, 50, 50, 760000, 3),
('13856eb5-0b95-401b-9ad8-6a6a7e08c54f', '8281cbfd-1e58-488d-91a8-a58fa18787d8', 'Sebastián', 'Galindo', 74, 'F', 87, 31, 89, 50, 50, 760000, 2),
('363a6b18-02c5-40f2-971f-8e3a005f180b', 'd3935206-b888-435c-8498-eb1c2babde43', 'Bruno', 'Aaltonen', 95, 'G', 82, 29, 83, 50, 50, 520000, 4),
('c6b8e4cf-558c-4706-9fb6-4f4de864e341', 'd3935206-b888-435c-8498-eb1c2babde43', 'Vicente', 'Ferrán', 58, 'G', 69, 32, 69, 50, 50, 200000, 3),
('fc699302-5104-46d4-92bb-f17c9ca4e7fa', 'd3935206-b888-435c-8498-eb1c2babde43', 'Teo', 'Falkner', 66, 'D', 92, 19, 100, 50, 50, 660000, 3),
('d317f390-8b78-46ef-b3d8-c10b996bb6f4', 'd3935206-b888-435c-8498-eb1c2babde43', 'Ivo', 'Castellví', 46, 'D', 91, 29, 92, 50, 50, 1020000, 1),
('2ea88cef-a7a1-431d-8eb9-df7303dccff4', 'd3935206-b888-435c-8498-eb1c2babde43', 'Jonas', 'Villaseñor', 36, 'D', 89, 29, 90, 50, 50, 880000, 2),
('65b3c6c9-dba7-49eb-9781-42041579ea8d', 'd3935206-b888-435c-8498-eb1c2babde43', 'Matías', 'Lozano', 63, 'D', 88, 30, 88, 50, 50, 820000, 1),
('9799edad-df07-4c34-910e-4e42ff88d93f', 'd3935206-b888-435c-8498-eb1c2babde43', 'Cedric', 'Westerlund', 13, 'D', 86, 19, 93, 50, 50, 420000, 3),
('db90bfbd-ee95-4132-b43e-57576e4d7568', 'd3935206-b888-435c-8498-eb1c2babde43', 'Vicente', 'Aaltonen', 8, 'D', 85, 27, 85, 50, 50, 650000, 1),
('7b03a1b2-efce-4537-8420-6ef2aac229f8', 'd3935206-b888-435c-8498-eb1c2babde43', 'Teo', 'Ordaz', 33, 'F', 96, 23, 98, 50, 50, 1440000, 1),
('0183fc5a-15f1-4344-95ac-8f9afe1fc3dc', 'd3935206-b888-435c-8498-eb1c2babde43', 'Zeno', 'Zamora', 96, 'F', 96, 25, 97, 50, 50, 1440000, 4),
('a447e5fd-b64b-4514-85c1-78aeb96b46fc', 'd3935206-b888-435c-8498-eb1c2babde43', 'Hugo', 'Granqvist', 77, 'F', 96, 29, 97, 50, 50, 1440000, 2),
('07f03de2-55e0-4032-abb0-8d010e084507', 'd3935206-b888-435c-8498-eb1c2babde43', 'Gael', 'Marklund', 24, 'F', 94, 26, 95, 50, 50, 1260000, 1),
('c0d8428f-ab52-466c-a3d2-4a2a78425deb', 'd3935206-b888-435c-8498-eb1c2babde43', 'Elio', 'Arnesen', 78, 'F', 93, 27, 94, 50, 50, 1170000, 3),
('8ae5794e-4f1f-4722-8f3a-224be008bb7d', 'd3935206-b888-435c-8498-eb1c2babde43', 'Alvar', 'Jurado', 85, 'F', 92, 28, 94, 50, 50, 1090000, 2),
('07875c23-399f-4096-8ed1-f63b3fd7071e', 'd3935206-b888-435c-8498-eb1c2babde43', 'Lenny', 'Olmedo', 65, 'F', 91, 33, 92, 50, 50, 870000, 2),
('a2a12649-4785-4f48-af3b-2c5012214eb1', 'd3935206-b888-435c-8498-eb1c2babde43', 'Lisandro', 'Echeverri', 89, 'F', 90, 28, 91, 50, 50, 950000, 5),
('715a59e1-dda5-4033-ae9f-3be2d8d69ecf', 'd3935206-b888-435c-8498-eb1c2babde43', 'Anders', 'Hidalgo', 23, 'F', 89, 29, 91, 50, 50, 880000, 1),
('e0d899bf-c5e3-4ec7-93c9-321fc0fc19b7', 'd3935206-b888-435c-8498-eb1c2babde43', 'Pavel', 'Riquelme', 6, 'F', 88, 29, 88, 50, 50, 820000, 5),
('14963c8f-62b1-43e5-a51d-9e678842b4ee', 'd3935206-b888-435c-8498-eb1c2babde43', 'Mattis', 'Zamora', 70, 'F', 87, 24, 91, 50, 50, 760000, 1),
('295ebc03-2f78-48be-95bf-ddf6424da926', 'd3935206-b888-435c-8498-eb1c2babde43', 'Olaf', 'Olmedo', 72, 'F', 87, 24, 92, 50, 50, 760000, 4);
insert into players (id, team_id, first_name, last_name, number, position, rating, age, potential, form, morale, salary, contract_years) values
('e8ec8005-6f2e-4f6d-a65a-e9b8e9667e2d', '725ad4e0-326d-479e-8795-60fb2d9b023c', 'Tadeo', 'Karlsen', 32, 'G', 85, 23, 89, 50, 50, 650000, 3),
('7e8a86e4-83fa-44e2-a200-4cd54ae0db8d', '725ad4e0-326d-479e-8795-60fb2d9b023c', 'Eero', 'Vallejo', 37, 'G', 77, 31, 77, 50, 50, 350000, 2),
('97585c11-99c6-4ea9-8b0c-39ec50d5c2fa', '725ad4e0-326d-479e-8795-60fb2d9b023c', 'Nikolai', 'Granqvist', 93, 'D', 83, 23, 86, 50, 50, 560000, 5),
('1b9f7565-22a6-42fb-932f-231f2c19dd3a', '725ad4e0-326d-479e-8795-60fb2d9b023c', 'Enzo', 'Sandoval', 55, 'D', 82, 26, 83, 50, 50, 520000, 1),
('7cf500e6-8d36-4ccd-9b83-9e6e4678fc97', '725ad4e0-326d-479e-8795-60fb2d9b023c', 'Dorian', 'Echeverri', 6, 'D', 80, 30, 81, 50, 50, 440000, 3),
('c29d5386-8caa-40d8-a66e-16b08bab4d29', '725ad4e0-326d-479e-8795-60fb2d9b023c', 'Emil', 'Vallejo', 56, 'D', 79, 21, 83, 50, 50, 240000, 5),
('3508b4cc-22a6-44d7-b4e0-1c3d4ede40ce', '725ad4e0-326d-479e-8795-60fb2d9b023c', 'Caio', 'Ordaz', 9, 'D', 77, 21, 83, 50, 50, 210000, 5),
('9093786d-e65a-4863-87d7-bd93b99a48d1', '725ad4e0-326d-479e-8795-60fb2d9b023c', 'Benicio', 'Wahlgren', 86, 'D', 76, 31, 78, 50, 50, 320000, 2),
('7f949b1b-24dd-4e4b-954b-1fecd2bd94da', '725ad4e0-326d-479e-8795-60fb2d9b023c', 'Fausto', 'Wahlgren', 33, 'F', 96, 23, 100, 50, 50, 1440000, 3),
('26a25d0d-f838-49ea-9d26-47b8583f4cc9', '725ad4e0-326d-479e-8795-60fb2d9b023c', 'Lucas', 'Navarrete', 27, 'F', 95, 29, 97, 50, 50, 1340000, 1),
('0f96de6a-d7dc-49e1-bc2a-bf8b8ace5bbb', '725ad4e0-326d-479e-8795-60fb2d9b023c', 'Sven', 'Cabrales', 3, 'F', 94, 26, 95, 50, 50, 1260000, 1),
('c24f5c51-e6d4-46ed-8e8f-5130461a2a7a', '725ad4e0-326d-479e-8795-60fb2d9b023c', 'Caio', 'Hidalgo', 74, 'F', 93, 26, 93, 50, 50, 1170000, 4),
('bfbdd8c5-207e-461e-89e8-d6e31d1d1b74', '725ad4e0-326d-479e-8795-60fb2d9b023c', 'Thiago', 'Belmonte', 36, 'F', 92, 24, 96, 50, 50, 1090000, 5),
('f3862d03-f434-470e-9cde-a5281ee63ea3', '725ad4e0-326d-479e-8795-60fb2d9b023c', 'Aksel', 'Zelenka', 38, 'F', 91, 25, 93, 50, 50, 1020000, 3),
('ddc219fb-1527-45ee-90df-ff5ec07c3e7f', '725ad4e0-326d-479e-8795-60fb2d9b023c', 'Aldo', 'Dahlberg', 88, 'F', 90, 25, 92, 50, 50, 950000, 5),
('79fe6c37-1159-415a-982f-53a74054ac1c', '725ad4e0-326d-479e-8795-60fb2d9b023c', 'Valtteri', 'Marklund', 61, 'F', 89, 21, 96, 50, 50, 530000, 2),
('6bbbf5db-a357-4d51-84d0-9b5dd9f4b721', '725ad4e0-326d-479e-8795-60fb2d9b023c', 'Lisandro', 'Arriaga', 71, 'F', 88, 32, 89, 50, 50, 820000, 4),
('a2f23d4a-3502-490e-9ea2-686910500750', '725ad4e0-326d-479e-8795-60fb2d9b023c', 'Lauri', 'Bergkvist', 47, 'F', 86, 29, 87, 50, 50, 710000, 3),
('2f2f3c5f-9863-436b-9144-e4af5face49a', '725ad4e0-326d-479e-8795-60fb2d9b023c', 'Rafael', 'Castellví', 22, 'F', 86, 29, 87, 50, 50, 710000, 4),
('29397431-e6a7-4e12-82e1-cb645aee137e', '725ad4e0-326d-479e-8795-60fb2d9b023c', 'Silas', 'Urquiza', 80, 'F', 85, 31, 86, 50, 50, 650000, 2),
('d2bfc5d0-8a70-4aa7-8506-b9b4ca980782', 'b668868f-bf60-4ac3-b2b1-422f8ce1f8cd', 'Oskar', 'Rautio', 19, 'G', 90, 26, 90, 50, 50, 950000, 3),
('56da605c-0457-4710-b223-37a2830c8171', 'b668868f-bf60-4ac3-b2b1-422f8ce1f8cd', 'Renzo', 'Quiroga', 9, 'G', 81, 31, 83, 50, 50, 480000, 5),
('99cb9674-497b-4f58-96ec-9b2fc2a29509', 'b668868f-bf60-4ac3-b2b1-422f8ce1f8cd', 'Rasmus', 'Lagarde', 25, 'D', 91, 29, 93, 50, 50, 1020000, 3),
('66da385b-ea0e-4b73-a8a0-97e8cbdc9137', 'b668868f-bf60-4ac3-b2b1-422f8ce1f8cd', 'Fausto', 'Riquelme', 93, 'D', 90, 20, 100, 50, 50, 570000, 4),
('7f4f75f2-4400-4ac6-9f04-7267ec95a5cc', 'b668868f-bf60-4ac3-b2b1-422f8ce1f8cd', 'Jaakko', 'Kovář', 15, 'D', 88, 32, 88, 50, 50, 820000, 5),
('2f5b74de-3ea2-439c-b349-b84518578987', 'b668868f-bf60-4ac3-b2b1-422f8ce1f8cd', 'Gael', 'Granqvist', 50, 'D', 87, 26, 89, 50, 50, 760000, 2),
('96d97fca-ac37-45da-b3f5-b86840d355b4', 'b668868f-bf60-4ac3-b2b1-422f8ce1f8cd', 'Olaf', 'Calderas', 43, 'D', 85, 26, 86, 50, 50, 650000, 2),
('c7ea3200-2175-4c0a-a14f-64ea115b8bc9', 'b668868f-bf60-4ac3-b2b1-422f8ce1f8cd', 'Pablo', 'Calderas', 37, 'D', 84, 34, 86, 50, 50, 510000, 1),
('855e4bf4-ce05-4f9e-ad16-a38b7e8e8f9a', 'b668868f-bf60-4ac3-b2b1-422f8ce1f8cd', 'Arvid', 'Bergkvist', 82, 'F', 90, 25, 93, 50, 50, 950000, 3),
('632e7077-7578-4524-85dc-14db1c8cb847', 'b668868f-bf60-4ac3-b2b1-422f8ce1f8cd', 'Yago', 'Granqvist', 66, 'F', 89, 24, 94, 50, 50, 880000, 5),
('9f34a396-a124-485e-a303-cafa078eb67c', 'b668868f-bf60-4ac3-b2b1-422f8ce1f8cd', 'Aksel', 'Zapatero', 57, 'F', 88, 29, 89, 50, 50, 820000, 1),
('2cf70e21-10ca-4c4d-893c-8c03c3cc6587', 'b668868f-bf60-4ac3-b2b1-422f8ce1f8cd', 'Oskar', 'Renteria', 24, 'F', 87, 26, 89, 50, 50, 760000, 2),
('4e1e687c-1944-463c-a429-8e249e57591a', 'b668868f-bf60-4ac3-b2b1-422f8ce1f8cd', 'Esteban', 'Urquiza', 13, 'F', 86, 23, 90, 50, 50, 710000, 4),
('6fdbd1f3-c5f8-4c1b-83cb-5547302cc7ae', 'b668868f-bf60-4ac3-b2b1-422f8ce1f8cd', 'Nahuel', 'Pellerin', 11, 'F', 86, 25, 88, 50, 50, 710000, 5),
('c99bf316-9aa0-440e-9771-55b83b26d722', 'b668868f-bf60-4ac3-b2b1-422f8ce1f8cd', 'Ulises', 'Renteria', 86, 'F', 84, 28, 85, 50, 50, 600000, 5),
('99e34b88-2784-4ba7-b550-eab0e4b9d3d4', 'b668868f-bf60-4ac3-b2b1-422f8ce1f8cd', 'Marek', 'Maravilla', 34, 'F', 83, 27, 84, 50, 50, 560000, 1),
('8c1fe374-e369-46ea-b127-2cc347c92522', 'b668868f-bf60-4ac3-b2b1-422f8ce1f8cd', 'Caio', 'Haldane', 77, 'F', 82, 24, 86, 50, 50, 520000, 1),
('cdd1fabf-809a-477b-8583-5fc879cc8d68', 'b668868f-bf60-4ac3-b2b1-422f8ce1f8cd', 'Quentin', 'Lindahl', 54, 'F', 81, 25, 83, 50, 50, 480000, 1),
('650354b4-5ebb-4058-953c-4e917c500e7e', 'b668868f-bf60-4ac3-b2b1-422f8ce1f8cd', 'Bruno', 'Arriaga', 67, 'F', 80, 36, 81, 50, 50, 380000, 1),
('b249c784-1373-422c-8fdd-58ab0ac50d6b', 'b668868f-bf60-4ac3-b2b1-422f8ce1f8cd', 'Ilan', 'Bramante', 29, 'F', 79, 26, 80, 50, 50, 410000, 4),
('53638767-dbc7-4338-bf83-64fc1c302024', '91fbbaad-ee73-47da-bd4b-716768c12235', 'Milo', 'Sundqvist', 87, 'G', 86, 20, 92, 50, 50, 420000, 1),
('595daa01-207e-4c92-ad4b-126c81db3624', '91fbbaad-ee73-47da-bd4b-716768c12235', 'Teo', 'Borrego', 69, 'G', 71, 26, 71, 50, 50, 230000, 4),
('47392461-7099-43a4-a18a-a63c54e44964', '91fbbaad-ee73-47da-bd4b-716768c12235', 'Ulises', 'Corvalán', 91, 'D', 95, 22, 100, 50, 50, 1340000, 1),
('71599617-c35f-4c1e-8a58-f338117e0483', '91fbbaad-ee73-47da-bd4b-716768c12235', 'Sebastián', 'Bramante', 58, 'D', 94, 27, 94, 50, 50, 1260000, 2),
('731e7d10-266b-466a-8c16-15c56b482e8a', '91fbbaad-ee73-47da-bd4b-716768c12235', 'Silas', 'Salazar', 59, 'D', 92, 25, 94, 50, 50, 1090000, 3),
('4fa601c8-5551-4ee4-a901-bfd081903224', '91fbbaad-ee73-47da-bd4b-716768c12235', 'Elio', 'Delacroix', 12, 'D', 91, 27, 92, 50, 50, 1020000, 4),
('2e9caa9d-6603-4533-994a-7dc31087dc54', '91fbbaad-ee73-47da-bd4b-716768c12235', 'Amadeo', 'Echeverri', 34, 'D', 89, 32, 89, 50, 50, 880000, 4),
('cd152adb-5a27-4764-aebd-9bfaf2d98d10', '91fbbaad-ee73-47da-bd4b-716768c12235', 'Bruno', 'Iturbe', 11, 'D', 88, 31, 89, 50, 50, 820000, 3),
('d6f2f8a7-d996-499c-804a-b182a783b110', '91fbbaad-ee73-47da-bd4b-716768c12235', 'Nahuel', 'Vallejo', 19, 'F', 91, 32, 93, 50, 50, 1020000, 2),
('177340f9-820a-444a-b5c4-caf2d3d600e5', '91fbbaad-ee73-47da-bd4b-716768c12235', 'Nikolai', 'Delacroix', 16, 'F', 90, 30, 91, 50, 50, 950000, 3),
('d35e275b-74d0-4f0a-96b8-0ea7d8568117', '91fbbaad-ee73-47da-bd4b-716768c12235', 'Yannick', 'Brandt', 80, 'F', 89, 25, 91, 50, 50, 880000, 1),
('f8c8cdb5-726a-4048-b384-d6cab9a8879c', '91fbbaad-ee73-47da-bd4b-716768c12235', 'Cedric', 'Jansky', 53, 'F', 88, 24, 91, 50, 50, 820000, 5),
('281dcbe0-86fb-401b-9578-87ca07afda62', '91fbbaad-ee73-47da-bd4b-716768c12235', 'Jaakko', 'Ekholm', 75, 'F', 87, 28, 88, 50, 50, 760000, 1),
('2fa52489-1021-4145-b6fc-506df331b72d', '91fbbaad-ee73-47da-bd4b-716768c12235', 'Teo', 'Tamayo', 50, 'F', 86, 26, 87, 50, 50, 710000, 2),
('05b70f28-de80-4ea8-b2fd-73e7a9dfee9e', '91fbbaad-ee73-47da-bd4b-716768c12235', 'Rune', 'Castellví', 65, 'F', 85, 22, 93, 50, 50, 650000, 1),
('380ea62b-b7a8-46f5-b226-3af0f49b6b5c', '91fbbaad-ee73-47da-bd4b-716768c12235', 'Quentin', 'Ostrowski', 93, 'F', 84, 28, 85, 50, 50, 600000, 4),
('0f33c772-ae1c-4478-beb0-4d8de6c540c0', '91fbbaad-ee73-47da-bd4b-716768c12235', 'Hugo', 'Riquelme', 26, 'F', 83, 22, 91, 50, 50, 560000, 2),
('0aa2ae71-12fb-487b-9ca7-efe8cdae0a10', '91fbbaad-ee73-47da-bd4b-716768c12235', 'Lauri', 'Toivonen', 84, 'F', 81, 27, 82, 50, 50, 480000, 3),
('f7593d8b-0987-44c9-b306-e57c5376b138', '91fbbaad-ee73-47da-bd4b-716768c12235', 'Aldo', 'Ferrán', 63, 'F', 81, 30, 82, 50, 50, 480000, 1),
('a2de1cbe-b249-434a-bfec-8bbed829f251', '91fbbaad-ee73-47da-bd4b-716768c12235', 'Bruno', 'Sundqvist', 61, 'F', 80, 22, 88, 50, 50, 440000, 1),
('58e36377-24bb-46ea-ad05-424312be6574', '4eecd7bb-d0c8-4ce3-8b35-4735528793cf', 'Bastian', 'Quintanar', 20, 'G', 87, 29, 88, 50, 50, 760000, 3),
('3395b4a1-9b4f-42dd-af24-70d07165929e', '4eecd7bb-d0c8-4ce3-8b35-4735528793cf', 'Emil', 'Escalante', 31, 'G', 78, 27, 80, 50, 50, 380000, 1),
('ad751282-6935-413c-9582-2f6ee504877a', '4eecd7bb-d0c8-4ce3-8b35-4735528793cf', 'Sven', 'Iturbe', 28, 'D', 87, 32, 88, 50, 50, 760000, 3),
('e7022bb6-d868-4e9e-aac3-ab69a64f939b', '4eecd7bb-d0c8-4ce3-8b35-4735528793cf', 'Arvid', 'Urquiza', 9, 'D', 86, 29, 87, 50, 50, 710000, 2),
('f079f699-d6c9-43ab-9fad-51262db3f5c4', '4eecd7bb-d0c8-4ce3-8b35-4735528793cf', 'Yannick', 'Lindqvist', 29, 'D', 84, 28, 86, 50, 50, 600000, 1),
('92017287-13a6-48d8-aefe-75175a00bf6c', '4eecd7bb-d0c8-4ce3-8b35-4735528793cf', 'Fausto', 'Halvorsen', 36, 'D', 83, 31, 84, 50, 50, 560000, 4),
('b2ca4d30-ef5b-4806-9fdf-f6113bcda79c', '4eecd7bb-d0c8-4ce3-8b35-4735528793cf', 'Tobías', 'Arnesen', 57, 'D', 81, 32, 82, 50, 50, 480000, 4),
('aa00cc16-955d-403b-9319-b4a73f0d25d5', '4eecd7bb-d0c8-4ce3-8b35-4735528793cf', 'Tadeo', 'Lagarde', 67, 'D', 80, 32, 81, 50, 50, 440000, 4),
('bbd769cd-8280-4e6a-b6cc-7644fdbc7f35', '4eecd7bb-d0c8-4ce3-8b35-4735528793cf', 'Esteban', 'Arnesen', 94, 'F', 97, 30, 99, 50, 50, 1530000, 1),
('940b3362-ed97-4f4a-9c78-4dc6d6a33d9a', '4eecd7bb-d0c8-4ce3-8b35-4735528793cf', 'Rafael', 'Duarte', 33, 'F', 96, 33, 96, 50, 50, 1220000, 5),
('f8ee8e93-708e-43ac-9736-2331a7e7d3a5', '4eecd7bb-d0c8-4ce3-8b35-4735528793cf', 'Leandro', 'Fonteyne', 32, 'F', 95, 22, 100, 50, 50, 1340000, 2),
('dc6b8b65-c344-4d6e-a21f-b6c657a0df18', '4eecd7bb-d0c8-4ce3-8b35-4735528793cf', 'Lenny', 'Falkner', 38, 'F', 94, 30, 96, 50, 50, 1260000, 1),
('a9ad16d4-f5b5-42a3-9fe8-25a1193d6c51', '4eecd7bb-d0c8-4ce3-8b35-4735528793cf', 'Casimir', 'Tamayo', 62, 'F', 93, 26, 94, 50, 50, 1170000, 5),
('14868492-60e1-4b64-a9cf-1c271f53f48d', '4eecd7bb-d0c8-4ce3-8b35-4735528793cf', 'Ivo', 'Zelenka', 3, 'F', 93, 21, 97, 50, 50, 700000, 1),
('3561763c-2563-478c-b920-10fb095eb9f0', '4eecd7bb-d0c8-4ce3-8b35-4735528793cf', 'Yannick', 'Ostrowski', 77, 'F', 91, 26, 93, 50, 50, 1020000, 2),
('6f94800a-ad93-4f51-88a1-2fc42fb3d45a', '4eecd7bb-d0c8-4ce3-8b35-4735528793cf', 'Valtteri', 'Zelenka', 25, 'F', 90, 24, 94, 50, 50, 950000, 1),
('ad978a15-6d9a-4ccb-9134-038f82966c12', '4eecd7bb-d0c8-4ce3-8b35-4735528793cf', 'Sven', 'Gallardo', 2, 'F', 89, 24, 91, 50, 50, 880000, 3),
('d2f9d262-4a62-40e6-a6cd-17e48d1bc93b', '4eecd7bb-d0c8-4ce3-8b35-4735528793cf', 'Gustavo', 'Corvalán', 69, 'F', 88, 27, 89, 50, 50, 820000, 1),
('033d890d-3b60-46fb-a9da-519c3103ae14', '4eecd7bb-d0c8-4ce3-8b35-4735528793cf', 'Lenny', 'Norberg', 41, 'F', 87, 26, 89, 50, 50, 760000, 5),
('1e305999-7dc0-44be-9a84-b63e8b1353ce', '4eecd7bb-d0c8-4ce3-8b35-4735528793cf', 'Dorian', 'Cabrales', 53, 'F', 86, 28, 88, 50, 50, 710000, 4);
insert into competitions (id, key, name, format, participant_rule, config, ranking_weight, permanent, sort_order) values ('243a017c-c692-431e-aafa-6b72fb42e365', 'ohl', 'OHL', 'league', '{"type":"all"}'::jsonb, '{"points":{"win":3,"draw":1,"loss":0,"otWin":2,"otLoss":1},"tiebreakers":["points","goal_diff","goals_for","head_to_head","wins"],"randomness":30,"mode":"realista","overtime":true,"awayGoals":false,"roundsPerOpponent":2,"playoffTeams":24,"playoffByes":8,"playoffLegs":1}'::jsonb, 2, true, 1);
insert into competitions (id, key, name, format, participant_rule, config, ranking_weight, permanent, sort_order) values ('b14850b1-4234-4493-bebf-d01c445c0008', 'primera', 'Primera División', 'league', '{"type":"division","division":1}'::jsonb, '{"points":{"win":3,"draw":1,"loss":0,"otWin":2,"otLoss":1},"tiebreakers":["points","goal_diff","goals_for","head_to_head","wins"],"randomness":30,"mode":"realista","overtime":true,"awayGoals":false,"roundsPerOpponent":2,"playoffTeams":8,"relegated":6,"playoffLegs":1}'::jsonb, 2, true, 2);
insert into competitions (id, key, name, format, participant_rule, config, ranking_weight, permanent, sort_order) values ('f2205a66-425c-4c45-a279-658d7a1c44e1', 'segunda', 'Segunda División', 'league', '{"type":"division","division":2}'::jsonb, '{"points":{"win":3,"draw":1,"loss":0,"otWin":2,"otLoss":1},"tiebreakers":["points","goal_diff","goals_for","head_to_head","wins"],"randomness":30,"mode":"realista","overtime":true,"awayGoals":false,"roundsPerOpponent":2,"playoffTeams":16,"promoted":6,"playoffLegs":1}'::jsonb, 0.5, true, 3);
insert into competitions (id, key, name, format, participant_rule, config, ranking_weight, permanent, sort_order) values ('7c46a897-1591-4bfb-ae68-48a540fd88b7', 'all_stars', 'ALL STARS', 'swiss', '{"type":"historical_top","n":32}'::jsonb, '{"points":{"win":3,"draw":1,"loss":0,"otWin":2,"otLoss":1},"tiebreakers":["points","goal_diff","goals_for","head_to_head","wins"],"randomness":30,"mode":"realista","overtime":true,"awayGoals":false,"swissRounds":8,"directQualifiers":8,"playoffFrom":9,"playoffTo":24,"playoffLegs":1}'::jsonb, 2, true, 4);
insert into competitions (id, key, name, format, participant_rule, config, ranking_weight, permanent, sort_order) values ('5f8fb457-3fbf-4c7b-96d9-ed3093bcb00b', 'champions', 'CHAMPIONS', 'two_legged', '{"type":"season_top","n":32,"fallback":"historical_top"}'::jsonb, '{"points":{"win":3,"draw":1,"loss":0,"otWin":2,"otLoss":1},"tiebreakers":["points","goal_diff","goals_for","head_to_head","wins"],"randomness":30,"mode":"realista","overtime":true,"awayGoals":false,"playoffLegs":2,"singleLegFinal":true,"neutralFinal":true}'::jsonb, 2.5, true, 5);
insert into competitions (id, key, name, format, participant_rule, config, ranking_weight, permanent, sort_order) values ('ac5488cf-d1e2-48ae-90a9-adc3204e18e3', 'copa', 'COPA', 'groups_knockout', '{"type":"combo","parts":[{"type":"season_top","n":10,"fallback":"historical_top","seeded":8},{"type":"draw","n":22}]}'::jsonb, '{"points":{"win":3,"draw":1,"loss":0,"otWin":2,"otLoss":1},"tiebreakers":["points","goal_diff","goals_for","head_to_head","wins"],"randomness":30,"mode":"realista","overtime":true,"awayGoals":false,"groups":8,"groupSize":4,"qualifyPerGroup":2,"roundsPerOpponent":1,"playoffLegs":1}'::jsonb, 1.5, true, 6);
insert into competitions (id, key, name, format, participant_rule, config, ranking_weight, permanent, sort_order) values ('a93bfb3e-0cc4-4903-864c-206e3875540e', 'open', 'OPEN', 'league', '{"type":"invite"}'::jsonb, '{"points":{"win":3,"draw":1,"loss":0,"otWin":2,"otLoss":1},"tiebreakers":["points","goal_diff","goals_for","head_to_head","wins"],"randomness":30,"mode":"realista","overtime":true,"awayGoals":false,"roundsPerOpponent":2,"playoffTeams":8,"playoffLegs":1}'::jsonb, 1, true, 7);
insert into competitions (id, key, name, format, participant_rule, config, ranking_weight, permanent, sort_order) values ('48c4c0ad-2362-4a9f-a0a8-cdf51c550e53', 'centenario', 'Torneo CENTENARIO', 'league', '{"type":"historical_top","n":12}'::jsonb, '{"points":{"win":3,"draw":1,"loss":0,"otWin":2,"otLoss":1},"tiebreakers":["points","goal_diff","goals_for","head_to_head","wins"],"randomness":30,"mode":"realista","overtime":true,"awayGoals":false,"roundsPerOpponent":4,"playoffTeams":8,"playoffLegs":1,"triggerEvery":100}'::jsonb, 3, false, 8);
insert into seasons (id, number, status) values ('d99b8b70-4490-46b9-8c49-43d1bd2d61fc', 1, 'active');
commit;

-- ═══ supabase/legacy.sql ═══
-- Generado por scripts/import-legacy.ts
begin;
select set_config('arena.skip_log', 'on', true);
delete from legacy_editions;
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('32PLAYS', '2026', 'Kings', (select id from teams where lower(name) = lower('Kings')), 'Boing', (select id from teams where lower(name) = lower('Boing')), '[]'::jsonb, '[]'::jsonb, 1);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('ALL SATRS', '2026', 'Falcons', (select id from teams where lower(name) = lower('Falcons')), 'Phantoms', (select id from teams where lower(name) = lower('Phantoms')), '[]'::jsonb, '[]'::jsonb, 2);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('All Stars', '2026', 'Teletes', (select id from teams where lower(name) = lower('Teletes')), 'Ice Dragons', (select id from teams where lower(name) = lower('Ice Dragons')), '[]'::jsonb, '[]'::jsonb, 3);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('ALL STARS', '2026', 'Kings', (select id from teams where lower(name) = lower('Kings')), 'Titans', (select id from teams where lower(name) = lower('Titans')), '[]'::jsonb, '[]'::jsonb, 4);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('ALL STARS', '2026', 'The Lightnings', (select id from teams where lower(name) = lower('The Lightnings')), 'AZTECZ', (select id from teams where lower(name) = lower('AZTECZ')), '[]'::jsonb, '[]'::jsonb, 5);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('ALL STARS', '2026', 'Aletico Metropolitano', (select id from teams where lower(name) = lower('Aletico Metropolitano')), 'Ducks', (select id from teams where lower(name) = lower('Ducks')), '[]'::jsonb, '[]'::jsonb, 6);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('ALL STARS', '2026', 'Penguins', (select id from teams where lower(name) = lower('Penguins')), 'Bears', (select id from teams where lower(name) = lower('Bears')), '[]'::jsonb, '[]'::jsonb, 7);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('ALL STARS', '2026', 'IMALAYAS HC', (select id from teams where lower(name) = lower('IMALAYAS HC')), 'Titans', (select id from teams where lower(name) = lower('Titans')), '[]'::jsonb, '[]'::jsonb, 8);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('ALL STARS', '2026', 'The Lightnings', (select id from teams where lower(name) = lower('The Lightnings')), 'Horizon', (select id from teams where lower(name) = lower('Horizon')), '["Kings","Ice Dragons","Teletes"]'::jsonb, '[{"position":1,"team":"Kings","points":56,"wins":17,"draws":0,"losses":10,"goalsFor":95,"goalsAgainst":81},{"position":2,"team":"Ice Dragons","points":55,"wins":17,"draws":0,"losses":10,"goalsFor":106,"goalsAgainst":79},{"position":3,"team":"Teletes","points":55,"wins":15,"draws":0,"losses":9,"goalsFor":103,"goalsAgainst":85}]'::jsonb, 9);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('ALL STARS', '2026', 'Aletico Metropolitano', (select id from teams where lower(name) = lower('Aletico Metropolitano')), 'Kings', (select id from teams where lower(name) = lower('Kings')), '["Penguins","Raptors","Teletes"]'::jsonb, '[{"position":1,"team":"Penguins","points":99,"wins":28,"draws":0,"losses":16,"goalsFor":186,"goalsAgainst":162},{"position":2,"team":"Raptors","points":97,"wins":27,"draws":0,"losses":18,"goalsFor":196,"goalsAgainst":193},{"position":3,"team":"Teletes","points":95,"wins":28,"draws":0,"losses":19,"goalsFor":193,"goalsAgainst":156}]'::jsonb, 10);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('ALL STARS', '2026', 'Aletico Metropolitano', (select id from teams where lower(name) = lower('Aletico Metropolitano')), 'Kings', (select id from teams where lower(name) = lower('Kings')), '[]'::jsonb, '[]'::jsonb, 11);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('ALL STARS', '2026', 'Kings', (select id from teams where lower(name) = lower('Kings')), 'Teletes', (select id from teams where lower(name) = lower('Teletes')), '[]'::jsonb, '[]'::jsonb, 12);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('ALL STARS', '2026', 'Cuervos', (select id from teams where lower(name) = lower('Cuervos')), 'Bears', (select id from teams where lower(name) = lower('Bears')), '[]'::jsonb, '[]'::jsonb, 13);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('ALL STARS', '2026', 'Ice Dragons', (select id from teams where lower(name) = lower('Ice Dragons')), 'Kings', (select id from teams where lower(name) = lower('Kings')), '[]'::jsonb, '[]'::jsonb, 14);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('ALL STARS', '2026', 'Kings', (select id from teams where lower(name) = lower('Kings')), 'IMALAYAS HC', (select id from teams where lower(name) = lower('IMALAYAS HC')), '["Horizon","Ice Breakers","Falcons"]'::jsonb, '[{"position":1,"team":"Horizon","points":94,"wins":24,"draws":0,"losses":12,"goalsFor":135,"goalsAgainst":121},{"position":2,"team":"Ice Breakers","points":88,"wins":25,"draws":0,"losses":13,"goalsFor":130,"goalsAgainst":124},{"position":3,"team":"Falcons","points":87,"wins":23,"draws":0,"losses":16,"goalsFor":134,"goalsAgainst":117}]'::jsonb, 15);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('ALL STARS', '2026', 'Ice Breakers', (select id from teams where lower(name) = lower('Ice Breakers')), 'Ducks', (select id from teams where lower(name) = lower('Ducks')), '[]'::jsonb, '[]'::jsonb, 16);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('ALL STARS', '2026', 'Angels', (select id from teams where lower(name) = lower('Angels')), 'Ducks', (select id from teams where lower(name) = lower('Ducks')), '[]'::jsonb, '[]'::jsonb, 17);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('ALL STARS', '2026', 'Aletico Metropolitano', (select id from teams where lower(name) = lower('Aletico Metropolitano')), 'Dolphins', (select id from teams where lower(name) = lower('Dolphins')), '["Kings","Ice Dragons","Horizon"]'::jsonb, '[{"position":1,"team":"Kings","points":94,"wins":23,"draws":0,"losses":12,"goalsFor":139,"goalsAgainst":119},{"position":2,"team":"Ice Dragons","points":93,"wins":22,"draws":0,"losses":11,"goalsFor":137,"goalsAgainst":120},{"position":3,"team":"Horizon","points":90,"wins":24,"draws":0,"losses":14,"goalsFor":134,"goalsAgainst":118}]'::jsonb, 18);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('ALL STARS', '2026', 'Penguins', (select id from teams where lower(name) = lower('Penguins')), 'Falcons', (select id from teams where lower(name) = lower('Falcons')), '["IMALAYAS HC","Falcons","Penguins"]'::jsonb, '[{"position":1,"team":"IMALAYAS HC","points":91,"wins":21,"draws":0,"losses":11,"goalsFor":130,"goalsAgainst":116},{"position":2,"team":"Falcons","points":88,"wins":23,"draws":0,"losses":14,"goalsFor":132,"goalsAgainst":119},{"position":3,"team":"Penguins","points":87,"wins":19,"draws":0,"losses":10,"goalsFor":132,"goalsAgainst":125}]'::jsonb, 19);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('ALL STARS', '2026', 'Aletico Metropolitano', (select id from teams where lower(name) = lower('Aletico Metropolitano')), 'Cuervos', (select id from teams where lower(name) = lower('Cuervos')), '[]'::jsonb, '[]'::jsonb, 20);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('ALL STARS', '2026', 'Ice Dragons', (select id from teams where lower(name) = lower('Ice Dragons')), 'IMALAYAS HC', (select id from teams where lower(name) = lower('IMALAYAS HC')), '["Ducks","IMALAYAS HC","Kings"]'::jsonb, '[{"position":1,"team":"Ducks","points":80,"wins":19,"draws":0,"losses":8,"goalsFor":114,"goalsAgainst":102},{"position":2,"team":"IMALAYAS HC","points":76,"wins":19,"draws":0,"losses":11,"goalsFor":113,"goalsAgainst":101},{"position":3,"team":"Kings","points":75,"wins":21,"draws":0,"losses":13,"goalsFor":110,"goalsAgainst":97}]'::jsonb, 21);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('ALL STARS', '2026', 'Ice Breakers', (select id from teams where lower(name) = lower('Ice Breakers')), 'Teletes', (select id from teams where lower(name) = lower('Teletes')), '[]'::jsonb, '[]'::jsonb, 22);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('ALL STARS', '2026', 'Panthers', (select id from teams where lower(name) = lower('Panthers')), 'Penguins', (select id from teams where lower(name) = lower('Penguins')), '[]'::jsonb, '[]'::jsonb, 23);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('ALL STARS', '2026', 'Falcons', (select id from teams where lower(name) = lower('Falcons')), 'Horizon', (select id from teams where lower(name) = lower('Horizon')), '[]'::jsonb, '[]'::jsonb, 24);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('ALL STARS', '2026', 'Angels', (select id from teams where lower(name) = lower('Angels')), 'Ducks', (select id from teams where lower(name) = lower('Ducks')), '[]'::jsonb, '[]'::jsonb, 25);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('ALL STARS', '2026', 'Ducks', (select id from teams where lower(name) = lower('Ducks')), 'Penguins', (select id from teams where lower(name) = lower('Penguins')), '["Ice Breakers","Ducks","Falcons"]'::jsonb, '[{"position":1,"team":"Ice Breakers","points":73,"wins":20,"draws":0,"losses":14,"goalsFor":116,"goalsAgainst":104},{"position":2,"team":"Ducks","points":73,"wins":19,"draws":0,"losses":13,"goalsFor":110,"goalsAgainst":99},{"position":3,"team":"Falcons","points":72,"wins":19,"draws":0,"losses":13,"goalsFor":107,"goalsAgainst":97}]'::jsonb, 26);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('ALL STARS', '2026', 'Cuervos', (select id from teams where lower(name) = lower('Cuervos')), 'Ice Breakers', (select id from teams where lower(name) = lower('Ice Breakers')), '[]'::jsonb, '[]'::jsonb, 27);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('ALL STARS', '2026', 'Ice Breakers', (select id from teams where lower(name) = lower('Ice Breakers')), 'Panthers', (select id from teams where lower(name) = lower('Panthers')), '[]'::jsonb, '[]'::jsonb, 28);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('ALL STARS', '2026', 'Teletes', (select id from teams where lower(name) = lower('Teletes')), 'Ice Breakers', (select id from teams where lower(name) = lower('Ice Breakers')), '[]'::jsonb, '[]'::jsonb, 29);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('ALL STARS', '2026', 'Wolves', (select id from teams where lower(name) = lower('Wolves')), 'Kings', (select id from teams where lower(name) = lower('Kings')), '[]'::jsonb, '[]'::jsonb, 30);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('ALL STARS', '2026', 'Ice Breakers', (select id from teams where lower(name) = lower('Ice Breakers')), 'Kings', (select id from teams where lower(name) = lower('Kings')), '[]'::jsonb, '[]'::jsonb, 31);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('ALL STARS', '2026', 'Ducks', (select id from teams where lower(name) = lower('Ducks')), 'Ice Dragons', (select id from teams where lower(name) = lower('Ice Dragons')), '["Ice Dragons","Aletico Metropolitano","Penguins"]'::jsonb, '[{"position":1,"team":"Ice Dragons","points":48,"wins":10,"draws":0,"losses":6,"goalsFor":64,"goalsAgainst":54},{"position":2,"team":"Aletico Metropolitano","points":44,"wins":11,"draws":0,"losses":8,"goalsFor":62,"goalsAgainst":57},{"position":3,"team":"Penguins","points":43,"wins":9,"draws":0,"losses":6,"goalsFor":61,"goalsAgainst":57}]'::jsonb, 32);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('ALL STARS', '2026', 'Teletes', (select id from teams where lower(name) = lower('Teletes')), 'Berserkers', (select id from teams where lower(name) = lower('Berserkers')), '[]'::jsonb, '[]'::jsonb, 33);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('ALL STARS', '2039', 'Ducks', (select id from teams where lower(name) = lower('Ducks')), 'Berserkers', (select id from teams where lower(name) = lower('Berserkers')), '["Berserkers","OWLS","Salmons"]'::jsonb, '[{"position":1,"team":"Berserkers","points":46,"wins":11,"draws":0,"losses":6,"goalsFor":63,"goalsAgainst":61},{"position":2,"team":"OWLS","points":44,"wins":9,"draws":0,"losses":7,"goalsFor":60,"goalsAgainst":53},{"position":3,"team":"Salmons","points":42,"wins":7,"draws":0,"losses":8,"goalsFor":63,"goalsAgainst":56}]'::jsonb, 34);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('ALLS STARS', '2032', 'The Lightnings', (select id from teams where lower(name) = lower('The Lightnings')), 'Ducks', (select id from teams where lower(name) = lower('Ducks')), '[]'::jsonb, '[]'::jsonb, 35);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('ALLS vs NEW', '2029', 'Dolphins', (select id from teams where lower(name) = lower('Dolphins')), 'Ice Dragons', (select id from teams where lower(name) = lower('Ice Dragons')), '[]'::jsonb, '[]'::jsonb, 36);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('CHAMPIONS', '2026', 'Perry the platypus', (select id from teams where lower(name) = lower('Perry the platypus')), 'IMALAYAS HC', (select id from teams where lower(name) = lower('IMALAYAS HC')), '[]'::jsonb, '[]'::jsonb, 37);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('CHAMPIONS', '2026', 'The Lightnings', (select id from teams where lower(name) = lower('The Lightnings')), 'Raptors', (select id from teams where lower(name) = lower('Raptors')), '[]'::jsonb, '[]'::jsonb, 38);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('CHAMPIONS', '2026', 'Penguins', (select id from teams where lower(name) = lower('Penguins')), 'Ducks', (select id from teams where lower(name) = lower('Ducks')), '[]'::jsonb, '[]'::jsonb, 39);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('CHAMPIONS', '2026', 'The Lightnings', (select id from teams where lower(name) = lower('The Lightnings')), 'Tigers', (select id from teams where lower(name) = lower('Tigers')), '[]'::jsonb, '[]'::jsonb, 40);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('CHAMPIONS', '2026', 'Kings', (select id from teams where lower(name) = lower('Kings')), 'Demons', (select id from teams where lower(name) = lower('Demons')), '[]'::jsonb, '[]'::jsonb, 41);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('CHAMPIONS', '2026', 'Teletes', (select id from teams where lower(name) = lower('Teletes')), 'The Lightnings', (select id from teams where lower(name) = lower('The Lightnings')), '[]'::jsonb, '[]'::jsonb, 42);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('CHAMPIONS', '2026', 'Dolphins', (select id from teams where lower(name) = lower('Dolphins')), 'Cuervos', (select id from teams where lower(name) = lower('Cuervos')), '[]'::jsonb, '[]'::jsonb, 43);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('CHAMPIONS', '2026', 'IMALAYAS HC', (select id from teams where lower(name) = lower('IMALAYAS HC')), 'Dolphins', (select id from teams where lower(name) = lower('Dolphins')), '[]'::jsonb, '[]'::jsonb, 44);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('CHAMPIONS', '2026', 'Titans', (select id from teams where lower(name) = lower('Titans')), 'Vikings', (select id from teams where lower(name) = lower('Vikings')), '[]'::jsonb, '[]'::jsonb, 45);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('CHAMPIONS', '2026', 'Teletes', (select id from teams where lower(name) = lower('Teletes')), 'Cuervos', (select id from teams where lower(name) = lower('Cuervos')), '[]'::jsonb, '[]'::jsonb, 46);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('CHAMPIONS', '2026', 'Cuervos', (select id from teams where lower(name) = lower('Cuervos')), 'IMALAYAS HC', (select id from teams where lower(name) = lower('IMALAYAS HC')), '[]'::jsonb, '[]'::jsonb, 47);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('CHAMPIONS', '2026', 'RHINOS', (select id from teams where lower(name) = lower('RHINOS')), 'Titans', (select id from teams where lower(name) = lower('Titans')), '[]'::jsonb, '[]'::jsonb, 48);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('CHAMPIONS', '2026', 'Aletico Metropolitano', (select id from teams where lower(name) = lower('Aletico Metropolitano')), 'Kings', (select id from teams where lower(name) = lower('Kings')), '[]'::jsonb, '[]'::jsonb, 49);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('CHAMPIONS', '2026', 'IMALAYAS HC', (select id from teams where lower(name) = lower('IMALAYAS HC')), 'Panthers', (select id from teams where lower(name) = lower('Panthers')), '[]'::jsonb, '[]'::jsonb, 50);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('CHAMPIONS', '2026', 'Ice Dragons', (select id from teams where lower(name) = lower('Ice Dragons')), 'OWLS', (select id from teams where lower(name) = lower('OWLS')), '[]'::jsonb, '[]'::jsonb, 51);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('Copa', '2026', 'Teletes', (select id from teams where lower(name) = lower('Teletes')), 'Ice Dragons', (select id from teams where lower(name) = lower('Ice Dragons')), '[]'::jsonb, '[]'::jsonb, 52);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('Copa', '2026', 'Dolphins', (select id from teams where lower(name) = lower('Dolphins')), 'Teletes', (select id from teams where lower(name) = lower('Teletes')), '[]'::jsonb, '[]'::jsonb, 53);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('COPA', '2026', 'Black Horses', (select id from teams where lower(name) = lower('Black Horses')), 'Pirates', (select id from teams where lower(name) = lower('Pirates')), '[]'::jsonb, '[]'::jsonb, 54);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('COPA', '2026', 'Ducks', (select id from teams where lower(name) = lower('Ducks')), 'Axolotls', (select id from teams where lower(name) = lower('Axolotls')), '[]'::jsonb, '[]'::jsonb, 55);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('COPA', '2026', 'Ice Breakers', (select id from teams where lower(name) = lower('Ice Breakers')), 'Penguins', (select id from teams where lower(name) = lower('Penguins')), '[]'::jsonb, '[]'::jsonb, 56);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('COPA', '2026', 'Black Horses', (select id from teams where lower(name) = lower('Black Horses')), 'Kings', (select id from teams where lower(name) = lower('Kings')), '[]'::jsonb, '[]'::jsonb, 57);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('COPA', '2026', 'Ducks', (select id from teams where lower(name) = lower('Ducks')), 'Horizon', (select id from teams where lower(name) = lower('Horizon')), '[]'::jsonb, '[]'::jsonb, 58);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('Especial 151', '2026', 'Black Horses', (select id from teams where lower(name) = lower('Black Horses')), 'Ice Dragons', (select id from teams where lower(name) = lower('Ice Dragons')), '["Bears","Falcons","Black Horses"]'::jsonb, '[{"position":1,"team":"Bears","points":168,"wins":50,"draws":0,"losses":21,"goalsFor":307,"goalsAgainst":221},{"position":2,"team":"Falcons","points":154,"wins":43,"draws":0,"losses":23,"goalsFor":287,"goalsAgainst":242},{"position":3,"team":"Black Horses","points":152,"wins":45,"draws":0,"losses":25,"goalsFor":281,"goalsAgainst":246}]'::jsonb, 59);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('Especial', '2026', 'Ducks', (select id from teams where lower(name) = lower('Ducks')), 'Ice Dragons', (select id from teams where lower(name) = lower('Ice Dragons')), '["Ducks","Foxes","Ice Dragons"]'::jsonb, '[{"position":1,"team":"Ducks","points":91,"wins":15,"draws":0,"losses":8,"goalsFor":123,"goalsAgainst":108},{"position":2,"team":"Foxes","points":90,"wins":21,"draws":0,"losses":11,"goalsFor":124,"goalsAgainst":115},{"position":3,"team":"Ice Dragons","points":83,"wins":21,"draws":0,"losses":14,"goalsFor":118,"goalsAgainst":116}]'::jsonb, 60);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('FSLH', '2026', 'Falcons', (select id from teams where lower(name) = lower('Falcons')), 'Aletico Metropolitano', (select id from teams where lower(name) = lower('Aletico Metropolitano')), '[]'::jsonb, '[]'::jsonb, 61);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('LAB CUP', '2026', 'Salamaders', (select id from teams where lower(name) = lower('Salamaders')), 'The Lightnings', (select id from teams where lower(name) = lower('The Lightnings')), '[]'::jsonb, '[]'::jsonb, 62);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('LAB CUP', '2026', 'Falcons', (select id from teams where lower(name) = lower('Falcons')), 'Salmons', (select id from teams where lower(name) = lower('Salmons')), '["Teletes","The Lightnings","Ice Breakers"]'::jsonb, '[{"position":1,"team":"Teletes","points":115,"wins":34,"draws":0,"losses":16,"goalsFor":208,"goalsAgainst":151},{"position":2,"team":"The Lightnings","points":111,"wins":30,"draws":0,"losses":16,"goalsFor":206,"goalsAgainst":167},{"position":3,"team":"Ice Breakers","points":108,"wins":31,"draws":0,"losses":17,"goalsFor":200,"goalsAgainst":147}]'::jsonb, 63);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('LAB CUP', '2026', 'Horizon', (select id from teams where lower(name) = lower('Horizon')), 'Titans', (select id from teams where lower(name) = lower('Titans')), '["Penguins","Teletes","Horizon"]'::jsonb, '[{"position":1,"team":"Penguins","points":48,"wins":13,"draws":0,"losses":7,"goalsFor":62,"goalsAgainst":52},{"position":2,"team":"Teletes","points":43,"wins":12,"draws":0,"losses":9,"goalsFor":65,"goalsAgainst":64},{"position":3,"team":"Horizon","points":42,"wins":10,"draws":0,"losses":9,"goalsFor":76,"goalsAgainst":69}]'::jsonb, 64);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('LAB CUP', '2026', 'Falcons', (select id from teams where lower(name) = lower('Falcons')), 'Aletico Metropolitano', (select id from teams where lower(name) = lower('Aletico Metropolitano')), '[]'::jsonb, '[]'::jsonb, 65);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('LAB CUP', '2026', 'Ducks', (select id from teams where lower(name) = lower('Ducks')), 'Horizon', (select id from teams where lower(name) = lower('Horizon')), '["Kings","Ducks","IMALAYAS HC"]'::jsonb, '[{"position":1,"team":"Kings","points":84,"wins":21,"draws":0,"losses":12,"goalsFor":124,"goalsAgainst":109},{"position":2,"team":"Ducks","points":83,"wins":24,"draws":0,"losses":16,"goalsFor":119,"goalsAgainst":107},{"position":3,"team":"IMALAYAS HC","points":81,"wins":21,"draws":0,"losses":14,"goalsFor":120,"goalsAgainst":112}]'::jsonb, 66);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('LAB CUP', '2026', 'Horizon', (select id from teams where lower(name) = lower('Horizon')), 'Ice Dragons', (select id from teams where lower(name) = lower('Ice Dragons')), '[]'::jsonb, '[]'::jsonb, 67);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('LAB CUP', '2026', 'IMALAYAS HC', (select id from teams where lower(name) = lower('IMALAYAS HC')), 'Ducks', (select id from teams where lower(name) = lower('Ducks')), '[]'::jsonb, '[]'::jsonb, 68);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('LAB CUP', '2026', 'Ice Breakers', (select id from teams where lower(name) = lower('Ice Breakers')), 'The Lightnings', (select id from teams where lower(name) = lower('The Lightnings')), '[]'::jsonb, '[]'::jsonb, 69);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('LAB CUP', '2026', 'Kings', (select id from teams where lower(name) = lower('Kings')), 'Ice Breakers', (select id from teams where lower(name) = lower('Ice Breakers')), '[]'::jsonb, '[]'::jsonb, 70);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('LAB CUP', '2026', 'Berserkers', (select id from teams where lower(name) = lower('Berserkers')), 'Ice Dragons', (select id from teams where lower(name) = lower('Ice Dragons')), '[]'::jsonb, '[]'::jsonb, 71);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('Liga del siglo', '2030', 'OWLS', (select id from teams where lower(name) = lower('OWLS')), 'Berserkers', (select id from teams where lower(name) = lower('Berserkers')), '["Berserkers","Kings","OWLS"]'::jsonb, '[{"position":1,"team":"Berserkers","points":214,"wins":52,"draws":0,"losses":28,"goalsFor":302,"goalsAgainst":257},{"position":2,"team":"Kings","points":212,"wins":51,"draws":0,"losses":25,"goalsFor":283,"goalsAgainst":247},{"position":3,"team":"OWLS","points":194,"wins":47,"draws":0,"losses":33,"goalsFor":269,"goalsAgainst":245}]'::jsonb, 72);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL 2', '2028', 'Teletes', (select id from teams where lower(name) = lower('Teletes')), 'Ice Dragons', (select id from teams where lower(name) = lower('Ice Dragons')), '[]'::jsonb, '[]'::jsonb, 73);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Boing', (select id from teams where lower(name) = lower('Boing')), 'Perry the platypus', (select id from teams where lower(name) = lower('Perry the platypus')), '[]'::jsonb, '[]'::jsonb, 74);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Horizon', (select id from teams where lower(name) = lower('Horizon')), 'Boing', (select id from teams where lower(name) = lower('Boing')), '["Ducks","Raptors","The Lightnings"]'::jsonb, '[{"position":1,"team":"Ducks","points":198,"wins":53,"draws":0,"losses":28,"goalsFor":353,"goalsAgainst":298},{"position":2,"team":"Raptors","points":193,"wins":56,"draws":0,"losses":31,"goalsFor":346,"goalsAgainst":293},{"position":3,"team":"The Lightnings","points":188,"wins":56,"draws":0,"losses":38,"goalsFor":347,"goalsAgainst":318}]'::jsonb, 75);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Cobras', (select id from teams where lower(name) = lower('Cobras')), 'Huskys', (select id from teams where lower(name) = lower('Huskys')), '["Ice Dragons","Falcons","Phantoms"]'::jsonb, '[{"position":1,"team":"Ice Dragons","points":215,"wins":63,"draws":0,"losses":28,"goalsFor":354,"goalsAgainst":263},{"position":2,"team":"Falcons","points":191,"wins":54,"draws":0,"losses":35,"goalsFor":375,"goalsAgainst":299},{"position":3,"team":"Phantoms","points":190,"wins":56,"draws":0,"losses":36,"goalsFor":365,"goalsAgainst":294}]'::jsonb, 76);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Bears', (select id from teams where lower(name) = lower('Bears')), 'Panthers', (select id from teams where lower(name) = lower('Panthers')), '[]'::jsonb, '[]'::jsonb, 77);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Demons', (select id from teams where lower(name) = lower('Demons')), 'Falcons', (select id from teams where lower(name) = lower('Falcons')), '[]'::jsonb, '[]'::jsonb, 78);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Ducks', (select id from teams where lower(name) = lower('Ducks')), 'United', (select id from teams where lower(name) = lower('United')), '[]'::jsonb, '[]'::jsonb, 79);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'YETIS', (select id from teams where lower(name) = lower('YETIS')), 'Kings', (select id from teams where lower(name) = lower('Kings')), '["Ice Dragons","Berserkers","Krakens"]'::jsonb, '[{"position":1,"team":"Ice Dragons","points":176,"wins":53,"draws":0,"losses":28,"goalsFor":318,"goalsAgainst":252},{"position":2,"team":"Berserkers","points":169,"wins":48,"draws":0,"losses":31,"goalsFor":355,"goalsAgainst":307},{"position":3,"team":"Krakens","points":167,"wins":49,"draws":0,"losses":33,"goalsFor":273,"goalsAgainst":250}]'::jsonb, 80);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Krakens', (select id from teams where lower(name) = lower('Krakens')), 'Ice Dragons', (select id from teams where lower(name) = lower('Ice Dragons')), '["The Lightnings","Titans","Boing"]'::jsonb, '[{"position":1,"team":"The Lightnings","points":183,"wins":52,"draws":0,"losses":26,"goalsFor":313,"goalsAgainst":251},{"position":2,"team":"Titans","points":180,"wins":53,"draws":0,"losses":25,"goalsFor":304,"goalsAgainst":238},{"position":3,"team":"Boing","points":172,"wins":53,"draws":0,"losses":32,"goalsFor":310,"goalsAgainst":261}]'::jsonb, 81);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Ducks', (select id from teams where lower(name) = lower('Ducks')), 'YETIS', (select id from teams where lower(name) = lower('YETIS')), '[]'::jsonb, '[]'::jsonb, 82);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Wolves', (select id from teams where lower(name) = lower('Wolves')), 'Kings', (select id from teams where lower(name) = lower('Kings')), '[]'::jsonb, '[]'::jsonb, 83);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'The Lightnings', (select id from teams where lower(name) = lower('The Lightnings')), 'Penguins', (select id from teams where lower(name) = lower('Penguins')), '[]'::jsonb, '[]'::jsonb, 84);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Kings', (select id from teams where lower(name) = lower('Kings')), 'YETIS', (select id from teams where lower(name) = lower('YETIS')), '[]'::jsonb, '[]'::jsonb, 85);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Ducks', (select id from teams where lower(name) = lower('Ducks')), 'Wyvers', (select id from teams where lower(name) = lower('Wyvers')), '[]'::jsonb, '[]'::jsonb, 86);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Cuervos', (select id from teams where lower(name) = lower('Cuervos')), 'Teletes', (select id from teams where lower(name) = lower('Teletes')), '[]'::jsonb, '[]'::jsonb, 87);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Teletes', (select id from teams where lower(name) = lower('Teletes')), 'Boing', (select id from teams where lower(name) = lower('Boing')), '[]'::jsonb, '[]'::jsonb, 88);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Falcons', (select id from teams where lower(name) = lower('Falcons')), 'Berserkers', (select id from teams where lower(name) = lower('Berserkers')), '["Axolotls","Whales","The Lightnings"]'::jsonb, '[{"position":1,"team":"Axolotls","points":156,"wins":45,"draws":0,"losses":20,"goalsFor":286,"goalsAgainst":219},{"position":2,"team":"Whales","points":147,"wins":38,"draws":0,"losses":21,"goalsFor":252,"goalsAgainst":218},{"position":3,"team":"The Lightnings","points":145,"wins":39,"draws":0,"losses":22,"goalsFor":270,"goalsAgainst":205}]'::jsonb, 89);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Kings', (select id from teams where lower(name) = lower('Kings')), 'Horizon', (select id from teams where lower(name) = lower('Horizon')), '[]'::jsonb, '[]'::jsonb, 90);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Vikings', (select id from teams where lower(name) = lower('Vikings')), 'Ice Breakers', (select id from teams where lower(name) = lower('Ice Breakers')), '["Ice Breakers","United","Cobras"]'::jsonb, '[{"position":1,"team":"Ice Breakers","points":165,"wins":50,"draws":0,"losses":22,"goalsFor":318,"goalsAgainst":223},{"position":2,"team":"United","points":147,"wins":39,"draws":0,"losses":23,"goalsFor":275,"goalsAgainst":229},{"position":3,"team":"Cobras","points":139,"wins":40,"draws":0,"losses":30,"goalsFor":274,"goalsAgainst":241}]'::jsonb, 91);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Falcons', (select id from teams where lower(name) = lower('Falcons')), 'Foxes', (select id from teams where lower(name) = lower('Foxes')), '["Penguins","Ducks","Falcons"]'::jsonb, '[{"position":1,"team":"Penguins","points":153,"wins":44,"draws":0,"losses":26,"goalsFor":262,"goalsAgainst":228},{"position":2,"team":"Ducks","points":147,"wins":41,"draws":0,"losses":25,"goalsFor":285,"goalsAgainst":223},{"position":3,"team":"Falcons","points":145,"wins":43,"draws":0,"losses":28,"goalsFor":297,"goalsAgainst":252}]'::jsonb, 92);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Falcons', (select id from teams where lower(name) = lower('Falcons')), 'Salamaders', (select id from teams where lower(name) = lower('Salamaders')), '["Penguins","Kings","Demons"]'::jsonb, '[{"position":1,"team":"Penguins","points":151,"wins":46,"draws":0,"losses":23,"goalsFor":262,"goalsAgainst":206},{"position":2,"team":"Kings","points":144,"wins":41,"draws":0,"losses":23,"goalsFor":258,"goalsAgainst":211},{"position":3,"team":"Demons","points":138,"wins":39,"draws":0,"losses":26,"goalsFor":281,"goalsAgainst":244}]'::jsonb, 93);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Raptors', (select id from teams where lower(name) = lower('Raptors')), 'Salamaders', (select id from teams where lower(name) = lower('Salamaders')), '["Kings","Falcons","Raptors"]'::jsonb, '[{"position":1,"team":"Kings","points":148,"wins":39,"draws":0,"losses":19,"goalsFor":255,"goalsAgainst":209},{"position":2,"team":"Falcons","points":145,"wins":41,"draws":0,"losses":24,"goalsFor":277,"goalsAgainst":208},{"position":3,"team":"Raptors","points":140,"wins":41,"draws":0,"losses":27,"goalsFor":261,"goalsAgainst":221}]'::jsonb, 94);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Vikings', (select id from teams where lower(name) = lower('Vikings')), 'Cuervos', (select id from teams where lower(name) = lower('Cuervos')), '["Titans","Falcons","IMALAYAS HC"]'::jsonb, '[{"position":1,"team":"Titans","points":141,"wins":40,"draws":0,"losses":26,"goalsFor":270,"goalsAgainst":218},{"position":2,"team":"Falcons","points":140,"wins":41,"draws":0,"losses":23,"goalsFor":273,"goalsAgainst":218},{"position":3,"team":"IMALAYAS HC","points":135,"wins":36,"draws":0,"losses":24,"goalsFor":265,"goalsAgainst":213}]'::jsonb, 95);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Aletico Metropolitano', (select id from teams where lower(name) = lower('Aletico Metropolitano')), 'Ice Breakers', (select id from teams where lower(name) = lower('Ice Breakers')), '["Aletico Metropolitano","Panthers","United"]'::jsonb, '[{"position":1,"team":"Aletico Metropolitano","points":144,"wins":44,"draws":0,"losses":25,"goalsFor":229,"goalsAgainst":195},{"position":2,"team":"Panthers","points":138,"wins":40,"draws":0,"losses":26,"goalsFor":230,"goalsAgainst":191},{"position":3,"team":"United","points":137,"wins":39,"draws":0,"losses":24,"goalsFor":215,"goalsAgainst":175}]'::jsonb, 96);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Ice Breakers', (select id from teams where lower(name) = lower('Ice Breakers')), 'Demons', (select id from teams where lower(name) = lower('Demons')), '[]'::jsonb, '[]'::jsonb, 97);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Horizon', (select id from teams where lower(name) = lower('Horizon')), 'Vikings', (select id from teams where lower(name) = lower('Vikings')), '["Kings","Falcons","Ice Breakers"]'::jsonb, '[{"position":1,"team":"Kings","points":149,"wins":41,"draws":0,"losses":17,"goalsFor":211,"goalsAgainst":182},{"position":2,"team":"Falcons","points":145,"wins":35,"draws":0,"losses":17,"goalsFor":217,"goalsAgainst":189},{"position":3,"team":"Ice Breakers","points":138,"wins":37,"draws":0,"losses":23,"goalsFor":207,"goalsAgainst":189}]'::jsonb, 98);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Kings', (select id from teams where lower(name) = lower('Kings')), 'Teletes', (select id from teams where lower(name) = lower('Teletes')), '[]'::jsonb, '[]'::jsonb, 99);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Penguins', (select id from teams where lower(name) = lower('Penguins')), 'Panthers', (select id from teams where lower(name) = lower('Panthers')), '["Kings","Falcons","Ducks"]'::jsonb, '[{"position":1,"team":"Kings","points":150,"wins":38,"draws":0,"losses":17,"goalsFor":213,"goalsAgainst":177},{"position":2,"team":"Falcons","points":145,"wins":36,"draws":0,"losses":18,"goalsFor":212,"goalsAgainst":188},{"position":3,"team":"Ducks","points":142,"wins":36,"draws":0,"losses":20,"goalsFor":212,"goalsAgainst":186}]'::jsonb, 100);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Penguins', (select id from teams where lower(name) = lower('Penguins')), 'The Lightnings', (select id from teams where lower(name) = lower('The Lightnings')), '[]'::jsonb, '[]'::jsonb, 101);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'The Lightnings', (select id from teams where lower(name) = lower('The Lightnings')), 'Dolphins', (select id from teams where lower(name) = lower('Dolphins')), '[]'::jsonb, '[]'::jsonb, 102);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'IMALAYAS HC', (select id from teams where lower(name) = lower('IMALAYAS HC')), 'Penguins', (select id from teams where lower(name) = lower('Penguins')), '[]'::jsonb, '[]'::jsonb, 103);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Titans', (select id from teams where lower(name) = lower('Titans')), 'Bears', (select id from teams where lower(name) = lower('Bears')), '["Kings","Ice Breakers","Ducks"]'::jsonb, '[{"position":1,"team":"Kings","points":149,"wins":39,"draws":0,"losses":17,"goalsFor":214,"goalsAgainst":183},{"position":2,"team":"Ice Breakers","points":145,"wins":33,"draws":0,"losses":16,"goalsFor":216,"goalsAgainst":192},{"position":3,"team":"Ducks","points":144,"wins":33,"draws":0,"losses":17,"goalsFor":211,"goalsAgainst":184}]'::jsonb, 104);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'IMALAYAS HC', (select id from teams where lower(name) = lower('IMALAYAS HC')), 'Teletes', (select id from teams where lower(name) = lower('Teletes')), '["Horizon","Vikings","Ducks"]'::jsonb, '[{"position":1,"team":"Horizon","points":145,"wins":36,"draws":0,"losses":16,"goalsFor":210,"goalsAgainst":191},{"position":2,"team":"Vikings","points":142,"wins":31,"draws":0,"losses":18,"goalsFor":206,"goalsAgainst":182},{"position":3,"team":"Ducks","points":140,"wins":37,"draws":0,"losses":19,"goalsFor":201,"goalsAgainst":181}]'::jsonb, 105);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Axolotls', (select id from teams where lower(name) = lower('Axolotls')), 'IMALAYAS HC', (select id from teams where lower(name) = lower('IMALAYAS HC')), '["Horizon","Falcons","Ice Breakers"]'::jsonb, '[{"position":1,"team":"Horizon","points":156,"wins":39,"draws":0,"losses":16,"goalsFor":215,"goalsAgainst":174},{"position":2,"team":"Falcons","points":149,"wins":39,"draws":0,"losses":19,"goalsFor":214,"goalsAgainst":183},{"position":3,"team":"Ice Breakers","points":140,"wins":36,"draws":0,"losses":21,"goalsFor":208,"goalsAgainst":184}]'::jsonb, 106);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'IMALAYAS HC', (select id from teams where lower(name) = lower('IMALAYAS HC')), 'Wolves', (select id from teams where lower(name) = lower('Wolves')), '[]'::jsonb, '[]'::jsonb, 107);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'AZTECZ', (select id from teams where lower(name) = lower('AZTECZ')), 'Angels', (select id from teams where lower(name) = lower('Angels')), '[]'::jsonb, '[]'::jsonb, 108);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'IMALAYAS HC', (select id from teams where lower(name) = lower('IMALAYAS HC')), 'Wolves', (select id from teams where lower(name) = lower('Wolves')), '[]'::jsonb, '[]'::jsonb, 109);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Teletes', (select id from teams where lower(name) = lower('Teletes')), 'IMALAYAS HC', (select id from teams where lower(name) = lower('IMALAYAS HC')), '[]'::jsonb, '[]'::jsonb, 110);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'RHINOS', (select id from teams where lower(name) = lower('RHINOS')), 'Teletes', (select id from teams where lower(name) = lower('Teletes')), '[]'::jsonb, '[]'::jsonb, 111);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Falcons', (select id from teams where lower(name) = lower('Falcons')), 'Ducks', (select id from teams where lower(name) = lower('Ducks')), '[]'::jsonb, '[]'::jsonb, 112);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'The Lightnings', (select id from teams where lower(name) = lower('The Lightnings')), 'Vikings', (select id from teams where lower(name) = lower('Vikings')), '[]'::jsonb, '[]'::jsonb, 113);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'The Lightnings', (select id from teams where lower(name) = lower('The Lightnings')), 'Horizon', (select id from teams where lower(name) = lower('Horizon')), '[]'::jsonb, '[]'::jsonb, 114);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Cuervos', (select id from teams where lower(name) = lower('Cuervos')), 'IMALAYAS HC', (select id from teams where lower(name) = lower('IMALAYAS HC')), '[]'::jsonb, '[]'::jsonb, 115);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'IMALAYAS HC', (select id from teams where lower(name) = lower('IMALAYAS HC')), 'Vikings', (select id from teams where lower(name) = lower('Vikings')), '[]'::jsonb, '[]'::jsonb, 116);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Angels', (select id from teams where lower(name) = lower('Angels')), 'Kings', (select id from teams where lower(name) = lower('Kings')), '[]'::jsonb, '[]'::jsonb, 117);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Teletes', (select id from teams where lower(name) = lower('Teletes')), 'Ducks', (select id from teams where lower(name) = lower('Ducks')), '[]'::jsonb, '[]'::jsonb, 118);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'The Lightnings', (select id from teams where lower(name) = lower('The Lightnings')), 'Vikings', (select id from teams where lower(name) = lower('Vikings')), '[]'::jsonb, '[]'::jsonb, 119);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'RHINOS', (select id from teams where lower(name) = lower('RHINOS')), 'Ducks', (select id from teams where lower(name) = lower('Ducks')), '[]'::jsonb, '[]'::jsonb, 120);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Wolves', (select id from teams where lower(name) = lower('Wolves')), 'IMALAYAS HC', (select id from teams where lower(name) = lower('IMALAYAS HC')), '[]'::jsonb, '[]'::jsonb, 121);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Kings', (select id from teams where lower(name) = lower('Kings')), 'Ducks', (select id from teams where lower(name) = lower('Ducks')), '[]'::jsonb, '[]'::jsonb, 122);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'The Lightnings', (select id from teams where lower(name) = lower('The Lightnings')), 'Falcons', (select id from teams where lower(name) = lower('Falcons')), '[]'::jsonb, '[]'::jsonb, 123);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Ice Dragons', (select id from teams where lower(name) = lower('Ice Dragons')), 'Kings', (select id from teams where lower(name) = lower('Kings')), '[]'::jsonb, '[]'::jsonb, 124);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Falcons', (select id from teams where lower(name) = lower('Falcons')), 'Ice Breakers', (select id from teams where lower(name) = lower('Ice Breakers')), '[]'::jsonb, '[]'::jsonb, 125);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Ducks', (select id from teams where lower(name) = lower('Ducks')), 'Ice Breakers', (select id from teams where lower(name) = lower('Ice Breakers')), '[]'::jsonb, '[]'::jsonb, 126);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Ice Dragons', (select id from teams where lower(name) = lower('Ice Dragons')), 'Kings', (select id from teams where lower(name) = lower('Kings')), '[]'::jsonb, '[]'::jsonb, 127);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Aletico Metropolitano', (select id from teams where lower(name) = lower('Aletico Metropolitano')), 'Ice Breakers', (select id from teams where lower(name) = lower('Ice Breakers')), '[]'::jsonb, '[]'::jsonb, 128);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Kings', (select id from teams where lower(name) = lower('Kings')), 'Wolves', (select id from teams where lower(name) = lower('Wolves')), '[]'::jsonb, '[]'::jsonb, 129);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Panthers', (select id from teams where lower(name) = lower('Panthers')), 'Kings', (select id from teams where lower(name) = lower('Kings')), '["Kings","Ice Dragons","Panthers"]'::jsonb, '[{"position":1,"team":"Kings","points":144,"wins":37,"draws":0,"losses":21,"goalsFor":214,"goalsAgainst":181},{"position":2,"team":"Ice Dragons","points":140,"wins":36,"draws":0,"losses":22,"goalsFor":212,"goalsAgainst":187},{"position":3,"team":"Panthers","points":139,"wins":38,"draws":0,"losses":23,"goalsFor":209,"goalsAgainst":190}]'::jsonb, 130);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Toros', (select id from teams where lower(name) = lower('Toros')), 'Berserkers', (select id from teams where lower(name) = lower('Berserkers')), '[]'::jsonb, '[]'::jsonb, 131);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Ice Dragons', (select id from teams where lower(name) = lower('Ice Dragons')), 'Kings', (select id from teams where lower(name) = lower('Kings')), '[]'::jsonb, '[]'::jsonb, 132);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Wolves', (select id from teams where lower(name) = lower('Wolves')), 'Titans', (select id from teams where lower(name) = lower('Titans')), '[]'::jsonb, '[]'::jsonb, 133);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Ice Dragons', (select id from teams where lower(name) = lower('Ice Dragons')), 'Axolotls', (select id from teams where lower(name) = lower('Axolotls')), '[]'::jsonb, '[]'::jsonb, 134);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2026', 'Ice Breakers', (select id from teams where lower(name) = lower('Ice Breakers')), 'Ice Dragons', (select id from teams where lower(name) = lower('Ice Dragons')), '[]'::jsonb, '[]'::jsonb, 135);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2028', 'Penguins', (select id from teams where lower(name) = lower('Penguins')), 'Berserkers', (select id from teams where lower(name) = lower('Berserkers')), '[]'::jsonb, '[]'::jsonb, 136);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2032', 'Cuervos', (select id from teams where lower(name) = lower('Cuervos')), 'Titans', (select id from teams where lower(name) = lower('Titans')), '[]'::jsonb, '[]'::jsonb, 137);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL', '2037', 'The Lightnings', (select id from teams where lower(name) = lower('The Lightnings')), 'Aletico Metropolitano', (select id from teams where lower(name) = lower('Aletico Metropolitano')), '[]'::jsonb, '[]'::jsonb, 138);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OHL3', '2030', 'Ice Dragons', (select id from teams where lower(name) = lower('Ice Dragons')), 'Ducks', (select id from teams where lower(name) = lower('Ducks')), '[]'::jsonb, '[]'::jsonb, 139);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OPEN', '2026', 'Horizon', (select id from teams where lower(name) = lower('Horizon')), 'Phantoms', (select id from teams where lower(name) = lower('Phantoms')), '[]'::jsonb, '[]'::jsonb, 140);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OPEN', '2026', 'Ducks', (select id from teams where lower(name) = lower('Ducks')), 'Falcons', (select id from teams where lower(name) = lower('Falcons')), '[]'::jsonb, '[]'::jsonb, 141);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OPEN', '2026', 'Raptors', (select id from teams where lower(name) = lower('Raptors')), 'Boing', (select id from teams where lower(name) = lower('Boing')), '["Ice Dragons","Ducks","Raptors"]'::jsonb, '[{"position":1,"team":"Ice Dragons","points":73,"wins":22,"draws":0,"losses":12,"goalsFor":123,"goalsAgainst":86},{"position":2,"team":"Ducks","points":72,"wins":21,"draws":0,"losses":11,"goalsFor":144,"goalsAgainst":106},{"position":3,"team":"Raptors","points":71,"wins":21,"draws":0,"losses":11,"goalsFor":134,"goalsAgainst":126}]'::jsonb, 142);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OPEN', '2026', 'Ice Dragons', (select id from teams where lower(name) = lower('Ice Dragons')), 'Ice Breakers', (select id from teams where lower(name) = lower('Ice Breakers')), '["Kings","Falcons","Penguins"]'::jsonb, '[{"position":1,"team":"Kings","points":67,"wins":21,"draws":0,"losses":10,"goalsFor":115,"goalsAgainst":97},{"position":2,"team":"Falcons","points":64,"wins":18,"draws":0,"losses":9,"goalsFor":104,"goalsAgainst":89},{"position":3,"team":"Penguins","points":57,"wins":16,"draws":0,"losses":11,"goalsFor":117,"goalsAgainst":102}]'::jsonb, 143);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OPEN', '2026', 'IMALAYAS HC', (select id from teams where lower(name) = lower('IMALAYAS HC')), 'Berserkers', (select id from teams where lower(name) = lower('Berserkers')), '["Teletes","Tigers","Panthers"]'::jsonb, '[{"position":1,"team":"Teletes","points":64,"wins":18,"draws":0,"losses":10,"goalsFor":120,"goalsAgainst":85},{"position":2,"team":"Tigers","points":60,"wins":16,"draws":0,"losses":10,"goalsFor":109,"goalsAgainst":89},{"position":3,"team":"Panthers","points":60,"wins":17,"draws":0,"losses":11,"goalsFor":114,"goalsAgainst":96}]'::jsonb, 144);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OPEN', '2026', 'Falcons', (select id from teams where lower(name) = lower('Falcons')), 'HEX Clankers', (select id from teams where lower(name) = lower('HEX Clankers')), '["Falcons","Penguins","Ducks"]'::jsonb, '[{"position":1,"team":"Falcons","points":53,"wins":16,"draws":0,"losses":11,"goalsFor":89,"goalsAgainst":82},{"position":2,"team":"Penguins","points":52,"wins":15,"draws":0,"losses":11,"goalsFor":88,"goalsAgainst":78},{"position":3,"team":"Ducks","points":51,"wins":16,"draws":0,"losses":12,"goalsFor":104,"goalsAgainst":86}]'::jsonb, 145);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OPEN', '2026', 'Panthers', (select id from teams where lower(name) = lower('Panthers')), 'Ice Breakers', (select id from teams where lower(name) = lower('Ice Breakers')), '[]'::jsonb, '[]'::jsonb, 146);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OPEN', '2026', 'Axolotls', (select id from teams where lower(name) = lower('Axolotls')), 'Vikings', (select id from teams where lower(name) = lower('Vikings')), '["Whales","Kings","Ducks"]'::jsonb, '[{"position":1,"team":"Whales","points":58,"wins":15,"draws":0,"losses":8,"goalsFor":69,"goalsAgainst":57},{"position":2,"team":"Kings","points":52,"wins":12,"draws":0,"losses":8,"goalsFor":90,"goalsAgainst":69},{"position":3,"team":"Ducks","points":52,"wins":15,"draws":0,"losses":10,"goalsFor":84,"goalsAgainst":70}]'::jsonb, 147);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OPEN', '2026', 'IMALAYAS HC', (select id from teams where lower(name) = lower('IMALAYAS HC')), 'The Lightnings', (select id from teams where lower(name) = lower('The Lightnings')), '["Ice Breakers","Kings","Horizon"]'::jsonb, '[{"position":1,"team":"Ice Breakers","points":40,"wins":10,"draws":0,"losses":6,"goalsFor":59,"goalsAgainst":52},{"position":2,"team":"Kings","points":37,"wins":9,"draws":0,"losses":7,"goalsFor":57,"goalsAgainst":52},{"position":3,"team":"Horizon","points":37,"wins":9,"draws":0,"losses":7,"goalsFor":56,"goalsAgainst":51}]'::jsonb, 148);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OPEN', '2026', 'Kings', (select id from teams where lower(name) = lower('Kings')), 'Ice Breakers', (select id from teams where lower(name) = lower('Ice Breakers')), '[]'::jsonb, '[]'::jsonb, 149);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OPEN', '2026', 'Penguins', (select id from teams where lower(name) = lower('Penguins')), 'Ducks', (select id from teams where lower(name) = lower('Ducks')), '[]'::jsonb, '[]'::jsonb, 150);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OPEN', '2026', 'Kings', (select id from teams where lower(name) = lower('Kings')), 'Falcons', (select id from teams where lower(name) = lower('Falcons')), '[]'::jsonb, '[]'::jsonb, 151);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OPEN', '2026', 'Bears', (select id from teams where lower(name) = lower('Bears')), 'Kings', (select id from teams where lower(name) = lower('Kings')), '[]'::jsonb, '[]'::jsonb, 152);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OPEN', '2026', 'Kings', (select id from teams where lower(name) = lower('Kings')), 'Raptors', (select id from teams where lower(name) = lower('Raptors')), '[]'::jsonb, '[]'::jsonb, 153);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('OPEN', '2026', 'Ice Dragons', (select id from teams where lower(name) = lower('Ice Dragons')), 'Penguins', (select id from teams where lower(name) = lower('Penguins')), '[]'::jsonb, '[]'::jsonb, 154);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('PLay offs 2026', '2026', 'The Lightnings', (select id from teams where lower(name) = lower('The Lightnings')), 'Ducks', (select id from teams where lower(name) = lower('Ducks')), '[]'::jsonb, '[]'::jsonb, 155);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('Primera Division', '2026', 'Ducks', (select id from teams where lower(name) = lower('Ducks')), 'Cuervos', (select id from teams where lower(name) = lower('Cuervos')), '[]'::jsonb, '[]'::jsonb, 156);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('Short Primier', '2029', 'Ice Dragons', (select id from teams where lower(name) = lower('Ice Dragons')), 'Ice Breakers', (select id from teams where lower(name) = lower('Ice Breakers')), '[]'::jsonb, '[]'::jsonb, 157);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('Super ALL STARS', '2026', 'AZTECZ', (select id from teams where lower(name) = lower('AZTECZ')), 'Bears', (select id from teams where lower(name) = lower('Bears')), '["Ice Dragons","Kings","Horizon"]'::jsonb, '[{"position":1,"team":"Ice Dragons","points":193,"wins":57,"draws":0,"losses":36,"goalsFor":395,"goalsAgainst":336},{"position":2,"team":"Kings","points":193,"wins":55,"draws":0,"losses":35,"goalsFor":353,"goalsAgainst":314},{"position":3,"team":"Horizon","points":188,"wins":54,"draws":0,"losses":38,"goalsFor":363,"goalsAgainst":316}]'::jsonb, 158);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('TECATE RED', '2026', 'Demons', (select id from teams where lower(name) = lower('Demons')), 'Foxes', (select id from teams where lower(name) = lower('Foxes')), '[]'::jsonb, '[]'::jsonb, 159);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('TECATE RED', '2026', 'Ice Breakers', (select id from teams where lower(name) = lower('Ice Breakers')), 'Berserkers', (select id from teams where lower(name) = lower('Berserkers')), '[]'::jsonb, '[]'::jsonb, 160);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('TECATE RED', '2026', 'Salmons', (select id from teams where lower(name) = lower('Salmons')), 'Ice Breakers', (select id from teams where lower(name) = lower('Ice Breakers')), '[]'::jsonb, '[]'::jsonb, 161);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('TECATE RED', '2031', 'Kings', (select id from teams where lower(name) = lower('Kings')), 'Salamaders', (select id from teams where lower(name) = lower('Salamaders')), '[]'::jsonb, '[]'::jsonb, 162);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('THEBIG10', '2026', 'Teletes', (select id from teams where lower(name) = lower('Teletes')), 'Ducks', (select id from teams where lower(name) = lower('Ducks')), '[]'::jsonb, '[]'::jsonb, 163);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('TOPS', '2026', 'Aletico Metropolitano', (select id from teams where lower(name) = lower('Aletico Metropolitano')), 'The Lightnings', (select id from teams where lower(name) = lower('The Lightnings')), '[]'::jsonb, '[]'::jsonb, 164);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('TOPS', '2026', 'Ducks', (select id from teams where lower(name) = lower('Ducks')), 'The Lightnings', (select id from teams where lower(name) = lower('The Lightnings')), '[]'::jsonb, '[]'::jsonb, 165);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('TOPS', '2026', 'Horizon', (select id from teams where lower(name) = lower('Horizon')), 'Raptors', (select id from teams where lower(name) = lower('Raptors')), '[]'::jsonb, '[]'::jsonb, 166);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('TOPS', '2026', 'Ducks', (select id from teams where lower(name) = lower('Ducks')), 'Ice Breakers', (select id from teams where lower(name) = lower('Ice Breakers')), '[]'::jsonb, '[]'::jsonb, 167);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('TOPS', '2026', 'Ice Breakers', (select id from teams where lower(name) = lower('Ice Breakers')), 'Kings', (select id from teams where lower(name) = lower('Kings')), '[]'::jsonb, '[]'::jsonb, 168);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('TOPS', '2026', 'Kings', (select id from teams where lower(name) = lower('Kings')), 'The Lightnings', (select id from teams where lower(name) = lower('The Lightnings')), '["Horizon","The Lightnings","Ice Dragons"]'::jsonb, '[{"position":1,"team":"Horizon","points":109,"wins":31,"draws":0,"losses":20,"goalsFor":203,"goalsAgainst":168},{"position":2,"team":"The Lightnings","points":103,"wins":33,"draws":0,"losses":25,"goalsFor":189,"goalsAgainst":170},{"position":3,"team":"Ice Dragons","points":101,"wins":31,"draws":0,"losses":22,"goalsFor":193,"goalsAgainst":195}]'::jsonb, 169);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('Torneo CENTENARIO', '2026', 'Kings', (select id from teams where lower(name) = lower('Kings')), 'Penguins', (select id from teams where lower(name) = lower('Penguins')), '[]'::jsonb, '[]'::jsonb, 170);
insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values ('Torneo Tecate', '2026', 'Foxes', (select id from teams where lower(name) = lower('Foxes')), 'Falcons', (select id from teams where lower(name) = lower('Falcons')), '[]'::jsonb, '[]'::jsonb, 171);
commit;
