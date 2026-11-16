// Asistente de cierre de temporada: revisar, corregir y confirmar.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, Flag, RefreshCw } from 'lucide-react';
import { engine } from '@/lib/engine';
import { useTeams } from '@/lib/hooks';
import { useA11y } from '@/lib/a11y';
import { Button, Card, ErrorBox, SectionTitle, Spinner, cn } from '@/components/ui';
import { TeamName } from '@/components/game';

interface Preview {
  season: { id: string; number: number };
  pending: string[];
  moves: { promoted: string[]; relegated: string[] };
  retiringCandidates: number;
  expiringContracts: number;
}

const STEPS = [
  ['Ranking', 'Los puntos de la temporada ya se sumaron al cerrar cada competición.'],
  ['Divisiones', 'Ascensos y descensos entre Primera y Segunda.'],
  ['Jugadores', 'Progresión por edad y potencial, retiros desde los 34 años y contratos que vencen.'],
  ['Economía', 'Se cobran salarios y se pagan las ventas de camisetas.'],
  ['Nueva temporada', 'Empieza la siguiente; después: draft y mercado de pretemporada.'],
] as const;

export function SeasonClose() {
  const qc = useQueryClient();
  const { say } = useA11y();
  const { byId, teams } = useTeams();
  const preview = useQuery({ queryKey: ['close-preview'], queryFn: () => engine<Preview>('season.closePreview') });
  const [promoted, setPromoted] = useState<string[] | null>(null);
  const [relegated, setRelegated] = useState<string[] | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<{ log: string[]; newSeason: number } | null>(null);

  if (preview.isLoading) return <Spinner />;
  if (preview.error) return <ErrorBox error={preview.error} />;
  const p = preview.data!;
  const up = promoted ?? p.moves.promoted;
  const down = relegated ?? p.moves.relegated;
  const prim = teams.filter((t) => t.division === 1);
  const seg = teams.filter((t) => t.division === 2);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await engine<{ log: string[]; newSeason: number }>('season.close', { moves: { promoted: up, relegated: down } });
      setResult(r);
      say(`Temporada cerrada. Empieza la temporada ${r.newSeason}`);
      await qc.invalidateQueries();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  if (result)
    return (
      <div className="space-y-4">
        <SectionTitle>Cierre de temporada</SectionTitle>
        <Card className="space-y-2 border-win/50">
          <h3 className="flex items-center gap-2 font-display text-2xl font-bold uppercase text-win">
            <CheckCircle2 aria-hidden /> Temporada {result.newSeason} en marcha
          </h3>
          <ul className="list-disc pl-5 text-sm">
            {result.log.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
          <p className="text-sm text-muted">Siguiente: prepara el draft y abre el mercado de pretemporada en «Mercado y draft», y arranca las competiciones nuevas.</p>
        </Card>
      </div>
    );

  return (
    <div className="space-y-5">
      <SectionTitle>Cierre de la temporada {p.season.number}</SectionTitle>
      {p.pending.length > 0 && (
        <div className="rounded-2xl border border-secondary/40 bg-secondary/10 p-4 text-sm" role="status">
          <b className="flex items-center gap-2 text-secondary">
            <AlertTriangle size={16} aria-hidden /> Aún hay competiciones sin terminar
          </b>
          {p.pending.join(', ')}. Puedes cerrar igual; sus resultados no contarán para ascensos.
        </div>
      )}

      <ol className="grid gap-2 sm:grid-cols-5" aria-label="Pasos del cierre">
        {STEPS.map(([title, desc], i) => (
          <li key={title} className="card p-3">
            <div className="font-display text-2xl font-bold text-primary">{i + 1}</div>
            <div className="font-semibold">{title}</div>
            <div className="text-xs text-muted">{desc}</div>
          </li>
        ))}
      </ol>

      <div className="grid gap-4 md:grid-cols-2">
        <MoveList title="Ascienden a Primera" icon={<ArrowUp className="text-win" size={18} />} ids={up} pool={seg.map((t) => t.id)} onChange={setPromoted} byId={byId} />
        <MoveList title="Descienden a Segunda" icon={<ArrowDown className="text-loss" size={18} />} ids={down} pool={prim.map((t) => t.id)} onChange={setRelegated} byId={byId} />
      </div>
      {up.length !== down.length && <p className="text-sm text-secondary">Ascensos y descensos deben ser iguales para mantener 27 equipos por división.</p>}

      <Card className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-xs uppercase text-muted">Candidatos a retiro (34+)</div>
          <div className="font-display text-2xl font-bold">{p.retiringCandidates}</div>
        </div>
        <div>
          <div className="text-xs uppercase text-muted">Contratos que vencen</div>
          <div className="font-display text-2xl font-bold">{p.expiringContracts}</div>
        </div>
      </Card>

      {error ? <ErrorBox error={error} /> : null}
      {!confirm ? (
        <Button onClick={() => setConfirm(true)} disabled={up.length !== down.length}>
          <Flag size={16} /> Cerrar la temporada {p.season.number}
        </Button>
      ) : (
        <Card className="space-y-3 border-loss/50">
          <p className="font-semibold">¿Seguro? Esto no se puede deshacer desde la bitácora.</p>
          <div className="flex gap-2">
            <Button variant="danger" onClick={run} disabled={busy}>
              {busy ? (
                <>
                  <RefreshCw size={16} className="animate-spin" /> Cerrando…
                </>
              ) : (
                'Sí, cerrar'
              )}
            </Button>
            <Button variant="ghost" onClick={() => setConfirm(false)} disabled={busy}>
              Cancelar
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function MoveList({ title, icon, ids, pool, onChange, byId }: { title: string; icon: React.ReactNode; ids: string[]; pool: string[]; onChange: (x: string[]) => void; byId: Map<string, import('@/lib/types').Team> }) {
  const [adding, setAdding] = useState(false);
  return (
    <Card>
      <h3 className="mb-2 flex items-center gap-2 font-semibold">
        {icon} {title} ({ids.length})
      </h3>
      <ul className="space-y-1">
        {ids.map((id) => (
          <li key={id} className="flex items-center gap-2 rounded-lg bg-surface-2 px-2 py-1.5 text-sm">
            <span className="flex-1">
              <TeamName team={byId.get(id)} size={20} link={false} />
            </span>
            <button onClick={() => onChange(ids.filter((x) => x !== id))} className="focus-ring rounded px-2 text-xs text-muted hover:text-loss">
              Quitar
            </button>
          </li>
        ))}
        {!ids.length && <li className="text-sm text-muted">Sin movimientos (falta la tabla de esa división).</li>}
      </ul>
      <button onClick={() => setAdding((a) => !a)} className="focus-ring mt-2 rounded text-xs font-semibold text-primary">
        {adding ? 'Listo' : 'Agregar equipo a mano'}
      </button>
      {adding && (
        <div className="mt-2 grid max-h-48 grid-cols-2 gap-1 overflow-y-auto">
          {pool
            .filter((x) => !ids.includes(x))
            .map((id) => (
              <button key={id} onClick={() => onChange([...ids, id])} className={cn('focus-ring rounded-lg px-2 py-1.5 text-left text-xs hover:bg-surface-2')}>
                <TeamName team={byId.get(id)} size={16} link={false} />
              </button>
            ))}
        </div>
      )}
    </Card>
  );
}
