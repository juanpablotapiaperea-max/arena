// Componentes del juego: marcadores, tarjetas de partido, tablas con
// movimiento, forma reciente, cuenta regresiva y nombres de equipo.
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowDown, ArrowUp, Minus, Radio } from 'lucide-react';
import type { Team } from '@/lib/types';
import { useQuery } from '@tanstack/react-query';
import { getEditions, type Match, type Standing } from '@/lib/engine';
import { compColor } from '@/lib/compColors';
import { Crest } from './Crest';
import { cn } from './ui';

export const fmtTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '—';
export const fmtDate = (iso: string) =>
  new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
export const fmtShortDate = (iso: string) =>
  new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' });
export const pct = (x: number) => (x >= 0.995 ? '>99%' : x > 0 && x < 0.005 ? '<1%' : `${Math.round(x * 100)}%`);

/** Reloj que avanza cada segundo. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function Countdown({ to, className }: { to: string; className?: string }) {
  const now = useNow();
  const diff = Math.max(0, Date.parse(to) - now);
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1000);
  const label = diff === 0 ? 'ahora' : h ? `${h} h ${m} min` : m ? `${m}:${String(s).padStart(2, '0')}` : `${s} s`;
  return (
    <span className={cn('tabular', className)} aria-label={diff === 0 ? 'empieza ahora' : `empieza en ${h ? `${h} horas ` : ''}${m} minutos`}>
      {label}
    </span>
  );
}

export function TeamName({ team, size = 24, short = false, link = true, className }: { team?: Team; size?: number; short?: boolean; link?: boolean; className?: string }) {
  if (!team) return <span className="text-muted">Por definir</span>;
  const inner = (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
      <Crest team={team} size={size} />
      <span className="truncate">{short ? team.short_name : team.name}</span>
    </span>
  );
  return link ? (
    <Link to={`/equipos/${team.key}`} className="focus-ring min-w-0 rounded hover:text-primary">
      {inner}
    </Link>
  ) : (
    inner
  );
}

export function FormPills({ form }: { form: string }) {
  if (!form) return <span className="text-xs text-muted">—</span>;
  return (
    <span className="inline-flex gap-0.5" aria-label={`Forma: ${[...form].map((c) => (c === 'W' ? 'ganó' : c === 'L' ? 'perdió' : 'empató')).join(', ')}`}>
      {[...form].map((c, i) => (
        <span
          key={i}
          data-r={c}
          className={cn(
            'result-pill inline-flex h-5 min-w-5 items-center justify-center rounded px-0.5 text-[10px] font-bold',
            c === 'W' ? 'bg-win/20 text-win' : c === 'L' ? 'bg-loss/20 text-loss' : 'bg-surface-2 text-muted',
          )}
          aria-hidden
        >
          {c === 'W' ? 'G' : c === 'L' ? 'P' : 'E'}
        </span>
      ))}
    </span>
  );
}

export function Movement({ now, before }: { now: number; before: number | null }) {
  const d = before ? before - now : 0;
  if (!d)
    return (
      <span className="text-muted" aria-label="sin cambio">
        <Minus size={12} />
      </span>
    );
  return d > 0 ? (
    <span className="inline-flex items-center text-win" aria-label={`sube ${d}`}>
      <ArrowUp size={12} />
      <span className="text-[10px] font-bold">{d}</span>
    </span>
  ) : (
    <span className="inline-flex items-center text-loss" aria-label={`baja ${-d}`}>
      <ArrowDown size={12} />
      <span className="text-[10px] font-bold">{-d}</span>
    </span>
  );
}

/** Marcador grande con animación al cambiar. */
export function Score({ value, className }: { value: number | null; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.span
      key={value ?? 'x'}
      initial={reduce ? false : { scale: 1.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 400, damping: 18 }}
      className={cn('inline-block font-display font-extrabold tabular', className)}
    >
      {value ?? '–'}
    </motion.span>
  );
}

export function LiveBadge({ label = 'En vivo' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-live/15 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-live">
      <span className="live-dot h-2 w-2 rounded-full bg-live" aria-hidden />
      {label}
    </span>
  );
}

