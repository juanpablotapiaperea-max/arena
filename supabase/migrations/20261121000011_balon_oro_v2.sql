-- Balón de Oro v2: cuenta la importancia del jugador en su equipo, los títulos
-- y llegar a semifinales; Segunda División no cuenta. El puntaje solo lo ve el
-- administrador: los espectadores ven a los nominados con sus números y logros.

drop function if exists public.balon_oro_race(uuid, int);

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
  ), team_tot as (
    -- Producción total de cada equipo en esas competiciones (para medir qué tan clave es el jugador).
    select team_id, edition_id, greatest(1, sum(goals + assists)) ga
    from player_edition_stats where edition_id in (select id from eds) group by team_id, edition_id
  ), per as (
    -- Portero titular: tan clave como un atacante que aporta ~10% de la producción.
    select st.*, greatest((st.goals + st.assists)::numeric / tt.ga, 0.10 * coalesce(st.goalie_gp::numeric / nullif(st.gp, 0), 0)) share
    from st join team_tot tt on tt.team_id = st.team_id and tt.edition_id = st.edition_id
  ), agg as (
    select player_id,
           (array_agg(team_id order by goals + assists + mvps desc))[1] team_id,
           sum(
             w * (goals + 0.75 * assists + 2 * mvps + gwg + 2 * hat_tricks + 3 * shutouts + 0.025 * saves)
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

/** Con puntaje: solo el administrador (o el servidor). */
create or replace function public.balon_oro_race(p_season uuid default null, p_limit int default 10)
returns table (
  player_id uuid, team_id uuid, score numeric, goals bigint, assists bigint, mvps bigint, gp bigint,
  shutouts bigint, save_pct numeric, team_share numeric, titles text[], finals text[], semis text[], awards text[]
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role') then
    raise exception 'Solo el administrador ve los puntajes';
  end if;
  return query select * from public._balon_oro_core(p_season, p_limit);
end $$;
revoke all on function public.balon_oro_race(uuid, int) from public, anon;
grant execute on function public.balon_oro_race(uuid, int) to authenticated, service_role;

/** Para todos: los nominados con sus números y logros, sin puntaje y en orden alfabético. */
create or replace function public.balon_oro_nominees(p_season uuid default null)
returns table (
  player_id uuid, team_id uuid, goals bigint, assists bigint, mvps bigint, gp bigint,
  shutouts bigint, save_pct numeric, team_share numeric, titles text[], finals text[], semis text[], awards text[]
)
language sql stable security definer set search_path = public as $$
  select c.player_id, c.team_id, c.goals, c.assists, c.mvps, c.gp, c.shutouts, c.save_pct, c.team_share, c.titles, c.finals, c.semis, c.awards
  from public._balon_oro_core(p_season, 10) c
  join players p on p.id = c.player_id
  order by p.last_name, p.first_name;
$$;
revoke all on function public.balon_oro_nominees(uuid) from public, anon;
grant execute on function public.balon_oro_nominees(uuid) to authenticated;
