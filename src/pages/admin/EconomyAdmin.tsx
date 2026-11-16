// Economía y apuestas: márgenes, topes, bono diario, tope salarial, presupuestos
// y estrategias de la IA por club, y consulta de apuestas.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { db } from '@/lib/supabase';
import { useTeams } from '@/lib/hooks';
import { Card, SectionTitle, Spinner, money, Badge } from '@/components/ui';
import { SettingsForm } from '@/components/SettingsForm';
import { TeamName } from '@/components/game';

const STRATS: [string, string][] = [
  ['estrella', 'Estrella'],
  ['cantera', 'Cantera'],
  ['defensivo', 'Defensivo'],
  ['equilibrado', 'Equilibrado'],
  ['austeridad', 'Austeridad'],
];

export function EconomyAdmin() {
  return (
    <div className="space-y-6">
      <SectionTitle>Economía y apuestas</SectionTitle>
      <Card>
        <h3 className="mb-3 font-semibold">Apuestas</h3>
        <SettingsForm
          settingKey="betting"
          title="Apuestas"
          fields={[
            { path: 'initialCredits', label: 'Créditos iniciales', type: 'number', min: 0 },
            { path: 'dailyBonus', label: 'Bono por día de competencia', type: 'number', min: 0 },
            { path: 'houseMargin', label: 'Margen de la casa', type: 'percent', min: 0, max: 20, hint: 'Entre 5 y 8 % es lo habitual.' },
            { path: 'clubStakeCap', label: 'Tope por apuesta del club (del presupuesto)', type: 'percent', min: 1, max: 100 },
            { path: 'maxParlayLegs', label: 'Máximo de selecciones en combinada', type: 'number', min: 2, max: 10 },
          ]}
        />
      </Card>
      <Card>
        <h3 className="mb-3 font-semibold">Economía de clubes</h3>
        <SettingsForm
          settingKey="economy"
          title="Economía"
          fields={[
            { path: 'ticketPrice', label: 'Precio de entrada', type: 'money', min: 1 },
            { path: 'baseOccupancy', label: 'Ocupación base', type: 'percent', min: 10, max: 100 },
            { path: 'jerseyPerFame', label: 'Camisetas por punto de fama', type: 'money', min: 0 },
            { path: 'prizeByRound.champion', label: 'Premio al campeón', type: 'money' },
            { path: 'prizeByRound.runnerUp', label: 'Premio al subcampeón', type: 'money' },
            { path: 'salaryCap.enabled', label: 'Tope salarial con impuesto de lujo', type: 'boolean' },
            { path: 'salaryCap.cap', label: 'Tope salarial', type: 'money' },
            { path: 'salaryCap.luxuryTaxRate', label: 'Impuesto de lujo', type: 'percent' },
          ]}
        />
      </Card>
      <Clubs />
      <BetsOverview />
    </div>
  );
}

/** Presupuestos y estrategia de la IA de cada club (secreto). */
function Clubs() {
  const qc = useQueryClient();
  const { byId } = useTeams();
  const q = useQuery({ queryKey: ['team-private'], queryFn: async () => ((await db().from('team_private').select('*')).data ?? []) as { team_id: string; budget: number; ai_strategy: string }[] });
  const [edit, setEdit] = useState<Record<string, number>>({});
  if (q.isLoading) return <Spinner />;
  const rows = [...(q.data ?? [])].sort((a, b) => Number(b.budget) - Number(a.budget));
  return (
    <Card className="p-0">
      <h3 className="border-b border-line px-4 py-3 font-semibold">Clubes: presupuesto y estrategia de la IA</h3>
      <div className="max-h-[60vh] overflow-y-auto">
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r) => (
              <tr key={r.team_id} className="border-b border-line/50">
                <td className="max-w-0 px-3 py-1.5">
                  <TeamName team={byId.get(r.team_id)} size={18} link={false} />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="number"
                    aria-label="Presupuesto"
                    className="focus-ring w-32 rounded-lg border border-line bg-surface-2 px-2 py-1 text-right tabular"
                    value={edit[r.team_id] ?? Number(r.budget)}
                    onChange={(e) => setEdit({ ...edit, [r.team_id]: Number(e.target.value) })}
                    onBlur={async () => {
                      if (edit[r.team_id] === undefined) return;
                      await db().from('team_private').update({ budget: edit[r.team_id] }).eq('team_id', r.team_id);
                      qc.invalidateQueries({ queryKey: ['team-private'] });
                    }}
                  />
                  <div className="text-right text-[10px] text-muted">{money(edit[r.team_id] ?? Number(r.budget))}</div>
                </td>
                <td className="px-3 py-1.5">
                  <select
                    aria-label="Estrategia"
                    className="focus-ring rounded-lg border border-line bg-surface-2 px-2 py-1"
                    value={r.ai_strategy}
                    onChange={async (e) => {
                      await db().from('team_private').update({ ai_strategy: e.target.value }).eq('team_id', r.team_id);
                      qc.invalidateQueries({ queryKey: ['team-private'] });
                    }}
                  >
                    {STRATS.map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function BetsOverview() {
  const q = useQuery({
    queryKey: ['admin-bets'],
    queryFn: async () => ((await db().from('bets').select('status,stake,payout,source').limit(5000)).data ?? []) as { status: string; stake: number; payout: number | null; source: string }[],
  });
  if (q.isLoading) return <Spinner />;
  const rows = q.data ?? [];
  const staked = rows.reduce((s, b) => s + Number(b.stake), 0);
  const paid = rows.reduce((s, b) => s + Number(b.payout ?? 0), 0);
  return (
    <Card>
      <h3 className="mb-3 font-semibold">Apuestas registradas</h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-xl bg-surface-2 p-3">
          <div className="text-[11px] uppercase text-muted">Selecciones</div>
          <div className="font-display text-2xl font-bold">{rows.length}</div>
        </div>
        <div className="rounded-xl bg-surface-2 p-3">
          <div className="text-[11px] uppercase text-muted">Abiertas</div>
          <div className="font-display text-2xl font-bold">{rows.filter((b) => b.status === 'open').length}</div>
        </div>
        <div className="rounded-xl bg-surface-2 p-3">
          <div className="text-[11px] uppercase text-muted">Apostado</div>
          <div className="font-display text-2xl font-bold">{staked.toLocaleString('es-MX')}</div>
        </div>
        <div className="rounded-xl bg-surface-2 p-3">
          <div className="text-[11px] uppercase text-muted">Pagado</div>
          <div className="font-display text-2xl font-bold">{paid.toLocaleString('es-MX')}</div>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted">
        <Badge>Club</Badge> {rows.filter((b) => b.source === 'club').length} apuestas con dinero de clubes.
      </p>
    </Card>
  );
}
