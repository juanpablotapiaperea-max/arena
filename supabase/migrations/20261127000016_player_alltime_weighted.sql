-- Top histórico ponderado: no es lo mismo destacar en Segunda que en Primera.
-- Cada competición cuenta según su peso (Primera = 1; Segunda 0.25, COPA 0.75,
-- OHL y ALL STARS 1, CHAMPIONS 1.25). Se agrega el desglose por competición.
drop function if exists public.player_alltime();
create or replace function public.player_alltime()
returns table (
  player_id uuid, first_name text, last_name text, pos text, age int, retired boolean,
  team_id uuid, main_team_id uuid, seasons bigint,
  gp bigint, goals bigint, assists bigint, mvps bigint, hat_tricks bigint, gwg bigint,
  goalie_gp bigint, saves bigint, goals_against bigint, shutouts bigint, goalie_wins bigint,
  titles text[], awards text[],
  value numeric, goalie_value numeric, by_comp jsonb
)
language sql stable security definer set search_path = public as $$
  with s as (
    select pes.*, e.season_id, e.name ename, e.status estatus, e.champion_team_id,
           split_part(e.name, ' · ', 1) comp,
           coalesce((e.config ->> 'weight')::numeric, 1) / 2 f
    from player_edition_stats pes join editions e on e.id = pes.edition_id
  ), per_comp as (
    select player_id, comp, max(f) f, sum(gp) gp, sum(goals) g, sum(assists) a, sum(goalie_gp) ggp, sum(wins) w, sum(shutouts) so
    from s group by player_id, comp
  ), agg as (
    select player_id,
           (array_agg(team_id order by gp desc))[1] main_team_id,
           count(distinct season_id) seasons,
           sum(gp) gp, sum(goals) goals, sum(assists) assists, sum(mvps) mvps, sum(hat_tricks) hat_tricks, sum(gwg) gwg,
           sum(goalie_gp) goalie_gp, sum(saves) saves, sum(goals_against) goals_against, sum(shutouts) shutouts, sum(wins) goalie_wins,
           array_remove(array_agg(case when estatus = 'finished' and team_id = champion_team_id then ename end order by ename), null) titles,
           -- Valor: goles + asistencias + 2 por MVP de partido, todo por el peso de la competición;
           -- un título suma 15 × peso.
           round(sum(f * (goals + assists + 2 * mvps) + case when estatus = 'finished' and team_id = champion_team_id then 15 * f else 0 end), 1) value,
           round(sum(f * (wins + 3 * shutouts + 2 * mvps) + case when estatus = 'finished' and team_id = champion_team_id then 15 * f else 0 end), 1) goalie_value
    from s group by player_id
  )
  select a.player_id, p.first_name, p.last_name, p.position::text, p.age, p.retired,
         p.team_id, a.main_team_id, a.seasons,
         a.gp, a.goals, a.assists, a.mvps, a.hat_tricks, a.gwg,
         a.goalie_gp, a.saves, a.goals_against, a.shutouts, a.goalie_wins,
         a.titles,
         coalesce((select array_agg(aw.label order by aw.created_at) from awards aw where aw.player_id = a.player_id), '{}'),
         a.value, a.goalie_value,
         (select jsonb_agg(jsonb_build_object('comp', c.comp, 'f', c.f, 'gp', c.gp, 'g', c.g, 'a', c.a, 'ggp', c.ggp, 'w', c.w, 'so', c.so) order by c.f desc, c.gp desc)
            from per_comp c where c.player_id = a.player_id)
  from agg a join players p on p.id = a.player_id
  where a.gp > 0;
$$;
revoke all on function public.player_alltime() from public, anon;
grant execute on function public.player_alltime() to authenticated;
