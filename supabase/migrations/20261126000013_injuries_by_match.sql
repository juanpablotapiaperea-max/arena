-- Las lesiones se curan por partidos jugados por su equipo (antes, por días de
-- competencia: con decenas de partidos al día se acumulaban y los equipos salían
-- con 8 jugadores). Se curan las lesiones que ya habrían sanado con esta regla.

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

    -- Lesiones: cuentan partidos, no días. Cada partido de su equipo, los
    -- lesionados se acercan a volver; luego se registran las lesiones nuevas.
    update players set injury_days = injury_days - 1
      where team_id in (hid, aid) and injury_days > 0;
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

-- Cada equipo jugó decenas de partidos desde que empezó la jornada: con la
-- regla nueva (1 a 10 partidos de baja) todas estas lesiones ya habrían sanado.
update players set injury_days = 0 where injury_days > 0;
select public.recompute_all_ratings();
