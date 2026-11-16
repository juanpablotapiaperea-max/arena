// Competiciones: arrancar ediciones de la temporada, ver su avance y simular
// una jornada al instante. Incluye el constructor de competiciones nuevas.
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FastForward, Hammer, Play, Plus, Trophy } from 'lucide-react';
import { useCompetitions, useTeams } from '@/lib/hooks';
import { engine, getEditions, type Edition } from '@/lib/engine';
import { compColor, FORMAT_LABEL, STATUS_LABEL } from '@/lib/compColors';
import { db } from '@/lib/supabase';
import { useA11y } from '@/lib/a11y';
import type { Competition } from '@/lib/types';
import { Badge, Button, ErrorBox, Input, Label, SectionTitle, Spinner, cn } from '@/components/ui';
import { TeamName } from '@/components/game';
import { Dialog } from './Planner';

const RULE_LABEL = (r: Record<string, unknown>): string => {
  switch (r.type) {
    case 'all':
      return 'Todos los equipos';
    case 'division':
      return r.division === 1 ? 'Primera División' : 'Segunda División';
    case 'historical_top':
      return `Top ${r.n} del ranking histórico`;
    case 'season_top':
      return `Top ${r.n} del ranking de temporada`;
    case 'invite':
      return 'Equipos invitados';
    case 'draw':
      return `${r.n} por sorteo`;
    case 'combo':
      return ((r.parts as Record<string, unknown>[]) ?? []).map(RULE_LABEL).join(' + ');
    case 'competition_top':
      return `Top ${r.n} de ${r.competition}`;
    default:
      return '—';
  }
};

async function editionProgress(editionId: string) {
  const { data } = await db().from('matches').select('status').eq('edition_id', editionId);
  const total = data?.length ?? 0;
  const done = (data ?? []).filter((m) => m.status === 'finished').length;
  return { total, done };
}

