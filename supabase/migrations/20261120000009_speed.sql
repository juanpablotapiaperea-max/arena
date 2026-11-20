-- Ritmo rápido: el motor despierta cada 15 s, con un candado para que dos
-- ejecuciones nunca procesen lo mismo, y horarios de partidos en lote.

insert into private_config (key, value) values ('tick_lease', '2000-01-01T00:00:00Z')
on conflict (key) do nothing;

/** Toma el turno del motor por `p_seconds`; false si otra ejecución lo tiene. */
create or replace function public.acquire_tick_lease(p_seconds int default 55) returns boolean
language plpgsql security definer set search_path = public as $$
declare got int;
begin
  update private_config set value = (now() + make_interval(secs => p_seconds))::text
  where key = 'tick_lease' and value::timestamptz < now();
  get diagnostics got = row_count;
  return got > 0;
end $$;

create or replace function public.release_tick_lease() returns void
language sql security definer set search_path = public as $$
  update private_config set value = '2000-01-01T00:00:00Z' where key = 'tick_lease';
$$;

/** Fija la hora programada de muchos partidos en una sola llamada. */
create or replace function public.set_match_times(p_ids uuid[], p_times timestamptz[]) returns void
language sql security definer set search_path = public as $$
  update matches m set scheduled_at = x.t
  from unnest(p_ids, p_times) as x(id, t)
  where m.id = x.id;
$$;

revoke all on function public.acquire_tick_lease(int), public.release_tick_lease(), public.set_match_times(uuid[], timestamptz[]) from public, anon, authenticated;

-- Ráfagas cada minuto y vivos de 5 min + 30 s de pausa.
update settings set value = value || '{"burstEveryMinutes": 1, "liveEventMinutes": 5.5, "dayEndHour": 14}'::jsonb, updated_at = now()
where key = 'calendar';

-- El motor despierta cada 15 segundos.
do $$
declare j int;
begin
  select jobid into j from cron.job where jobname = 'arena-tick';
  if j is not null then perform cron.alter_job(j, schedule := '15 seconds'); end if;
exception when others then null; -- sin pg_cron (pruebas locales)
end $$;
