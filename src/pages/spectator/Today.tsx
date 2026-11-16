// Hoy: el guion del día como una transmisión. Cuenta regresiva a los eventos
// principales, ráfagas de resultados que llegan solas y el bono diario.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { CalendarClock, Coins, Gift, Radio, Star, Trophy } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useTeams } from '@/lib/hooks';
import { useRealtime } from '@/lib/realtime';
import { useA11y } from '@/lib/a11y';
import { db } from '@/lib/supabase';
import { getCurrentDay, getDayItems, getLiveMatches, getNews, type ScheduleItem } from '@/lib/engine';
import { Badge, SectionTitle, Spinner, cn } from '@/components/ui';
import { Countdown, EmptyState, LiveBadge, fmtDate, fmtTime, TeamName } from '@/components/game';
import { Crest } from '@/components/Crest';

export function TodayPage() {
  const { profile, setLocalProfile } = useAuth();
  const { byId } = useTeams();
  const qc = useQueryClient();
  const reduce = useReducedMotion();
  const { say } = useA11y();
  const day = useQuery({ queryKey: ['current-day'], queryFn: getCurrentDay, refetchInterval: 30_000 });
  const items = useQuery({ queryKey: ['day-items', day.data?.id], queryFn: () => getDayItems(day.data!.id), enabled: !!day.data, refetchInterval: 20_000 });
  const live = useQuery({ queryKey: ['live-matches'], queryFn: getLiveMatches, refetchInterval: 15_000 });
  const news = useQuery({ queryKey: ['news', 3], queryFn: () => getNews(3) });
  useRealtime('schedule_items', [['day-items'], ['live-matches']]);
  useRealtime('competition_days', [['current-day']]);
  const [bonus, setBonus] = useState<number | null>(null);

  // Bono por entrar en un día de competencia.
  useEffect(() => {
    if (!profile || profile.role === 'admin' || day.data?.status !== 'running') return;
    db()
      .rpc('claim_daily_bonus')
      .then(({ data }) => {
        const amount = Number(data ?? 0);
        if (amount > 0) {
          setBonus(amount);
          setLocalProfile({ credits: profile.credits + amount });
          say(`Recibiste ${amount} créditos de bono diario`);
          qc.invalidateQueries({ queryKey: ['profile'] });
        }
      });
  }, [day.data?.status, profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const favs = useMemo(() => new Set([...(profile?.favorite_team_ids ?? []), ...(profile?.star_team_id ? [profile.star_team_id] : [])]), [profile]);
  const all = items.data ?? [];
  const events = all.filter((i) => i.kind === 'event');
  const upcoming = events.filter((i) => i.status === 'pending');
  const bursts = all.filter((i) => i.kind === 'burst' && i.status === 'done').reverse();

  if (day.isLoading) return <Spinner />;
  if (!day.data)
    return (
      <div className="space-y-6">
        <SectionTitle>Hoy</SectionTitle>
        <EmptyState icon={<CalendarClock className="text-primary" size={32} />} title="Sin días programados">
          Cuando el administrador publique o inicie un día de competencia, aquí verás el guion completo: eventos en vivo, ráfagas de resultados y tablas.
        </EmptyState>
        <LatestNews news={news.data ?? []} />
      </div>
    );

  const d = day.data;
  return (
    <div className="space-y-6">
      <AnimatePresence>
        {bonus && (
          <motion.div
            initial={reduce ? false : { y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ opacity: 0 }}
            className="card flex items-center gap-3 border-secondary/60 p-3"
            role="status"
          >
            <Gift className="text-secondary" aria-hidden />
            <span className="flex-1 text-sm">
              ¡Bono del día! Recibiste <b className="tabular">{bonus}</b> créditos.
            </span>
            <button className="focus-ring rounded px-2 text-sm text-muted" onClick={() => setBonus(null)}>
              Cerrar
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-muted">{d.status === 'running' ? 'Día de competencia' : d.status === 'paused' ? 'En pausa' : d.status === 'closed' ? 'Último día jugado' : 'Próximo día'}</div>
          <h1 className="font-display text-4xl font-extrabold uppercase leading-none first-letter:uppercase sm:text-5xl">{fmtDate(d.date)}</h1>
        </div>
        {d.status === 'running' ? <LiveBadge label="Al aire" /> : d.status === 'paused' ? <Badge tone="loss">Pausa</Badge> : d.status === 'closed' ? <Badge tone="win">Terminado</Badge> : <Badge tone="primary">Programado</Badge>}
      </header>

      {(live.data ?? []).length > 0 && (
        <section aria-label="En vivo ahora" className="space-y-2">
          {(live.data ?? []).map((m) => {
            const h = byId.get(m.home_team_id);
            const a = byId.get(m.away_team_id);
            return (
              <Link
                key={m.id}
                to={`/en-vivo/${m.id}`}
                className="focus-ring relative block overflow-hidden rounded-3xl border border-live/60 p-4"
                style={{ background: `linear-gradient(110deg, ${h?.primary_color}55, transparent 45%, transparent 55%, ${a?.primary_color}55)` }}
              >
                <div className="mb-2 flex items-center justify-between">
                  <LiveBadge />
                  <span className="text-xs font-semibold uppercase tracking-wider">{m.event_name}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  {h && <Crest team={h} size={52} />}
                  <div className="text-center">
                    <div className="font-display text-xl font-bold uppercase">
                      {h?.short_name} vs {a?.short_name}
                    </div>
                    <div className="text-sm font-semibold text-primary">Toca para ver en vivo →</div>
                  </div>
                  {a && <Crest team={a} size={52} />}
                </div>
              </Link>
            );
          })}
        </section>
      )}

      {upcoming.length > 0 && (
        <section>
          <SectionTitle>Eventos principales</SectionTitle>
          <ol className="grid gap-2 sm:grid-cols-2">
            {upcoming.slice(0, 8).map((e, i) => (
              <li key={e.id} className={cn('card flex items-center gap-3 p-3', i === 0 && 'border-primary/60')}>
                <Radio size={18} className="shrink-0 text-live" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{e.label}</div>
                  <div className="text-xs text-muted">{fmtTime(e.scheduled_at)}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wider text-muted">Empieza en</div>
                  <Countdown to={e.scheduled_at} className="font-display text-xl font-bold" />
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section>
        <SectionTitle right={<span className="text-xs text-muted">Se actualiza solo</span>}>Resultados del día</SectionTitle>
        {items.isLoading ? (
          <Spinner />
        ) : bursts.length === 0 && events.filter((e) => e.status === 'done').length === 0 ? (
          <p className="card p-4 text-sm text-muted">{d.status === 'planned' ? 'El día aún no empieza.' : 'La primera ráfaga de resultados llega en unos minutos.'}</p>
        ) : (
          <div className="space-y-3">
            <AnimatePresence initial={false}>
              {[...bursts, ...events.filter((e) => e.status === 'done')]
                .sort((a, b) => Date.parse(b.scheduled_at) - Date.parse(a.scheduled_at))
                .map((it) => (
                  <motion.div key={it.id} layout initial={reduce ? false : { opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}>
                    <BurstCard item={it} favs={favs} />
                  </motion.div>
                ))}
            </AnimatePresence>
          </div>
        )}
      </section>

      <LatestNews news={news.data ?? []} />
    </div>
  );

  function BurstCard({ item, favs }: { item: ScheduleItem; favs: Set<string> }) {
    const scores = item.result?.scores ?? [];
    return (
      <article className="card p-3">
        <header className="mb-2 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            {item.kind === 'event' ? <Radio size={14} className="text-live" aria-hidden /> : <Trophy size={14} className="text-muted" aria-hidden />}
            {item.label}
          </h3>
          <span className="text-xs text-muted tabular">{fmtTime(item.scheduled_at)}</span>
        </header>
        {scores.length ? (
          <ul className="grid gap-1 sm:grid-cols-2">
            {scores.map((s) => {
              const fav = favs.has(s.h) || favs.has(s.a);
              return (
                <li key={s.id} className={cn('flex items-center gap-2 rounded-lg px-2 py-1 text-sm', fav ? 'bg-primary/10' : 'bg-surface-2/50')}>
                  {fav && <Star size={12} className="shrink-0 text-secondary" aria-label="Tu equipo" fill="currentColor" />}
                  <span className={cn('min-w-0 flex-1 truncate', s.hs > s.as && 'font-bold')}>
                    <TeamName team={byId.get(s.h)} size={18} short link={false} />
                  </span>
                  <span className="font-display text-lg font-bold tabular">
                    {s.hs}-{s.as}
                  </span>
                  <span className={cn('min-w-0 flex-1 truncate text-right', s.as > s.hs && 'font-bold')}>
                    <span className="inline-flex flex-row-reverse items-center gap-2">
                      <TeamName team={byId.get(s.a)} size={18} short link={false} />
                    </span>
                  </span>
                  {s.ot && <span className="text-[10px] font-bold text-muted">TE</span>}
                </li>
              );
            })}
          </ul>
        ) : item.kind === 'event' && item.match_id ? (
          <Link to={`/en-vivo/${item.match_id}`} className="focus-ring text-sm font-semibold text-primary">
            Ver repetición y estadísticas →
          </Link>
        ) : null}
      </article>
    );
  }
}

function LatestNews({ news }: { news: { id: string; title: string; kind: string; published_at: string | null }[] }) {
  if (!news.length) return null;
  return (
    <section>
      <SectionTitle
        right={
          <Link to="/noticias" className="focus-ring rounded text-sm text-primary">
            Todas →
          </Link>
        }
      >
        Noticias
      </SectionTitle>
      <ul className="grid gap-2 sm:grid-cols-3">
        {news.map((n) => (
          <li key={n.id}>
            <Link to={`/noticias#${n.id}`} className="focus-ring card block h-full p-3 transition hover:border-primary/60">
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-secondary">{n.kind.replace('_', ' ')}</div>
              <div className="font-semibold leading-snug">{n.title}</div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export { Coins };
