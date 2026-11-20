// Centro de mando: el día en curso, su guion y los controles de transmisión.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CalendarRange, CheckCircle2, Clock, FastForward, Pause, Play, Radio, Rewind, Square, Zap } from 'lucide-react';
import { engine, getEditions, getMatchesByIds, type CompetitionDay, type Plan, type ScheduleItem } from '@/lib/engine';
import { usePlayers, useTeams } from '@/lib/hooks';
import { useA11y } from '@/lib/a11y';
import { Badge, Button, Card, ErrorBox, SectionTitle, Spinner, Stat, cn } from '@/components/ui';
import { Countdown, LiveBadge, fmtDate, fmtTime, useNow } from '@/components/game';

export function AdminDashboard() {
  const qc = useQueryClient();
  const { say } = useA11y();
  const status = useQuery({
    queryKey: ['day-status'],
    queryFn: () => engine<{ day: CompetitionDay | null; items: ScheduleItem[] }>('day.status'),
    refetchInterval: 5000,
  });
  const editions = useQuery({ queryKey: ['editions'], queryFn: getEditions });
  const { teams } = useTeams();
  const players = usePlayers();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const day = status.data?.day ?? null;
  const items = status.data?.items ?? [];

  const act = async (label: string, action: string, body: Record<string, unknown>, done: string) => {
    setBusy(label);
    setError(null);
    try {
      await engine(action, body);
      await qc.invalidateQueries();
      say(done);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  const injured = (players.data ?? []).filter((p) => p.injury_days > 0).length;
  const active = (editions.data ?? []).filter((e) => e.status !== 'finished').length;

  return (
    <div className="space-y-6">
      <SectionTitle>Centro de mando</SectionTitle>
      {error ? <ErrorBox error={error} /> : null}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Equipos" value={teams.length} />
        <Stat label="Competiciones activas" value={active} />
        <Stat label="Jugadores" value={players.data?.length ?? '…'} />
        <Stat label="Lesionados" value={injured} />
      </div>

      {status.isLoading ? (
        <Spinner />
      ) : !day ? (
        <Card className="flex flex-col items-center gap-3 p-8 text-center">
          <CalendarRange className="text-primary" size={32} aria-hidden />
          <h3 className="font-display text-2xl font-bold uppercase">Ningún día en curso</h3>
          <p className="max-w-md text-sm text-muted">Arranca las competiciones, planea la semana y pulsa «Iniciar» en el día que quieras jugar.</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Link to="/admin/competiciones">
              <Button variant="outline">Competiciones</Button>
            </Link>
            <Link to="/admin/planificador">
              <Button>Planificador</Button>
            </Link>
          </div>
        </Card>
      ) : (
        <DayControl day={day} items={items} busy={busy} act={act} />
      )}

      <DayQueue current={day} items={items} busy={busy} act={act} />
    </div>
  );
}

/** Fila de días: lo que se juega ahora y lo que sigue, con cuándo arranca cada uno. */
function DayQueue({
  current,
  items,
  busy,
  act,
}: {
  current: CompetitionDay | null;
  items: ScheduleItem[];
  busy: string | null;
  act: (label: string, action: string, body: Record<string, unknown>, done: string) => Promise<void>;
}) {
  const plan = useQuery({ queryKey: ['plan'], queryFn: () => engine<Plan>('plan.get'), refetchInterval: 30_000 });
  const days = (plan.data?.days ?? []).filter((d) => d.status !== 'closed').sort((a, b) => a.date.localeCompare(b.date));
  if (!days.length) return null;
  const today = new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
  const busyDay = current && (current.status === 'running' || current.status === 'paused') ? current : null;
  // Fin estimado del día en curso: su último elemento programado.
  const currentEnd = busyDay && items.length ? items.reduce((m, i) => (i.scheduled_at > m ? i.scheduled_at : m), items[0].scheduled_at) : null;
  const pendingNow = items.filter((i) => i.status === 'pending' || i.status === 'running').length;
  const firstPlanned = days.find((d) => d.status === 'planned');

  return (
    <Card className="space-y-3">
      <h3 className="flex items-center gap-2 font-semibold">
        <CalendarRange size={18} className="text-primary" aria-hidden /> Fila de días
      </h3>
      <p className="text-sm text-muted">Los días se juegan uno tras otro. Cuando termina uno, el siguiente arranca solo (si su fecha ya llegó).</p>
      <ol className="space-y-2">
        {days.map((d, i) => {
          const isCurrent = busyDay?.id === d.id;
          const comps = [...new Set(d.blocks.map((b) => b.label.split(' · ')[0]))];
          const late = d.status === 'planned' && d.date < today;
          const waiting = d.status === 'planned' && d.date <= today;
          const label = isCurrent
            ? d.status === 'paused'
              ? 'En pausa'
              : 'Jugándose ahora'
            : waiting
              ? busyDay
                ? `En espera: arranca solo al terminar el ${fmtDate(busyDay.date).split(',')[0]}${currentEnd && d.id === firstPlanned?.id ? ` (≈ ${fmtTime(currentEnd)})` : ''}`
                : 'Arranca solo en menos de 1 min'
              : `Arranca solo el ${fmtDate(d.date)} a las 8:00`;
          return (
            <li
              key={d.id}
              className={cn(
                'flex flex-wrap items-center gap-3 rounded-xl border p-3',
                isCurrent ? 'border-live/60 bg-live/5' : waiting ? 'border-secondary/50 bg-secondary/5' : 'border-line',
              )}
            >
              <span className="font-display text-2xl font-bold tabular text-muted">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 font-semibold capitalize">
                  {fmtDate(d.date)}
                  {isCurrent && d.status === 'running' && <LiveBadge />}
                  {late && <Badge tone="loss">Atrasado</Badge>}
                  {d.date === today && <Badge tone="primary">Hoy</Badge>}
                </div>
                <div className="text-xs text-muted">
                  {label} · {d.blocks.length} jornadas · {d.matches.toLocaleString('es-MX')} partidos
                  {isCurrent ? ` · faltan ${pendingNow} elementos` : ''}
                </div>
                {comps.length > 0 && <div className="mt-0.5 truncate text-xs text-muted">{comps.join(' · ')}</div>}
              </div>
              {d.status === 'planned' && !busyDay && waiting && (
                <Button size="sm" onClick={() => act('start-now', 'day.start', { dayId: d.id, mode: 'now' }, 'Día iniciado')} disabled={busy !== null}>
                  <Play size={14} /> Arrancar ya
                </Button>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function DayControl({
  day,
  items,
  busy,
  act,
}: {
  day: CompetitionDay;
  items: ScheduleItem[];
  busy: string | null;
  act: (label: string, action: string, body: Record<string, unknown>, done: string) => Promise<void>;
}) {
  const now = useNow(1000);
  const { byId } = useTeams();
  const done = items.filter((i) => i.status === 'done');
  const pending = items.filter((i) => i.status === 'pending');
  const runningEvent = items.find((i) => i.status === 'running');
  const next = pending[0];
  const totalMatches = done.reduce((s, i) => s + (i.result?.matches ?? 0), 0);
  const liveMatch = useQuery({
    queryKey: ['admin-live', runningEvent?.match_id],
    enabled: !!runningEvent?.match_id,
    queryFn: () => getMatchesByIds([runningEvent!.match_id!]),
  });
  const lm = liveMatch.data?.[0];
  const [filter, setFilter] = useState<'all' | 'pending' | 'event'>('pending');
  const shown = items.filter((i) => (filter === 'all' ? true : filter === 'pending' ? i.status === 'pending' || i.status === 'running' : i.kind === 'event'));

  return (
    <div className="space-y-4">
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted">Día de competencia</div>
            <div className="font-display text-3xl font-bold uppercase leading-none first-letter:uppercase">{fmtDate(day.date)}</div>
          </div>
          {day.status === 'running' ? <LiveBadge label="Al aire" /> : day.status === 'paused' ? <Badge tone="loss">En pausa</Badge> : <Badge tone="win">Cerrado</Badge>}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Partidos jugados" value={totalMatches} />
          <Stat label="Pendientes" value={pending.length} />
          <Stat label="Siguiente" value={next ? <Countdown to={next.scheduled_at} className="text-xl" /> : '—'} />
        </div>
        {day.status !== 'closed' && (
          <div className="flex flex-wrap gap-2">
            {day.status === 'running' ? (
              <Button variant="outline" onClick={() => act('pause', 'day.pause', { dayId: day.id }, 'Día en pausa')} disabled={busy !== null}>
                <Pause size={16} /> Pausar
              </Button>
            ) : (
              <Button onClick={() => act('resume', 'day.resume', { dayId: day.id }, 'Día reanudado')} disabled={busy !== null}>
                <Play size={16} /> Reanudar
              </Button>
            )}
            {day.status === 'running' && (
              <Button variant="ghost" onClick={() => act('compact', 'day.compact', { dayId: day.id }, 'Día reacomodado')} disabled={busy !== null} title="Junta todo lo pendiente desde ahora, sin huecos">
                <Zap size={16} /> Quitar huecos
              </Button>
            )}
            <Button variant="ghost" onClick={() => act('tick', 'tick', {}, 'Ejecutado')} disabled={busy !== null} title="Ejecuta ya lo que toque sin esperar al siguiente minuto">
              <Zap size={16} /> Ejecutar ahora
            </Button>
            <Button variant="danger" onClick={() => act('close', 'day.close', { dayId: day.id }, 'Día cerrado')} disabled={busy !== null}>
              <Square size={16} /> Cerrar día
            </Button>
          </div>
        )}
      </Card>

      {runningEvent && (
        <Card className="border-live/50">
          <div className="mb-2 flex items-center gap-2">
            <LiveBadge />
            <span className="font-semibold">{runningEvent.label}</span>
          </div>
          {lm && (
            <div className="flex items-center justify-between gap-2 text-sm">
              <span>
                {byId.get(lm.home_team_id)?.name} vs {byId.get(lm.away_team_id)?.name}
              </span>
              <span className="text-muted">
                desde {fmtTime(lm.started_at)} · {Math.floor((now - Date.parse(lm.started_at ?? '')) / 60000)} min
              </span>
            </div>
          )}
          <Link to={lm ? `/en-vivo/${lm.id}` : '/en-vivo'} className="focus-ring mt-2 inline-block rounded text-sm font-semibold text-primary">
            Ver como espectador →
          </Link>
        </Card>
      )}

      <Card className="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <h3 className="flex-1 font-semibold">Guion del día</h3>
          <div className="flex gap-1 rounded-xl bg-surface-2 p-1" role="tablist">
            {(
              [
                ['pending', 'Pendiente'],
                ['event', 'En vivo'],
                ['all', 'Todo'],
              ] as const
            ).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)} className={cn('focus-ring min-h-8 rounded-lg px-2.5 text-xs font-medium', filter === k ? 'bg-primary text-bg' : 'text-muted')}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <ol className="divide-y divide-line/60">
          {shown.map((it) => (
            <li key={it.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <span className="w-14 text-sm font-semibold tabular">{fmtTime(it.scheduled_at)}</span>
              <span className="text-muted" aria-hidden>
                {it.kind === 'event' ? <Radio size={16} className="text-live" /> : it.kind === 'summary' ? <CheckCircle2 size={16} /> : <Clock size={16} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{it.label}</div>
                <div className="text-xs text-muted">
                  {it.kind === 'burst' ? `Ráfaga de ${it.burst_size} partidos` : it.kind === 'event' ? 'Evento en vivo · 5 min' : 'Resumen y cierre'}
                  {it.status === 'done' && it.result?.matches !== undefined ? ` · ${it.result.matches} jugados` : ''}
                </div>
              </div>
              {it.status === 'pending' ? (
                <div className="flex gap-1">
                  <MiniBtn label="Adelantar 5 min" onClick={() => act(`s-${it.id}`, 'item.shift', { itemId: it.id, minutes: -5 }, 'Adelantado')}>
                    <Rewind size={14} />
                  </MiniBtn>
                  <MiniBtn label="Atrasar 5 min" onClick={() => act(`s+${it.id}`, 'item.shift', { itemId: it.id, minutes: 5 }, 'Atrasado')}>
                    <FastForward size={14} />
                  </MiniBtn>
                  <MiniBtn label="Forzar ahora" onClick={() => act(`f${it.id}`, 'item.force', { itemId: it.id }, 'Ejecutado')}>
                    <Zap size={14} />
                  </MiniBtn>
                  <MiniBtn label="Cancelar" onClick={() => act(`c${it.id}`, 'item.cancel', { itemId: it.id }, 'Cancelado')}>
                    <Ban size={14} />
                  </MiniBtn>
                </div>
              ) : (
                <Badge tone={it.status === 'done' ? 'win' : it.status === 'running' ? 'live' : 'neutral'}>{it.status === 'done' ? 'Hecho' : it.status === 'running' ? 'En vivo' : 'Cancelado'}</Badge>
              )}
            </li>
          ))}
          {!shown.length && <li className="p-6 text-center text-sm text-muted">Nada por aquí.</li>}
        </ol>
      </Card>
    </div>
  );
}

function MiniBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={label} aria-label={label} className="focus-ring flex h-9 w-9 items-center justify-center rounded-lg border border-line text-muted hover:bg-surface-2 hover:text-fg">
      {children}
    </button>
  );
}
