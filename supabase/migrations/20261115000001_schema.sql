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
