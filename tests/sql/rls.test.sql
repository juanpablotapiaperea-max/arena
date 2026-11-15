-- Pruebas de permisos (sección 18): un espectador no puede leer AdminBias ni
-- AdminLog por ninguna ruta, y el administrador sí, con bitácora y deshacer.
\set ON_ERROR_STOP 1

create or replace function public.t_assert(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FALLÓ: %', msg; end if;
end $$;
grant execute on function public.t_assert(boolean, text) to authenticated;

-- Usuarios de prueba
insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-00000000000b'),
  ('00000000-0000-0000-0000-00000000000c');
insert into profiles (id, display_name, login_slug, role, club_team_id) values
  ('00000000-0000-0000-0000-00000000000a', 'Admin', 'admin', 'admin', null),
  ('00000000-0000-0000-0000-00000000000b', 'Espectador', 'espectador', 'spectator', null),
  ('00000000-0000-0000-0000-00000000000c', 'Dueño', 'dueno', 'owner', (select id from teams where key = 'kings'));

-- Datos secretos
insert into editions (id, competition_id, season_id, name)
  select '00000000-0000-0000-0000-0000000000e1', c.id, s.id, 'OHL T1' from competitions c, seasons s where c.key = 'ohl' and s.number = 1;
insert into matches (id, edition_id, home_team_id, away_team_id, is_main_event, status, started_at)
  select '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1',
         (select id from teams where key = 'kings'), (select id from teams where key = 'ducks'), true, 'live', now() - interval '60 seconds';
insert into match_timelines (match_id, events, duration_seconds) values
  ('00000000-0000-0000-0000-0000000000a1',
   '[{"second":30,"type":"goal"},{"second":600,"type":"goal"},{"second":900,"type":"final","data":{"score":[1,1]}}]', 900);
insert into match_secrets (match_id, seed, home_bias) values ('00000000-0000-0000-0000-0000000000a1', 123, 1.2);
insert into admin_biases (team_id, scope, multiplier) select id, 'competition', 1.25 from teams where key = 'kings';
insert into admin_log (action, entity, entity_id) values ('custom', 'prueba', 'x');
insert into admin_ranking_adjustments (team_id, points) select id, 50 from teams where key = 'ducks';
insert into finance_entries (team_id, concept, amount) select id, 'taquilla', 1000 from teams where key in ('kings', 'ducks');

-- ═══ Espectador ═══
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select set_config('request.jwt.claims', '{"aal":"aal1"}', false);

select t_assert((select count(*) from admin_biases) = 0, 'espectador no lee admin_biases');
select t_assert((select count(*) from admin_log) = 0, 'espectador no lee admin_log');
select t_assert((select count(*) from admin_ranking_adjustments) = 0, 'espectador no lee ajustes de ranking');
select t_assert((select count(*) from match_secrets) = 0, 'espectador no lee semillas ni sesgos aplicados');
select t_assert((select count(*) from team_private) = 0, 'espectador no lee presupuestos');
select t_assert((select count(*) from finance_entries) = 0, 'espectador no lee finanzas');
select t_assert((select count(*) from ai_usage) = 0, 'espectador no lee gasto de IA');
select t_assert((select count(*) from teams) = 54, 'espectador ve los 54 equipos');
select t_assert((select count(*) from players) = 1080, 'espectador ve los 1,080 jugadores');
select t_assert((select count(*) from settings where key = 'engine') = 0, 'configuración secreta oculta');
select t_assert((select count(*) from settings where key = 'stadiums_enabled') = 1, 'configuración pública visible');
select t_assert(not public.is_admin(), 'espectador no es admin');
select t_assert((select count(*) from profiles) = 1, 'solo ve su propio perfil');
select t_assert((select count(*) from public_profiles) = 3, 've nombres públicos');
-- La línea de tiempo no se puede leer directamente durante el vivo...
select t_assert((select count(*) from match_timelines) = 0, 'timeline oculta mientras está en vivo');
-- ...y la RPC solo entrega lo ya ocurrido (segundo 30, no el 600 ni el final).
select t_assert(jsonb_array_length(public.live_timeline('00000000-0000-0000-0000-0000000000a1') -> 'events') = 1,
                'live_timeline no adelanta el resultado');

do $$ begin
  begin
    insert into admin_biases (team_id, scope, multiplier) select id, 'competition', 1.3 from teams limit 1;
    raise exception 'FALLÓ: espectador pudo insertar un sesgo';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.undo_admin_change(1);
    raise exception 'FALLÓ: espectador pudo deshacer';
  exception when raise_exception then
    if sqlerrm like 'FALLÓ%' then raise; end if;
  end;
  begin
    update profiles set credits = 999999 where id = auth.uid();
    raise exception 'FALLÓ: espectador cambió sus créditos';
  exception when raise_exception then
    if sqlerrm like 'FALLÓ%' then raise; end if;
  end;
  begin
    update profiles set role = 'admin' where id = auth.uid();
    raise exception 'FALLÓ: espectador se hizo admin';
  exception when raise_exception then
    if sqlerrm like 'FALLÓ%' then raise; end if;
  end;
end $$;
update teams set name = 'Hackeado' where key = 'kings'; -- RLS: no afecta filas
select t_assert((select name from teams where key = 'kings') = 'Kings', 'espectador no edita equipos');
update profiles set favorite_team_ids = array[(select id from teams where key = 'kings')] where id = auth.uid();
select t_assert((select cardinality(favorite_team_ids) from profiles where id = auth.uid()) = 1, 'puede elegir favoritos');
insert into chat_messages (channel, user_id, body) values ('general', auth.uid(), 'hola');
reset role;

-- ═══ Dueño ═══
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
select t_assert((select count(*) from team_private) = 1, 'dueño ve solo el presupuesto de su club');
select t_assert((select count(*) from finance_entries) = 1, 'dueño ve solo las finanzas de su club');
select t_assert((select count(*) from admin_biases) = 0, 'dueño no lee sesgos');
select public.set_play_style('ofensivo');
select t_assert((select play_style from teams where key = 'kings') = 'ofensivo', 'dueño cambia su estilo');
reset role;

-- ═══ Administrador sin segundo factor ═══
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select set_config('request.jwt.claims', '{"aal":"aal1"}', false);
select t_assert(not public.is_admin(), 'admin sin TOTP no tiene permisos');
select t_assert((select count(*) from admin_biases) = 0, 'admin sin TOTP no lee sesgos');

-- ═══ Administrador con segundo factor ═══
select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
select t_assert(public.is_admin(), 'admin con TOTP');
select t_assert((select count(*) from admin_biases) = 1, 'admin lee sesgos');
select t_assert((select count(*) from match_secrets) = 1, 'admin lee secretos de partido');
update teams set attack = 99 where key = 'kings';
select t_assert((select count(*) from admin_log where entity = 'teams' and action = 'UPDATE') = 1, 'cambio queda en bitácora');
select public.undo_admin_change((select id from admin_log where entity = 'teams' and action = 'UPDATE'));
select t_assert((select attack from teams where key = 'kings') = 93, 'deshacer restaura el valor');
select t_assert((select undone_at is not null from admin_log where entity = 'teams' and action = 'UPDATE'), 'marca deshecho');
insert into admin_biases (team_id, scope, multiplier) select id, 'match', 0.8 from teams where key = 'ducks';
select public.undo_admin_change((select max(id) from admin_log where entity = 'admin_biases'));
select t_assert((select count(*) from admin_biases) = 1, 'deshacer un alta la borra');
reset role;

-- ═══ Sin sesión ═══
set role anon;
do $$ begin
  begin
    perform count(*) from admin_biases;
    raise exception 'FALLÓ: anon leyó admin_biases';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from teams;
    raise exception 'FALLÓ: anon leyó equipos';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

select 'RLS OK' as resultado;
