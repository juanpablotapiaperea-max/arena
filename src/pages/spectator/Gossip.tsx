// Chismes: la revista del corazón de ARENA. Todo es ficticio y solo habla de
// jugadores y equipos de la liga, nunca de los usuarios.
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import { Heart, Share2, Sparkles } from 'lucide-react';
import { DEMO_MODE, db } from '@/lib/supabase';
import { useRealtime } from '@/lib/realtime';
import { useTeams } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import type { News } from '@/lib/engine';
import { Crest } from '@/components/Crest';
import { EmptyState } from '@/components/game';
import { Spinner, cn } from '@/components/ui';

const CAT_EMOJI: Record<string, string> = {
  Corazón: '💘',
  Vestidor: '🚪',
  Fiesta: '🪩',
  Redes: '📱',
  Mercado: '💼',
  Lujo: '💎',
  'Vida privada': '🏡',
  Directiva: '👔',
  Rivalidad: '🔥',
};

type Gossip = News & { facts?: { text?: string } | null };

const categoryOf = (n: Gossip) => /Tema: ([^.]+)\./.exec(n.facts?.text ?? '')?.[1] ?? 'Chisme';

export function GossipPage() {
  const q = useQuery({
    queryKey: ['gossip'],
    enabled: !DEMO_MODE,
    queryFn: async () =>
      ((await db().from('news').select('*').eq('kind', 'chisme').eq('status', 'published').order('published_at', { ascending: false }).limit(80)).data ?? []) as Gossip[],
    refetchInterval: 60_000,
  });
  useRealtime('news', [['gossip']]);
  const { byId } = useTeams();
  const { profile } = useAuth();
  const reduce = useReducedMotion();
  const [cat, setCat] = useState('Todos');
  const [mine, setMine] = useState(false);
  const favs = useMemo(() => new Set([...(profile?.favorite_team_ids ?? []), ...(profile?.star_team_id ? [profile.star_team_id] : [])]), [profile]);

  if (q.isLoading) return <Spinner />;
  const all = q.data ?? [];
  const cats = ['Todos', ...new Set(all.map(categoryOf))];
  const list = all.filter((n) => (cat === 'Todos' || categoryOf(n) === cat) && (!mine || (n.team_id && favs.has(n.team_id))));

  const share = (n: Gossip) => {
    const text = `${n.title}\n\n${n.body}`;
    if (navigator.share) navigator.share({ title: n.title, text }).catch(() => undefined);
    else navigator.clipboard?.writeText(text).catch(() => undefined);
  };

  return (
    <div className="space-y-4">
      <header className="relative overflow-hidden rounded-3xl p-5" style={{ background: 'linear-gradient(120deg, #db277799, #7c3aed66 55%, transparent)' }}>
        <div className="text-xs font-semibold uppercase tracking-[0.3em] text-pink-200">La revista de la liga</div>
        <h1 className="font-display text-5xl font-extrabold uppercase leading-none">
          Chismes <span aria-hidden>💋</span>
        </h1>
        <p className="mt-1 max-w-xl text-sm text-fg/80">Romances, pleitos de vestidor, fiestas y rumores de mercado. Nada está confirmado… y todo es ficticio.</p>
      </header>

      <div className="-mx-4 flex gap-1 overflow-x-auto px-4" role="group" aria-label="Filtrar por tema">
        {cats.map((c) => (
          <button
            key={c}
            onClick={() => setCat(c)}
            aria-pressed={cat === c}
            className={cn('focus-ring min-h-9 shrink-0 rounded-full px-3 text-sm font-medium', cat === c ? 'bg-pink-500 text-white' : 'bg-surface-2 text-muted')}
          >
            {c !== 'Todos' && <span aria-hidden>{CAT_EMOJI[c] ?? '🗞️'} </span>}
            {c}
          </button>
        ))}
        {favs.size > 0 && (
          <button
            onClick={() => setMine((m) => !m)}
            aria-pressed={mine}
            className={cn('focus-ring ml-1 inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full px-3 text-sm font-medium', mine ? 'bg-secondary text-bg' : 'bg-surface-2 text-muted')}
          >
            <Heart size={14} aria-hidden /> Mis equipos
          </button>
        )}
      </div>

      {list.length === 0 ? (
        <EmptyState icon={<Sparkles className="text-pink-400" size={30} />} title="Todavía no hay chismes">
          Los paparazzi de ARENA publican un chisme nuevo cada rato. Vuelve en unos minutos.
        </EmptyState>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.map((n, i) => {
            const t = n.team_id ? byId.get(n.team_id) : undefined;
            const c = categoryOf(n);
            const lead = i === 0 && cat === 'Todos' && !mine;
            return (
              <motion.article
                key={n.id}
                id={`n-${n.id}`}
                initial={reduce ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i, 8) * 0.04 }}
                className={cn('card relative scroll-mt-20 overflow-hidden p-4', lead && 'md:col-span-2')}
                style={t ? { boxShadow: `inset 4px 0 0 ${t.primary_color}` } : undefined}
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-pink-500/15 px-2 py-0.5 text-xs font-semibold text-pink-300">
                    <span aria-hidden>{CAT_EMOJI[c] ?? '🗞️'}</span> {c}
                  </span>
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted">Sin confirmar</span>
                  <span className="ml-auto text-xs text-muted">
                    {n.published_at ? new Date(n.published_at).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : ''}
                  </span>
                </div>
                <div className="flex items-start gap-3">
                  {t && <Crest team={t} size={lead ? 56 : 36} />}
                  <div className="min-w-0 flex-1">
                    <h2 className={cn('font-display font-bold leading-tight', lead ? 'text-3xl' : 'text-xl')}>{n.title}</h2>
                    <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-fg/90">{n.body}</p>
                  </div>
                </div>
                <div className="mt-3 flex justify-end">
                  <button onClick={() => share(n)} className="focus-ring inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted hover:text-fg" aria-label="Compartir chisme">
                    <Share2 size={14} /> Compartir
                  </button>
                </div>
              </motion.article>
            );
          })}
        </div>
      )}
    </div>
  );
}
