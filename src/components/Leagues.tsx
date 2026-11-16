// Ligas privadas de apuestas entre amigos y logros del apostador.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, Copy, LogOut, Plus, Users } from 'lucide-react';
import { db } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import type { Bet } from '@/lib/engine';
import { Badge, Button, ErrorBox, Input, Spinner, cn } from './ui';

export function PrivateLeagues() {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const mine = useQuery({ queryKey: ['my-leagues'], queryFn: async () => ((await db().rpc('my_bet_leagues')).data ?? []) as { id: string; name: string; join_code: string; members: number; is_owner: boolean }[] });
  const [sel, setSel] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<unknown>(null);
  const current = sel ?? mine.data?.[0]?.id ?? null;
  const table = useQuery({ queryKey: ['league-table', current], enabled: !!current, queryFn: async () => ((await db().rpc('bet_league_table', { p_league: current })).data ?? []) as { user_id: string; display_name: string; won: number; bets: number; net: number }[] });

  const run = async (fn: () => PromiseLike<{ error: { message: string } | null; data: unknown }>) => {
    setError(null);
    const { error: err, data } = await fn();
    if (err) setError(new Error(err.message));
    await qc.invalidateQueries({ queryKey: ['my-leagues'] });
    return data;
  };

  return (
    <section className="card space-y-3 p-4">
      <h3 className="flex items-center gap-2 font-display text-xl font-bold uppercase">
        <Users size={18} aria-hidden /> Ligas privadas
      </h3>
      {mine.isLoading ? (
        <Spinner />
      ) : (
        <>
          {(mine.data ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1">
              {mine.data!.map((l) => (
                <button key={l.id} onClick={() => setSel(l.id)} aria-pressed={current === l.id} className={cn('focus-ring min-h-9 rounded-xl px-3 text-sm', current === l.id ? 'bg-primary text-bg' : 'bg-surface-2 text-muted')}>
                  {l.name} <span className="opacity-70">({l.members})</span>
                </button>
              ))}
            </div>
          )}
          {current && (
            <>
              {(() => {
                const l = mine.data!.find((x) => x.id === current)!;
                return (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-muted">Código para invitar:</span>
                    <span className="mono rounded-lg bg-surface-2 px-2 py-1 font-bold tracking-widest">{l?.join_code}</span>
                    <button
                      onClick={() => navigator.clipboard?.writeText(l.join_code).catch(() => undefined)}
                      className="focus-ring rounded p-1.5 text-muted hover:text-fg"
                      aria-label="Copiar código"
                    >
                      <Copy size={14} />
                    </button>
                    <button onClick={() => run(() => db().rpc('leave_bet_league', { p_league: current })).then(() => setSel(null))} className="focus-ring ml-auto inline-flex items-center gap-1 rounded text-xs text-muted hover:text-loss">
                      <LogOut size={12} /> Salir
                    </button>
                  </div>
                );
              })()}
              <ol className="divide-y divide-line/50 rounded-xl bg-surface-2">
                {(table.data ?? []).map((r, i) => (
                  <li key={r.user_id} className={cn('flex items-center gap-3 px-3 py-2 text-sm', r.user_id === profile?.id && 'font-semibold')}>
                    <span className="w-5 text-right font-display font-bold text-muted">{i + 1}</span>
                    <span className="flex-1 truncate">{r.display_name}</span>
                    <span className={cn('font-display text-lg font-bold tabular', Number(r.net) >= 0 ? 'text-win' : 'text-loss')}>
                      {Number(r.net) >= 0 ? '+' : ''}
                      {Number(r.net).toLocaleString('es-MX')}
                    </span>
                  </li>
                ))}
              </ol>
            </>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(() => db().rpc('create_bet_league', { p_name: name })).then(() => setName(''));
              }}
              className="flex gap-2"
            >
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre de tu liga" aria-label="Nombre de la nueva liga" />
              <Button disabled={name.trim().length < 2} aria-label="Crear liga">
                <Plus size={16} />
              </Button>
            </form>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(() => db().rpc('join_bet_league', { p_code: code })).then(() => setCode(''));
              }}
              className="flex gap-2"
            >
              <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Código de invitación" aria-label="Código de invitación" maxLength={6} className="mono tracking-widest" />
              <Button disabled={code.trim().length < 6}>Unirme</Button>
            </form>
          </div>
          {error ? <ErrorBox error={error} /> : null}
        </>
      )}
    </section>
  );
}

const ACHIEVEMENTS: { key: string; label: string; desc: string; test: (b: Bet[]) => boolean }[] = [
  { key: 'first', label: 'Primera boleta', desc: 'Hiciste tu primera apuesta.', test: (b) => b.length > 0 },
  { key: 'win', label: 'Olfato', desc: 'Ganaste una apuesta.', test: (b) => b.some((x) => x.status === 'won') },
  { key: 'parlay', label: 'Combinada maestra', desc: 'Ganaste una combinada.', test: (b) => b.some((x) => x.parlay_id && Number(x.payout ?? 0) > 0) },
  { key: 'exact', label: 'Adivino', desc: 'Acertaste un marcador exacto.', test: (b) => b.some((x) => x.market === 'exact' && x.status === 'won') },
  { key: 'longshot', label: 'Batacazo', desc: 'Ganaste con cuota mayor a 5.', test: (b) => b.some((x) => x.status === 'won' && Number(x.odds) >= 5) },
  { key: 'ten', label: 'Constante', desc: 'Diez apuestas ganadas.', test: (b) => b.filter((x) => x.status === 'won').length >= 10 },
  { key: 'future', label: 'Visionario', desc: 'Acertaste un mercado de largo plazo.', test: (b) => b.some((x) => !x.match_id && x.status === 'won') },
];

export function Achievements({ bets }: { bets: Bet[] }) {
  return (
    <section className="card p-4">
      <h3 className="mb-3 flex items-center gap-2 font-display text-xl font-bold uppercase">
        <Award size={18} aria-hidden /> Logros
      </h3>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ACHIEVEMENTS.map((a) => {
          const got = a.test(bets);
          return (
            <li key={a.key} className={cn('rounded-xl border p-3 text-center', got ? 'border-secondary/60 bg-secondary/10' : 'border-line opacity-50')}>
              <div className="text-2xl" aria-hidden>
                {got ? '🏅' : '🔒'}
              </div>
              <div className="text-sm font-semibold">{a.label}</div>
              <div className="text-[11px] text-muted">{a.desc}</div>
              <span className="sr-only">{got ? 'Conseguido' : 'Pendiente'}</span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-muted">
        <Badge>{ACHIEVEMENTS.filter((a) => a.test(bets)).length}/{ACHIEVEMENTS.length}</Badge> conseguidos
      </p>
    </section>
  );
}