export function CompetitionsAdmin() {
  const qc = useQueryClient();
  const { say } = useA11y();
  const comps = useCompetitions();
  const editions = useQuery({ queryKey: ['editions'], queryFn: getEditions });
  const { byId } = useTeams();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [invite, setInvite] = useState<Competition | null>(null);
  const [builder, setBuilder] = useState(false);

  const seasonEditions = useMemo(() => {
    const m = new Map<string, Edition>();
    for (const e of editions.data ?? []) if (!m.has(e.competition_id)) m.set(e.competition_id, e);
    return m;
  }, [editions.data]);

  const act = async (label: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries();
      say(done);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  const start = (c: Competition, invited?: string[]) =>
    act(`start:${c.key}`, () => engine('season.createEdition', { competitionKey: c.key, invited }), `${c.name} arrancó`);

  const startAll = () => {
    const keys = (comps.data ?? []).filter((c) => c.permanent && c.participant_rule.type !== 'invite' && !seasonEditions.get(c.id)).map((c) => c.key);
    return act('startAll', () => engine('season.createEditions', { competitionKeys: keys }), 'Temporada arrancada');
  };

  if (comps.isLoading || editions.isLoading) return <Spinner />;
  const pendingPermanent = (comps.data ?? []).filter((c) => c.permanent && c.participant_rule.type !== 'invite' && !seasonEditions.get(c.id));

  return (
    <div className="space-y-6">
      <SectionTitle
        right={
          <Button variant="outline" size="sm" onClick={() => setBuilder(true)}>
            <Hammer size={14} /> Nueva competición
          </Button>
        }
      >
        Competiciones
      </SectionTitle>
      {error ? <ErrorBox error={error} /> : null}

      {pendingPermanent.length > 0 && (
        <div className="card flex flex-wrap items-center gap-3 border-primary/50 p-4">
          <div className="flex-1">
            <div className="font-semibold">Arrancar la temporada</div>
            <div className="text-sm text-muted">Crea de un golpe {pendingPermanent.map((c) => c.name).join(', ')} con sus participantes según las reglas.</div>
          </div>
          <Button onClick={startAll} disabled={busy !== null}>
            <Play size={16} /> {busy === 'startAll' ? 'Creando…' : 'Arrancar todas'}
          </Button>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {(comps.data ?? []).map((c) => {
          const e = seasonEditions.get(c.id);
          return (
            <CompetitionCard
              key={c.id}
              c={c}
              e={e}
              champion={e?.champion_team_id ? byId.get(e.champion_team_id) : undefined}
              busy={busy}
              onStart={() => (c.participant_rule.type === 'invite' ? setInvite(c) : start(c))}
              onSimulate={(unitIndex) => act(`sim:${e!.id}`, () => engine('unit.simulateNow', { editionId: e!.id, unitIndex }), 'Jornada simulada')}
              onProbabilities={() => act(`prob:${e!.id}`, () => engine('edition.probabilities', { editionId: e!.id }), 'Probabilidades actualizadas')}
            />
          );
        })}
      </div>

      {invite && (
        <InviteDialog
          comp={invite}
          onClose={() => setInvite(null)}
          onConfirm={(ids) => {
            setInvite(null);
            start(invite, ids);
          }}
        />
      )}
      {builder && <BuilderDialog onClose={() => setBuilder(false)} onCreated={() => qc.invalidateQueries({ queryKey: ['competitions'] })} />}
    </div>
  );
}

function CompetitionCard({
  c,
  e,
  champion,
  busy,
  onStart,
  onSimulate,
  onProbabilities,
}: {
  c: Competition;
  e?: Edition;
  champion?: import('@/lib/types').Team;
  busy: string | null;
  onStart: () => void;
  onSimulate: (unitIndex: number) => void;
  onProbabilities: () => void;
}) {
  const color = compColor(c.key);
  const progress = useQuery({ queryKey: ['progress', e?.id], queryFn: () => editionProgress(e!.id), enabled: !!e });
  const nextUnit = useQuery({
    queryKey: ['nextUnit', e?.id, progress.data?.done],
    enabled: !!e && e.status !== 'finished',
    queryFn: async () => {
      const { data } = await db().from('matches').select('unit_index').eq('edition_id', e!.id).eq('status', 'scheduled').order('unit_index').limit(1);
      return data?.[0]?.unit_index as number | undefined;
    },
  });
  const unitLabel = nextUnit.data !== undefined ? e?.state.units.find((u) => u.index === nextUnit.data)?.label : undefined;
  const p = progress.data;
  return (
    <article className="card overflow-hidden" style={{ boxShadow: `inset 0 4px 0 ${color}` }}>
      <div className="flex items-start gap-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-2xl font-bold uppercase leading-none">{c.name}</h3>
            {!c.permanent && <Badge>Especial</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted">
            {FORMAT_LABEL[c.format] ?? c.format} · {RULE_LABEL(c.participant_rule)} · peso ×{Number(c.ranking_weight)}
          </p>
        </div>
        {e ? <Badge tone={e.status === 'finished' ? 'win' : e.status === 'playoffs' ? 'live' : 'primary'}>{STATUS_LABEL[e.status]}</Badge> : <Badge>Sin arrancar</Badge>}
      </div>
      {e ? (
        <div className="space-y-3 border-t border-line p-4">
          {p && (
            <div>
              <div className="mb-1 flex justify-between text-xs text-muted">
                <span>{unitLabel ? `Sigue: ${unitLabel}` : e.status === 'finished' ? 'Terminada' : 'Esperando la siguiente ronda'}</span>
                <span className="tabular">
                  {p.done}/{p.total} partidos
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full" style={{ width: `${p.total ? (p.done / p.total) * 100 : 0}%`, background: color }} />
              </div>
            </div>
          )}
          {champion && (
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Trophy size={16} className="text-secondary" aria-hidden /> Campeón: <TeamName team={champion} size={20} />
            </div>
          )}
          {e.status !== 'finished' && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={busy !== null || nextUnit.data === undefined} onClick={() => onSimulate(nextUnit.data!)}>
                <FastForward size={14} /> {busy === `sim:${e.id}` ? 'Simulando…' : 'Simular siguiente ya'}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy !== null} onClick={onProbabilities}>
                {busy === `prob:${e.id}` ? 'Calculando…' : 'Recalcular probabilidades'}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="border-t border-line p-4">
          <Button size="sm" onClick={onStart} disabled={busy !== null}>
            <Play size={14} /> {busy === `start:${c.key}` ? 'Creando…' : c.participant_rule.type === 'invite' ? 'Invitar y arrancar' : 'Arrancar edición'}
          </Button>
        </div>
      )}
    </article>
  );
}

function InviteDialog({ comp, onClose, onConfirm }: { comp: Competition; onClose: () => void; onConfirm: (ids: string[]) => void }) {
  const { teams } = useTeams();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const sorted = teams.slice().sort((a, b) => (a.initial_rank ?? 99) - (b.initial_rank ?? 99));
  return (
    <Dialog title={`Invitados a ${comp.name}`} onClose={onClose}>
      <p className="mb-3 text-sm text-muted">Elige al menos 4 equipos ({sel.size} elegidos).</p>
      <div className="grid max-h-[50vh] grid-cols-2 gap-1.5 overflow-y-auto">
        {sorted.map((t) => (
          <button
            key={t.id}
            aria-pressed={sel.has(t.id)}
            onClick={() =>
              setSel((s) => {
                const n = new Set(s);
                if (n.has(t.id)) n.delete(t.id);
                else n.add(t.id);
                return n;
              })
            }
            className={cn('focus-ring flex min-h-11 items-center gap-2 rounded-xl border px-2 text-left text-sm', sel.has(t.id) ? 'border-primary bg-primary/10' : 'border-line bg-surface-2')}
          >
            {sel.has(t.id) && <CheckCircle2 size={14} className="shrink-0 text-primary" />}
            <TeamName team={t} size={18} link={false} />
          </button>
        ))}
      </div>
      <Button className="mt-4 w-full" disabled={sel.size < 4} onClick={() => onConfirm([...sel])}>
        Arrancar con {sel.size} equipos
      </Button>
    </Dialog>
  );
}

/** Constructor: competiciones nuevas, permanentes o especiales. */
function BuilderDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [format, setFormat] = useState('league');
  const [rule, setRule] = useState('historical_top');
  const [n, setN] = useState(16);
  const [rounds, setRounds] = useState(2);
  const [playoffs, setPlayoffs] = useState(8);
  const [legs, setLegs] = useState(1);
  const [weight, setWeight] = useState(1);
  const [randomness, setRandomness] = useState(30);
  const [mode, setMode] = useState('realista');
  const [permanent, setPermanent] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const key = name
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '');
      const participant_rule = rule === 'invite' || rule === 'all' ? { type: rule } : { type: rule, n };
      const config: Record<string, unknown> = {
        points: { win: 3, draw: 1, loss: 0, otWin: 2, otLoss: 1 },
        tiebreakers: ['points', 'goal_diff', 'goals_for', 'head_to_head', 'wins'],
        randomness,
        mode,
        overtime: true,
        awayGoals: false,
        roundsPerOpponent: rounds,
        playoffTeams: format === 'league' || format === 'swiss' ? playoffs : undefined,
        playoffLegs: legs,
        singleLegFinal: true,
        neutralFinal: true,
      };
      if (format === 'groups_knockout') Object.assign(config, { groups: Math.max(2, Math.round(n / 4)), groupSize: 4, qualifyPerGroup: 2, roundsPerOpponent: 1 });
      if (format === 'swiss') Object.assign(config, { swissRounds: rounds * 4 });
      const { error: err } = await db().from('competitions').insert({ key, name, format, participant_rule, config, ranking_weight: weight, permanent, sort_order: 50 });
      if (err) throw new Error(err.message);
      onCreated();
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  };

  const sel = 'focus-ring min-h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-sm';
  return (
    <Dialog title="Nueva competición" onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="cname">Nombre</Label>
          <Input id="cname" value={name} onChange={(e) => setName(e.target.value)} placeholder="Copa de Invierno" />
        </div>
        <div>
          <Label htmlFor="cformat">Formato</Label>
          <select id="cformat" className={sel} value={format} onChange={(e) => setFormat(e.target.value)}>
            {Object.entries(FORMAT_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="crule">Participantes</Label>
          <select id="crule" className={sel} value={rule} onChange={(e) => setRule(e.target.value)}>
            <option value="historical_top">Top del ranking histórico</option>
            <option value="season_top">Top del ranking de temporada</option>
            <option value="all">Todos los equipos</option>
            <option value="invite">Invitación manual</option>
            <option value="draw">Sorteo</option>
          </select>
        </div>
        {rule !== 'all' && rule !== 'invite' && (
          <div>
            <Label htmlFor="cn">Número de equipos</Label>
            <Input id="cn" type="number" min={4} max={54} value={n} onChange={(e) => setN(Number(e.target.value))} />
          </div>
        )}
        {(format === 'league' || format === 'swiss') && (
          <>
            <div>
              <Label htmlFor="crounds">{format === 'swiss' ? 'Rondas (×4)' : 'Partidos por rival'}</Label>
              <Input id="crounds" type="number" min={1} max={4} value={rounds} onChange={(e) => setRounds(Number(e.target.value))} />
            </div>
            <div>
              <Label htmlFor="cpo">Clasificados a playoffs</Label>
              <Input id="cpo" type="number" min={0} max={32} value={playoffs} onChange={(e) => setPlayoffs(Number(e.target.value))} />
            </div>
          </>
        )}
        <div>
          <Label htmlFor="clegs">Eliminatorias</Label>
          <select id="clegs" className={sel} value={legs} onChange={(e) => setLegs(Number(e.target.value))}>
            <option value={1}>Partido único</option>
            <option value={2}>Ida y vuelta (final única)</option>
          </select>
        </div>
        <div>
          <Label htmlFor="cweight">Peso en el ranking</Label>
          <Input id="cweight" type="number" step={0.5} min={0} max={5} value={weight} onChange={(e) => setWeight(Number(e.target.value))} />
        </div>
        <div>
          <Label htmlFor="cmode">Modo</Label>
          <select id="cmode" className={sel} value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="realista">Realista</option>
            <option value="balanceado">Balanceado</option>
            <option value="aleatorio">Aleatorio</option>
          </select>
        </div>
        <div>
          <Label htmlFor="crand">Aleatoriedad ({randomness})</Label>
          <input id="crand" type="range" min={0} max={100} value={randomness} onChange={(e) => setRandomness(Number(e.target.value))} className="w-full accent-[rgb(var(--team-primary))]" />
        </div>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={permanent} onChange={(e) => setPermanent(e.target.checked)} className="h-5 w-5" /> Permanente (aparece cada temporada)
        </label>
      </div>
      {error ? <div className="mt-3"><ErrorBox error={error} /></div> : null}
      <Button className="mt-4 w-full" disabled={!name.trim() || saving} onClick={save}>
        <Plus size={16} /> Crear competición
      </Button>
    </Dialog>
  );
}