export function MatchCard({
  m,
  teams,
  compact = false,
  right,
  to,
}: {
  m: Match;
  teams: Map<string, Team>;
  compact?: boolean;
  right?: ReactNode;
  to?: string;
}) {
  const home = teams.get(m.home_team_id);
  const away = teams.get(m.away_team_id);
  const done = m.status === 'finished';
  const hw = done && (m.home_score ?? 0) > (m.away_score ?? 0);
  const aw = done && (m.away_score ?? 0) > (m.home_score ?? 0);
  const body = (
    <div className={cn('card flex items-center gap-3', compact ? 'p-2.5' : 'p-3', m.status === 'live' && 'border-live/60')}>
      <div className="min-w-0 flex-1 space-y-1.5">
        {m.event_name && !compact && <div className="truncate text-[11px] font-semibold uppercase tracking-wider text-secondary">{m.event_name}</div>}
        <Row team={home} score={m.home_score} bold={hw} dim={aw} show={done} />
        <Row team={away} score={m.away_score} bold={aw} dim={hw} show={done} />
      </div>
      <div className="flex w-16 shrink-0 flex-col items-end gap-1 text-right text-xs text-muted">
        {m.status === 'live' ? <LiveBadge /> : done ? <span className="font-semibold">{m.overtime ? 'Final · TE' : 'Final'}</span> : <span className="tabular">{fmtTime(m.scheduled_at)}</span>}
        {right}
      </div>
    </div>
  );
  return to ? (
    <Link to={to} className="focus-ring block rounded-2xl transition hover:-translate-y-0.5">
      {body}
    </Link>
  ) : (
    body
  );
}

function Row({ team, score, bold, dim, show }: { team?: Team; score: number | null; bold: boolean; dim: boolean; show: boolean }) {
  return (
    <div className={cn('flex items-center gap-2', dim && 'opacity-60')}>
      <span className={cn('min-w-0 flex-1 text-sm', bold ? 'font-bold' : 'font-medium')}>
        <TeamName team={team} size={22} link={false} />
      </span>
      {show && <span className={cn('font-display text-xl tabular', bold ? 'font-extrabold' : 'font-semibold')}>{score}</span>}
    </div>
  );
}

type Zone = 'promote' | 'playoff' | 'relegate';
const ZONE_COLOR: Record<Zone, string> = { promote: 'rgb(var(--win))', playoff: 'rgb(var(--team-primary))', relegate: 'rgb(var(--loss))' };
const ZONE_ROW: Record<Zone, string> = { promote: 'bg-win/[0.06]', playoff: 'bg-primary/[0.05]', relegate: 'bg-loss/[0.07]' };
const ZONE_LABEL: Record<Zone, string> = { promote: 'Ascenso', playoff: 'Playoffs', relegate: 'Descenso' };

/** Zona de una posición: ascenso tiene prioridad sobre playoffs; descenso, abajo. */
export function zoneOf(pos: number, n: number, z?: { top?: number; bottom?: number; promote?: number }): Zone | null {
  if (!z) return null;
  if (z.bottom && pos > n - z.bottom) return 'relegate';
  if (z.promote && pos <= z.promote) return 'promote';
  if (z.top && pos <= z.top) return 'playoff';
  return null;
}

export function ZoneLegend({ zones, topLabel }: { zones?: { top?: number; bottom?: number; promote?: number }; topLabel?: string }) {
  const items: [Zone, string][] = [];
  if (zones?.promote) items.push(['promote', `${ZONE_LABEL.promote} (${zones.promote})`]);
  if (zones?.top) items.push(['playoff', `${topLabel ?? ZONE_LABEL.playoff} (${zones.top})`]);
  if (zones?.bottom) items.push(['relegate', `${ZONE_LABEL.relegate} (${zones.bottom})`]);
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap gap-3 px-3 py-2 text-xs text-muted">
      {items.map(([z, label]) => (
        <span key={z} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-1.5 rounded-sm" style={{ background: ZONE_COLOR[z] }} aria-hidden />
          {label}
        </span>
      ))}
    </div>
  );
}

