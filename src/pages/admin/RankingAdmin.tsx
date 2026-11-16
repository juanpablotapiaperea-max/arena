// Ranking: puntos base, pesos por competición y ajustes manuales secretos.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { db } from '@/lib/supabase';
import { useCompetitions, useHistoricalRanking, useTeams } from '@/lib/hooks';
import { useA11y } from '@/lib/a11y';
import { Button, Card, ErrorBox, Input, Label, SectionTitle } from '@/components/ui';
import { SettingsForm } from '@/components/SettingsForm';
import { TeamName } from '@/components/game';

export function RankingAdmin() {
  const qc = useQueryClient();
  const { say } = useA11y();
  const comps = useCompetitions();
  const { teams, byId } = useTeams();
  const ranking = useHistoricalRanking();
  const adj = useQuery({ queryKey: ['rank-adj'], queryFn: async () => (await db().from('admin_ranking_adjustments').select('*').order('created_at', { ascending: false })).data ?? [] });
  const [form, setForm] = useState({ team: '', points: 50, note: '' });
  const [error, setError] = useState<unknown>(null);

  const addAdj = async () => {
    setError(null);
    const { error: err } = await db().from('admin_ranking_adjustments').insert({ team_id: form.team, points: form.points, note: form.note || null });
    if (err) return setError(new Error(err.message));
    // También se refleja en el ranking histórico visible.
    const r = ranking.data?.find((x) => x.team_id === form.team);
    if (r) await db().from('ranking_entries').update({ points: Number(r.points) + form.points }).eq('team_id', form.team).is('season_id', null);
    say('Ajuste aplicado');
    qc.invalidateQueries();
  };

  return (
    <div className="space-y-6">
      <SectionTitle>Ranking</SectionTitle>
      <Card>
        <h3 className="mb-3 font-semibold">Puntos base por resultado</h3>
        <SettingsForm
          settingKey="ranking"
          title="Ranking"
          fields={[
            { path: 'base.champion', label: 'Campeón', type: 'number' },
            { path: 'base.runnerUp', label: 'Subcampeón', type: 'number' },
            { path: 'base.semifinal', label: 'Semifinalista', type: 'number' },
            { path: 'base.quarterfinal', label: 'Cuartos de final', type: 'number' },
            { path: 'base.roundOf16', label: 'Octavos de final', type: 'number' },
            { path: 'base.playoffs', label: 'Clasificó a playoffs', type: 'number' },
            { path: 'base.leagueMax', label: 'Liga regular (máximo, 1.º lugar)', type: 'number' },
          ]}
        />
      </Card>
      <Card>
        <h3 className="mb-3 font-semibold">Peso de cada competición</h3>
        <ul className="grid gap-2 sm:grid-cols-2">
          {(comps.data ?? []).map((c) => (
            <li key={c.id} className="flex items-center gap-3">
              <Label htmlFor={`w-${c.id}`}>{c.name}</Label>
              <input
                id={`w-${c.id}`}
                type="number"
                step={0.5}
                min={0}
                defaultValue={Number(c.ranking_weight)}
                onBlur={async (e) => {
                  await db().from('competitions').update({ ranking_weight: Number(e.target.value) }).eq('id', c.id);
                  qc.invalidateQueries({ queryKey: ['competitions'] });
                  say(`Peso de ${c.name} guardado`);
                }}
                className="focus-ring ml-auto w-24 rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-right"
              />
            </li>
          ))}
        </ul>
      </Card>
      <Card className="space-y-3">
        <h3 className="font-semibold">Ajustes manuales (secretos)</h3>
        <ul className="space-y-1">
          {(adj.data ?? []).map((a: Record<string, unknown>) => (
            <li key={String(a.id)} className="flex items-center gap-2 rounded-lg bg-surface-2 px-2 py-1.5 text-sm">
              <TeamName team={byId.get(String(a.team_id))} size={18} link={false} />
              <span className={Number(a.points) >= 0 ? 'text-win' : 'text-loss'}>
                {Number(a.points) >= 0 ? '+' : ''}
                {Number(a.points)}
              </span>
              <span className="flex-1 text-xs text-muted">{String(a.note ?? '')}</span>
            </li>
          ))}
        </ul>
        <div className="grid gap-2 sm:grid-cols-[1fr_120px_1fr_auto] sm:items-end">
          <div>
            <Label htmlFor="rteam">Equipo</Label>
            <select id="rteam" className="focus-ring min-h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-sm" value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value })}>
              <option value="">Elige…</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="rpts">Puntos</Label>
            <Input id="rpts" type="number" value={form.points} onChange={(e) => setForm({ ...form, points: Number(e.target.value) })} />
          </div>
          <div>
            <Label htmlFor="rnote">Nota</Label>
            <Input id="rnote" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </div>
          <Button onClick={addAdj} disabled={!form.team || !form.points}>
            Aplicar
          </Button>
        </div>
        {error ? <ErrorBox error={error} /> : null}
      </Card>
    </div>
  );
}
