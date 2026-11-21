import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { buildLineup, DEFAULT_ENGINE_SETTINGS, type EnginePlayer } from '@shared/engine';
import { STYLE_LABELS } from '@shared/engine/settings';
import { useHistoricalRanking, usePlayers, useTeams } from '@/lib/hooks';
import { POSITION_SHORT, type Player } from '@/lib/types';
import { textOn } from '@/lib/theme';
import { Crest } from '@/components/Crest';
import { Badge, ErrorBox, RatingBar, SectionTitle, Spinner, Stat, money } from '@/components/ui';
import { useQuery } from '@tanstack/react-query';
import { DEMO_MODE, db } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { StadiumView, type StadiumData } from '@/components/Stadium';
import { TeamHallOfFame } from '@/components/HallOfFame';
import { TeamStatusTags } from '@/components/TeamStatus';

export function TeamDetailPage() {
  const { key } = useParams();
  const { teams, isLoading, error } = useTeams();
  const team = teams.find((t) => t.key === key);
  const players = usePlayers(team?.id);
  const ranking = useHistoricalRanking();
  const { profile } = useAuth();
  const stadiumsOn = useQuery({ queryKey: ['setting', 'stadiums_enabled'], enabled: !DEMO_MODE, queryFn: async () => !!(await db().from('settings').select('value').eq('key', 'stadiums_enabled').maybeSingle()).data?.value });
  const stadium = useQuery({
    queryKey: ['stadium', team?.id],
    enabled: !DEMO_MODE && !!team && (!!stadiumsOn.data || profile?.role === 'admin'),
    queryFn: async () => (await db().from('stadiums').select('*').eq('team_id', team!.id).maybeSingle()).data as StadiumData | null,
  });

  const lineup = useMemo(() => {
    if (!players.data) return null;
    const engine: EnginePlayer[] = players.data.map((p) => ({
      id: p.id,
      name: `${p.first_name} ${p.last_name}`,
      number: p.number,
      position: p.position,
      rating: p.rating,
      form: p.form,
      morale: p.morale,
      injuryDays: p.injury_days,
    }));
    return buildLineup(engine, DEFAULT_ENGINE_SETTINGS);
  }, [players.data]);

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  if (!team) return <ErrorBox error="Equipo no encontrado" />;

  const rank = (ranking.data ?? []).slice().sort((a, b) => b.points - a.points || b.titles - a.titles);
  const pos = rank.findIndex((r) => r.team_id === team.id) + 1;
  const entry = rank.find((r) => r.team_id === team.id);
  const byId = new Map((players.data ?? []).map((p) => [p.id, p]));
  const fg = textOn(team.primary_color);

  return (
    <div className="space-y-6">
      <Link to="/equipos" className="focus-ring inline-flex items-center gap-1 rounded text-sm text-muted hover:text-fg">
        <ArrowLeft size={16} /> Equipos
      </Link>

      <section
        className="relative overflow-hidden rounded-3xl p-5 sm:p-8"
        style={{ background: `linear-gradient(135deg, ${team.primary_color}, ${team.primary_color}cc 55%, ${team.secondary_color})`, color: fg }}
      >
        <div className="flex items-center gap-4 sm:gap-6">
          <Crest team={team} size={88} />
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-widest opacity-80">
              {team.division === 1 ? 'Primera División' : 'Segunda División'}
            </div>
            <h1 className="font-display text-4xl font-extrabold uppercase leading-none sm:text-6xl">{team.name}</h1>
            <div className="mt-2 text-sm opacity-90">Estilo: {STYLE_LABELS[team.play_style as keyof typeof STYLE_LABELS] ?? team.play_style}</div>
            <div className="mt-2">
              <TeamStatusTags teamId={team.id} />
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Ataque" value={Number(team.attack).toFixed(1)} />
        <Stat label="Defensa" value={Number(team.defense).toFixed(1)} />
        <Stat label="Portería" value={Number(team.goalie).toFixed(1)} />
        <Stat label="Ranking histórico" value={pos ? `#${pos}` : '—'} />
        <Stat label="Títulos" value={entry?.titles ?? 0} />
        <Stat label="Subcampeonatos" value={entry?.runners_up ?? 0} />
        <Stat label="Puntos de ranking" value={Math.round(entry?.points ?? 0).toLocaleString('es-MX')} />
        <Stat label="Plantilla" value={players.data?.length ?? '—'} />
      </div>

      <TeamHallOfFame team={team} />

      {stadium.data && (
        <section>
          <SectionTitle right={!stadiumsOn.data ? <Badge>Vista previa (estadios apagados)</Badge> : undefined}>Estadio</SectionTitle>
          <StadiumView s={stadium.data} team={team} />
        </section>
      )}

      {players.isLoading ? (
        <Spinner />
      ) : lineup ? (
        <section>
          <SectionTitle>Alineación titular</SectionTitle>
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="card p-3">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Portería</h3>
              <PlayerRow p={byId.get(lineup.goalie.id)} />
              {lineup.backupGoalie && <PlayerRow p={byId.get(lineup.backupGoalie.id)} sub />}
            </div>
            <div className="card p-3">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Parejas de defensa</h3>
              {lineup.pairs.map((pair, i) => (
                <div key={i} className="mb-2">
                  <div className="text-[11px] text-muted">Pareja {i + 1}</div>
                  {pair.map((p) => (
                    <PlayerRow key={p.id} p={byId.get(p.id)} />
                  ))}
                </div>
              ))}
            </div>
            <div className="card p-3">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Líneas de ataque</h3>
              {lineup.lines.map((line, i) => (
                <div key={i} className="mb-2">
                  <div className="text-[11px] text-muted">Línea {i + 1}</div>
                  {line.map((p) => (
                    <PlayerRow key={p.id} p={byId.get(p.id)} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function PlayerRow({ p, sub = false }: { p?: Player; sub?: boolean }) {
  if (!p) return null;
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="w-7 text-right font-display text-lg font-bold text-muted tabular">{p.number}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 truncate text-sm font-medium">
          {p.first_name} {p.last_name}
          {sub && <Badge>Suplente</Badge>}
          {p.injury_days > 0 && <Badge tone="loss">Lesión {p.injury_days}d</Badge>}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted">
          <span>{POSITION_SHORT[p.position]}</span>
          <span>{p.age} años</span>
          <span>{money(p.salary)}</span>
        </div>
      </div>
      <div className="w-16">
        <div className="text-right font-display text-lg font-bold tabular">{p.rating}</div>
        <RatingBar value={p.rating} />
      </div>
    </div>
  );
}