export function StandingsTable({
  rows,
  teams,
  zones,
  probs,
  highlight,
  compact = false,
}: {
  rows: Standing[];
  teams: Map<string, Team>;
  zones?: { top?: number; topLabel?: string; bottom?: number; bottomLabel?: string; promote?: number };
  probs?: Map<string, { champion: number; playoffs: number; relegation: number; promotion: number }>;
  highlight?: Set<string>;
  compact?: boolean;
}) {
  const n = rows.length;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Tabla de posiciones</caption>
        <thead className="text-left text-[11px] uppercase tracking-wider text-muted">
          <tr className="border-b border-line">
            <th className="w-12 px-2 py-2">#</th>
            <th className="px-2 py-2">Equipo</th>
            <th className="px-1 py-2 text-right" title="Partidos jugados">PJ</th>
            {!compact && (
              <>
                <th className="hidden px-1 py-2 text-right sm:table-cell" title="Ganados (incluye tiempo extra)">G</th>
                <th className="hidden px-1 py-2 text-right sm:table-cell" title="Perdidos en tiempo extra">PTE</th>
                <th className="hidden px-1 py-2 text-right sm:table-cell" title="Perdidos">P</th>
                <th className="hidden px-1 py-2 text-right md:table-cell" title="Diferencia de goles">DG</th>
              </>
            )}
            <th className="px-2 py-2 text-right">Pts</th>
            {!compact && <th className="hidden px-2 py-2 md:table-cell">Forma</th>}
            {probs && <th className="hidden px-2 py-2 text-right lg:table-cell" title="Probabilidad de ser campeón">Título</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const t = teams.get(r.team_id);
            const zone = zoneOf(r.position, n, zones);
            return (
              <motion.tr
                layout
                key={r.team_id}
                className={cn('border-b border-line/50 last:border-0', highlight?.has(r.team_id) && 'bg-primary/10', zone && ZONE_ROW[zone])}
              >
                <td className="px-2 py-1.5" style={zone ? { borderLeft: `4px solid ${ZONE_COLOR[zone]}` } : { borderLeft: '4px solid transparent' }}>
                  <span className="flex items-center gap-1">
                    <span className="w-5 text-right font-display text-base font-bold tabular">{r.position}</span>
                    <Movement now={r.position} before={r.prev_position} />
                  </span>
                </td>
                <td className="max-w-0 px-2 py-1.5 font-medium">
                  <TeamName team={t} size={20} short={compact} />
                </td>
                <td className="px-1 py-1.5 text-right tabular text-muted">{r.played}</td>
                {!compact && (
                  <>
                    <td className="hidden px-1 py-1.5 text-right tabular sm:table-cell">{r.wins + r.ot_wins}</td>
                    <td className="hidden px-1 py-1.5 text-right tabular sm:table-cell">{r.ot_losses}</td>
                    <td className="hidden px-1 py-1.5 text-right tabular sm:table-cell">{r.losses}</td>
                    <td className="hidden px-1 py-1.5 text-right tabular md:table-cell">
                      {r.goals_for - r.goals_against > 0 ? '+' : ''}
                      {r.goals_for - r.goals_against}
                    </td>
                  </>
                )}
                <td className="px-2 py-1.5 text-right font-display text-lg font-bold tabular">{r.points}</td>
                {!compact && (
                  <td className="hidden px-2 py-1.5 md:table-cell">
                    <FormPills form={r.form} />
                  </td>
                )}
                {probs && <td className="hidden px-2 py-1.5 text-right tabular text-muted lg:table-cell">{probs.get(r.team_id) ? pct(probs.get(r.team_id)!.champion) : '—'}</td>}
              </motion.tr>
            );
          })}
        </tbody>
      </table>
      {zones && (
        <div className="border-t border-line">
          <ZoneLegend zones={zones} topLabel={zones.topLabel} />
        </div>
      )}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-2 p-8 text-center">
      {icon ?? <Radio className="text-primary" size={28} aria-hidden />}
      <h3 className="font-display text-xl font-bold uppercase">{title}</h3>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}

/** Torneo y fase/jornada de un partido: «OHL · Jornada 52», «Primera División · Cuartos de final · ida». */
export function useMatchContext(m?: Pick<Match, 'edition_id' | 'unit_index' | 'group_label' | 'stage'> | null) {
  const eds = useQuery({ queryKey: ['editions'], queryFn: getEditions, staleTime: 60_000 });
  if (!m) return null;
  const e = eds.data?.find((x) => x.id === m.edition_id);
  if (!e) return null;
  const unit = e.state?.units?.find((u) => u.index === m.unit_index);
  const phase = unit?.label ?? (m.stage === 'playoff' ? 'Eliminatoria' : `Jornada ${m.unit_index + 1}`);
  return {
    competition: e.name.split(' · ')[0],
    phase: m.group_label && m.stage !== 'playoff' ? `${phase} · Grupo ${m.group_label}` : phase,
    color: compColor(e.config.competitionKey),
    playoff: m.stage === 'playoff',
  };
}

export function MatchContextBadge({ m, className }: { m?: Pick<Match, 'edition_id' | 'unit_index' | 'group_label' | 'stage'> | null; className?: string }) {
  const c = useMatchContext(m);
  if (!c) return null;
  return (
    <span className={cn('inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wider', className)} style={{ background: `${c.color}33`, color: c.color }}>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: c.color }} aria-hidden />
      <span className="truncate">
        {c.competition} · {c.phase}
      </span>
    </span>
  );
}
