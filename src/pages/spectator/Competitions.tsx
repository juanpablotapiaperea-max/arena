// Competiciones: tablas con movimiento, cuadro de playoffs, resultados por
// jornada, probabilidades y líderes de cada edición.
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronLeft, ChevronRight, Trophy } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useTeams, usePlayers } from '@/lib/hooks';
import { useRealtime } from '@/lib/realtime';
import { getEditions, getMatches, getProbabilities, getStandings, getTopPlayers, type Edition, type Match } from '@/lib/engine';
import { compColor, FORMAT_LABEL, STATUS_LABEL } from '@/lib/compColors';
import type { Team } from '@/lib/types';
import { Badge, SectionTitle, Spinner, cn } from '@/components/ui';
import { EmptyState, MatchCard, StandingsTable, TeamName, pct } from '@/components/game';
import { Crest } from '@/components/Crest';

export function CompetitionsPage() {
  const editions = useQuery({ queryKey: ['editions'], queryFn: getEditions });
  const { byId } = useTeams();
  if (editions.isLoading) return <Spinner />;
  const list = editions.data ?? [];
  return (
    <div className="space-y-4">
      <SectionTitle>Competiciones</SectionTitle>
      {list.length === 0 ? (
        <EmptyState icon={<Trophy className="text-secondary" size={30} />} title="La temporada aún no arranca">
          Cuando el administrador arranque las competiciones, aquí verás tablas, cuadros y probabilidades.
        </EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {list.map((e) => (
            <Link key={e.id} to={`/competiciones/${e.id}`} className="focus-ring card block overflow-hidden p-0 transition hover:-translate-y-0.5" style={{ boxShadow: `inset 0 4px 0 ${compColor(e.config.competitionKey)}` }}>
              <div className="flex items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="font-display text-2xl font-bold uppercase leading-none">{e.name.split(' · ')[0]}</div>
                  <div className="mt-1 text-xs text-muted">
                    {FORMAT_LABEL[e.config.format] ?? e.config.format} · {e.name.split(' · ')[1] ?? ''}
                  </div>
                </div>
                {e.champion_team_id ? (
                  <span className="flex items-center gap-1.5 text-sm font-semibold">
                    <Trophy size={16} className="text-secondary" aria-hidden />
                    {byId.get(e.champion_team_id) && <Crest team={byId.get(e.champion_team_id)!} size={26} />}
                  </span>
                ) : (
                  <Badge tone={e.status === 'playoffs' ? 'live' : 'primary'}>{STATUS_LABEL[e.status]}</Badge>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

type Tab = 'tabla' | 'cuadro' | 'resultados' | 'probabilidades' | 'lideres';

export function EditionPage() {
  const { id } = useParams();
  const { profile } = useAuth();
  const { byId } = useTeams();
  const editions = useQuery({ queryKey: ['editions'], queryFn: getEditions });
  const e = editions.data?.find((x) => x.id === id);
  const standings = useQuery({ queryKey: ['standings', id], queryFn: () => getStandings(id!), enabled: !!id });
  const matches = useQuery({ queryKey: ['matches', id], queryFn: () => getMatches(id!), enabled: !!id });
  const probs = useQuery({ queryKey: ['probs', id], queryFn: () => getProbabilities(id!), enabled: !!id });
  useRealtime('edition_standings', [['standings', id]], `edition_id=eq.${id}`);
  const hasRegular = e?.state.units.some((u) => u.stage !== 'playoff');
  const hasPlayoff = e?.state.units.some((u) => u.stage === 'playoff');
  const [tab, setTab] = useState<Tab | null>(null);
  const current: Tab = tab ?? (hasRegular ? 'tabla' : 'cuadro');
  const favs = new Set([...(profile?.favorite_team_ids ?? []), ...(profile?.star_team_id ? [profile.star_team_id] : [])]);

  if (editions.isLoading) return <Spinner />;
  if (!e) return <EmptyState title="Competición no encontrada" />;
  const probMap = new Map((probs.data ?? []).map((p) => [p.team_id, p]));
  const color = compColor(e.config.competitionKey);

  const tabs: [Tab, string, boolean][] = [
    ['tabla', e.config.format === 'groups_knockout' ? 'Grupos' : 'Tabla', !!hasRegular],
    ['cuadro', 'Cuadro', !!hasPlayoff],
    ['resultados', 'Resultados', true],
    ['probabilidades', 'Probabilidades', (probs.data ?? []).length > 0],
    ['lideres', 'Líderes', true],
  ];

  return (
    <div className="space-y-4">
      <Link to="/competiciones" className="focus-ring inline-flex items-center gap-1 rounded text-sm text-muted hover:text-fg">
        <ArrowLeft size={16} /> Competiciones
      </Link>
      <header className="rounded-3xl p-5" style={{ background: `linear-gradient(120deg, ${color}40, transparent 70%)` }}>
        <div className="text-xs font-semibold uppercase tracking-widest" style={{ color }}>
          {FORMAT_LABEL[e.config.format]} · peso ×{e.config.weight}
        </div>
        <h1 className="font-display text-4xl font-extrabold uppercase leading-none sm:text-5xl">{e.name.split(' · ')[0]}</h1>
        <div className="mt-1 text-sm text-muted">{e.name.split(' · ')[1]}</div>
        {e.champion_team_id && (
          <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-secondary/20 px-3 py-1.5 font-semibold">
            <Trophy size={16} className="text-secondary" aria-hidden /> Campeón: <TeamName team={byId.get(e.champion_team_id)} size={22} />
          </div>
        )}
      </header>

      <div className="-mx-4 flex gap-1 overflow-x-auto px-4" role="tablist" aria-label="Secciones">
        {tabs
          .filter(([, , show]) => show)
          .map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={current === k}
              onClick={() => setTab(k)}
              className={cn('focus-ring min-h-10 shrink-0 rounded-xl px-3.5 text-sm font-semibold', current === k ? 'bg-primary text-bg' : 'bg-surface-2 text-muted')}
            >
              {label}
            </button>
          ))}
      </div>

      {current === 'tabla' && <StandingsView e={e} rows={standings.data} probs={probMap} favs={favs} teams={byId} />}
      {current === 'cuadro' && (matches.isLoading ? <Spinner /> : <Bracket e={e} matches={matches.data ?? []} teams={byId} />)}
      {current === 'resultados' && (matches.isLoading ? <Spinner /> : <Results e={e} matches={matches.data ?? []} teams={byId} />)}
      {current === 'probabilidades' && <ProbabilityView e={e} probs={probs.data ?? []} teams={byId} />}
      {current === 'lideres' && <Leaders editionId={e.id} teams={byId} />}
    </div>
  );
}

function StandingsView({ e, rows, probs, favs, teams }: { e: Edition; rows?: import('@/lib/engine').Standing[]; probs: Map<string, { champion: number; playoffs: number; relegation: number; promotion: number }>; favs: Set<string>; teams: Map<string, Team> }) {
  if (!rows) return <Spinner />;
  const groups = [...new Set(rows.map((r) => r.group_label))];
  const zones = {
    top: e.config.format === 'groups_knockout' ? Number(e.config.qualifyPerGroup ?? 2) : Number(e.config.playoffTeams ?? 0) || undefined,
    topLabel: e.config.format === 'groups_knockout' ? 'Pasan a eliminatoria' : 'Playoffs',
    bottom: Number(e.config.relegated ?? 0) || undefined,
    promote: Number(e.config.promoted ?? 0) || undefined,
  };
  return (
    <div className={cn('grid gap-4', groups.length > 1 && 'md:grid-cols-2')}>
      {groups.map((g) => (
        <div key={g}>
          {g && <h3 className="mb-2 font-display text-xl font-bold uppercase">Grupo {g}</h3>}
          <StandingsTable rows={rows.filter((r) => r.group_label === g)} teams={teams} zones={zones} probs={probs.size ? probs : undefined} highlight={favs} compact={groups.length > 1} />
        </div>
      ))}
    </div>
  );
}

const ROUND_ORDER = ['previa', 'dieciseisavos', 'octavos', 'cuartos', 'semifinal', 'final'];
const ROUND_NAME: Record<string, string> = { previa: 'Previa', dieciseisavos: 'Dieciseisavos', octavos: 'Octavos', cuartos: 'Cuartos', semifinal: 'Semifinal', final: 'Final' };

/** Cuadro de playoffs interactivo: una columna por ronda, eliminatorias con su global. */
function Bracket({ e, matches, teams }: { e: Edition; matches: Match[]; teams: Map<string, Team> }) {
  const po = matches.filter((m) => m.stage === 'playoff');
  const units = e.state.units.filter((u) => u.stage === 'playoff');
  const rounds = [...new Set(units.map((u) => u.round!))].sort((a, b) => ROUND_ORDER.indexOf(a) - ROUND_ORDER.indexOf(b));
  const [focus, setFocus] = useState<string | null>(null);
  if (!rounds.length) return <EmptyState title="Sin playoffs" />;
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2">
      <div className="flex min-w-max gap-4">
        {rounds.map((r) => {
          const unit = units.find((u) => u.round === r)!;
          const ties = Math.max(unit.matches, 1);
          return (
            <div key={r} className="flex w-56 flex-col">
              <h3 className="mb-2 text-center text-xs font-bold uppercase tracking-widest text-muted">{ROUND_NAME[r]}</h3>
              <div className="flex flex-1 flex-col justify-around gap-2">
                {Array.from({ length: ties }, (_, slot) => {
                  const legs = po.filter((m) => m.round === r && (m.bracket_slot ?? 0) === slot).sort((a, b) => (a.leg ?? 1) - (b.leg ?? 1));
                  return <Tie key={slot} legs={legs} teams={teams} focus={focus} setFocus={setFocus} final={r === 'final'} />;
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Tie({ legs, teams, focus, setFocus, final }: { legs: Match[]; teams: Map<string, Team>; focus: string | null; setFocus: (t: string | null) => void; final: boolean }) {
  if (!legs.length)
    return (
      <div className="rounded-xl border border-dashed border-line p-3 text-center text-xs text-muted" aria-label="Por definir">
        Por definir
      </div>
    );
  const a = legs[0].home_team_id;
  const b = legs[0].away_team_id;
  const agg = (t: string) => legs.reduce((s, m) => s + (m.status === 'finished' ? (m.home_team_id === t ? m.home_score ?? 0 : m.away_score ?? 0) : 0), 0);
  const done = legs.every((m) => m.status === 'finished');
  const winner = done ? (agg(a) > agg(b) ? a : agg(b) > agg(a) ? b : null) : null;
  const live = legs.some((m) => m.status === 'live');
  const row = (t: string) => (
    <button
      onMouseEnter={() => setFocus(t)}
      onMouseLeave={() => setFocus(null)}
      onFocus={() => setFocus(t)}
      onBlur={() => setFocus(null)}
      className={cn('focus-ring flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition', focus === t && 'bg-primary/15', winner && winner !== t && 'opacity-50')}
    >
      <span className="min-w-0 flex-1 truncate font-medium">
        <TeamName team={teams.get(t)} size={18} short link={false} />
      </span>
      <span className={cn('font-display text-lg tabular', winner === t && 'font-extrabold')}>{legs.some((m) => m.status === 'finished') ? agg(t) : ''}</span>
    </button>
  );
  return (
    <Link to={legs.some((m) => m.is_main_event) ? `/en-vivo/${legs[legs.length - 1].id}` : '#'} className={cn('focus-ring card block p-1', final && 'border-secondary/60', live && 'border-live/60')}>
      {row(a)}
      {row(b)}
      {legs.length > 1 && (
        <div className="px-2 pb-1 text-[10px] text-muted">
          {legs.map((m) => (m.status === 'finished' ? `${m.leg === 1 ? 'Ida' : 'Vuelta'} ${m.home_score}-${m.away_score}` : '')).filter(Boolean).join(' · ') || 'Ida y vuelta'}
        </div>
      )}
    </Link>
  );
}

function Results({ e, matches, teams }: { e: Edition; matches: Match[]; teams: Map<string, Team> }) {
  const lastPlayed = useMemo(() => {
    const done = matches.filter((m) => m.status === 'finished').map((m) => m.unit_index);
    return done.length ? Math.max(...done) : 0;
  }, [matches]);
  const [unit, setUnit] = useState<number | null>(null);
  const u = unit ?? lastPlayed;
  const units = e.state.units;
  const label = units.find((x) => x.index === u)?.label ?? `Jornada ${u + 1}`;
  const list = matches.filter((m) => m.unit_index === u);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <button className="focus-ring rounded-lg p-2 hover:bg-surface-2 disabled:opacity-30" disabled={u <= 0} onClick={() => setUnit(u - 1)} aria-label="Anterior">
          <ChevronLeft />
        </button>
        <select
          value={u}
          onChange={(ev) => setUnit(Number(ev.target.value))}
          className="focus-ring min-h-10 rounded-xl border border-line bg-surface-2 px-3 text-sm font-semibold"
          aria-label="Elegir jornada o ronda"
        >
          {units.map((x) => (
            <option key={x.index} value={x.index}>
              {x.label}
            </option>
          ))}
        </select>
        <button className="focus-ring rounded-lg p-2 hover:bg-surface-2 disabled:opacity-30" disabled={u >= units.length - 1} onClick={() => setUnit(u + 1)} aria-label="Siguiente">
          <ChevronRight />
        </button>
      </div>
      <h3 className="sr-only">{label}</h3>
      {list.length ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {list.map((m) => (
            <MatchCard key={m.id} m={m} teams={teams} to={m.is_main_event ? `/en-vivo/${m.id}` : undefined} />
          ))}
        </div>
      ) : (
        <p className="card p-4 text-sm text-muted">Los cruces se definen cuando termine la ronda anterior.</p>
      )}
    </div>
  );
}

function ProbabilityView({ e, probs, teams }: { e: Edition; probs: import('@/lib/engine').Probability[]; teams: Map<string, Team> }) {
  const cols: [keyof import('@/lib/engine').Probability, string][] = [['champion', 'Campeón']];
  if (Number(e.config.playoffTeams ?? 0) > 0 && e.status === 'in_progress') cols.push(['playoffs', 'Playoffs']);
  if (Number(e.config.promoted ?? 0) > 0) cols.push(['promotion', 'Asciende']);
  if (Number(e.config.relegated ?? 0) > 0) cols.push(['relegation', 'Desciende']);
  const sorted = [...probs].sort((a, b) => b.champion - a.champion || b.playoffs - a.playoffs);
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted">
        Simulamos {probs[0]?.iterations.toLocaleString('es-MX')} veces lo que falta de la competición con el mismo motor de los partidos.
      </p>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-[11px] uppercase tracking-wider text-muted">
            <tr className="border-b border-line">
              <th className="px-3 py-2">Equipo</th>
              {cols.map(([, l]) => (
                <th key={l} className="px-3 py-2 text-right">
                  {l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <tr key={p.team_id} className="border-b border-line/50">
                <td className="max-w-0 px-3 py-1.5">
                  <TeamName team={teams.get(p.team_id)} size={20} />
                </td>
                {cols.map(([k]) => (
                  <td key={k} className="px-3 py-1.5 text-right">
                    <span className="inline-flex items-center gap-2">
                      <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-surface-2 sm:block" aria-hidden>
                        <span className={cn('block h-full rounded-full', k === 'relegation' ? 'bg-loss' : 'bg-primary')} style={{ width: `${Number(p[k]) * 100}%` }} />
                      </span>
                      <span className="w-10 tabular">{pct(Number(p[k]))}</span>
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Leaders({ editionId, teams }: { editionId: string; teams: Map<string, Team> }) {
  const players = usePlayers();
  const names = new Map((players.data ?? []).map((p) => [p.id, p]));
  const goals = useQuery({ queryKey: ['top', editionId, 'goals'], queryFn: () => getTopPlayers(editionId, 'goals', 10) });
  const assists = useQuery({ queryKey: ['top', editionId, 'assists'], queryFn: () => getTopPlayers(editionId, 'assists', 10) });
  const mvps = useQuery({ queryKey: ['top', editionId, 'mvps'], queryFn: () => getTopPlayers(editionId, 'mvps', 10) });
  const saves = useQuery({ queryKey: ['top', editionId, 'saves'], queryFn: () => getTopPlayers(editionId, 'saves', 10) });
  const boards: [string, typeof goals, (s: import('@/lib/engine').PlayerStat) => string][] = [
    ['Goleadores', goals, (s) => `${s.goals}`],
    ['Asistentes', assists, (s) => `${s.assists}`],
    ['MVP', mvps, (s) => `${s.mvps}`],
    ['Porteros (atajadas)', saves, (s) => `${s.saves} · ${s.saves + s.goals_against ? ((s.saves / (s.saves + s.goals_against)) * 100).toFixed(1) : '0'}%`],
  ];
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {boards.map(([title, q, value]) => (
        <section key={title} className="card p-3">
          <h3 className="mb-2 font-display text-lg font-bold uppercase">{title}</h3>
          {q.isLoading ? (
            <Spinner />
          ) : !(q.data ?? []).length ? (
            <p className="text-sm text-muted">Aún sin datos.</p>
          ) : (
            <ol className="space-y-1">
              {q.data!.map((s, i) => {
                const p = names.get(s.player_id);
                const t = s.team_id ? teams.get(s.team_id) : undefined;
                return (
                  <li key={s.player_id} className="flex items-center gap-2 text-sm">
                    <span className="w-5 text-right font-display font-bold text-muted tabular">{i + 1}</span>
                    {t && <Crest team={t} size={18} />}
                    <span className="min-w-0 flex-1 truncate">{p ? `${p.first_name} ${p.last_name}` : 'Jugador'}</span>
                    <span className="font-display text-lg font-bold tabular">{value(s)}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      ))}
    </div>
  );
}
