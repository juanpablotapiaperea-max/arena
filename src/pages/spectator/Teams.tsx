import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useTeams } from '@/lib/hooks';
import { Crest } from '@/components/Crest';
import { TeamStatusTags, useTeamStatus } from '@/components/TeamStatus';
import { ErrorBox, Input, SectionTitle, Spinner, cn } from '@/components/ui';

export function TeamsPage() {
  const { teams, isLoading, error } = useTeams();
  const [q, setQ] = useState('');
  const [division, setDivision] = useState<0 | 1 | 2>(0);
  const status = useTeamStatus();

  const list = useMemo(
    () =>
      teams
        .filter((t) => (division ? t.division === division : true))
        .filter((t) => t.name.toLowerCase().includes(q.trim().toLowerCase()))
        .sort((a, b) => (a.initial_rank ?? 99) - (b.initial_rank ?? 99)),
    [teams, q, division],
  );

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;

  return (
    <div>
      <SectionTitle right={<span className="text-sm text-muted">{teams.length} equipos</span>}>Equipos</SectionTitle>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <Input placeholder="Buscar equipo" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" aria-label="Buscar equipo" />
        </div>
        <div className="flex gap-1 rounded-xl bg-surface-2 p-1" role="tablist" aria-label="División">
          {(
            [
              [0, 'Todos'],
              [1, 'Primera'],
              [2, 'Segunda'],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              role="tab"
              aria-selected={division === v}
              onClick={() => setDivision(v)}
              className={cn('focus-ring min-h-9 rounded-lg px-3 text-sm font-medium', division === v ? 'bg-primary text-bg' : 'text-muted')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((t) => (
          <li key={t.id}>
            <Link
              to={`/equipos/${t.key}`}
              className="focus-ring card flex items-center gap-3 p-3 transition hover:border-primary/60"
              style={{ boxShadow: `inset 4px 0 0 ${t.primary_color}` }}
            >
              <Crest team={t} size={40} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{t.name}</div>
                <div className="text-xs text-muted">{t.division === 1 ? 'Primera División' : 'Segunda División'}</div>
                <div className="mt-1">
                  <TeamStatusTags teamId={t.id} status={status.data} compact />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center font-display tabular">
                {[
                  ['ATQ', t.attack],
                  ['DEF', t.defense],
                  ['POR', t.goalie],
                ].map(([l, v]) => (
                  <div key={l as string}>
                    <div className="text-[10px] font-sans font-semibold text-muted">{l}</div>
                    <div className="text-lg font-bold leading-none">{Math.round(Number(v))}</div>
                  </div>
                ))}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
