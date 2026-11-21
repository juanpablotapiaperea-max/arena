-- Historial de ascensos y descensos. `season_id` es la temporada en la que el
-- cambio ya está vigente (la que empieza después del cierre).

create table if not exists team_movements (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  kind text not null check (kind in ('promoted', 'relegated')),
  from_division int not null,
  to_division int not null,
  created_at timestamptz not null default now(),
  unique (season_id, team_id)
);
create index if not exists team_movements_team_idx on team_movements(team_id, season_id desc);

alter table team_movements enable row level security;
drop policy if exists movements_read on team_movements;
create policy movements_read on team_movements for select to authenticated using (true);
drop policy if exists admin_all on team_movements;
create policy admin_all on team_movements for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on team_movements from anon;
grant select on team_movements to authenticated;
