// Board: tablas de varias ligas a la vez, recalculadas al instante con cada
// resultado (tiempo real) y con animaciones de subida y bajada.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import { ArrowDown, ArrowUp, Maximize2, Minimize2, MonitorPlay } from 'lucide-react';
import { computeStandings, DEFAULT_POINTS, DEFAULT_TIEBREAKERS, type PointsConfig, type StandingRow, type Tiebreaker } from '@shared/competition/standings';
import { DEMO_MODE, db, supabase } from '@/lib/supabase';
import { getEditions, type Edition, type Match } from '@/lib/engine';
import { compColor } from '@/lib/compColors';
import { useTeams } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import type { Team } from '@/lib/types';
import { Crest } from '@/components/Crest';
import { EmptyState, ZoneLegend, zoneOf } from '@/components/game';
import { Spinner, cn } from '@/components/ui';

const TABLE_FORMATS = new Set(['league', 'groups_knockout', 'swiss']);
const COLS = 'id,edition_id,stage,group_label,unit_index,home_team_id,away_team_id,home_score,away_score,overtime,status,finished_at';
type BoardMatch = Pick<Match, 'id' | 'edition_id' | 'stage' | 'group_label' | 'unit_index' | 'home_team_id' | 'away_team_id' | 'home_score' | 'away_score' | 'overtime' | 'status' | 'finished_at'>;

const STORE = 'arena:board';
function loadPrefs(): { ids: string[]; rows: number } {
  try {
    return { ids: [], rows: 0, ...JSON.parse(localStorage.getItem(STORE) ?? '{}') };
  } catch {
    return { ids: [], rows: 0 };
  }
}

async function boardMatches(editionId: string): Promise<BoardMatch[]> {
  const out: BoardMatch[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db().from('matches').select(COLS).eq('edition_id', editionId).order('unit_index').range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as BoardMatch[]));
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

