import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Undo2 } from 'lucide-react';
import { adminGetLog, adminUndo } from '@/lib/api';
import { Badge, Button, ErrorBox, SectionTitle, Spinner } from '@/components/ui';

const ACTION: Record<string, string> = { INSERT: 'Alta', UPDATE: 'Cambio', DELETE: 'Baja' };
const ENTITY: Record<string, string> = {
  teams: 'Equipo',
  team_private: 'Club (privado)',
  players: 'Jugador',
  matches: 'Partido',
  competitions: 'Competición',
  editions: 'Edición',
  settings: 'Configuración',
  admin_biases: 'Sesgo',
  news: 'Noticia',
  profiles: 'Usuario',
  transfers: 'Fichaje',
  ranking_entries: 'Ranking',
  admin_ranking_adjustments: 'Ajuste de ranking',
};

/** Diferencias entre antes y después, solo de los campos que cambiaron. */
function diff(before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
  if (!before || !after) return [];
  return Object.keys(after)
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map((k) => ({ k, from: before[k], to: after[k] }));
}

export function LogAdmin() {
  const qc = useQueryClient();
  const log = useQuery({ queryKey: ['admin', 'log'], queryFn: () => adminGetLog() });
  const [error, setError] = useState<unknown>(null);

  const undo = async (id: number) => {
    setError(null);
    try {
      await adminUndo(id);
      await qc.invalidateQueries();
    } catch (e) {
      setError(e);
    }
  };

  return (
    <div className="space-y-4">
      <SectionTitle>Bitácora privada</SectionTitle>
      <p className="text-sm text-muted">Solo tú ves este registro. Cada cambio se puede deshacer.</p>
      {error ? <ErrorBox error={error} /> : null}
      {log.isLoading ? (
        <Spinner />
      ) : (log.data ?? []).length === 0 ? (
        <p className="card p-4 text-sm text-muted">Aún no hay cambios registrados.</p>
      ) : (
        <ul className="space-y-2">
          {log.data!.map((l) => {
            const name = (l.after?.name ?? l.before?.name ?? `${l.after?.first_name ?? l.before?.first_name ?? ''} ${l.after?.last_name ?? l.before?.last_name ?? ''}`) as string;
            return (
              <li key={l.id} className="card flex flex-wrap items-start gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge tone="primary">{ACTION[l.action] ?? l.action}</Badge>
                    <span className="font-semibold">{ENTITY[l.entity] ?? l.entity}</span>
                    <span className="truncate text-muted">{name.trim()}</span>
                    {l.undone_at && <Badge>Deshecho</Badge>}
                  </div>
                  <ul className="mt-1 space-y-0.5 font-mono text-xs text-muted">
                    {diff(l.before, l.after)
                      .slice(0, 6)
                      .map((d) => (
                        <li key={d.k}>
                          {d.k}: {JSON.stringify(d.from)} → <span className="text-fg">{JSON.stringify(d.to)}</span>
                        </li>
                      ))}
                  </ul>
                  <div className="mt-1 text-[11px] text-muted">{new Date(l.created_at).toLocaleString('es-MX')}</div>
                </div>
                {!l.undone_at && ['INSERT', 'UPDATE', 'DELETE'].includes(l.action) && (
                  <Button size="sm" variant="outline" onClick={() => undo(l.id)}>
                    <Undo2 size={14} /> Deshacer
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
