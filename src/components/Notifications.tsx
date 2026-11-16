// Avisos dentro de la app: inicio de evento, resultado de apuesta, y fichajes
// o rumores de los equipos favoritos. Campana con historial y avisos flotantes.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Bell, X } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useTeams } from '@/lib/hooks';
import { DEMO_MODE, db, supabase } from '@/lib/supabase';
import { playCue, useA11y } from '@/lib/a11y';
import { cn } from './ui';

interface Toast {
  id: string;
  title: string;
  body?: string;
  to?: string;
  tone: 'live' | 'win' | 'loss' | 'primary';
}

export function NotificationCenter() {
  const { profile, setLocalProfile } = useAuth();
  const { byId } = useTeams();
  const { say, prefs } = useA11y();
  const reduce = useReducedMotion();
  const qc = useQueryClient();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [open, setOpen] = useState(false);
  const favs = useRef(new Set<string>());
  favs.current = new Set([...(profile?.favorite_team_ids ?? []), ...(profile?.star_team_id ? [profile.star_team_id] : [])]);

  const list = useQuery({
    queryKey: ['notifications', profile?.id],
    enabled: !!profile && !DEMO_MODE,
    queryFn: async () => ((await db().from('notifications').select('*').eq('user_id', profile!.id).order('created_at', { ascending: false }).limit(30)).data ?? []) as { id: number; kind: string; payload: Record<string, unknown>; read_at: string | null; created_at: string }[],
  });
  const unread = (list.data ?? []).filter((n) => !n.read_at).length;

  const push = (t: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((x) => [...x.slice(-3), { ...t, id }]);
    say(`${t.title}. ${t.body ?? ''}`);
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), 6000);
  };

  useEffect(() => {
    if (DEMO_MODE || !supabase || !profile) return;
    const ch = supabase
      .channel(`notify:${profile.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${profile.id}` }, ({ new: n }) => {
        const p = (n as { payload: { won: boolean; payout: number; stake: number; source: string } }).payload;
        push({ title: p.won ? '¡Apuesta ganada!' : 'Apuesta perdida', body: p.won ? `+${p.payout.toLocaleString('es-MX')} ${p.source === 'club' ? 'USD al club' : 'créditos'}` : `Apostaste ${p.stake}`, to: '/apuestas', tone: p.won ? 'win' : 'loss' });
        if (p.won && p.source === 'credits') setLocalProfile({ credits: (profile.credits ?? 0) + p.payout });
        if (p.won && prefs.sound) playCue('win');
        qc.invalidateQueries({ queryKey: ['notifications'] });
        qc.invalidateQueries({ queryKey: ['my-bets'] });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches', filter: 'status=eq.live' }, ({ new: m }) => {
        const mm = m as { id: string; event_name: string | null; home_team_id: string; away_team_id: string };
        const fav = favs.current.has(mm.home_team_id) || favs.current.has(mm.away_team_id);
        push({ title: fav ? '¡Juega tu equipo en vivo!' : 'Empieza un evento en vivo', body: mm.event_name ?? `${byId.get(mm.home_team_id)?.name} vs ${byId.get(mm.away_team_id)?.name}`, to: `/en-vivo/${mm.id}`, tone: 'live' });
        if (prefs.sound) playCue('whistle');
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'news' }, ({ new: n }) => {
        const nn = n as { id: string; kind: string; title: string; team_id: string | null; status: string };
        if (nn.status !== 'published' || !nn.team_id || !favs.current.has(nn.team_id)) return;
        if (!['fichaje', 'rumor', 'campeon', 'polemica'].includes(nn.kind)) return;
        push({ title: nn.kind === 'rumor' ? 'Rumor sobre tu equipo' : nn.kind === 'campeon' ? '¡Tu equipo es campeón!' : 'Noticia de tu equipo', body: nn.title, to: `/noticias#${nn.id}`, tone: 'primary' });
      })
      .subscribe();
    return () => {
      supabase!.removeChannel(ch);
    };
  }, [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const markRead = async () => {
    if (!profile || !unread) return;
    await db().from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', profile.id).is('read_at', null);
    qc.invalidateQueries({ queryKey: ['notifications'] });
  };

  return (
    <>
      <button
        onClick={() => {
          setOpen((o) => !o);
          markRead();
        }}
        className="focus-ring relative rounded-lg p-2 text-muted hover:text-fg"
        aria-label={`Avisos${unread ? `, ${unread} sin leer` : ''}`}
        aria-expanded={open}
      >
        <Bell size={18} />
        {unread > 0 && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-live" aria-hidden />}
      </button>
      {open && (
        <div className="fixed inset-0 z-40" onClick={() => setOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="card absolute right-3 top-16 max-h-[70vh] w-[min(92vw,360px)] overflow-y-auto p-0 shadow-2xl" role="dialog" aria-label="Avisos">
            <h3 className="border-b border-line px-4 py-3 font-semibold">Avisos</h3>
            <ul>
              {(list.data ?? []).map((n) => {
                const p = n.payload as { won?: boolean; payout?: number; stake?: number };
                return (
                  <li key={n.id} className="border-b border-line/50 px-4 py-2.5 text-sm">
                    <div className="font-medium">{n.kind === 'bet' ? (p.won ? `Ganaste ${p.payout?.toLocaleString('es-MX')}` : `Perdiste ${p.stake}`) : n.kind}</div>
                    <div className="text-xs text-muted">{new Date(n.created_at).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}</div>
                  </li>
                );
              })}
              {!(list.data ?? []).length && <li className="p-4 text-sm text-muted">Aquí verás los resultados de tus apuestas.</li>}
            </ul>
          </div>
        </div>
      )}
      <div className="pointer-events-none fixed inset-x-0 top-16 z-50 flex flex-col items-center gap-2 px-3" aria-hidden>
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div key={t.id} initial={reduce ? false : { y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ opacity: 0, y: -10 }} className="pointer-events-auto w-full max-w-sm">
              <div className={cn('card flex items-start gap-3 p-3 shadow-2xl', t.tone === 'live' ? 'border-live/60' : t.tone === 'win' ? 'border-win/60' : t.tone === 'loss' ? 'border-loss/60' : 'border-primary/60')}>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{t.title}</div>
                  {t.body && <div className="truncate text-sm text-muted">{t.body}</div>}
                  {t.to && (
                    <Link to={t.to} className="text-sm font-semibold text-primary" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
                      Ver →
                    </Link>
                  )}
                </div>
                <button onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} className="rounded p-1 text-muted" aria-label="Cerrar aviso">
                  <X size={14} />
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </>
  );
}
