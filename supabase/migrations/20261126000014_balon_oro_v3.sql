-- Balón de Oro v3: la parte de la producción del equipo se mide contra sus goles
-- reales del marcador. Con muchas lesiones, el simulador completaba la alineación
-- con suplentes de relleno cuyos goles no quedan a nombre de nadie; eso inflaba
-- la importancia de los pocos jugadores que sí sumaban. Las atajadas pesan 0.015
-- (con tantos tiros por partido, los porteros se llenaban de puntos solo por volumen).

create or replace function public._balon_oro_core(p_season uuid default null, p_limit int default 10)
returns table (
  player_id uuid, team_id uuid, score numeric, goals bigint, assists bigint, mvps bigint, gp bigint,
  shutouts bigint, save_pct numeric, team_share numeric, titles text[], finals text[], semis text[], awards text[]
)
language sql stable security definer set search_path = public as $$
  with s as (
    select coalesce(p_season, (select id from seasons where status = 'active' order by number desc limit 1)) id
  ), eds as (
    -- Segunda División no cuenta para el Balón de Oro.
    select e.id, coalesce((e.config ->> 'weight')::numeric, 1) w, split_part(e.name, ' · ', 1) comp,
           e.champion_team_id, e.runner_up_team_id
    from editions e
    where e.season_id = (select id from s) and coalesce(e.config ->> 'competitionKey', '') <> 'segunda'
  ), semis as (
    -- Equipos que llegaron a semifinales (o a la final) de cada competición.
    select distinct m.edition_id, t team_id
    from matches m, lateral (values (m.home_team_id), (m.away_team_id)) v(t)
    where m.edition_id in (select id from eds) and m.stage = 'playoff' and m.round in ('semifinal', 'final')
  ), st as (
    select pes.*, eds.w, eds.comp, eds.champion_team_id, eds.runner_up_team_id,
           exists (select 1 from semis x where x.edition_id = pes.edition_id and x.team_id = pes.team_id) in_semis
    from player_edition_stats pes join eds on eds.id = pes.edition_id
  ), team_goals as (
    -- Goles reales del equipo en el marcador (incluye los de suplentes de relleno,
    -- que no quedan a nombre de ningún jugador).
    select edition_id, team_id, sum(gf) gf from (
      select edition_id, home_team_id team_id, home_score gf from matches where edition_id in (select id from eds) and status = 'finished'
      union all
      select edition_id, away_team_id, away_score from matches where edition_id in (select id from eds) and status = 'finished'
    ) x group by edition_id, team_id
  ), team_tot as (
    -- Producción total de cada equipo (para medir qué tan clave es el jugador). Si
    -- parte de sus goles fueron de suplentes de relleno, se cuenta la producción
    -- completa: así nadie parece más clave solo porque a sus compañeros les faltaban partidos.
    select p.team_id, p.edition_id,
           -- +10: en torneos de pocos partidos un gol no vuelve "clave" a nadie.
           10 + sum(p.goals + p.assists) * greatest(1, coalesce(max(tg.gf), 0)::numeric / greatest(1, sum(p.goals))) ga
    from player_edition_stats p
    left join team_goals tg on tg.edition_id = p.edition_id and tg.team_id = p.team_id
    where p.edition_id in (select id from eds) group by p.team_id, p.edition_id
  ), per as (
    -- Portero titular: tan clave como un atacante que aporta ~10% de la producción.
    select st.*, greatest((st.goals + st.assists)::numeric / tt.ga, 0.10 * coalesce(st.goalie_gp::numeric / nullif(st.gp, 0), 0)) share
    from st join team_tot tt on tt.team_id = st.team_id and tt.edition_id = st.edition_id
  ), agg as (
    select player_id,
           (array_agg(team_id order by goals + assists + mvps desc))[1] team_id,
           sum(
             w * (goals + 0.75 * assists + 2 * mvps + gwg + 2 * hat_tricks + 3 * shutouts + 0.015 * saves)
             -- Jugador clave: su parte de la producción de su equipo.
             + w * 120 * share
             -- Logros del equipo.
             + case when team_id = champion_team_id then 30 * w
                    when team_id = runner_up_team_id then 18 * w
                    when in_semis then 10 * w else 0 end
           ) score,
           sum(goals) goals, sum(assists) assists, sum(mvps) mvps, sum(gp) gp, sum(shutouts) shutouts,
           round(sum(saves)::numeric / nullif(sum(saves + goals_against), 0), 3) save_pct,
           round(max(share), 3) team_share,
           array_remove(array_agg(distinct case when team_id = champion_team_id then comp end), null) titles,
           array_remove(array_agg(distinct case when team_id = runner_up_team_id then comp end), null) finals,
           array_remove(array_agg(distinct case when in_semis and team_id <> coalesce(champion_team_id, team_id) and team_id <> coalesce(runner_up_team_id, team_id) then comp end), null) semis
    from per group by player_id
  )
  select a.player_id, a.team_id, round(a.score, 1), a.goals, a.assists, a.mvps, a.gp, a.shutouts, a.save_pct, a.team_share,
         a.titles, a.finals, a.semis,
         coalesce((select array_agg(aw.label order by aw.created_at) from awards aw where aw.player_id = a.player_id and aw.season_id = (select id from s) and aw.kind <> 'balon_oro'), '{}')
  from agg a join players p on p.id = a.player_id and not p.retired
  order by a.score desc
  limit greatest(1, least(p_limit, 50));
$$;
revoke all on function public._balon_oro_core(uuid, int) from public, anon, authenticated;
