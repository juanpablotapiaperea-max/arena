// Mi club (solo dueños): finanzas, plantilla, estilo de juego, fichajes
// sugeridos y acceso al draft y a las apuestas del club.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from 'recharts';
import { Lock, Plus, Trash2 } from 'lucide-react';
import { STYLE_LABELS } from '@shared/engine/settings';
import { useAuth } from '@/lib/auth';
import { usePlayers, useTeams } from '@/lib/hooks';
import { useA11y } from '@/lib/a11y';
import { db } from '@/lib/supabase';
import { POSITION_SHORT } from '@/lib/types';
import { Badge, Button, Card, ErrorBox, Spinner, Stat, cn, money } from '@/components/ui';
import { EmptyState } from '@/components/game';
import { Crest } from '@/components/Crest';
import { textOn } from '@/lib/theme';

const STYLE_HINT: Record<string, string> = {
  equilibrado: 'Sin ajustes.',
  ofensivo: 'Ataque +4 %, defensa −4 %. Más tiros en ambos lados.',
  defensivo: 'Ataque −4 %, defensa +4 %. Menos tiros en ambos lados.',
  presion: 'Ataque +3 %, defensa −2 %. Más penalizaciones propias.',
  contraataque: 'Ataque −2 %, defensa +3 %. Más goles en el tercer periodo.',
};

const CONCEPT: Record<string, string> = {
  taquilla: 'Taquilla',
  camisetas: 'Camisetas',
  venta_fichaje: 'Venta de fichajes',
  premio: 'Premios',
  salarios: 'Salarios',
  compra_fichaje: 'Compra de fichajes',
  apuestas: 'Apuestas',
};

