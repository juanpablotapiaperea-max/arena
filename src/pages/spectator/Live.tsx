// En vivo: el evento principal reproducido desde su línea de tiempo con el
// reloj del servidor. Todos ven lo mismo al mismo tiempo; quien llega tarde se
// une en el minuto actual.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import confetti from 'canvas-confetti';
import { ArrowLeft, MessageCircle, Radio, Send, Shield, Siren, Target } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useTeams } from '@/lib/hooks';
import { useRealtime } from '@/lib/realtime';
import { playCue, useA11y, vibrate } from '@/lib/a11y';
import { DEMO_MODE, supabase, db } from '@/lib/supabase';
import {
  getChat,
  getCurrentDay,
  getDayItems,
  getLiveFeed,
  getLiveMatches,
  getMatchBox,
  getMatchesByIds,
  getPublicProfiles,
  getTeamStats,
  type Match,
  type TimelineEvent,
} from '@/lib/engine';
import type { Team } from '@/lib/types';
import { Crest } from '@/components/Crest';
import { Badge, Button, SectionTitle, Spinner, cn } from '@/components/ui';
import { Countdown, EmptyState, LiveBadge, Score, fmtTime, useNow } from '@/components/game';
import { textOn } from '@/lib/theme';


export function LiveIndexPage() {
  const live = useQuery({ queryKey: ['live-matches'], queryFn: getLiveMatches, refetchInterval: 10_000 });
  const day = useQuery({ queryKey: ['current-day'], queryFn: getCurrentDay });
  const items = useQuery({ queryKey: ['day-items', day.data?.id], queryFn: () => getDayItems(day.data!.id), enabled: !!day.data });
  const doneEvents = (items.data ?? []).filter((i) => i.kind === 'event' && i.status === 'done' && i.match_id);
  const finished = useQuery({ queryKey: ['done-events', doneEvents.map((d) => d.match_id).join()], queryFn: () => getMatchesByIds(doneEvents.map((d) => d.match_id!)) });
  const { byId } = useTeams();
  useRealtime('matches', [['live-matches']], 'status=eq.live');
  const next = (items.data ?? []).find((i) => i.kind === 'event' && i.status === 'pending');

  if (live.isLoading) return <Spinner />;
  return (
    <div className="space-y-6">
      <SectionTitle>En vivo</SectionTitle>
      {(live.data ?? []).length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {live.data!.map((m) => (
            <LiveTile key={m.id} m={m} home={byId.get(m.home_team_id)} away={byId.get(m.away_team_id)} />
          ))}
        </div>
      ) : (
        <EmptyState icon={<Radio className="text-live" size={30} />} title="Nada al aire ahora">
          {next ? (
            <>
              El siguiente evento es <b>{next.label}</b> en <Countdown to={next.scheduled_at} className="font-semibold text-fg" />.
            </>
          ) : (
            'Los derbis, cuartos, semifinales y finales se transmiten aquí en vivo durante el día de competencia.'
          )}
        </EmptyState>
      )}
      {(finished.data ?? []).length > 0 && (
        <section>
          <SectionTitle>Repeticiones de hoy</SectionTitle>
          <div className="grid gap-2 sm:grid-cols-2">
            {finished.data!.map((m) => (
              <Link key={m.id} to={`/en-vivo/${m.id}`} className="focus-ring card flex items-center gap-3 p-3 hover:border-primary/60">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold uppercase text-secondary">{m.event_name}</div>
                  <div className="truncate text-sm font-medium">
                    {byId.get(m.home_team_id)?.name} {m.home_score}-{m.away_score} {byId.get(m.away_team_id)?.name}
                  </div>
                </div>
                <Badge>Final</Badge>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function LiveTile({ m, home, away }: { m: Match; home?: Team; away?: Team }) {
  return (
    <Link to={`/en-vivo/${m.id}`} className="focus-ring card block overflow-hidden p-0 transition hover:-translate-y-0.5">
      <div className="h-1.5" style={{ background: `linear-gradient(90deg, ${home?.primary_color}, ${away?.primary_color})` }} />
      <div className="flex items-center gap-3 p-4">
        {home && <Crest team={home} size={44} />}
        <div className="min-w-0 flex-1 text-center">
          <LiveBadge />
          <div className="mt-1 truncate font-display text-lg font-bold uppercase">
            {home?.short_name} vs {away?.short_name}
          </div>
          <div className="truncate text-xs text-muted">{m.event_name}</div>
        </div>
        {away && <Crest team={away} size={44} />}
      </div>
    </Link>
  );
}

/** Reloj de juego: cada periodo real (100 s) se muestra como 20:00 de hockey. */
function gameClock(elapsed: number, duration: number, PERIOD: number) {
  if (elapsed >= duration) return { period: 'Final', clock: '0:00' };
  const p = Math.floor(elapsed / PERIOD);
  if (p >= 3) {
    const left = Math.max(0, duration - elapsed);
    const s = Math.round((left / Math.max(1, duration - 3 * PERIOD)) * 300);
    return { period: 'TE', clock: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` };
  }
  const left = Math.round(((PERIOD - (elapsed - p * PERIOD)) / PERIOD) * 1200);
  return { period: `${p + 1}.º`, clock: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` };
}

export function LiveMatchPage() {
  const { id } = useParams();
  const { profile } = useAuth();
  const { byId } = useTeams();
  const { prefs, say } = useA11y();
  const reduce = useReducedMotion();
  const match = useQuery({ queryKey: ['match', id], queryFn: () => getMatchesByIds([id!]).then((r) => r[0]), refetchInterval: 20_000 });
  const feed = useQuery({ queryKey: ['live-feed', id], queryFn: () => getLiveFeed(id!), refetchInterval: (q) => (q.state.data?.status === 'finished' ? false : 4000) });
  const now = useNow(250);
  const [offset, setOffset] = useState(0);
  const [goalFlash, setGoalFlash] = useState<{ side: 'home' | 'away'; name?: string } | null>(null);
  const seenGoals = useRef<number>(-1);

  // Diferencia entre el reloj local y el del servidor.
  useEffect(() => {
    if (feed.data?.server_now) setOffset(Date.parse(feed.data.server_now) - Date.now());
  }, [feed.data?.server_now]);

  const m = match.data;
  const home = m ? byId.get(m.home_team_id) : undefined;
  const away = m ? byId.get(m.away_team_id) : undefined;
  const period = feed.data?.period_seconds ?? 100;
  const duration = feed.data?.duration ?? 3 * period;
  const finished = feed.data?.status === 'finished' || m?.status === 'finished';
  const started = feed.data?.started_at ? Date.parse(feed.data.started_at) : null;
  const elapsed = finished ? duration : started ? Math.max(0, (now + offset - started) / 1000) : 0;
  // Mientras se juega no se revela cuál gol será el del triunfo.
  const events = useMemo(
    () =>
      (feed.data?.events ?? [])
        .filter((e) => finished || e.second <= elapsed)
        .map((e) => (finished || !e.data?.gameWinning ? e : { ...e, data: { ...e.data, gameWinning: undefined } })),
    [feed.data, elapsed, finished],
  );
  const goals = events.filter((e) => e.type === 'goal');
  const last = goals[goals.length - 1];
  const score: [number, number] = last?.data?.score ?? [0, 0];
  const { period: periodLabel, clock } = gameClock(elapsed, duration, period);
  const shots = { home: events.filter((e) => (e.type === 'shot' || e.type === 'goal') && e.side === 'home').length, away: events.filter((e) => (e.type === 'shot' || e.type === 'goal') && e.side === 'away').length };
  const pens = { home: events.filter((e) => e.type === 'penalty' && e.side === 'home').length, away: events.filter((e) => e.type === 'penalty' && e.side === 'away').length };

  // Animación y avisos de gol.
  useEffect(() => {
    if (seenGoals.current === -1) {
      seenGoals.current = goals.length;
      return;
    }
    if (goals.length > seenGoals.current) {
      const g = goals[goals.length - 1];
      seenGoals.current = goals.length;
      const team = g.side === 'home' ? home : away;
      setGoalFlash({ side: g.side!, name: g.player?.name });
      setTimeout(() => setGoalFlash(null), 2600);
      say(`¡Gol de ${team?.name}! ${g.player?.name ?? ''}. ${g.data?.score?.join(' a ')}`, true);
      const isStar = profile?.star_team_id && team?.id === profile.star_team_id;
      if (prefs.sound) playCue('goal');
      if (isStar && prefs.haptics) vibrate([80, 40, 160]);
      if (isStar && !prefs.reduceMotion && !reduce) confetti({ particleCount: 90, spread: 70, origin: { y: 0.35 }, colors: [team!.primary_color, team!.secondary_color] });
    }
  }, [goals.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (finished && m && !prefs.reduceMotion && m.is_final && seenGoals.current >= 0) {
      const w = (m.home_score ?? 0) > (m.away_score ?? 0) ? home : away;
      if (w) confetti({ particleCount: 160, spread: 100, origin: { y: 0.3 }, colors: [w.primary_color, w.secondary_color, '#ffd700'] });
    }
  }, [finished]); // eslint-disable-line react-hooks/exhaustive-deps

  if (match.isLoading || feed.isLoading) return <Spinner label="Conectando con la transmisión…" />;
  if (!m || !home || !away) return <EmptyState title="Partido no encontrado" />;
  if (!feed.data || (!started && !finished)) {
    return (
      <div className="space-y-4">
        <BackLink />
        <EmptyState title={m.event_name ?? 'Evento principal'}>
          {m.scheduled_at ? (
            <>
              La transmisión empieza en <Countdown to={m.scheduled_at} className="font-semibold text-fg" />.
            </>
          ) : (
            'Este partido aún no tiene horario.'
          )}
        </EmptyState>
      </div>
    );
  }

  const progress = Math.min(1, elapsed / duration);
  return (
    <div className="space-y-4">
      <BackLink />

      {/* Marcador */}
      <section
        aria-label="Marcador"
        className="relative overflow-hidden rounded-3xl border border-line"
        style={{ background: `linear-gradient(115deg, ${home.primary_color} 0%, ${home.primary_color}aa 30%, rgb(var(--surface)) 50%, ${away.primary_color}aa 70%, ${away.primary_color} 100%)` }}
      >
        <div className="flex items-center justify-between gap-2 bg-black/30 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-white">
          <span className="truncate">{m.event_name}</span>
          {finished ? <span>{m.overtime ? 'Final · tiempo extra' : 'Final'}</span> : <LiveBadge />}
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-5 sm:px-8">
          <TeamSide team={home} align="left" />
          <div className="text-center">
            <div className="flex items-center justify-center gap-3 text-white drop-shadow-lg">
              <Score value={score[0]} className="text-6xl sm:text-7xl" />
              <span className="font-display text-4xl opacity-60">:</span>
              <Score value={score[1]} className="text-6xl sm:text-7xl" />
            </div>
            <div className="mt-1 inline-flex items-center gap-2 rounded-full bg-black/40 px-3 py-1 font-display text-lg font-bold tabular text-white">
              <span>{periodLabel}</span>
              <span className="opacity-60">|</span>
              <span aria-label={`Reloj ${clock}`}>{clock}</span>
            </div>
          </div>
          <TeamSide team={away} align="right" />
        </div>
        <div className="h-1 bg-black/30" aria-hidden>
          <div className="h-full bg-white/80 transition-[width] duration-500" style={{ width: `${progress * 100}%` }} />
        </div>
        <AnimatePresence>
          {goalFlash && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/50">
              <div className="goal-flash text-center">
                <div className="font-display text-7xl font-extrabold uppercase tracking-widest text-white drop-shadow-[0_0_30px_rgba(255,255,255,0.6)] sm:text-8xl">¡Gol!</div>
                <div className="mt-1 text-lg font-semibold text-white">{goalFlash.name}</div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      <Reactions matchId={m.id} />

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <section className="card p-4" aria-label="Estadísticas en vivo">
            <h2 className="mb-3 font-display text-xl font-bold uppercase">Estadísticas</h2>
            <StatBar label="Tiros" home={shots.home} away={shots.away} hc={home.primary_color} ac={away.primary_color} />
            <StatBar label="Goles" home={score[0]} away={score[1]} hc={home.primary_color} ac={away.primary_color} />
            <StatBar label="Penalizaciones" home={pens.home} away={pens.away} hc={home.primary_color} ac={away.primary_color} />
            <PeriodTable events={events} home={home} away={away} />
          </section>
          <PlayByPlay events={events} home={home} away={away} />
          {finished && <BoxScore matchId={m.id} home={home} away={away} />}
        </div>
        <Chat channel={`match:${m.id}`} />
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/en-vivo" className="focus-ring inline-flex items-center gap-1 rounded text-sm text-muted hover:text-fg">
      <ArrowLeft size={16} /> En vivo
    </Link>
  );
}

function TeamSide({ team, align }: { team: Team; align: 'left' | 'right' }) {
  return (
    <div className={cn('flex min-w-0 flex-col items-center gap-2', align === 'left' ? 'sm:items-start' : 'sm:items-end')}>
      <Crest team={team} size={64} />
      <span className="max-w-full truncate rounded-lg px-2 py-0.5 font-display text-lg font-bold uppercase sm:text-2xl" style={{ background: team.primary_color, color: textOn(team.primary_color) }}>
        {team.short_name}
      </span>
    </div>
  );
}

function StatBar({ label, home, away, hc, ac }: { label: string; home: number; away: number; hc: string; ac: string }) {
  const total = home + away || 1;
  return (
    <div className="mb-3">
      <div className="mb-1 flex justify-between text-sm">
        <b className="tabular">{home}</b>
        <span className="text-xs uppercase tracking-wider text-muted">{label}</span>
        <b className="tabular">{away}</b>
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <div style={{ width: `${(home / total) * 100}%`, background: hc }} className="transition-all duration-500" />
        <div style={{ width: `${(away / total) * 100}%`, background: ac }} className="ml-auto transition-all duration-500" />
      </div>
    </div>
  );
}

function PeriodTable({ events, home, away }: { events: TimelineEvent[]; home: Team; away: Team }) {
  const g = (side: 'home' | 'away', p: number) => events.filter((e) => e.type === 'goal' && e.side === side && e.period === p).length;
  const hasOt = events.some((e) => e.period === 4);
  const periods = hasOt ? [1, 2, 3, 4] : [1, 2, 3];
  return (
    <table className="mt-2 w-full text-sm">
      <caption className="sr-only">Goles por periodo</caption>
      <thead className="text-[11px] uppercase text-muted">
        <tr>
          <th className="text-left font-semibold">Equipo</th>
          {periods.map((p) => (
            <th key={p} className="w-10 text-center font-semibold">
              {p === 4 ? 'TE' : p}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {([['home', home], ['away', away]] as const).map(([side, t]) => (
          <tr key={side}>
            <td className="py-1 font-medium">{t.short_name}</td>
            {periods.map((p) => (
              <td key={p} className="text-center font-display text-lg tabular">
                {g(side, p)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PlayByPlay({ events, home, away }: { events: TimelineEvent[]; home: Team; away: Team }) {
  const shown = events.filter((e) => e.type === 'goal' || e.type === 'penalty' || e.type === 'period_start' || e.type === 'overtime_start' || e.type === 'final').reverse();
  const reduce = useReducedMotion();
  return (
    <section className="card p-4" aria-label="Jugada a jugada">
      <h2 className="mb-3 font-display text-xl font-bold uppercase">Jugada a jugada</h2>
      <ol className="space-y-2" aria-live="off">
        <AnimatePresence initial={false}>
          {shown.map((e, i) => {
            const t = e.side === 'home' ? home : e.side === 'away' ? away : undefined;
            return (
              <motion.li key={`${e.second}-${e.type}-${i}`} initial={reduce ? false : { opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="flex items-start gap-3">
                <span className="w-12 shrink-0 pt-0.5 text-xs font-semibold tabular text-muted">{e.period === 4 ? 'TE' : e.period ? `${e.period}.º` : ''}</span>
                {e.type === 'goal' ? (
                  <div className="flex flex-1 items-start gap-2 rounded-xl p-2" style={{ background: `${t?.primary_color}22` }}>
                    <Target size={16} className="mt-0.5 shrink-0" style={{ color: t?.primary_color }} aria-hidden />
                    <div className="min-w-0">
                      <div className="font-semibold">
                        Gol de {t?.name} · {e.data?.score?.join('-')}
                        {e.data?.powerPlay && <span className="ml-1 text-xs text-secondary">(power play)</span>}
                        {e.data?.gameWinning && <span className="ml-1 text-xs text-secondary">· gol del triunfo</span>}
                      </div>
                      <div className="text-sm text-muted">
                        {e.player?.number ? `#${e.player.number} ` : ''}
                        {e.player?.name}
                        {e.assists?.length ? ` · asistencias: ${e.assists.join(', ')}` : ' · sin asistencia'}
                      </div>
                    </div>
                  </div>
                ) : e.type === 'penalty' ? (
                  <div className="flex flex-1 items-center gap-2 text-sm">
                    <Siren size={14} className="shrink-0 text-secondary" aria-hidden />
                    Penalización a {e.player?.name ?? 'un jugador'} ({t?.short_name}) · 2 min
                  </div>
                ) : (
                  <div className="flex flex-1 items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted">
                    <Shield size={14} aria-hidden />
                    {e.type === 'final' ? 'Final del partido' : e.type === 'overtime_start' ? 'Tiempo extra · gol de oro' : `Inicia el ${e.period}.º periodo`}
                  </div>
                )}
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ol>
    </section>
  );
}

function BoxScore({ matchId, home, away }: { matchId: string; home: Team; away: Team }) {
  const box = useQuery({ queryKey: ['box', matchId], queryFn: () => getMatchBox(matchId) });
  const stats = useQuery({ queryKey: ['team-stats', matchId], queryFn: () => getTeamStats(matchId) });
  if (!box.data) return null;
  const sides = [
    ['home', home],
    ['away', away],
  ] as const;
  return (
    <section className="card p-4">
      <h2 className="mb-3 font-display text-xl font-bold uppercase">Box score</h2>
      {stats.data && (
        <div className="mb-4 grid grid-cols-2 gap-2 text-sm">
          {sides.map(([side, t]) => {
            const s = stats.data!.find((x) => x.is_home === (side === 'home'));
            return (
              <div key={side} className="rounded-xl bg-surface-2 p-3">
                <div className="mb-1 font-semibold">{t.name}</div>
                <div className="text-muted">
                  Tiros {s?.shots} · Atajadas {s?.saves} · PP {s?.power_play_goals}/{s?.power_plays}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {sides.map(([side, t]) => (
        <div key={side} className="mb-4 overflow-x-auto">
          <h3 className="mb-1 text-sm font-semibold">{t.name}</h3>
          <table className="w-full min-w-[420px] text-sm">
            <thead className="text-[11px] uppercase text-muted">
              <tr className="border-b border-line">
                <th className="py-1 text-left">Jugador</th>
                <th className="text-right">G</th>
                <th className="text-right">A</th>
                <th className="text-right">+/-</th>
                <th className="text-right">T</th>
                <th className="text-right">Ataj.</th>
              </tr>
            </thead>
            <tbody>
              {box.data!.players
                .filter((p) => p.side === side && (p.goals || p.assists || p.isGoalie || p.isMvp || p.shots >= 3))
                .sort((a, b) => b.goals * 3 + b.assists * 2 - (a.goals * 3 + a.assists * 2))
                .map((p) => (
                  <tr key={p.playerId} className="border-b border-line/40">
                    <td className="py-1">
                      {p.number ? <span className="mr-1 text-muted">#{p.number}</span> : null}
                      {p.name}
                      {p.isMvp && <Badge tone="primary">MVP</Badge>}
                    </td>
                    <td className="text-right tabular">{p.goals}</td>
                    <td className="text-right tabular">{p.assists}</td>
                    <td className="text-right tabular">{p.plusMinus}</td>
                    <td className="text-right tabular">{p.shots}</td>
                    <td className="text-right tabular">{p.isGoalie ? p.saves : ''}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}

const REACTIONS = ['🔥', '👏', '😱', '🏒', '😤', '🎉'];

/** Reacciones rápidas: efímeras, por el canal de tiempo real (no se guardan). */
function Reactions({ matchId }: { matchId: string }) {
  const [floating, setFloating] = useState<{ id: number; e: string; x: number }[]>([]);
  const reduce = useReducedMotion();
  const channel = useRef<ReturnType<NonNullable<typeof supabase>['channel']> | null>(null);
  useEffect(() => {
    if (DEMO_MODE || !supabase) return;
    const ch = supabase.channel(`reactions:${matchId}`, { config: { broadcast: { self: true } } });
    ch.on('broadcast', { event: 'react' }, ({ payload }) => {
      const item = { id: Math.random(), e: String(payload.e), x: 10 + Math.random() * 80 };
      setFloating((f) => [...f.slice(-20), item]);
      setTimeout(() => setFloating((f) => f.filter((x) => x.id !== item.id)), 2200);
    }).subscribe();
    channel.current = ch;
    return () => {
      supabase!.removeChannel(ch);
    };
  }, [matchId]);
  return (
    <div className="relative">
      <div className="flex justify-center gap-2" role="group" aria-label="Reacciones">
        {REACTIONS.map((e) => (
          <button
            key={e}
            onClick={() => channel.current?.send({ type: 'broadcast', event: 'react', payload: { e } })}
            className="focus-ring flex h-11 w-11 items-center justify-center rounded-full bg-surface-2 text-xl transition active:scale-90"
            aria-label={`Reaccionar ${e}`}
          >
            {e}
          </button>
        ))}
      </div>
      {!reduce && (
        <div className="pointer-events-none absolute inset-x-0 bottom-12 h-40 overflow-hidden" aria-hidden>
          <AnimatePresence>
            {floating.map((f) => (
              <motion.span key={f.id} initial={{ y: 140, opacity: 1 }} animate={{ y: -10, opacity: 0 }} exit={{ opacity: 0 }} transition={{ duration: 2, ease: 'easeOut' }} className="absolute text-3xl" style={{ left: `${f.x}%` }}>
                {f.e}
              </motion.span>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

export function Chat({ channel }: { channel: string }) {
  const { profile } = useAuth();
  const msgs = useQuery({ queryKey: ['chat', channel], queryFn: () => getChat(channel) });
  const people = useQuery({ queryKey: ['public-profiles'], queryFn: getPublicProfiles, staleTime: 60_000 });
  const names = new Map((people.data ?? []).map((p) => [p.id, p]));
  useRealtime('chat_messages', [['chat', channel]], `channel=eq.${channel}`);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const muted = profile?.muted_until && Date.parse(profile.muted_until) > Date.now();
  const list = [...(msgs.data ?? [])].reverse();

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [list.length]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || !profile) return;
    setError(null);
    setText('');
    const { error: err } = await db().from('chat_messages').insert({ channel, user_id: profile.id, body: body.slice(0, 300) });
    if (err) setError(muted ? 'Estás silenciado por el administrador.' : 'No se pudo enviar.');
  };

  return (
    <section className="card flex h-[480px] flex-col p-0" aria-label="Chat">
      <h2 className="flex items-center gap-2 border-b border-line px-4 py-3 font-display text-xl font-bold uppercase">
        <MessageCircle size={18} aria-hidden /> Chat
      </h2>
      <ol ref={listRef} className="flex-1 space-y-2 overflow-y-auto p-3" aria-live="polite" aria-relevant="additions">
        {list.length === 0 && <li className="text-center text-sm text-muted">Sé el primero en escribir.</li>}
        {list.map((m) => {
          const p = names.get(m.user_id);
          const mine = m.user_id === profile?.id;
          return (
            <li key={m.id} className={cn('max-w-[85%] rounded-2xl px-3 py-1.5 text-sm', mine ? 'ml-auto bg-primary/20' : 'bg-surface-2')}>
              <div className="text-[11px] font-semibold text-muted">
                {p?.display_name ?? 'Alguien'}
                {p?.role === 'admin' && ' · admin'}
                <span className="ml-1 font-normal">{fmtTime(m.created_at)}</span>
              </div>
              <div className="break-words">{m.body}</div>
            </li>
          );
        })}
      </ol>
      <form onSubmit={send} className="flex gap-2 border-t border-line p-2">
        <label htmlFor={`chat-${channel}`} className="sr-only">
          Mensaje
        </label>
        <input
          id={`chat-${channel}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={300}
          disabled={!!muted}
          placeholder={muted ? 'Estás silenciado' : 'Escribe algo…'}
          className="focus-ring min-h-11 flex-1 rounded-xl border border-line bg-surface-2 px-3 text-sm"
        />
        <Button aria-label="Enviar" disabled={!text.trim() || !!muted}>
          <Send size={16} />
        </Button>
      </form>
      {error && <p className="px-3 pb-2 text-xs text-loss">{error}</p>}
    </section>
  );
}
