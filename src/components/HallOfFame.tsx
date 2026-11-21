// Salón de la fama: vitrina de trofeos del club, placas de sus récords
// históricos y premios individuales; carrera al Balón de Oro.
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import { Award, Crown, Goal, Handshake, Shield, Star, Trophy } from 'lucide-react';
import { DEMO_MODE, db } from '@/lib/supabase';
import { usePlayers, useTeams } from '@/lib/hooks';
import { getEditions } from '@/lib/engine';
import { compColor } from '@/lib/compColors';
import type { Team } from '@/lib/types';
import { Crest } from './Crest';
import { Button, SectionTitle, Spinner, cn } from './ui';

export interface AwardRow {
  id: string;
  season_id: string | null;
  edition_id: string | null;
  kind: 'top_scorer' | 'top_assists' | 'mvp' | 'best_goalie' | 'balon_oro';
  player_id: string | null;
  team_id: string | null;
  value: number | null;
  label: string;
  created_at: string;
}

const KIND_ICON = { top_scorer: Goal, top_assists: Handshake, mvp: Star, best_goalie: Shield, balon_oro: Crown } as const;
const KIND_COLOR = { top_scorer: '#f97316', top_assists: '#38bdf8', mvp: '#a855f7', best_goalie: '#22c55e', balon_oro: '#facc15' } as const;

type NameInfo = { name: string; number: number; position: string; team: string | null };

/**
 * Nombres de jugadores activos y retirados. Los récords históricos conservan a
 * sus jugadores aunque ya se hayan retirado, así que se piden por id también.
 */
function usePlayerNames(extraIds: string[] = []) {
  const all = usePlayers();
  const key = [...new Set(extraIds)].sort().join(',');
  const extra = useQuery({
    queryKey: ['player-names', key],
    enabled: !DEMO_MODE && key.length > 0,
    queryFn: async () => {
      const ids = key.split(',');
      const { data } = await db().from('players').select('id,first_name,last_name,number,position,team_id').in('id', ids);
      return (data ?? []) as { id: string; first_name: string; last_name: string; number: number; position: string; team_id: string | null }[];
    },
    staleTime: 5 * 60_000,
  });
  return useMemo(() => {
    const m = new Map<string, NameInfo>();
    for (const p of all.data ?? []) m.set(p.id, { name: `${p.first_name} ${p.last_name}`, number: p.number, position: p.position, team: p.team_id });
    for (const p of extra.data ?? []) m.set(p.id, { name: `${p.first_name} ${p.last_name}`, number: p.number, position: p.position, team: p.team_id });
    return m;
  }, [all.data, extra.data]);
}

