// Estadísticas: líderes de la temporada, equipos y Versus (comparador de hasta 4).
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import { BarChart3, Plus, X } from 'lucide-react';
import { useHistoricalRanking, usePlayers, useTeams } from '@/lib/hooks';
import { db } from '@/lib/supabase';
import type { PlayerStat } from '@/lib/engine';
import type { Team } from '@/lib/types';
import { Badge, SectionTitle, Spinner, cn } from '@/components/ui';
import { TeamName } from '@/components/game';
import { Crest } from '@/components/Crest';

type Tab = 'versus' | 'jugadores' | 'equipos';

export function StatsPage() {
  const [tab, setTab] = useState<Tab>('versus');
  return (
    <div className="space-y-4">
      <SectionTitle>Estadísticas</SectionTitle>
      <div className="-mx-4 flex gap-1 overflow-x-auto px-4" role="tablist">
        {(
          [
            ['versus', 'Versus'],
            ['jugadores', 'Jugadores'],
            ['equipos', 'Equipos'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn('focus-ring min-h-10 shrink-0 rounded-xl px-3.5 text-sm font-semibold', tab === k ? 'bg-primary text-bg' : 'bg-surface-2 text-muted')}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'versus' && <Versus />}
      {tab === 'jugadores' && <PlayerLeaders />}
      {tab === 'equipos' && <TeamRecords />}
    </div>
  );
}

/** Totales de la temporada por equipo a partir de los box scores. */
function useTeamTotals() {
  return useQuery({
    queryKey: ['team-totals'],
    queryFn: async () => {
      const out = new Map<string, { gp: number; gf: number; ga: number; shots: number; shotsAgainst: number; pim: number; ppg: number; pp: number; w: number }>();
      for (let from = 0; ; from += 1000) {
        const { data } = await db().from('match_team_stats').select('match_id,team_id,is_home,goals,shots,saves,pim,power_plays,power_play_goals').range(from, from + 999);
        const rows = data ?? [];
        const byMatch = new Map<string, typeof rows>();
        for (const r of rows) {
          if (!byMatch.has(r.match_id)) byMatch.set(r.match_id, []);
          byMatch.get(r.match_id)!.push(r);
        }
        for (const pair of byMatch.values()) {
          for (const r of pair) {
            const opp = pair.find((x) => x.team_id !== r.team_id);
            const t = out.get(r.team_id) ?? { gp: 0, gf: 0, ga: 0, shots: 0, shotsAgainst: 0, pim: 0, ppg: 0, pp: 0, w: 0 };
            t.gp++;
            t.gf += r.goals;
            t.ga += opp?.goals ?? 0;
            t.shots += r.shots;
            t.shotsAgainst += opp?.shots ?? 0;
            t.pim += r.pim;
            t.ppg += r.power_play_goals;
            t.pp += r.power_plays;
            if (opp && r.goals > opp.goals) t.w++;
            out.set(r.team_id, t);
          }
        }
        if (rows.length < 1000) break;
      }
      return out;
    },
    staleTime: 60_000,
  });
}

function Versus() {
  const { teams, byId } = useTeams();
  const ranking = useHistoricalRanking();
  const totals = useTeamTotals();
  const [picked, setPicked] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const sel = picked.length ? picked : teams.slice().sort((a, b) => (a.initial_rank ?? 99) - (b.initial_rank ?? 99)).slice(0, 2).map((t) => t.id);
  const rank = new Map((ranking.data ?? []).map((r) => [r.team_id, r]));
  const t = totals.data;
  // Ejes del radar: ataque, defensa, portería, disciplina y forma (0-100).
  const data = useMemo(() => {
    const axes = ['Ataque', 'Defensa', 'Portería', 'Disciplina', 'Forma'];
    return axes.map((axis) => {
      const row: Record<string, number | string> = { axis };
      for (const id of sel) {
        const team = byId.get(id);
        const tt = t?.get(id);
        if (!team) continue;
        let v = 0;
        if (axis === 'Ataque') v = Number(team.attack);
        else if (axis === 'Defensa') v = Number(team.defense);
        else if (axis === 'Portería') v = Number(team.goalie);
        else if (axis === 'Disciplina') v = tt && tt.gp ? Math.max(40, 100 - (tt.pim / tt.gp) * 4) : 80;
        else v = tt && tt.gp ? 40 + (tt.w / tt.gp) * 60 : 70;
        row[team.short_name] = Math.round(v * 10) / 10;
      }
      return row;
    });
  }, [sel, byId, t]);

  const rows: [string, (id: string) => string | number][] = [
    ['Títulos', (id) => rank.get(id)?.titles ?? 0],
    ['Subcampeonatos', (id) => rank.get(id)?.runners_up ?? 0],
    ['Puntos de ranking', (id) => Math.round(Number(rank.get(id)?.points ?? 0)).toLocaleString('es-MX')],
    ['Ataque', (id) => Number(byId.get(id)?.attack ?? 0).toFixed(1)],
    ['Defensa', (id) => Number(byId.get(id)?.defense ?? 0).toFixed(1)],
    ['Portería', (id) => Number(byId.get(id)?.goalie ?? 0).toFixed(1)],
    ['Partidos (temporada)', (id) => t?.get(id)?.gp ?? 0],
    ['Goles por partido', (id) => (t?.get(id)?.gp ? (t!.get(id)!.gf / t!.get(id)!.gp).toFixed(2) : '—')],
    ['Recibidos por partido', (id) => (t?.get(id)?.gp ? (t!.get(id)!.ga / t!.get(id)!.gp).toFixed(2) : '—')],
    ['% de tiro', (id) => (t?.get(id)?.shots ? `${((t!.get(id)!.gf / t!.get(id)!.shots) * 100).toFixed(1)}%` : '—')],
    ['Power play', (id) => (t?.get(id)?.pp ? `${((t!.get(id)!.ppg / t!.get(id)!.pp) * 100).toFixed(0)}%` : '—')],
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {sel.map((id) => {
          const team = byId.get(id);
          return (
            <span key={id} className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface-2 py-1 pl-2 pr-1 text-sm">
              <TeamName team={team} size={20} link={false} />
              <button onClick={() => setPicked(sel.filter((x) => x !== id))} className="focus-ring rounded p-1 text-muted hover:text-fg" aria-label={`Quitar ${team?.name}`}>
                <X size={14} />
              </button>
            </span>
          );
        })}
        {sel.length < 4 && (
          <button onClick={() => setAdding((a) => !a)} className="focus-ring inline-flex min-h-9 items-center gap-1 rounded-xl border border-dashed border-line px-3 text-sm text-muted">
            <Plus size={14} /> Agregar equipo
          </button>
        )}
      </div>
      {adding && (
        <div className="card grid max-h-64 grid-cols-2 gap-1 overflow-y-auto p-2 sm:grid-cols-3">
          {teams
            .filter((x) => !sel.includes(x.id))
            .sort((a, b) => a.name.localeCompare(b.name, 'es'))
            .map((x) => (
              <button
                key={x.id}
                onClick={() => {
                  setPicked([...sel, x.id]);
                  setAdding(false);
                }}
                className="focus-ring flex min-h-10 items-center rounded-lg px-2 text-left text-sm hover:bg-surface-2"
              >
                <TeamName team={x} size={18} link={false} />
              </button>
            ))}
        </div>
      )}

      <div className="card h-80 p-2" role="img" aria-label={`Radar comparando ${sel.map((id) => byId.get(id)?.name).join(', ')}`}>
        <ResponsiveContainer>
          <RadarChart data={data} outerRadius="72%">
            <PolarGrid stroke="rgb(var(--line))" />
            <PolarAngleAxis dataKey="axis" tick={{ fill: 'rgb(var(--muted))', fontSize: 12 }} />
            <PolarRadiusAxis domain={[40, 100]} tick={false} axisLine={false} />
            {sel.map((id) => {
              const team = byId.get(id)!;
              return team ? <Radar key={id} name={team.short_name} dataKey={team.short_name} stroke={team.primary_color} fill={team.primary_color} fillOpacity={0.18} strokeWidth={2} /> : null;
            })}
            <Legend />
            <Tooltip contentStyle={{ background: 'rgb(var(--surface))', border: '1px solid rgb(var(--line))', borderRadius: 12 }} />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className="px-3 py-2 text-left text-[11px] uppercase text-muted">Dato</th>
              {sel.map((id) => (
                <th key={id} className="px-3 py-2 text-right">
                  {byId.get(id) && <Crest team={byId.get(id)!} size={24} className="ml-auto" />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, fn]) => (
              <tr key={label} className="border-b border-line/50 last:border-0">
                <td className="px-3 py-1.5 text-muted">{label}</td>
                {sel.map((id) => (
                  <td key={id} className="px-3 py-1.5 text-right font-semibold tabular">
                    {fn(id)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totals.isLoading && <Spinner label="Sumando la temporada…" />}
    </div>
  );
}

function PlayerLeaders() {
  const players = usePlayers();
  const { byId } = useTeams();
  const stats = useQuery({
    queryKey: ['all-player-stats'],
    queryFn: async () => {
      const out: PlayerStat[] = [];
      for (let from = 0; ; from += 1000) {
        const { data } = await db().from('player_edition_stats').select('*').range(from, from + 999);
        out.push(...((data ?? []) as PlayerStat[]));
        if ((data ?? []).length < 1000) break;
      }
      // Suma de todas las ediciones de la temporada por jugador.
      const by = new Map<string, PlayerStat>();
      for (const s of out) {
        const cur = by.get(s.player_id);
        if (!cur) by.set(s.player_id, { ...s });
        else for (const k of ['gp', 'goals', 'assists', 'plus_minus', 'shots', 'pim', 'gwg', 'hat_tricks', 'mvps', 'saves', 'goals_against', 'shutouts', 'wins', 'goalie_gp'] as const) (cur[k] as number) += s[k] as number;
      }
      return [...by.values()];
    },
  });
  const [metric, setMetric] = useState<'puntos' | 'goals' | 'assists' | 'plus_minus' | 'mvps' | 'hat_tricks' | 'saves'>('puntos');
  const names = new Map((players.data ?? []).map((p) => [p.id, p]));
  if (stats.isLoading) return <Spinner />;
  if (!(stats.data ?? []).length) return <p className="card p-4 text-sm text-muted">Las estadísticas de jugadores aparecen cuando se juegan los primeros partidos.</p>;
  const val = (s: PlayerStat) => (metric === 'puntos' ? s.goals + s.assists : (s[metric] as number));
  const list = [...stats.data!].filter((s) => (metric === 'saves' ? s.goalie_gp > 0 : true)).sort((a, b) => val(b) - val(a)).slice(0, 25);
  const labels = { puntos: 'Puntos', goals: 'Goles', assists: 'Asistencias', plus_minus: 'Más/menos', mvps: 'MVP', hat_tricks: 'Hat-tricks', saves: 'Atajadas' } as const;
  return (
    <div className="space-y-3">
      <div className="-mx-4 flex gap-1 overflow-x-auto px-4">
        {(Object.keys(labels) as (keyof typeof labels)[]).map((k) => (
          <button key={k} onClick={() => setMetric(k)} aria-pressed={metric === k} className={cn('focus-ring min-h-9 shrink-0 rounded-xl px-3 text-sm', metric === k ? 'bg-primary text-bg' : 'bg-surface-2 text-muted')}>
            {labels[k]}
          </button>
        ))}
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase text-muted">
            <tr className="border-b border-line">
              <th className="px-3 py-2 text-left">#</th>
              <th className="px-3 py-2 text-left">Jugador</th>
              <th className="px-2 py-2 text-right">PJ</th>
              <th className="hidden px-2 py-2 text-right sm:table-cell">G</th>
              <th className="hidden px-2 py-2 text-right sm:table-cell">A</th>
              <th className="px-3 py-2 text-right">{labels[metric]}</th>
            </tr>
          </thead>
          <tbody>
            {list.map((s, i) => {
              const p = names.get(s.player_id);
              const team = p?.team_id ? byId.get(p.team_id) : undefined;
              return (
                <tr key={s.player_id} className="border-b border-line/50 last:border-0">
                  <td className="px-3 py-1.5 font-display font-bold text-muted tabular">{i + 1}</td>
                  <td className="max-w-0 px-3 py-1.5">
                    <span className="flex items-center gap-2">
                      {team && <Crest team={team} size={18} />}
                      <span className="truncate">{p ? `${p.first_name} ${p.last_name}` : 'Jugador'}</span>
                      {s.hat_tricks > 0 && metric !== 'hat_tricks' && <Badge>🎩 {s.hat_tricks}</Badge>}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular text-muted">{metric === 'saves' ? s.goalie_gp : s.gp}</td>
                  <td className="hidden px-2 py-1.5 text-right tabular sm:table-cell">{s.goals}</td>
                  <td className="hidden px-2 py-1.5 text-right tabular sm:table-cell">{s.assists}</td>
                  <td className="px-3 py-1.5 text-right font-display text-lg font-bold tabular">{val(s)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TeamRecords() {
  const totals = useTeamTotals();
  const { teams } = useTeams();
  const [sort, setSort] = useState<'gf' | 'ga' | 'shots' | 'pp'>('gf');
  if (totals.isLoading) return <Spinner />;
  const rows = teams
    .map((t) => ({ t, s: totals.data?.get(t.id) }))
    .filter((r) => r.s && r.s.gp > 0)
    .sort((a, b) => {
      const v = (x: typeof a) => (sort === 'gf' ? x.s!.gf / x.s!.gp : sort === 'ga' ? -(x.s!.ga / x.s!.gp) : sort === 'shots' ? x.s!.gf / Math.max(1, x.s!.shots) : x.s!.ppg / Math.max(1, x.s!.pp));
      return v(b) - v(a);
    });
  if (!rows.length) return <p className="card p-4 text-sm text-muted">Aún no hay partidos jugados esta temporada.</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {(
          [
            ['gf', 'Mejor ataque'],
            ['ga', 'Mejor defensa'],
            ['shots', 'Puntería'],
            ['pp', 'Power play'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} onClick={() => setSort(k)} aria-pressed={sort === k} className={cn('focus-ring min-h-9 rounded-xl px-3 text-sm', sort === k ? 'bg-primary text-bg' : 'bg-surface-2 text-muted')}>
            {l}
          </button>
        ))}
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase text-muted">
            <tr className="border-b border-line">
              <th className="px-3 py-2 text-left">Equipo</th>
              <th className="px-2 py-2 text-right">PJ</th>
              <th className="px-2 py-2 text-right">GF/PJ</th>
              <th className="px-2 py-2 text-right">GC/PJ</th>
              <th className="hidden px-2 py-2 text-right sm:table-cell">% tiro</th>
              <th className="hidden px-2 py-2 text-right sm:table-cell">PP</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ t, s }) => (
              <tr key={t.id} className="border-b border-line/50 last:border-0">
                <td className="max-w-0 px-3 py-1.5">
                  <TeamName team={t as Team} size={18} />
                </td>
                <td className="px-2 py-1.5 text-right tabular text-muted">{s!.gp}</td>
                <td className="px-2 py-1.5 text-right font-semibold tabular">{(s!.gf / s!.gp).toFixed(2)}</td>
                <td className="px-2 py-1.5 text-right tabular">{(s!.ga / s!.gp).toFixed(2)}</td>
                <td className="hidden px-2 py-1.5 text-right tabular sm:table-cell">{((s!.gf / Math.max(1, s!.shots)) * 100).toFixed(1)}%</td>
                <td className="hidden px-2 py-1.5 text-right tabular sm:table-cell">{s!.pp ? `${Math.round((s!.ppg / s!.pp) * 100)}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export { BarChart3 };
