-- Ritmo nuevo: partidos de 5 minutos (3 periodos de 100 s), ráfagas cada
-- 2 minutos, vivos seguidos y la temporada completa en una semana.

-- La reproducción en vivo necesita saber cuánto dura cada periodo del partido.
create or replace function public.live_timeline(p_match uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  m matches;
  t match_timelines;
  elapsed numeric;
  period numeric;
begin
  if auth.uid() is null then raise exception 'Sin sesión'; end if;
  select * into m from matches where id = p_match;
  if not found or not m.is_main_event then return null; end if;
  select * into t from match_timelines where match_id = p_match;
  if not found or m.started_at is null then
    return jsonb_build_object('status', m.status, 'server_now', now(), 'events', '[]'::jsonb);
  end if;
  elapsed := extract(epoch from (now() - m.started_at));
  select round((e ->> 'second')::numeric) into period
    from jsonb_array_elements(t.events) e
    where e ->> 'type' = 'period_end' and (e ->> 'period')::int = 1
    limit 1;
  return jsonb_build_object(
    'status', m.status,
    'server_now', now(),
    'started_at', m.started_at,
    'elapsed', elapsed,
    'duration', t.duration_seconds,
    'period_seconds', coalesce(period, 300),
    'events', coalesce((
      select jsonb_agg(e order by (e ->> 'second')::numeric)
      from jsonb_array_elements(t.events) e
      where (e ->> 'second')::numeric <= elapsed or m.status = 'finished'
    ), '[]'::jsonb)
  );
end $$;
revoke all on function public.live_timeline(uuid) from public, anon;
grant execute on function public.live_timeline(uuid) to authenticated;

-- Partidos de 5 minutos.
update settings set value = value || '{"periodSeconds": 100, "overtimeSeconds": 40}'::jsonb, updated_at = now()
where key = 'engine';

-- Calendario comprimido: ráfagas cada 2 min, vivos de 6 min (5 de juego + 1 de
-- pausa), más vivos por día y hasta 800 partidos diarios.
update settings set value = value || '{
  "burstEveryMinutes": 2,
  "liveEventMinutes": 6,
  "maxLiveEventsPerDay": 40,
  "maxEventsPerDay": 40,
  "minLiveEventsPerDay": 8,
  "maxMatchesPerDay": 800
}'::jsonb, updated_at = now()
where key = 'calendar';

-- Más vivos y ráfagas más grandes: el día dura ~3.5 h con un vivo casi siempre en curso.
update settings set value = value || '{"minLiveEventsPerDay": 30, "burstMin": 5, "burstMax": 8, "autoStart": true}'::jsonb, updated_at = now()
where key = 'calendar';