/** Vitrina, placas y premios de un equipo. */
export function TeamHallOfFame({ team }: { team: Team }) {
  const reduce = useReducedMotion();
  const legacy = useQuery({
    queryKey: ['legacy-team', team.id],
    enabled: !DEMO_MODE,
    queryFn: async () =>
      ((await db().from('legacy_editions').select('competition_name,season_label,champion_team_id,runner_up_team_id').or(`champion_team_id.eq.${team.id},runner_up_team_id.eq.${team.id}`)).data ?? []) as {
        competition_name: string;
        season_label: string | null;
        champion_team_id: string | null;
        runner_up_team_id: string | null;
      }[],
  });
  const editions = useQuery({ queryKey: ['editions'], queryFn: getEditions, staleTime: 60_000 });
  const records = useQuery({
    queryKey: ['team-records', team.id],
    enabled: !DEMO_MODE,
    queryFn: async () => ((await db().rpc('team_records', { p_team: team.id })).data ?? []) as { player_id: string; goals: number; assists: number; mvps: number; gp: number }[],
  });
  const awards = useQuery({
    queryKey: ['awards-team', team.id],
    enabled: !DEMO_MODE,
    queryFn: async () => ((await db().from('awards').select('*').eq('team_id', team.id).order('created_at', { ascending: false })).data ?? []) as AwardRow[],
  });

  // Vitrina: títulos y subtítulos por competición (historial + temporadas de ARENA).
  const cabinet = useMemo(() => {
    const m = new Map<string, { titles: number; runners: number; color: string; seasons: string[] }>();
    const add = (comp: string, title: boolean, color: string, season?: string | null) => {
      const r = m.get(comp) ?? { titles: 0, runners: 0, color, seasons: [] };
      if (title) {
        r.titles++;
        if (season) r.seasons.push(season);
      } else r.runners++;
      m.set(comp, r);
    };
    for (const l of legacy.data ?? []) add(l.competition_name, l.champion_team_id === team.id, '#facc15', l.season_label);
    for (const e of editions.data ?? []) {
      if (e.status !== 'finished') continue;
      const comp = e.name.split(' · ')[0];
      if (e.champion_team_id === team.id) add(comp, true, compColor(e.config.competitionKey), e.name.split(' · ')[1]);
      else if (e.runner_up_team_id === team.id) add(comp, false, compColor(e.config.competitionKey));
    }
    return [...m.entries()].sort((a, b) => b[1].titles - a[1].titles || b[1].runners - a[1].runners);
  }, [legacy.data, editions.data, team.id]);

  const recs = records.data ?? [];
  const topGoals = [...recs].sort((a, b) => b.goals - a.goals)[0];
  const topAssists = [...recs].sort((a, b) => b.assists - a.assists)[0];
  const topMvp = [...recs].sort((a, b) => b.mvps - a.mvps)[0];
  const topGp = [...recs].sort((a, b) => b.gp - a.gp)[0];
  const totalTitles = cabinet.reduce((s, [, r]) => s + r.titles, 0);
  const names = usePlayerNames([
    ...recs.flatMap((r) => [r.player_id]),
    ...(awards.data ?? []).flatMap((a) => (a.player_id ? [a.player_id] : [])),
  ]);

  return (
    <section className="space-y-4">
      <SectionTitle right={<span className="text-sm text-muted">{totalTitles} títulos</span>}>Salón de la fama</SectionTitle>

      {/* Vitrina */}
      <div className="relative overflow-hidden rounded-3xl border border-secondary/30 p-4 sm:p-6" style={{ background: `radial-gradient(ellipse at top, ${team.primary_color}33, transparent 70%), linear-gradient(180deg, rgb(var(--surface)), rgb(var(--bg)))` }}>
        <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-secondary">
          <Trophy size={14} aria-hidden /> Vitrina de trofeos
        </div>
        {legacy.isLoading ? (
          <Spinner />
        ) : cabinet.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">La vitrina todavía está vacía. El primer trofeo será histórico.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {cabinet.map(([comp, r], i) => (
              <motion.li
                key={comp}
                initial={reduce ? false : { opacity: 0, y: 12, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ delay: Math.min(i, 10) * 0.04 }}
                className="flex flex-col items-center rounded-2xl border border-line/60 bg-black/25 p-3 text-center"
                title={r.seasons.length ? `Campeón: ${r.seasons.join(', ')}` : undefined}
              >
                <div className="relative">
                  <Trophy size={40} style={{ color: r.titles ? r.color : 'rgb(var(--muted))' }} strokeWidth={1.5} aria-hidden />
                  {r.titles > 1 && <span className="absolute -right-3 -top-1 rounded-full bg-secondary px-1.5 text-xs font-bold text-bg">×{r.titles}</span>}
                </div>
                <div className="mt-2 line-clamp-2 text-sm font-semibold leading-tight">{comp}</div>
                <div className="mt-1 text-xs text-muted">
                  {r.titles ? `${r.titles} ${r.titles === 1 ? 'título' : 'títulos'}` : ''}
                  {r.titles && r.runners ? ' · ' : ''}
                  {r.runners ? `${r.runners} ${r.runners === 1 ? 'subtítulo' : 'subtítulos'}` : ''}
                </div>
              </motion.li>
            ))}
          </ul>
        )}
      </div>

      {/* Placas de récords */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Plaque icon={Goal} title="Máximo goleador histórico" stat={topGoals?.goals} unit="goles" player={topGoals && names.get(topGoals.player_id)} team={team} />
        <Plaque icon={Handshake} title="Máximo asistidor histórico" stat={topAssists?.assists} unit="asistencias" player={topAssists && names.get(topAssists.player_id)} team={team} />
        <Plaque icon={Star} title="Más MVP histórico" stat={topMvp?.mvps} unit="MVP" player={topMvp && names.get(topMvp.player_id)} team={team} />
        <Plaque icon={Award} title="Más partidos histórico" stat={topGp?.gp} unit="partidos" player={topGp && names.get(topGp.player_id)} team={team} />
      </div>
      <p className="text-xs text-muted">Récords históricos con la camiseta del club, incluidos jugadores ya retirados. Desde la primera temporada de ARENA (el historial anterior no guardaba estadísticas de jugadores).</p>

      {/* Premios individuales */}
      <div className="card p-4">
        <h3 className="mb-3 flex items-center gap-2 font-semibold">
          <Award size={16} className="text-secondary" aria-hidden /> Premios individuales de sus jugadores
        </h3>
        {awards.isLoading ? (
          <Spinner />
        ) : (awards.data ?? []).length === 0 ? (
          <p className="text-sm text-muted">Todavía ningún jugador del club ha ganado un premio individual.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {awards.data!.map((a) => (
              <AwardLine key={a.id} a={a} player={a.player_id ? names.get(a.player_id)?.name : undefined} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Plaque({ icon: Icon, title, stat, unit, player, team }: { icon: typeof Goal; title: string; stat?: number; unit: string; player?: { name: string; number: number; position: string }; team: Team }) {
  return (
    <div
      className="relative overflow-hidden rounded-2xl border p-4"
      style={{ borderColor: `${team.secondary_color}66`, background: `linear-gradient(145deg, #3b2f1a, #1a1408 60%, #0b0905)` }}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-yellow-200/50 to-transparent" aria-hidden />
      <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-yellow-200/80">
        <Icon size={14} aria-hidden /> {title}
      </div>
      {player && stat ? (
        <>
          <div className="mt-2 font-display text-2xl font-bold uppercase leading-tight text-yellow-50">{player.name}</div>
          <div className="text-xs text-yellow-100/60">
            #{player.number} · {player.position === 'G' ? 'Portero' : player.position === 'D' ? 'Defensa' : 'Delantero'}
          </div>
          <div className="mt-2 font-display text-4xl font-extrabold tabular text-yellow-300">
            {stat} <span className="text-sm font-semibold uppercase text-yellow-100/60">{unit}</span>
          </div>
        </>
      ) : (
        <div className="mt-3 text-sm text-yellow-100/50">Placa en espera</div>
      )}
    </div>
  );
}

function AwardLine({ a, player }: { a: AwardRow; player?: string }) {
  const Icon = KIND_ICON[a.kind];
  return (
    <li className="flex items-center gap-3 rounded-xl bg-surface-2 p-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full" style={{ background: `${KIND_COLOR[a.kind]}22`, color: KIND_COLOR[a.kind] }}>
        <Icon size={20} aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block truncate font-semibold">{player ?? 'Jugador retirado'}</span>
        <span className="block truncate text-xs text-muted">
          {a.label}
          {a.value != null && a.kind !== 'balon_oro' ? ` · ${a.kind === 'best_goalie' ? `${(Number(a.value) * 100).toFixed(1)}% atajadas` : a.value}` : ''}
        </span>
      </span>
    </li>
  );
}

export interface NomineeRow {
  player_id: string;
  team_id: string;
  score?: number;
  goals: number;
  assists: number;
  mvps: number;
  gp: number;
  shutouts: number;
  save_pct: number | null;
  team_share: number | null;
  titles: string[];
  finals: string[];
  semis: string[];
  awards: string[];
}

/**
 * Balón de Oro. Espectadores: los 10 nominados (orden alfabético) con sus
 * números, edad y logros, sin puntaje. Administrador (`onPick`): con puntaje,
 * en orden, y el botón para entregarlo.
 */
export function BalonOro({ onPick, busyId }: { onPick?: (playerId: string) => void; busyId?: string | null }) {
  const reduce = useReducedMotion();
  const { byId } = useTeams();
  const all = usePlayers();
  const players = useMemo(() => new Map((all.data ?? []).map((p) => [p.id, p])), [all.data]);
  const admin = !!onPick;
  const list = useQuery({
    queryKey: ['balon-oro', admin ? 'race' : 'nominees'],
    enabled: !DEMO_MODE,
    queryFn: async () => {
      const r = admin ? await db().rpc('balon_oro_race', { p_limit: 10 }) : await db().rpc('balon_oro_nominees');
      if (r.error) throw new Error(r.error.message);
      return (r.data ?? []) as NomineeRow[];
    },
    refetchInterval: 60_000,
  });
  const winners = useQuery({
    queryKey: ['balon-oro-winners'],
    enabled: !DEMO_MODE,
    queryFn: async () => ((await db().from('awards').select('*').eq('kind', 'balon_oro').order('created_at', { ascending: false })).data ?? []) as AwardRow[],
  });
  const max = Math.max(1, ...(list.data ?? []).map((r) => Number(r.score ?? 0)));
  const posLabel = (p?: string) => (p === 'G' ? 'Portero' : p === 'D' ? 'Defensa' : 'Delantero');

  return (
    <div className="space-y-5">
      <header className="relative overflow-hidden rounded-3xl p-6" style={{ background: 'radial-gradient(ellipse at 20% 0%, #facc1555, transparent 60%), linear-gradient(135deg, #1f1606, #0b0905)' }}>
        <div className="flex items-center gap-4">
          <motion.div
            animate={reduce ? undefined : { rotate: [0, 8, -8, 0] }}
            transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
            className="grid h-20 w-20 shrink-0 place-items-center rounded-full"
            style={{ background: 'radial-gradient(circle at 35% 30%, #fff7c2, #facc15 40%, #a16207)', boxShadow: '0 0 40px #facc1566' }}
            aria-hidden
          >
            <Crown size={34} className="text-yellow-950" />
          </motion.div>
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.3em] text-yellow-300/80">Mejor jugador de la temporada</div>
            <h1 className="font-display text-5xl font-extrabold uppercase leading-none text-yellow-50">Balón de Oro</h1>
            <p className="mt-1 max-w-2xl text-sm text-yellow-100/70">
              {admin
                ? 'Puntaje (solo lo ves tú): números de la temporada, qué tan clave es en su equipo, títulos, finales y semifinales, con más peso en los torneos grandes. Segunda División no cuenta.'
                : 'Los 10 nominados de la temporada: figuras de su equipo, campeones y protagonistas de las fases finales. El ganador lo elige la organización.'}
            </p>
          </div>
        </div>
      </header>

      {(winners.data ?? []).length > 0 && (
        <section className="card p-4">
          <h3 className="mb-3 flex items-center gap-2 font-semibold text-yellow-300">
            <Crown size={16} aria-hidden /> Ganadores
          </h3>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {winners.data!.map((w) => {
              const t = w.team_id ? byId.get(w.team_id) : undefined;
              const pl = w.player_id ? players.get(w.player_id) : undefined;
              return (
                <li key={w.id} className="flex items-center gap-3 rounded-xl border border-yellow-400/30 bg-yellow-400/5 p-3">
                  {t && <Crest team={t} size={36} />}
                  <span className="min-w-0">
                    <span className="block truncate font-display text-lg font-bold uppercase">{pl ? `${pl.first_name} ${pl.last_name}` : '—'}</span>
                    <span className="block text-xs text-muted">
                      {w.label.replace('Balón de Oro · ', '')}
                      {t ? ` · ${t.name}` : ''}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section>
        <h3 className="mb-3 font-display text-2xl font-bold uppercase">{admin ? 'Nominados y puntaje' : 'Nominados de esta temporada'}</h3>
        {list.isLoading ? (
          <Spinner />
        ) : list.error ? (
          <p className="text-sm text-loss">{(list.error as Error).message}</p>
        ) : (list.data ?? []).length === 0 ? (
          <p className="card p-4 text-sm text-muted">Los nominados aparecen en cuanto se jueguen los primeros partidos.</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {list.data!.map((r, i) => {
              const t = byId.get(r.team_id);
              const pl = players.get(r.player_id);
              const goalie = pl?.position === 'G';
              const won = [
                ...r.titles.map((c) => ({ icon: '🏆', text: `Campeón · ${c}`, cls: 'border-yellow-400/50 bg-yellow-400/10 text-yellow-200' })),
                ...r.finals.map((c) => ({ icon: '🥈', text: `Subcampeón · ${c}`, cls: 'border-slate-300/40 bg-slate-300/10 text-slate-200' })),
                ...r.semis.map((c) => ({ icon: '⭐', text: `Semifinal · ${c}`, cls: 'border-line bg-surface-2 text-muted' })),
                ...r.awards.map((c) => ({ icon: '🎖️', text: c, cls: 'border-purple-400/40 bg-purple-400/10 text-purple-200' })),
              ];
              return (
                <motion.li
                  key={r.player_id}
                  initial={reduce ? false : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i, 9) * 0.04 }}
                  className="card relative overflow-hidden p-4"
                  style={t ? { boxShadow: `inset 4px 0 0 ${t.primary_color}` } : undefined}
                >
                  <div className="flex items-start gap-3">
                    {admin && <span className={cn('w-7 pt-1 text-center font-display text-2xl font-extrabold tabular', i < 3 ? 'text-yellow-300' : 'text-muted')}>{i + 1}</span>}
                    {t && <Crest team={t} size={48} />}
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-display text-2xl font-bold uppercase leading-tight">{pl ? `${pl.first_name} ${pl.last_name}` : 'Jugador'}</div>
                      <div className="text-sm text-muted">
                        {t ? (
                          <Link to={`/equipos/${t.key}`} className="hover:text-fg">
                            {t.name}
                          </Link>
                        ) : null}
                        {pl ? ` · ${posLabel(pl.position)} #${pl.number} · ${pl.age} años` : ''}
                      </div>
                    </div>
                    {admin && <span className="font-display text-2xl font-bold tabular text-yellow-200">{Number(r.score ?? 0).toFixed(0)}</span>}
                  </div>

                  <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                    {(goalie
                      ? [
                          ['PJ', r.gp],
                          ['En cero', r.shutouts],
                          ['% atajadas', r.save_pct != null ? `${(Number(r.save_pct) * 100).toFixed(1)}` : '—'],
                          ['MVP', r.mvps],
                        ]
                      : [
                          ['Goles', r.goals],
                          ['Asist.', r.assists],
                          ['MVP', r.mvps],
                          ['PJ', r.gp],
                        ]
                    ).map(([label, v]) => (
                      <div key={label as string} className="rounded-xl bg-surface-2 py-2">
                        <div className="font-display text-xl font-bold tabular">{v}</div>
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</div>
                      </div>
                    ))}
                  </div>

                  {!goalie && r.team_share != null && Number(r.team_share) >= 0.12 && (
                    <div className="mt-2 text-xs text-secondary">Pieza clave: {Math.round(Number(r.team_share) * 100)}% de los goles y asistencias de su equipo en una competición</div>
                  )}

                  <div className="mt-3">
                    <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-muted">Lo que ganó</div>
                    {won.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {won.map((w) => (
                          <span key={w.text} className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium', w.cls)}>
                            <span aria-hidden>{w.icon}</span> {w.text}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-muted">Sin títulos esta temporada: entra por sus números.</span>
                    )}
                  </div>

                  {admin && (
                    <>
                      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
                        <motion.div className="h-full rounded-full bg-gradient-to-r from-yellow-600 to-yellow-300" initial={false} animate={{ width: `${(Number(r.score ?? 0) / max) * 100}%` }} />
                      </div>
                      <div className="mt-3 flex justify-end">
                        <Button size="sm" variant={i === 0 ? 'primary' : 'outline'} disabled={!!busyId} onClick={() => onPick!(r.player_id)}>
                          {busyId === r.player_id ? 'Entregando…' : 'Darle el Balón de Oro'}
                        </Button>
                      </div>
                    </>
                  )}
                </motion.li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
