-- Las funciones del servidor que modifican perfiles se marcan como confiables
-- para pasar la protección de columnas (créditos, rol, club).
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() or auth.uid() is null or current_setting('arena.trusted', true) = 'on' then
    return new;
  end if;
  if new.role is distinct from old.role
     or new.credits is distinct from old.credits
     or new.club_team_id is distinct from old.club_team_id
     or new.login_slug is distinct from old.login_slug
     or new.display_name is distinct from old.display_name
     or new.muted_until is distinct from old.muted_until
     or new.last_bonus_day is distinct from old.last_bonus_day then
    raise exception 'Solo puedes cambiar tus equipos favoritos y tu estelar';
  end if;
  return new;
end $$;

create or replace function public.claim_daily_bonus() returns bigint
language plpgsql security definer set search_path = public as $$
declare
  d date := (select date from competition_days where status in ('running', 'paused') order by date desc limit 1);
  bonus bigint := coalesce((select (value ->> 'dailyBonus')::bigint from settings where key = 'betting'), 100);
begin
  if auth.uid() is null or d is null then return 0; end if;
  perform set_config('arena.trusted', 'on', true);
  update profiles set credits = credits + bonus, last_bonus_day = d
   where id = auth.uid() and role <> 'admin' and (last_bonus_day is null or last_bonus_day < d);
  perform set_config('arena.trusted', 'off', true);
  if not found then return 0; end if;
  return bonus;
end $$;
