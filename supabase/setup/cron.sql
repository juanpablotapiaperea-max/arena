-- Tarea programada: despierta al motor cada minuto (sección 15).
-- El motor solo hace algo si el administrador inició un día de competencia.
-- Reemplaza __PROJECT_REF__ por la referencia del proyecto antes de ejecutar.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'arena-tick';
select cron.schedule(
  'arena-tick',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://__PROJECT_REF__.supabase.co/functions/v1/engine',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.private_config where key = 'cron_secret')
    ),
    body := '{"action":"tick"}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);
select jobname, schedule, active from cron.job where jobname = 'arena-tick';
