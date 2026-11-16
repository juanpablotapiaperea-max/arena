// Ticker de resultados: los últimos marcadores del día pasan por la parte alta.
import { useQuery } from '@tanstack/react-query';
import { useReducedMotion } from 'framer-motion';
import { useTeams } from '@/lib/hooks';
import { useA11y } from '@/lib/a11y';
import { getCurrentDay, getDayItems } from '@/lib/engine';

export function Ticker() {
  const { byId } = useTeams();
  const { prefs } = useA11y();
  const reduce = useReducedMotion() || prefs.reduceMotion;
  const day = useQuery({ queryKey: ['current-day'], queryFn: getCurrentDay, refetchInterval: 60_000 });
  const items = useQuery({ queryKey: ['day-items', day.data?.id], queryFn: () => getDayItems(day.data!.id), enabled: day.data?.status === 'running' || day.data?.status === 'paused', refetchInterval: 30_000 });
  const scores = (items.data ?? [])
    .filter((i) => i.status === 'done' && i.result?.scores)
    .flatMap((i) => i.result!.scores!)
    .slice(-30)
    .reverse();
  if (!scores.length) return null;
  const chips = scores.map((s) => (
    <span key={s.id} className="inline-flex items-center gap-1.5 whitespace-nowrap px-3 text-xs">
      <b>{byId.get(s.h)?.short_name}</b>
      <span className="font-display text-sm font-bold tabular text-primary">
        {s.hs}-{s.as}
      </span>
      <b>{byId.get(s.a)?.short_name}</b>
      {s.ot && <span className="text-[9px] text-muted">TE</span>}
      <span className="text-line" aria-hidden>
        ·
      </span>
    </span>
  ));
  return (
    <div className="overflow-hidden border-b border-line/70 bg-surface/80 py-1.5" aria-label="Últimos resultados">
      {reduce ? (
        <div className="flex overflow-x-auto">{chips}</div>
      ) : (
        <div className="ticker-track flex w-max">
          {chips}
          <span aria-hidden className="flex">
            {chips}
          </span>
        </div>
      )}
    </div>
  );
}
