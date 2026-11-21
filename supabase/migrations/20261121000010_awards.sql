-- Premios individuales y Balón de Oro.

create table if not exists awards (
  id uuid primary key default gen_random_uuid(),
  season_id uuid references seasons(id) on delete cascade,
  edition_id uuid references editions(id) on delete cascade,
  kind text not null check (kind in ('top_scorer', 'top_assists', 'mvp', 'best_goalie', 'balon_oro')),
  player_id uuid references players(id) on delete set null,
  team_id uuid references teams(id) on delete set null,
  value numeric,
  label text not null,
  created_at timestamptz not null default now(),
  unique (edition_id, kind)
);
-- Un solo Balón de Oro por temporada.
create unique index if not exists awards_balon_oro_season on awards(season_id) where kind = 'balon_oro';
create index if not exists awards_team_idx on awards(team_id);
create index if not exists awards_player_idx on awards(player_id);

alter table awards enable row level security;
drop policy if exists awards_read on awards;
create policy awards_read on awards for select to authenticated using (true);
drop policy if exists admin_all on awards;
create policy admin_all on awards for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on awards from anon;
grant select on awards to authenticated;

-- Bitácora del administrador también para los premios (permite deshacer).
drop trigger if exists admin_log_awards on awards;
create trigger admin_log_awards after insert or update or delete on awards for each row execute function public.log_admin_change('id');

/**
 * Premios de una competición terminada: goleador, asistidor, MVP del torneo
 * (más MVP de partido; desempata goles + asistencias) y mejor portero (más
 * porterías en cero, luego mejor porcentaje de atajadas, mínimo 25% de los partidos).
 */
create or replace function public.grant_edition_awards(p_edition uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  e editions;
  comp text;
  max_gp int;
  n int := 0;
begin
  select * into e from editions where id = p_edition;
  if not found or e.status <> 'finished' then return 0; end if;
  comp := split_part(e.name, ' · ', 1);
  select coalesce(max(gp), 1) into max_gp from player_edition_stats where edition_id = p_edition;

  insert into awards (season_id, edition_id, kind, player_id, team_id, value, label)
  select e.season_id, p_edition, 'top_scorer', player_id, team_id, goals, 'Goleador · ' || comp
  from player_edition_stats where edition_id = p_edition and goals > 0
  order by goals desc, assists desc, gp asc limit 1
  on conflict (edition_id, kind) do nothing;
  get diagnostics n = row_count;

  insert into awards (season_id, edition_id, kind, player_id, team_id, value, label)
  select e.season_id, p_edition, 'top_assists', player_id, team_id, assists, 'Asistidor · ' || comp
  from player_edition_stats where edition_id = p_edition and assists > 0
  order by assists desc, goals desc, gp asc limit 1
  on conflict (edition_id, kind) do nothing;

  insert into awards (season_id, edition_id, kind, player_id, team_id, value, label)
  select e.season_id, p_edition, 'mvp', player_id, team_id, mvps, 'MVP del torneo · ' || comp
  from player_edition_stats where edition_id = p_edition and mvps > 0
  order by mvps desc, (goals + assists) desc, plus_minus desc limit 1
  on conflict (edition_id, kind) do nothing;

  insert into awards (season_id, edition_id, kind, player_id, team_id, value, label)
  select e.season_id, p_edition, 'best_goalie', player_id, team_id,
         round(saves::numeric / nullif(saves + goals_against, 0), 3), 'Mejor portero · ' || comp
  from player_edition_stats
  where edition_id = p_edition and goalie_gp >= greatest(1, ceil(max_gp * 0.25)) and (saves + goals_against) > 0
  order by shutouts desc, saves::numeric / nullif(saves + goals_against, 0) desc nulls last limit 1
  on conflict (edition_id, kind) do nothing;

  return n;
end $$;
revoke all on function public.grant_edition_awards(uuid) from public, anon, authenticated;

/**
 * Carrera al Balón de Oro: puntaje de cada jugador en toda la temporada.
 * Goles 1, asistencias 0.75, MVP de partido 2, gol del triunfo 1, hat-trick 2;
 * porteros: portería en cero 3, atajadas 0.025; todo por el peso del torneo.
 * Más bonos por títulos de su equipo (campeón 12, subcampeón 6, × peso).
 */
create or replace function public.balon_oro_race(p_season uuid default null, p_limit int default 10)
returns table (player_id uuid, team_id uuid, score numeric, goals bigint, assists bigint, mvps bigint, titles bigint, shutouts bigint)
language sql stable security definer set search_path = public as $$
  with s as (
    select coalesce(p_season, (select id from seasons where status = 'active' order by number desc limit 1)) id
  ), st as (
    select pes.player_id, pes.team_id, e.id edition_id, coalesce((e.config ->> 'weight')::numeric, 1) w,
           pes.goals, pes.assists, pes.mvps, pes.gwg, pes.hat_tricks, pes.shutouts, pes.saves,
           e.champion_team_id, e.runner_up_team_id
    from player_edition_stats pes join editions e on e.id = pes.edition_id
    where e.season_id = (select id from s)
  ), agg as (
    select player_id,
           (array_agg(team_id order by goals + assists desc))[1] team_id,
           sum(w * (goals + 0.75 * assists + 2 * mvps + gwg + 2 * hat_tricks + 3 * shutouts + 0.025 * saves)
               + case when team_id = champion_team_id then 12 * w when team_id = runner_up_team_id then 6 * w else 0 end) score,
           sum(goals) goals, sum(assists) assists, sum(mvps) mvps,
           count(*) filter (where team_id = champion_team_id) titles, sum(shutouts) shutouts
    from st group by player_id
  )
  select a.player_id, a.team_id, round(a.score, 1), a.goals, a.assists, a.mvps, a.titles, a.shutouts
  from agg a join players p on p.id = a.player_id
  order by a.score desc limit greatest(1, least(p_limit, 50));
$$;
revoke all on function public.balon_oro_race(uuid, int) from public, anon;
grant execute on function public.balon_oro_race(uuid, int) to authenticated;

/** Récords históricos de un club: goles y asistencias de sus jugadores con su camiseta. */
create or replace function public.team_records(p_team uuid)
returns table (player_id uuid, goals bigint, assists bigint, mvps bigint, gp bigint)
language sql stable security definer set search_path = public as $$
  select player_id, sum(goals), sum(assists), sum(mvps), sum(gp)
  from player_edition_stats where team_id = p_team
  group by player_id
  order by sum(goals) desc;
$$;
revoke all on function public.team_records(uuid) from public, anon;
grant execute on function public.team_records(uuid) to authenticated;

-- Premios de las competiciones que ya terminaron.
select public.grant_edition_awards(id) from editions where status = 'finished';

do $$ begin
  alter publication supabase_realtime add table awards;
exception when others then null;
end $$;
