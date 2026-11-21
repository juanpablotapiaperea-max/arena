// Estado de cada equipo en la liga: si acaba de ascender o descender, y cuántas
// temporadas lleva sin descender.
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Flame } from 'lucide-react';
import { DEMO_MODE, db } from '@/lib/supabase';
import { Badge } from './ui';

export interface TeamStatus {
  justMoved: 'promoted' | 'relegated' | null;
  division: 1 | 2 | null;
  /** Temporadas completas desde el último ascenso o descenso del equipo. */
  streak: number;
  sinceDate: string | null;
  season: number;
}

export function useTeamStatus() {
  return useQuery({
    queryKey: ['team-status'],
    enabled: !DEMO_MODE,
    staleTime: 60_000,
    queryFn: async () => {
      const [{ data: seasons }, { data: moves }] = await Promise.all([
        db().from('seasons').select('id,number,status,started_at,closed_at'),
        db().from('team_movements').select('team_id,kind,season_id'),
      ]);
      const list = (seasons ?? []) as { id: string; number: number; status: string; started_at: string; closed_at: string | null }[];
      const active = list.find((s) => s.status === 'active') ?? list.sort((a, b) => b.number - a.number)[0];
      const C = active?.number ?? 1;
      const numberOf = new Map(list.map((s) => [s.id, s.number]));
      const closedOf = new Map(list.map((s) => [s.number, s.closed_at]));
      const first = list.find((s) => s.number === 1);
      // Último movimiento (ascenso o descenso) y si ocurrió en la temporada actual.
      type Acc = { justMoved: TeamStatus['justMoved']; lastMove: number };
      const acc = new Map<string, Acc>();
      const ms = (moves ?? []) as { team_id: string; kind: 'promoted' | 'relegated'; season_id: string }[];
      for (const m of ms) {
        const n = numberOf.get(m.season_id) ?? 0;
        const cur: Acc = acc.get(m.team_id) ?? { justMoved: null, lastMove: 0 };
        if (n > cur.lastMove) cur.lastMove = n;
        if (n === C) cur.justMoved = m.kind;
        acc.set(m.team_id, cur);
      }
      // Equipos en su división desde el último cambio. Quien acaba de cambiar no tiene racha.
      const result = new Map<string, TeamStatus>();
      const allTeams = await db().from('teams').select('id,division');
      for (const t of (allTeams.data ?? []) as { id: string; division: 1 | 2 | null }[]) {
        const cur: Acc = acc.get(t.id) ?? { justMoved: null, lastMove: 0 };
        const L = cur.lastMove;
        result.set(t.id, {
          justMoved: cur.justMoved,
          division: t.division,
          streak: cur.justMoved ? 0 : L ? Math.max(0, C - L) : Math.max(0, C - 1),
          sinceDate: (L ? closedOf.get(L - 1) : first?.started_at) ?? null,
          season: C,
        });
      }
      return result;
    },
  });
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86_400_000));
}

/** Etiquetas de un equipo: recién ascendido / descendido y racha sin descender. */
export function TeamStatusTags({ teamId, status, compact = false }: { teamId: string; status?: Map<string, TeamStatus>; compact?: boolean }) {
  const q = useTeamStatus();
  const s = (status ?? q.data)?.get(teamId);
  if (!s) return null;
  const days = daysSince(s.sinceDate);
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {s.justMoved === 'promoted' && (
        <Badge tone="win">
          <ArrowUp size={12} className="inline" aria-hidden /> {compact ? 'Ascendido' : 'Recién ascendido'}
        </Badge>
      )}
      {s.justMoved === 'relegated' && (
        <Badge tone="loss">
          <ArrowDown size={12} className="inline" aria-hidden /> {compact ? 'Descendido' : 'Recién descendido'}
        </Badge>
      )}
      {!s.justMoved && s.streak >= 1 && (
        <span className="inline-flex items-center gap-1 rounded-full bg-secondary/15 px-2 py-0.5 text-[11px] font-semibold text-secondary" title={days != null ? `Desde hace ${days} días` : undefined}>
          <Flame size={12} aria-hidden />
          {s.streak} {s.streak === 1 ? 'temporada' : 'temporadas'} sin {s.division === 2 ? 'ascender' : 'descender'}
          {!compact && days != null && days > 0 ? <span className="font-normal text-secondary/70"> · {days} días</span> : null}
        </span>
      )}
    </span>
  );
}
