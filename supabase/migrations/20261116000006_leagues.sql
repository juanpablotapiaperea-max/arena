-- Ligas privadas de apuestas entre amigos y logros.

create or replace function public.create_bet_league(p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  code text := upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 6));
  lid uuid;
begin
  if auth.uid() is null then raise exception 'Sin sesión'; end if;
  if char_length(trim(p_name)) < 2 then raise exception 'Nombre demasiado corto'; end if;
  insert into bet_leagues (name, owner_id, join_code) values (trim(p_name), auth.uid(), code) returning id into lid;
  insert into bet_league_members (league_id, user_id) values (lid, auth.uid());
  return jsonb_build_object('id', lid, 'code', code);
end $$;

create or replace function public.join_bet_league(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare lid uuid;
begin
  if auth.uid() is null then raise exception 'Sin sesión'; end if;
  select id into lid from bet_leagues where join_code = upper(trim(p_code));
  if lid is null then raise exception 'No existe una liga con ese código'; end if;
  insert into bet_league_members (league_id, user_id) values (lid, auth.uid()) on conflict do nothing;
  return lid;
end $$;

create or replace function public.leave_bet_league(p_league uuid) returns void
language sql security definer set search_path = public as $$
  delete from bet_league_members where league_id = p_league and user_id = auth.uid();
$$;

/** Tabla de una liga privada: ganancia neta de cada miembro. */
create or replace function public.bet_league_table(p_league uuid) returns table (user_id uuid, display_name text, bets bigint, won bigint, net bigint)
language sql stable security definer set search_path = public as $$
  select b.user_id, b.display_name, b.bets, b.won, b.net
  from public.bettor_leaderboard() b
  where exists (select 1 from bet_league_members m where m.league_id = p_league and m.user_id = auth.uid())
    and b.user_id in (select user_id from bet_league_members where league_id = p_league)
  union all
  select m.user_id, p.display_name, 0, 0, 0
  from bet_league_members m join profiles p on p.id = m.user_id
  where m.league_id = p_league
    and exists (select 1 from bet_league_members x where x.league_id = p_league and x.user_id = auth.uid())
    and m.user_id not in (select user_id from public.bettor_leaderboard())
  order by 5 desc;
$$;

/** Ligas del usuario (sin la recursión de la política de miembros). */
create or replace function public.my_bet_leagues() returns table (id uuid, name text, join_code text, members bigint, is_owner boolean)
language sql stable security definer set search_path = public as $$
  select l.id, l.name, l.join_code, (select count(*) from bet_league_members x where x.league_id = l.id), l.owner_id = auth.uid()
  from bet_leagues l join bet_league_members m on m.league_id = l.id and m.user_id = auth.uid()
  order by l.created_at;
$$;

revoke all on function public.create_bet_league(text), public.join_bet_league(text), public.leave_bet_league(uuid), public.bet_league_table(uuid), public.my_bet_leagues() from public, anon;
grant execute on function public.create_bet_league(text), public.join_bet_league(text), public.leave_bet_league(uuid), public.bet_league_table(uuid), public.my_bet_leagues() to authenticated;

-- Las políticas originales de miembros se consultaban a sí mismas (recursión).
create or replace function public.is_league_member(p_league uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from bet_league_members where league_id = p_league and user_id = auth.uid());
$$;
drop policy if exists bet_leagues_member on bet_leagues;
create policy bet_leagues_member on bet_leagues for select to authenticated using (owner_id = auth.uid() or public.is_league_member(id));
drop policy if exists bet_league_members_read on bet_league_members;
create policy bet_league_members_read on bet_league_members for select to authenticated using (user_id = auth.uid() or public.is_league_member(league_id));