export function MyClubPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const { say } = useA11y();
  const { byId } = useTeams();
  const club = profile?.club_team_id ? byId.get(profile.club_team_id) : undefined;
  const roster = usePlayers(club?.id);
  const allPlayers = usePlayers();
  const priv = useQuery({ queryKey: ['my-club-private', club?.id], enabled: !!club, queryFn: async () => (await db().from('team_private').select('*').eq('team_id', club!.id).maybeSingle()).data as { budget: number } | null });
  const fin = useQuery({ queryKey: ['my-club-finance', club?.id], enabled: !!club, queryFn: async () => ((await db().from('finance_entries').select('*').eq('team_id', club!.id).order('created_at', { ascending: false }).limit(300)).data ?? []) as { concept: string; amount: number; created_at: string; note: string | null }[] });
  const wish = useQuery({ queryKey: ['wishlist', club?.id], enabled: !!club, queryFn: async () => ((await db().from('owner_wishlist').select('*').eq('team_id', club!.id).order('priority')).data ?? []) as { player_id: string; priority: number }[] });
  const [error, setError] = useState<unknown>(null);
  const [search, setSearch] = useState('');

  if (!profile || profile.role !== 'owner' || !club) return <EmptyState title="Solo para dueños">El administrador asigna los clubes a sus dueños.</EmptyState>;

  const setStyle = async (style: string) => {
    setError(null);
    const { error: err } = await db().rpc('set_play_style', { p_style: style });
    if (err) setError(new Error(err.message));
    else {
      say(`Estilo cambiado a ${STYLE_LABELS[style as keyof typeof STYLE_LABELS]}`);
      qc.invalidateQueries({ queryKey: ['teams'] });
    }
  };
  const addWish = async (playerId: string) => {
    setError(null);
    const used = new Set((wish.data ?? []).map((w) => w.priority));
    const priority = [1, 2, 3, 4, 5].find((n) => !used.has(n));
    if (!priority) return setError(new Error('Máximo 5 fichajes sugeridos'));
    const { error: err } = await db().from('owner_wishlist').insert({ team_id: club.id, player_id: playerId, priority });
    if (err) setError(new Error(err.message));
    qc.invalidateQueries({ queryKey: ['wishlist', club.id] });
  };

  const byConcept = new Map<string, number>();
  for (const f of fin.data ?? []) byConcept.set(f.concept, (byConcept.get(f.concept) ?? 0) + Number(f.amount));
  const chart = [...byConcept.entries()].map(([k, v]) => ({ name: CONCEPT[k] ?? k, value: Math.round(v / 1000) / 1000 }));
  const pById = new Map((allPlayers.data ?? []).map((p) => [p.id, p]));
  const salaries = (roster.data ?? []).reduce((s, p) => s + p.salary, 0);
  const candidates = (allPlayers.data ?? [])
    .filter((p) => p.team_id !== club.id && `${p.first_name} ${p.last_name}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 12);

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-4 rounded-3xl p-5" style={{ background: club.primary_color, color: textOn(club.primary_color) }}>
        <Crest team={club} size={64} />
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest opacity-80">Mi club</div>
          <h1 className="font-display text-4xl font-extrabold uppercase leading-none">{club.name}</h1>
        </div>
      </header>
      {error ? <ErrorBox error={error} /> : null}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Presupuesto" value={priv.data ? money(Number(priv.data.budget)) : '…'} />
        <Stat label="Salarios / temporada" value={money(salaries)} />
        <Stat label="Ataque" value={Number(club.attack).toFixed(1)} />
        <Stat label="Defensa / Portería" value={`${Number(club.defense).toFixed(0)} / ${Number(club.goalie).toFixed(0)}`} />
      </div>

      <Card>
        <h2 className="mb-1 font-display text-xl font-bold uppercase">Estilo de juego</h2>
        <p className="mb-3 flex items-center gap-1.5 text-sm text-muted">
          {club.play_style_locked ? (
            <>
              <Lock size={14} aria-hidden /> Bloqueado durante el día de competencia.
            </>
          ) : (
            'Se bloquea cuando empieza el día de competencia.'
          )}
        </p>
        <div className="grid gap-2 sm:grid-cols-5" role="radiogroup" aria-label="Estilo de juego">
          {Object.entries(STYLE_LABELS).map(([k, label]) => (
            <button
              key={k}
              role="radio"
              aria-checked={club.play_style === k}
              disabled={!!club.play_style_locked}
              onClick={() => setStyle(k)}
              className={cn('focus-ring rounded-2xl border p-3 text-left disabled:opacity-60', club.play_style === k ? 'border-primary bg-primary/15' : 'border-line bg-surface-2')}
            >
              <div className="font-semibold">{label}</div>
              <div className="text-xs text-muted">{STYLE_HINT[k]}</div>
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="mb-2 font-display text-xl font-bold uppercase">Fichajes sugeridos</h2>
        <p className="mb-3 text-sm text-muted">Hasta 5, por prioridad. La IA del club les da más peso en el mercado, pero no está obligada.</p>
        <ol className="mb-3 space-y-1">
          {(wish.data ?? []).map((w) => {
            const p = pById.get(w.player_id);
            return (
              <li key={w.player_id} className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm">
                <Badge tone="primary">{w.priority}</Badge>
                <span className="flex-1">
                  {p?.first_name} {p?.last_name} <span className="text-muted">· {p ? POSITION_SHORT[p.position] : ''} {p?.rating} · {p?.team_id ? byId.get(p.team_id)?.short_name : 'libre'}</span>
                </span>
                <button
                  onClick={async () => {
                    await db().from('owner_wishlist').delete().eq('team_id', club.id).eq('player_id', w.player_id);
                    qc.invalidateQueries({ queryKey: ['wishlist', club.id] });
                  }}
                  className="focus-ring rounded p-1 text-muted hover:text-loss"
                  aria-label="Quitar"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            );
          })}
        </ol>
        {(wish.data ?? []).length < 5 && (
          <>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar jugador de otro club" aria-label="Buscar jugador" className="focus-ring mb-2 min-h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-sm" />
            {search && (
              <ul className="grid gap-1 sm:grid-cols-2">
                {candidates.map((p) => (
                  <li key={p.id}>
                    <button onClick={() => addWish(p.id)} className="focus-ring flex w-full items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-left text-sm">
                      <Plus size={14} className="text-primary" />
                      <span className="flex-1 truncate">
                        {p.first_name} {p.last_name}
                      </span>
                      <span className="text-xs text-muted">
                        {POSITION_SHORT[p.position]} {p.rating}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 font-display text-xl font-bold uppercase">Finanzas (millones USD)</h2>
        {fin.isLoading ? (
          <Spinner />
        ) : !chart.length ? (
          <p className="text-sm text-muted">Aún sin movimientos: llegarán con la taquilla de los partidos de local.</p>
        ) : (
          <div className="h-56" role="img" aria-label={chart.map((c) => `${c.name} ${c.value} millones`).join(', ')}>
            <ResponsiveContainer>
              <BarChart data={chart} layout="vertical" margin={{ left: 20 }}>
                <XAxis type="number" tick={{ fill: 'rgb(var(--muted))', fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={120} tick={{ fill: 'rgb(var(--muted))', fontSize: 11 }} />
                <Tooltip contentStyle={{ background: 'rgb(var(--surface))', border: '1px solid rgb(var(--line))', borderRadius: 12 }} />
                <Bar dataKey="value" radius={6}>
                  {chart.map((c) => (
                    <Cell key={c.name} fill={c.value >= 0 ? 'rgb(var(--win))' : 'rgb(var(--loss))'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 font-display text-xl font-bold uppercase">Plantilla</h2>
        <ul className="grid gap-1 sm:grid-cols-2">
          {(roster.data ?? [])
            .slice()
            .sort((a, b) => 'GDF'.indexOf(a.position) - 'GDF'.indexOf(b.position) || b.rating - a.rating)
            .map((p) => (
              <li key={p.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm">
                <span className="w-9 text-xs font-bold text-muted">{POSITION_SHORT[p.position]}</span>
                <span className="flex-1 truncate">
                  {p.first_name} {p.last_name}
                </span>
                {p.injury_days > 0 && <Badge tone="loss">{p.injury_days}d</Badge>}
                <span className="text-xs text-muted">{p.contract_years}t</span>
                <span className="w-8 text-right font-display font-bold tabular">{p.rating}</span>
              </li>
            ))}
        </ul>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Link to="/mercado">
          <Button variant="outline">Sala del draft</Button>
        </Link>
        <Link to="/apuestas">
          <Button variant="outline">Apostar con el dinero del club</Button>
        </Link>
      </div>
    </div>
  );
}
