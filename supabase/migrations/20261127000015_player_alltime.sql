-- Top histórico de jugadores: todo lo que han hecho en ARENA (todas las
-- temporadas y competiciones), con sus títulos y premios individuales.
create or replace function public.player_alltime()
returns table (
  player_id uuid, first_name text, last_name text, pos text, age int, retired boolean,
  team_id uuid, main_team_id uuid, seasons bigint,
  gp bigint, goals bigint, assists bigint, mvps bigint, hat_tricks bigint, gwg bigint,
  goalie_gp bigint, saves bigint, goals_against bigint, shutouts bigint, goalie_wins bigint,
  titles text[], awards text[]
)
language sql stable security definer set search_path = public as $$
  with s as (
    select pes.*, e.season_id, e.name ename, e.status estatus, e.champion_team_id
    from player_edition_stats pes join editions e on e.id = pes.edition_id
  ), agg as (
    select player_id,
           (array_agg(team_id order by gp desc))[1] main_team_id,
           count(distinct season_id) seasons,
           sum(gp) gp, sum(goals) goals, sum(assists) assists, sum(mvps) mvps, sum(hat_tricks) hat_tricks, sum(gwg) gwg,
           sum(goalie_gp) goalie_gp, sum(saves) saves, sum(goals_against) goals_against, sum(shutouts) shutouts, sum(wins) goalie_wins,
           array_remove(array_agg(case when estatus = 'finished' and team_id = champion_team_id then ename end order by ename), null) titles
    from s group by player_id
  )
  select a.player_id, p.first_name, p.last_name, p.position::text, p.age, p.retired,
         p.team_id, a.main_team_id, a.seasons,
         a.gp, a.goals, a.assists, a.mvps, a.hat_tricks, a.gwg,
         a.goalie_gp, a.saves, a.goals_against, a.shutouts, a.goalie_wins,
         a.titles,
         coalesce((select array_agg(aw.label order by aw.created_at) from awards aw where aw.player_id = a.player_id), '{}')
  from agg a join players p on p.id = a.player_id
  where a.gp > 0;
$$;
revoke all on function public.player_alltime() from public, anon;
grant execute on function public.player_alltime() to authenticated;
