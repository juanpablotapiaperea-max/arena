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

function usePlayerNames() {
  const all = usePlayers();
  return useMemo(() => new Map((all.data ?? []).map((p) => [p.id, { name: `${p.first_name} ${p.last_name}`, number: p.number, position: p.position, team: p.team_id }])), [all.data]);
}

/** Vitrina, placas y premios de un equipo. */
export function TeamHallOfFame({ team }: { team: Team }) {
  const reduce = useReducedMotion();
  const names = usePlayerNames();
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
        <Plaque icon={Goal} title="Máximo goleador" stat={topGoals?.goals} unit="goles" player={topGoals && names.get(topGoals.player_id)} team={team} />
        <Plaque icon={Handshake} title="Máximo asistidor" stat={topAssists?.assists} unit="asistencias" player={topAssists && names.get(topAssists.player_id)} team={team} />
        <Plaque icon={Star} title="Más veces MVP" stat={topMvp?.mvps} unit="MVP" player={topMvp && names.get(topMvp.player_id)} team={team} />
        <Plaque icon={Award} title="Más partidos" stat={topGp?.gp} unit="partidos" player={topGp && names.get(topGp.player_id)} team={team} />
      </div>
      <p className="text-xs text-muted">Récords con la camiseta del club desde la primera temporada de ARENA (el historial anterior no guardaba estadísticas de jugadores).</p>

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

export interface RaceRow {
  player_id: string;
  team_id: string;
  score: number;
  goals: number;
  assists: number;
  mvps: number;
  titles: number;
  shutouts: number;
}

/** Carrera al Balón de Oro y ganadores. Con `onPick`, el administrador elige al ganador. */
export function BalonOro({ onPick, busyId }: { onPick?: (playerId: string) => void; busyId?: string | null }) {
  const reduce = useReducedMotion();
  const { byId } = useTeams();
  const names = usePlayerNames();
  const race = useQuery({
    queryKey: ['balon-oro-race'],
    enabled: !DEMO_MODE,
    queryFn: async () => ((await db().rpc('balon_oro_race', { p_limit: 10 })).data ?? []) as RaceRow[],
    refetchInterval: 60_000,
  });
  const winners = useQuery({
    queryKey: ['balon-oro-winners'],
    enabled: !DEMO_MODE,
    queryFn: async () => ((await db().from('awards').select('*').eq('kind', 'balon_oro').order('created_at', { ascending: false })).data ?? []) as AwardRow[],
  });
  const max = Math.max(1, ...(race.data ?? []).map((r) => Number(r.score)));

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
            <p className="mt-1 max-w-xl text-sm text-yellow-100/70">
              Los 10 nominados salen de la temporada completa (goles, asistencias, MVP de partido, goles del triunfo, porterías en cero y títulos, con más peso en los torneos grandes). El ganador lo elige la organización.
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
              return (
                <li key={w.id} className="flex items-center gap-3 rounded-xl border border-yellow-400/30 bg-yellow-400/5 p-3">
                  {t && <Crest team={t} size={36} />}
                  <span className="min-w-0">
                    <span className="block truncate font-display text-lg font-bold uppercase">{w.player_id ? names.get(w.player_id)?.name : '—'}</span>
                    <span className="block text-xs text-muted">{w.label.replace('Balón de Oro · ', '')}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="card overflow-hidden p-0">
        <h3 className="border-b border-line px-4 py-3 font-semibold">Carrera de esta temporada</h3>
        {race.isLoading ? (
          <div className="p-4">
            <Spinner />
          </div>
        ) : (race.data ?? []).length === 0 ? (
          <p className="p-4 text-sm text-muted">La carrera empieza en cuanto se jueguen los primeros partidos.</p>
        ) : (
          <ol>
            {race.data!.map((r, i) => {
              const t = byId.get(r.team_id);
              const p = names.get(r.player_id);
              return (
                <motion.li
                  key={r.player_id}
                  layout={!reduce}
                  className={cn('flex flex-wrap items-center gap-3 border-b border-line/50 px-4 py-3 last:border-0', i === 0 && 'bg-yellow-400/5')}
                >
                  <span className={cn('w-7 text-center font-display text-2xl font-extrabold tabular', i < 3 ? 'text-yellow-300' : 'text-muted')}>{i + 1}</span>
                  {t && <Crest team={t} size={34} />}
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{p?.name ?? 'Jugador'}</div>
                    <div className="text-xs text-muted">
                      <Link to={t ? `/equipos/${t.key}` : '#'} className="hover:text-fg">
                        {t?.name}
                      </Link>{' '}
                      · {r.goals} G · {r.assists} A · {r.mvps} MVP{r.titles ? ` · ${r.titles} 🏆` : ''}
                      {r.shutouts ? ` · ${r.shutouts} en cero` : ''}
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                      <motion.div className="h-full rounded-full bg-gradient-to-r from-yellow-600 to-yellow-300" initial={false} animate={{ width: `${(Number(r.score) / max) * 100}%` }} />
                    </div>
                  </div>
                  <span className="font-display text-xl font-bold tabular text-yellow-200">{Number(r.score).toFixed(0)}</span>
                  {onPick && (
                    <Button size="sm" variant={i === 0 ? 'primary' : 'outline'} disabled={!!busyId} onClick={() => onPick(r.player_id)}>
                      {busyId === r.player_id ? 'Entregando…' : 'Darle el Balón de Oro'}
                    </Button>
                  )}
                </motion.li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
