// Mercado y draft: fichajes confirmados, rumores y la sala del draft en vivo.
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, Dices, Repeat } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { usePlayers, useTeams } from '@/lib/hooks';
import { useRealtime } from '@/lib/realtime';
import { useA11y } from '@/lib/a11y';
import { db } from '@/lib/supabase';
import { engine } from '@/lib/engine';
import type { Player } from '@/lib/types';
import { Badge, Button, ErrorBox, SectionTitle, Spinner, cn, money } from '@/components/ui';
import { Countdown, EmptyState, TeamName } from '@/components/game';
import { Crest } from '@/components/Crest';

interface DraftState {
  season: { id: string; number: number };
  picks: { id: string; round: number; pick_number: number; team_id: string; player_id: string | null; mode: string; deadline: string | null }[];
  rookies: Player[];
}

export function MarketPage() {
  const [tab, setTab] = useState<'fichajes' | 'draft'>('fichajes');
  const live = useQuery({ queryKey: ['draft-live'], queryFn: async () => ((await db().from('settings').select('value').eq('key', 'draft_live').maybeSingle()).data?.value ?? { running: false }) as { running: boolean } });
  useEffect(() => {
    if (live.data?.running) setTab('draft');
  }, [live.data?.running]);
  return (
    <div className="space-y-4">
      <SectionTitle>Mercado y draft</SectionTitle>
      <div className="flex gap-1" role="tablist">
        {(
          [
            ['fichajes', 'Fichajes'],
            ['draft', live.data?.running ? 'Draft 🔴' : 'Draft'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn('focus-ring min-h-10 rounded-xl px-3.5 text-sm font-semibold', tab === k ? 'bg-primary text-bg' : 'bg-surface-2 text-muted')}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'fichajes' ? <Transfers /> : <DraftRoom />}
    </div>
  );
}

function Transfers() {
  const { byId } = useTeams();
  const players = usePlayers();
  const pById = new Map((players.data ?? []).map((p) => [p.id, p]));
  const q = useQuery({
    queryKey: ['transfers-public'],
    queryFn: async () => ((await db().from('transfers').select('*').eq('status', 'completed').is('parent_id', null).order('completed_at', { ascending: false }).limit(100)).data ?? []) as { id: string; player_id: string; from_team_id: string | null; to_team_id: string | null; fee: number; window_label: string; completed_at: string }[],
  });
  const window = useQuery({ queryKey: ['market-window'], queryFn: async () => ((await db().from('settings').select('value').eq('key', 'market_window').maybeSingle()).data?.value ?? { open: false }) as { open: boolean; label?: string; closesAt?: string } });
  useRealtime('news', [['transfers-public']]);
  if (q.isLoading) return <Spinner />;
  return (
    <div className="space-y-3">
      {window.data?.open && (
        <div className="card flex items-center gap-3 border-live/50 p-3" role="status">
          <Repeat size={18} className="text-live" aria-hidden />
          <span className="flex-1 text-sm">
            Ventana <b>{window.data.label}</b> abierta. Los clubes negocian; los fichajes se confirman al cerrar
            {window.data.closesAt ? (
              <>
                {' '}en <Countdown to={window.data.closesAt} className="font-semibold" />
              </>
            ) : null}
            .
          </span>
        </div>
      )}
      {!(q.data ?? []).length ? (
        <EmptyState icon={<Repeat className="text-primary" size={30} />} title="Sin fichajes todavía">
          Los fichajes llegan en las ventanas de mercado de pretemporada y de mitad de temporada. Los rumores aparecen en Noticias.
        </EmptyState>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {q.data!.map((t) => {
            const p = pById.get(t.player_id);
            return (
              <li key={t.id} className="card p-3">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{p ? `${p.first_name} ${p.last_name}` : 'Jugador'}</span>
                    <span className="text-xs text-muted">
                      {p?.position === 'G' ? 'Portero' : p?.position === 'D' ? 'Defensa' : 'Delantero'} · {p?.age} años · {p?.rating}
                    </span>
                  </span>
                  <Badge tone="primary">{money(Number(t.fee))}</Badge>
                </div>
                <div className="mt-2 flex items-center gap-2 text-sm">
                  <TeamName team={t.from_team_id ? byId.get(t.from_team_id) : undefined} size={18} short link={false} />
                  <ArrowRight size={14} className="text-muted" aria-label="a" />
                  <TeamName team={t.to_team_id ? byId.get(t.to_team_id) : undefined} size={18} short />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function DraftRoom() {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const { byId } = useTeams();
  const { say } = useA11y();
  const reduce = useReducedMotion();
  const state = useQuery({ queryKey: ['draft-state'], queryFn: () => engine<DraftState>('draft.state'), refetchInterval: 6000 });
  useRealtime('draft_picks', [['draft-state']]);
  const [error, setError] = useState<unknown>(null);
  const [pos, setPos] = useState<'all' | 'G' | 'D' | 'F'>('all');
  const picks = state.data?.picks ?? [];
  const cur = picks.find((p) => !p.player_id);
  const lastPicked = [...picks].reverse().find((p) => p.player_id);

  // Cualquier espectador ayuda a avanzar los turnos vencidos (el servidor decide).
  useEffect(() => {
    if (!cur?.deadline) return;
    const ms = Math.max(500, Date.parse(cur.deadline) - Date.now() + 300);
    const t = setTimeout(async () => {
      try {
        const s = await engine<DraftState>('draft.advance');
        qc.setQueryData(['draft-state'], s);
      } catch {
        /* otro cliente ya avanzó */
      }
    }, ms);
    return () => clearTimeout(t);
  }, [cur?.id, cur?.deadline, qc]);

  useEffect(() => {
    if (lastPicked) {
      const r = state.data?.rookies.find((x) => x.id === lastPicked.player_id);
      if (r) say(`${byId.get(lastPicked.team_id)?.name} elige a ${r.first_name} ${r.last_name}`);
    }
  }, [lastPicked?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state.isLoading) return <Spinner />;
  if (!picks.length)
    return (
      <EmptyState icon={<Dices className="text-secondary" size={30} />} title="Draft sin preparar">
        Al cierre de cada temporada entran entre 60 y 80 novatos. El peor del ranking elige primero.
      </EmptyState>
    );

  const myTurn = cur && profile?.role === 'owner' && profile.club_team_id === cur.team_id;
  const rookies = state.data!.rookies;
  const available = rookies.filter((r) => !picks.some((p) => p.player_id === r.id)).filter((r) => pos === 'all' || r.position === pos).sort((a, b) => b.rating + b.potential - (a.rating + a.potential));

  const pick = async (playerId: string) => {
    setError(null);
    try {
      const s = await engine<DraftState>('draft.pick', { playerId });
      qc.setQueryData(['draft-state'], s);
      say('Elección registrada');
    } catch (e) {
      setError(e);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="space-y-3">
        {cur ? (
          <div className={cn('card flex items-center gap-4 p-4', myTurn && 'border-secondary')} role="status">
            {byId.get(cur.team_id) && <Crest team={byId.get(cur.team_id)!} size={56} />}
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold uppercase tracking-widest text-muted">
                Ronda {cur.round} · elección {cur.pick_number}
              </div>
              <div className="font-display text-2xl font-bold uppercase">{byId.get(cur.team_id)?.name}</div>
              <div className="text-sm text-muted">{cur.mode === 'owner' ? (myTurn ? '¡Es tu turno!' : 'Elige su dueño') : 'Elige la IA'}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase text-muted">Tiempo</div>
              {cur.deadline ? <Countdown to={cur.deadline} className="font-display text-3xl font-bold" /> : <span className="text-sm text-muted">En espera</span>}
            </div>
          </div>
        ) : (
          <div className="card p-4 font-semibold text-win">El draft terminó.</div>
        )}
        {error ? <ErrorBox error={error} /> : null}

        <div className="flex gap-1">
          {(
            [
              ['all', 'Todos'],
              ['F', 'Delanteros'],
              ['D', 'Defensas'],
              ['G', 'Porteros'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} onClick={() => setPos(k)} aria-pressed={pos === k} className={cn('focus-ring min-h-9 rounded-xl px-3 text-xs font-semibold', pos === k ? 'bg-primary text-bg' : 'bg-surface-2 text-muted')}>
              {l}
            </button>
          ))}
        </div>
        <ul className="grid gap-2 sm:grid-cols-2">
          {available.slice(0, 40).map((r) => (
            <li key={r.id} className="card flex items-center gap-3 p-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2 font-display text-lg font-bold">{r.position}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">
                  {r.first_name} {r.last_name}
                </span>
                <span className="text-xs text-muted">
                  {r.age} años · atributo <b className="text-fg">{r.rating}</b> · potencial <b className="text-secondary">{r.potential}</b>
                </span>
              </span>
              {myTurn && (
                <Button size="sm" onClick={() => pick(r.id)}>
                  Elegir
                </Button>
              )}
            </li>
          ))}
        </ul>
      </div>

      <aside className="card max-h-[75vh] overflow-y-auto p-0" aria-label="Elecciones">
        <h3 className="sticky top-0 border-b border-line bg-surface px-4 py-3 font-display text-lg font-bold uppercase">Elecciones</h3>
        <ol>
          <AnimatePresence initial={false}>
            {picks
              .filter((p) => p.player_id)
              .reverse()
              .map((p) => {
                const r = rookies.find((x) => x.id === p.player_id);
                const t = byId.get(p.team_id);
                return (
                  <motion.li key={p.id} initial={reduce ? false : { opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-2 border-b border-line/50 px-4 py-2 text-sm">
                    <span className="w-7 font-display font-bold text-muted tabular">{p.pick_number}</span>
                    {t && <Crest team={t} size={20} />}
                    <span className="min-w-0 flex-1 truncate">
                      {r?.first_name} {r?.last_name}
                    </span>
                    <span className="text-xs text-muted">
                      {r?.position} {r?.rating}
                    </span>
                  </motion.li>
                );
              })}
          </AnimatePresence>
        </ol>
      </aside>
    </div>
  );
}
