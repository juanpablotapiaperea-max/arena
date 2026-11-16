// Noticias: resúmenes, crónicas, historias, rumores y polémicas.
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Flame, Newspaper, Pin, Sparkles } from 'lucide-react';
import { useTeams } from '@/lib/hooks';
import { useRealtime } from '@/lib/realtime';
import { getNews } from '@/lib/engine';
import { Badge, SectionTitle, Spinner, cn } from '@/components/ui';
import { EmptyState } from '@/components/game';
import { Crest } from '@/components/Crest';

const KIND: Record<string, string> = {
  jornada: 'Jornada',
  cronica: 'Crónica',
  campeon: 'Campeón',
  cierre_dia: 'Resumen del día',
  semanal: 'Semanal',
  historia: 'Historia',
  rumor: 'Rumor',
  fichaje: 'Fichaje',
  polemica: 'Polémica',
  manual: 'Editorial',
  draft: 'Draft',
};

export function NewsPage() {
  const q = useQuery({ queryKey: ['news', 60], queryFn: () => getNews(60) });
  useRealtime('news', [['news', 60]]);
  const { byId } = useTeams();
  const [filter, setFilter] = useState<string>('todas');
  useEffect(() => {
    const id = location.hash.slice(1);
    if (id) document.getElementById(`n-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [q.data]);
  if (q.isLoading) return <Spinner />;
  const all = q.data ?? [];
  const kinds = ['todas', ...new Set(all.map((n) => n.kind))];
  const list = filter === 'todas' ? all : all.filter((n) => n.kind === filter);
  return (
    <div className="space-y-4">
      <SectionTitle>Noticias</SectionTitle>
      {all.length === 0 ? (
        <EmptyState icon={<Newspaper className="text-primary" size={30} />} title="Sin noticias todavía">
          La prensa de ARENA publica resúmenes, crónicas y rumores en cuanto se juegan los partidos.
        </EmptyState>
      ) : (
        <>
          <div className="-mx-4 flex gap-1 overflow-x-auto px-4">
            {kinds.map((k) => (
              <button key={k} onClick={() => setFilter(k)} aria-pressed={filter === k} className={cn('focus-ring min-h-9 shrink-0 rounded-xl px-3 text-sm font-medium', filter === k ? 'bg-primary text-bg' : 'bg-surface-2 text-muted')}>
                {k === 'todas' ? 'Todas' : KIND[k] ?? k}
              </button>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {list.map((n, i) => {
              const t = n.team_id ? byId.get(n.team_id) : undefined;
              const lead = i === 0 && filter === 'todas';
              return (
                <article id={`n-${n.id}`} key={n.id} className={cn('card scroll-mt-20 p-4', lead && 'md:col-span-2')} style={t ? { boxShadow: `inset 4px 0 0 ${t.primary_color}` } : undefined}>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge tone={n.kind === 'polemica' || n.tone === 'picante' ? 'loss' : n.kind === 'campeon' ? 'win' : 'primary'}>{KIND[n.kind] ?? n.kind}</Badge>
                    {n.rumor_status === 'rumor' && <Badge tone="live">Rumor</Badge>}
                    {n.rumor_status === 'confirmed' && <Badge tone="win">Confirmado</Badge>}
                    {n.rumor_status === 'denied' && <Badge>Desmentido</Badge>}
                    {n.tone === 'picante' && <Flame size={14} className="text-loss" aria-label="Picante" />}
                    {n.pinned && <Pin size={14} className="text-secondary" aria-label="Fijada" />}
                    {n.ai_generated && <Sparkles size={12} className="text-muted" aria-label="Redactada con IA" />}
                    <span className="ml-auto text-xs text-muted">{n.published_at ? new Date(n.published_at).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : ''}</span>
                  </div>
                  <div className="flex items-start gap-3">
                    {t && <Crest team={t} size={lead ? 48 : 32} />}
                    <div className="min-w-0">
                      <h2 className={cn('font-display font-bold leading-tight', lead ? 'text-3xl' : 'text-xl')}>{n.title}</h2>
                      <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-fg/90">{n.body}</p>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