export function BoardPage() {
  const editions = useQuery({ queryKey: ['editions'], queryFn: getEditions });
  const qc = useQueryClient();
  const { byId } = useTeams();
  const { profile } = useAuth();
  const [prefs, setPrefs] = useState(loadPrefs);
  const [tv, setTv] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  const candidates = (editions.data ?? []).filter((e) => TABLE_FORMATS.has(e.config.format) && e.status !== 'setup');
  const active = candidates.filter((e) => e.status !== 'finished');
  const selected = (prefs.ids.length ? candidates.filter((e) => prefs.ids.includes(e.id)) : active).slice(0, 6);
  const ids = selected.map((e) => e.id);

  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify(prefs));
    } catch {
      /* sin almacenamiento */
    }
  }, [prefs]);

  const results = useQueries({
    queries: ids.map((id) => ({ queryKey: ['board-matches', id], queryFn: () => boardMatches(id), enabled: !DEMO_MODE, staleTime: 5 * 60_000 })),
  });

  // Tiempo real: cada partido que cambia se actualiza en su lugar, sin recargar.
  const idKey = ids.join(',');
  useEffect(() => {
    if (DEMO_MODE || !supabase || !ids.length) return;
    const ch = supabase
      .channel(`board:${idKey}:${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches', filter: `edition_id=in.(${idKey})` }, ({ new: row }) => {
        const m = row as BoardMatch;
        qc.setQueryData<BoardMatch[]>(['board-matches', m.edition_id], (old) => {
          if (!old) return old;
          const i = old.findIndex((x) => x.id === m.id);
          if (i < 0) return [...old, m];
          const next = old.slice();
          next[i] = { ...old[i], ...m };
          return next;
        });
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'matches', filter: `edition_id=in.(${idKey})` }, ({ new: row }) => {
        const m = row as BoardMatch;
        qc.setQueryData<BoardMatch[]>(['board-matches', m.edition_id], (old) => (old ? [...old, m] : old));
      })
      .subscribe();
    return () => {
      supabase!.removeChannel(ch);
    };
  }, [idKey, qc]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string) =>
    setPrefs((p) => {
      const cur = p.ids.length ? p.ids : active.map((e) => e.id);
      return { ...p, ids: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] };
    });

  const goTv = async () => {
    const next = !tv;
    setTv(next);
    try {
      if (next) await wrap.current?.requestFullscreen?.();
      else if (document.fullscreenElement) await document.exitFullscreen();
    } catch {
      /* el navegador no permite pantalla completa: se queda en modo compacto */
    }
  };
  useEffect(() => {
    const h = () => !document.fullscreenElement && setTv(false);
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);

  if (editions.isLoading) return <Spinner />;
  const favs = new Set([...(profile?.favorite_team_ids ?? []), ...(profile?.star_team_id ? [profile.star_team_id] : [])]);

  return (
    <div ref={wrap} className={cn('space-y-4', tv && 'h-screen overflow-y-auto bg-bg p-4')}>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="flex items-center gap-2 font-display text-3xl font-extrabold uppercase">
          <MonitorPlay className="text-primary" aria-hidden /> Board
        </h1>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-live/15 px-2.5 py-1 text-xs font-semibold text-live">
          <span className="h-2 w-2 animate-pulse rounded-full bg-live" aria-hidden /> En tiempo real
        </span>
        <div className="ml-auto flex items-center gap-1">
          <label className="text-xs text-muted">
            Filas{' '}
            <select value={prefs.rows} onChange={(e) => setPrefs((p) => ({ ...p, rows: Number(e.target.value) }))} className="focus-ring min-h-9 rounded-lg border border-line bg-surface-2 px-2 text-sm text-fg">
              <option value={0}>Todas</option>
              <option value={8}>Top 8</option>
              <option value={12}>Top 12</option>
              <option value={20}>Top 20</option>
            </select>
          </label>
          <button onClick={goTv} className="focus-ring inline-flex min-h-9 items-center gap-1 rounded-lg bg-surface-2 px-3 text-sm" aria-pressed={tv}>
            {tv ? <Minimize2 size={14} /> : <Maximize2 size={14} />} {tv ? 'Salir' : 'Pantalla completa'}
          </button>
        </div>
      </div>

      <div className="-mx-4 flex gap-1 overflow-x-auto px-4" role="group" aria-label="Ligas en el board">
        {candidates.map((e) => {
          const on = ids.includes(e.id);
          return (
            <button
              key={e.id}
              onClick={() => toggle(e.id)}
              aria-pressed={on}
              className={cn('focus-ring min-h-10 shrink-0 rounded-xl border px-3 text-sm font-semibold transition', on ? 'border-transparent text-bg' : 'border-line bg-surface-2 text-muted')}
              style={on ? { background: compColor(e.config.competitionKey) } : undefined}
            >
              {e.name.split(' · ')[0]}
              {e.status === 'finished' && <span className="ml-1 opacity-70">· final</span>}
            </button>
          );
        })}
      </div>

      {!selected.length ? (
        <EmptyState icon={<MonitorPlay className="text-primary" size={30} />} title="Elige al menos una liga">
          Toca las ligas de arriba para verlas en el board.
        </EmptyState>
      ) : (
        <LayoutGroup>
          <div className={cn('grid gap-4', selected.length === 2 && 'lg:grid-cols-2', selected.length >= 3 && 'lg:grid-cols-2 2xl:grid-cols-3')}>
            {selected.map((e, i) => (
              <LeagueBoard key={e.id} e={e} matches={results[i]?.data} teams={byId} rowsLimit={prefs.rows} favs={favs} />
            ))}
          </div>
        </LayoutGroup>
      )}
    </div>
  );
}

interface Move {
  delta: number;
  until: number;
  pts: number;
}

function LeagueBoard({ e, matches, teams, rowsLimit, favs }: { e: Edition; matches?: BoardMatch[]; teams: Map<string, Team>; rowsLimit: number; favs: Set<string> }) {
  const reduce = useReducedMotion();
  const color = compColor(e.config.competitionKey);
  const pts = (e.config.points as PointsConfig | undefined) ?? DEFAULT_POINTS;
  const tbs = (e.config.tiebreakers as Tiebreaker[] | undefined) ?? DEFAULT_TIEBREAKERS;

  const tables = useMemo(() => {
    if (!matches) return null;
    const regular = matches.filter((m) => m.stage !== 'playoff');
    const groups = [...new Set(regular.map((m) => m.group_label ?? ''))].sort();
    return groups.map((g) => {
      const inGroup = regular.filter((m) => (m.group_label ?? '') === g);
      const teamIds = [...new Set(inGroup.flatMap((m) => [m.home_team_id, m.away_team_id]))];
      const played = inGroup
        .filter((m) => m.status === 'finished' && m.home_score != null && m.away_score != null)
        .sort((a, b) => (a.finished_at ?? '').localeCompare(b.finished_at ?? ''))
        .map((m) => ({ home: m.home_team_id, away: m.away_team_id, homeScore: m.home_score!, awayScore: m.away_score!, overtime: m.overtime }));
      return { group: g, rows: computeStandings(teamIds, played, pts, tbs) };
    });
  }, [matches]); // eslint-disable-line react-hooks/exhaustive-deps

  // Movimientos desde la última actualización (flechas por unos segundos).
  const prev = useRef(new Map<string, { pos: number; pts: number }>());
  const [moves, setMoves] = useState(new Map<string, Move>());
  useEffect(() => {
    if (!tables) return;
    const now = Date.now();
    const next = new Map(moves);
    let changed = false;
    for (const t of tables) {
      t.rows.forEach((r, i) => {
        const key = `${t.group}|${r.teamId}`;
        const p = prev.current.get(key);
        if (p && (p.pos !== i || p.pts !== r.points)) {
          next.set(key, { delta: p.pos - i, until: now + 9000, pts: r.points - p.pts });
          changed = true;
        }
        prev.current.set(key, { pos: i, pts: r.points });
      });
    }
    if (changed) setMoves(next);
  }, [tables]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setInterval(() => {
      setMoves((m) => {
        const now = Date.now();
        const n = new Map([...m].filter(([, v]) => v.until > now));
        return n.size === m.size ? m : n;
      });
    }, 1500);
    return () => clearInterval(t);
  }, []);

  const finished = matches?.filter((m) => m.status === 'finished') ?? [];
  const total = matches?.length ?? 0;
  const lastResults = [...finished].sort((a, b) => (b.finished_at ?? '').localeCompare(a.finished_at ?? '')).slice(0, 8);
  const playoffTeams = Number(e.config.playoffTeams ?? 0);
  const relegated = Number(e.config.relegated ?? 0);
  const promoted = e.config.promotionVia === 'table' ? Number(e.config.promoted ?? 0) : 0;
  const promoNote = e.config.promoted && e.config.promotionVia !== 'table' ? `Ascienden ${e.config.promoted} por la liguilla` : undefined;
  const units = e.state?.units ?? [];
  const doneUnits = units.filter((u) => {
    const ms = matches?.filter((m) => m.unit_index === u.index) ?? [];
    return ms.length > 0 && ms.every((m) => m.status === 'finished');
  }).length;

  return (
    <motion.section layout={!reduce} className="card overflow-hidden p-0">
      <header className="p-3" style={{ background: `linear-gradient(110deg, ${color}40, transparent 70%)` }}>
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-display text-2xl font-extrabold uppercase leading-none">{e.name.split(' · ')[0]}</h2>
          <span className="text-xs text-muted tabular">
            Jornada {doneUnits}/{units.length}
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={total ? Math.round((finished.length / total) * 100) : 0} aria-valuemin={0} aria-valuemax={100} aria-label="Partidos jugados">
          <motion.div className="h-full rounded-full" style={{ background: color }} animate={{ width: `${total ? (finished.length / total) * 100 : 0}%` }} transition={{ duration: 0.8 }} />
        </div>
        {lastResults.length > 0 && (
          <div className="mt-2 flex gap-1.5 overflow-hidden text-[11px]" aria-label="Últimos resultados">
            <AnimatePresence initial={false}>
              {lastResults.map((m) => (
                <motion.span
                  key={m.id}
                  layout={!reduce}
                  initial={reduce ? false : { opacity: 0, scale: 0.7, x: -12 }}
                  animate={{ opacity: 1, scale: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  className="shrink-0 rounded-md bg-surface-2/80 px-1.5 py-0.5 font-semibold tabular"
                >
                  {teams.get(m.home_team_id)?.short_name} {m.home_score}-{m.away_score} {teams.get(m.away_team_id)?.short_name}
                  {m.overtime ? ' TE' : ''}
                </motion.span>
              ))}
            </AnimatePresence>
          </div>
        )}
      </header>

      {!tables ? (
        <div className="p-4">
          <Spinner />
        </div>
      ) : (
        tables.map((t) => (
          <div key={t.group}>
            {tables.length > 1 && <div className="border-t border-line px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted">Grupo {t.group}</div>}
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase tracking-wider text-muted">
                <tr className="border-y border-line/60">
                  <th className="w-8 py-1 pl-3 text-left">#</th>
                  <th className="py-1 text-left">Equipo</th>
                  <th className="w-8 py-1 text-right">PJ</th>
                  <th className="w-10 py-1 text-right">DG</th>
                  <th className="w-12 py-1 pr-3 text-right">Pts</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                  {(rowsLimit ? t.rows.slice(0, rowsLimit) : t.rows).map((r: StandingRow, i) => {
                    const team = teams.get(r.teamId);
                    const mv = moves.get(`${t.group}|${r.teamId}`);
                    const z = zoneOf(i + 1, t.rows.length, { top: playoffTeams || undefined, promote: promoted || undefined, bottom: relegated || undefined });
                    const zone = z === 'promote' ? 'border-l-win' : z === 'playoff' ? 'border-l-primary' : z === 'relegate' ? 'border-l-loss' : 'border-l-transparent';
                    return (
                      <motion.tr
                        key={r.teamId}
                        layout={!reduce ? 'position' : false}
                        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                        className={cn('border-b border-b-line/40', favs.has(r.teamId) && 'bg-secondary/10', mv && mv.pts > 0 && 'bg-win/10')}
                      >
                        <td className={cn('border-l-4 py-1.5 pl-2 font-display text-base font-bold tabular text-muted', zone)}>{i + 1}</td>
                        <td className="py-1.5">
                          <span className="flex min-w-0 items-center gap-2">
                            {team && <Crest team={team} size={22} />}
                            <span className="truncate font-medium">{team?.name ?? '—'}</span>
                            <AnimatePresence>
                              {mv && mv.delta !== 0 && (
                                <motion.span
                                  initial={{ opacity: 0, y: mv.delta > 0 ? 6 : -6 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  exit={{ opacity: 0 }}
                                  className={cn('inline-flex shrink-0 items-center text-[11px] font-bold', mv.delta > 0 ? 'text-win' : 'text-loss')}
                                  aria-label={mv.delta > 0 ? `Sube ${mv.delta}` : `Baja ${-mv.delta}`}
                                >
                                  {mv.delta > 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                                  {Math.abs(mv.delta)}
                                </motion.span>
                              )}
                            </AnimatePresence>
                          </span>
                        </td>
                        <td className="py-1.5 text-right tabular text-muted">{r.played}</td>
                        <td className="py-1.5 text-right tabular text-muted">{r.goalDiff > 0 ? `+${r.goalDiff}` : r.goalDiff}</td>
                        <td className="py-1.5 pr-3 text-right">
                          <motion.span
                            key={r.points}
                            initial={mv && mv.pts > 0 && !reduce ? { scale: 1.7 } : false}
                            animate={{ scale: 1 }}
                            transition={{ type: 'spring', stiffness: 300, damping: 12 }}
                            className={cn('inline-block font-display text-lg font-bold tabular', mv && mv.pts > 0 && 'text-win')}
                          >
                            {r.points}
                          </motion.span>
                        </td>
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>
              </tbody>
            </table>
            <ZoneLegend zones={{ top: playoffTeams || undefined, promote: promoted || undefined, bottom: relegated || undefined }} note={promoNote} />
          </div>
        ))
      )}
    </motion.section>
  );
}
