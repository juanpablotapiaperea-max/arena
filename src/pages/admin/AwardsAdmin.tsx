// Premios: el administrador entrega el Balón de Oro entre los 10 nominados.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { engine } from '@/lib/engine';
import { useA11y } from '@/lib/a11y';
import { BalonOro } from '@/components/HallOfFame';
import { ErrorBox } from '@/components/ui';

export function AwardsAdmin() {
  const qc = useQueryClient();
  const { say } = useA11y();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);
  const pick = async (playerId: string) => {
    if (!window.confirm('¿Entregar el Balón de Oro de esta temporada a este jugador? Se publicará una noticia. Si ya lo habías entregado, se reemplaza.')) return;
    setBusy(playerId);
    setError(null);
    try {
      const r = await engine<{ player: string; team: string }>('awards.balonOro', { playerId });
      setDone(`${r.player} (${r.team}) es el nuevo Balón de Oro.`);
      say('Balón de Oro entregado');
      await qc.invalidateQueries({ queryKey: ['balon-oro-winners'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="space-y-4">
      {done && (
        <p className="rounded-xl border border-yellow-400/40 bg-yellow-400/10 p-3 text-sm font-semibold text-yellow-200" role="status">
          🏆 {done}
        </p>
      )}
      {error ? <ErrorBox error={error} /> : null}
      <p className="text-sm text-muted">Los premios de cada competición (goleador, asistidor, MVP del torneo y mejor portero) se entregan solos al terminar. El Balón de Oro lo eliges tú.</p>
      <BalonOro onPick={pick} busyId={busy} />
    </div>
  );
}
