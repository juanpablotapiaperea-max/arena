import { Link } from 'react-router-dom';
import { useHistoricalRanking, useLegacyEditions, useTeams } from '@/lib/hooks';
import { Crest } from '@/components/Crest';
import { ErrorBox, SectionTitle, Spinner } from '@/components/ui';

/** Ranking histórico (desempate: puntos, títulos, subcampeonatos, nombre) e historial importado. */
export function HistoryPage() {
  const { byId, isLoading } = useTeams();
  const ranking = useHistoricalRanking();
  const legacy = useLegacyEditions();

  if (isLoading || ranking.isLoading) return <Spinner />;
  if (ranking.error) return <ErrorBox error={ranking.error} />;

  const rows = (ranking.data ?? [])
    .map((r) => ({ ...r, team: byId.get(r.team_id) }))
    .filter((r) => r.team)
    .sort(
      (a, b) =>
        Number(b.points) - Number(a.points) ||
        b.titles - a.titles ||
        b.runners_up - a.runners_up ||
        a.team!.name.localeCompare(b.team!.name, 'es'),
    );

  return (
    <div className="space-y-8">
      <section>
        <SectionTitle>Ranking histórico</SectionTitle>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wider text-muted">
              <tr className="border-b border-line">
                <th className="w-8 px-2 py-2 sm:px-3">#</th>
                <th className="px-3 py-2">Equipo</th>
                <th className="px-2 py-2 text-right sm:px-3">Tít.</th>
                <th className="hidden px-3 py-2 text-right sm:table-cell">Subcamp.</th>
                <th className="px-3 py-2 text-right">Puntos</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.team_id} className="border-b border-line/50 last:border-0">
                  <td className="px-2 py-2 font-display text-lg font-bold text-muted tabular sm:px-3">{i + 1}</td>
                  <td className="px-3 py-2">
                    <Link to={`/equipos/${r.team!.key}`} className="focus-ring flex min-w-0 items-center gap-2 rounded font-medium hover:text-primary">
                      <Crest team={r.team!} size={24} />
                      <span className="truncate">{r.team!.name}</span>
                    </Link>
                  </td>
                  <td className="px-2 py-2 text-right tabular sm:px-3">{r.titles}</td>
                  <td className="hidden px-3 py-2 text-right tabular sm:table-cell">{r.runners_up}</td>
                  <td className="px-3 py-2 text-right font-display text-lg font-bold tabular">
                    {Math.round(Number(r.points)).toLocaleString('es-MX')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <SectionTitle right={<span className="text-sm text-muted">{legacy.data?.length ?? 0} ediciones</span>}>Historial</SectionTitle>
        {legacy.isLoading ? (
          <Spinner />
        ) : (legacy.data ?? []).length === 0 ? (
          <p className="card p-4 text-sm text-muted">
            El historial de las 171 ediciones aparecerá aquí en cuanto se importe el documento original.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {legacy.data!.map((e) => (
              <li key={e.id} className="card p-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted">
                  {e.competition_name} {e.season_label ? `· ${e.season_label}` : ''}
                </div>
                <div className="mt-1 font-semibold">🏆 {e.champion_name ?? '—'}</div>
                <div className="text-sm text-muted">Subcampeón: {e.runner_up_name ?? '—'}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
