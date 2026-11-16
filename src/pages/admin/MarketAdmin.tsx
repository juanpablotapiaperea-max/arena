// Mercado y draft: abrir y cerrar ventanas, vetar o forzar fichajes en
// secreto, preparar e iniciar el draft.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Ban, Dices, DoorClosed, DoorOpen, Play, Shuffle } from 'lucide-react';
import { engine } from '@/lib/engine';
import { usePlayers, useTeams } from '@/lib/hooks';
import { useA11y } from '@/lib/a11y';
import { Badge, Button, Card, ErrorBox, Input, Label, SectionTitle, Spinner, money } from '@/components/ui';
import { Countdown, TeamName } from '@/components/game';

interface Transfer {
  id: string;
  player_id: string;
  from_team_id: string | null;
  to_team_id: string | null;
  fee: number;
  status: string;
  window_label: string;
  negotiation_round: number;
  parent_id: string | null;
  created_at: string;
}

export function MarketAdmin() {
  const qc = useQueryClient();
  const { say } = useA11y();
  const { byId, teams } = useTeams();
  const players = usePlayers();
  const pById = new Map((players.data ?? []).map((p) => [p.id, p]));
  const status = useQuery({ queryKey: ['market-status'], queryFn: () => engine<{ window: { open: boolean; label: string; closesAt?: string }; transfers: Transfer[] }>('market.status'), refetchInterval: 15_000 });
  const draft = useQuery({ queryKey: ['draft-state'], queryFn: () => engine<{ season: { number: number }; picks: { player_id: string | null }[]; rookies: unknown[] }>('draft.state') });
  const [label, setLabel] = useState('Pretemporada');
  const [minutes, setMinutes] = useState(30);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [force, setForce] = useState({ playerId: '', toTeamId: '', fee: 0 });

  const act = async (k: string, action: string, body: Record<string, unknown>, done: string) => {
    setBusy(k);
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

  const w = status.data?.window;
  const pending = (status.data?.transfers ?? []).filter((t) => t.status === 'accepted' && !t.parent_id);
  const recent = (status.data?.transfers ?? []).filter((t) => t.status === 'completed' && !t.parent_id).slice(0, 20);
  const picks = draft.data?.picks ?? [];
  const made = picks.filter((p) => p.player_id).length;

  return (
    <div className="space-y-6">
      <SectionTitle>Mercado y draft</SectionTitle>
      {error ? <ErrorBox error={error} /> : null}

      <Card className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="flex-1 font-semibold">Ventana de fichajes</h3>
          {w?.open ? <Badge tone="live">Abierta · {w.label}</Badge> : <Badge>Cerrada</Badge>}
        </div>
        {w?.open ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-muted">
              Cierra sola en {w.closesAt ? <Countdown to={w.closesAt} className="font-semibold text-fg" /> : '—'}. Hasta entonces puedes vetar o forzar fichajes.
            </span>
            <Button onClick={() => act('close', 'market.close', {}, 'Ventana cerrada')} disabled={busy !== null}>
              <DoorClosed size={16} /> {busy === 'close' ? 'Ejecutando traspasos…' : 'Cerrar ya'}
            </Button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-[1fr_140px_auto] sm:items-end">
            <div>
              <Label htmlFor="wlabel">Nombre</Label>
              <Input id="wlabel" value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="wmin">Minutos abierta</Label>
              <Input id="wmin" type="number" min={1} max={600} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
            </div>
            <Button onClick={() => act('open', 'market.open', { label, minutes }, 'Ventana abierta')} disabled={busy !== null}>
              <DoorOpen size={16} /> {busy === 'open' ? 'La IA está negociando…' : 'Abrir ventana'}
            </Button>
          </div>
        )}
        <p className="text-xs text-muted">Al abrir, cada club busca refuerzos según su estrategia (y las sugerencias de su dueño) y negocia hasta 3 rondas. Los traspasos se ejecutan al cerrar.</p>
      </Card>

      {pending.length > 0 && (
        <Card className="p-0">
          <h3 className="border-b border-line px-4 py-3 font-semibold">Acordados, pendientes de cierre ({pending.length})</h3>
          <ul className="divide-y divide-line/60">
            {pending.map((t) => {
              const p = pById.get(t.player_id);
              return (
                <li key={t.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                  <span className="min-w-40 flex-1 font-medium">
                    {p ? `${p.first_name} ${p.last_name}` : 'Jugador'} <span className="text-muted">({p?.position} · {p?.rating})</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <TeamName team={t.from_team_id ? byId.get(t.from_team_id) : undefined} size={18} short link={false} />
                    <ArrowRight size={14} className="text-muted" />
                    <TeamName team={t.to_team_id ? byId.get(t.to_team_id) : undefined} size={18} short link={false} />
                  </span>
                  <span className="w-20 text-right font-semibold tabular">{money(Number(t.fee))}</span>
                  <Button size="sm" variant="ghost" onClick={() => act(`veto${t.id}`, 'transfer.veto', { transferId: t.id }, 'Fichaje vetado')}>
                    <Ban size={14} /> Vetar
                  </Button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card className="space-y-3">
        <h3 className="flex items-center gap-2 font-semibold">
          <Shuffle size={16} aria-hidden /> Forzar un fichaje
        </h3>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_140px_auto] sm:items-end">
          <div>
            <Label htmlFor="fplayer">Jugador</Label>
            <select id="fplayer" className="focus-ring min-h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-sm" value={force.playerId} onChange={(e) => setForce({ ...force, playerId: e.target.value })}>
              <option value="">Elige…</option>
              {(players.data ?? [])
                .slice()
                .sort((a, b) => b.rating - a.rating)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.first_name} {p.last_name} · {p.position} {p.rating} · {p.team_id ? byId.get(p.team_id)?.short_name : 'libre'}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <Label htmlFor="fteam">Destino</Label>
            <select id="fteam" className="focus-ring min-h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-sm" value={force.toTeamId} onChange={(e) => setForce({ ...force, toTeamId: e.target.value })}>
              <option value="">Elige…</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="ffee">Precio (USD)</Label>
            <Input id="ffee" type="number" min={0} value={force.fee} onChange={(e) => setForce({ ...force, fee: Number(e.target.value) })} />
          </div>
          <Button disabled={!force.playerId || !force.toTeamId || busy !== null} onClick={() => act('force', 'transfer.force', force, 'Fichaje forzado')}>
            Forzar
          </Button>
        </div>
        <p className="text-xs text-muted">Secreto: se ejecuta al momento y queda en la bitácora.</p>
      </Card>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="flex flex-1 items-center gap-2 font-semibold">
            <Dices size={16} aria-hidden /> Draft {draft.data ? `· temporada ${draft.data.season.number}` : ''}
          </h3>
          {picks.length ? <Badge tone={made === picks.length ? 'win' : 'primary'}>{made}/{picks.length} elecciones</Badge> : <Badge>Sin preparar</Badge>}
        </div>
        {draft.isLoading ? (
          <Spinner />
        ) : (
          <div className="flex flex-wrap gap-2">
            {!picks.length && (
              <Button onClick={() => act('prep', 'draft.prepare', {}, 'Draft preparado')} disabled={busy !== null}>
                Preparar novatos y orden
              </Button>
            )}
            {picks.length > 0 && made < picks.length && (
              <Button onClick={() => act('start', 'draft.start', {}, 'Draft iniciado')} disabled={busy !== null}>
                <Play size={16} /> Iniciar draft en vivo
              </Button>
            )}
            <Link to="/mercado">
              <Button variant="outline">Ver la sala del draft</Button>
            </Link>
          </div>
        )}
        <p className="text-xs text-muted">Ronda 1: el peor del ranking de temporada elige primero; después, al azar. Los dueños tienen 60 segundos; si no eligen, elige la IA.</p>
      </Card>

      {recent.length > 0 && (
        <Card className="p-0">
          <h3 className="border-b border-line px-4 py-3 font-semibold">Últimos fichajes</h3>
          <ul className="divide-y divide-line/60">
            {recent.map((t) => {
              const p = pById.get(t.player_id);
              return (
                <li key={t.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                  <span className="flex-1">{p ? `${p.first_name} ${p.last_name}` : 'Jugador'}</span>
                  <TeamName team={t.to_team_id ? byId.get(t.to_team_id) : undefined} size={18} short link={false} />
                  <span className="w-20 text-right tabular text-muted">{money(Number(t.fee))}</span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
