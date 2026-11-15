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
