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
  update teams set play_style_locked = true;
  perform set_config('arena.skip_ratings', 'off', true);
  perform public.recompute_all_ratings();
end $$;
revoke all on function public.begin_competition_day() from public, anon, authenticated;

create or replace function public.end_competition_day() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('arena.skip_log', 'on', true);
  update teams set play_style_locked = false;
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
