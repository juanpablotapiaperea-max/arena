// Eventos: clásicos, eventos del momento (forzar o vetar en vivo) y sesgos
// secretos. Todo es invisible para los demás usuarios.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { EyeOff, Lock, Plus, Radio, Star, Trash2 } from 'lucide-react';
import { db } from '@/lib/supabase';
import { getEditions, type Match } from '@/lib/engine';
import { useCompetitions, useTeams } from '@/lib/hooks';
import { useA11y } from '@/lib/a11y';
import { Badge, Button, Card, ErrorBox, Input, Label, SectionTitle, Spinner } from '@/components/ui';
import { TeamName, fmtTime } from '@/components/game';

const sel = 'focus-ring min-h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-sm';

export function EventsAdmin() {
  return (
    <div className="space-y-6">
      <SectionTitle>Eventos</SectionTitle>
      <UpcomingMain />
      <Classics />
      <Biases />
    </div>
  );
}

/** Partidos próximos: convertir en evento principal o quitarlo. */
function UpcomingMain() {
  const qc = useQueryClient();
  const { byId } = useTeams();
  const { say } = useA11y();
  const q = useQuery({
    queryKey: ['admin-upcoming'],
    queryFn: async () => {
      const { data } = await db().from('matches').select('*').eq('status', 'scheduled').order('unit_index').limit(400);
      return (data ?? []) as Match[];
    },
  });
  const [filter, setFilter] = useState('');
  const toggle = async (m: Match) => {
    await db()
      .from('matches')
      .update({ is_main_event: !m.is_main_event, event_name: !m.is_main_event ? `Evento del momento · ${byId.get(m.home_team_id)?.name} vs ${byId.get(m.away_team_id)?.name}` : null })
      .eq('id', m.id);
    say(m.is_main_event ? 'Evento quitado' : 'Partido convertido en evento principal');
    qc.invalidateQueries({ queryKey: ['admin-upcoming'] });
  };
  const list = (q.data ?? []).filter((m) => {
    if (!filter) return true;
    const s = `${byId.get(m.home_team_id)?.name} ${byId.get(m.away_team_id)?.name}`.toLowerCase();
    return s.includes(filter.toLowerCase());
  });
  return (
    <Card className="space-y-3">
      <h3 className="flex items-center gap-2 font-semibold">
        <Radio size={16} className="text-live" aria-hidden /> Eventos del momento
      </h3>
      <p className="text-sm text-muted">
        Los cuartos, semifinales, finales y derbis (puntaje ≥ 70) ya van en vivo solos al iniciar el día. Aquí puedes forzar cualquier otro partido o quitar uno.
      </p>
      <Input placeholder="Buscar equipo" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Buscar equipo" />
      {q.isLoading ? (
        <Spinner />
      ) : (
        <ul className="max-h-80 divide-y divide-line/60 overflow-y-auto">
          {list.slice(0, 80).map((m) => (
            <li key={m.id} className="flex items-center gap-2 py-2 text-sm">
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                <TeamName team={byId.get(m.home_team_id)} size={18} short link={false} /> vs <TeamName team={byId.get(m.away_team_id)} size={18} short link={false} />
                {m.round && <Badge>{m.round}</Badge>}
                {m.scheduled_at && <span className="text-xs text-muted">{fmtTime(m.scheduled_at)}</span>}
              </span>
              <Button size="sm" variant={m.is_main_event ? 'primary' : 'outline'} onClick={() => toggle(m)}>
                {m.is_main_event ? 'En vivo ✓' : 'Hacer evento'}
              </Button>
            </li>
          ))}
          {!list.length && <li className="py-3 text-sm text-muted">No hay partidos programados.</li>}
        </ul>
      )}
    </Card>
  );
}

function Classics() {
  const qc = useQueryClient();
  const { teams, byId } = useTeams();
  const comps = useCompetitions();
  const q = useQuery({ queryKey: ['classics'], queryFn: async () => (await db().from('classics').select('*')).data ?? [] });
  const [form, setForm] = useState({ a: '', b: '', comp: '', name: '' });
  const [error, setError] = useState<unknown>(null);
  const add = async () => {
    setError(null);
    const { error: err } = await db().from('classics').insert({ team_a: form.a, team_b: form.b, competition_id: form.comp || null, name: form.name || null });
    if (err) setError(new Error(err.message));
    else {
      setForm({ a: '', b: '', comp: '', name: '' });
      qc.invalidateQueries({ queryKey: ['classics'] });
    }
  };
  return (
    <Card className="space-y-3">
      <h3 className="flex items-center gap-2 font-semibold">
        <Star size={16} className="text-secondary" aria-hidden /> Clásicos
      </h3>
      <p className="text-sm text-muted">Un clásico siempre se transmite en vivo, en todas las competiciones o solo en una.</p>
      <ul className="space-y-1">
        {(q.data ?? []).map((c: Record<string, string | null>) => (
          <li key={c.id!} className="flex items-center gap-2 rounded-lg bg-surface-2 px-2 py-1.5 text-sm">
            <TeamName team={byId.get(c.team_a!)} size={18} short link={false} /> vs <TeamName team={byId.get(c.team_b!)} size={18} short link={false} />
            <span className="flex-1 text-xs text-muted">{c.name ?? ''} · {c.competition_id ? comps.data?.find((x) => x.id === c.competition_id)?.name : 'global'}</span>
            <button
              onClick={async () => {
                await db().from('classics').delete().eq('id', c.id!);
                qc.invalidateQueries({ queryKey: ['classics'] });
              }}
              className="focus-ring rounded p-1 text-muted hover:text-loss"
              aria-label="Quitar clásico"
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>
      <div className="grid gap-2 sm:grid-cols-4">
        {(['a', 'b'] as const).map((k) => (
          <select key={k} className={sel} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} aria-label={k === 'a' ? 'Equipo A' : 'Equipo B'}>
            <option value="">{k === 'a' ? 'Equipo A' : 'Equipo B'}</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        ))}
        <select className={sel} value={form.comp} onChange={(e) => setForm({ ...form, comp: e.target.value })} aria-label="Competición">
          <option value="">Todas (global)</option>
          {(comps.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <Input placeholder="Nombre (opcional)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="Nombre del clásico" />
      </div>
      {error ? <ErrorBox error={error} /> : null}
      <Button size="sm" onClick={add} disabled={!form.a || !form.b || form.a === form.b}>
        <Plus size={14} /> Agregar clásico
      </Button>
    </Card>
  );
}

/** Sesgos secretos: multiplicadores 0.7-1.3 sobre los goles esperados. */
function Biases() {
  const qc = useQueryClient();
  const { teams, byId } = useTeams();
  const editions = useQuery({ queryKey: ['editions'], queryFn: getEditions });
  const q = useQuery({ queryKey: ['biases'], queryFn: async () => (await db().from('admin_biases').select('*').order('created_at', { ascending: false })).data ?? [] });
  const [form, setForm] = useState({ team: '', scope: 'competition', edition: '', from: 1, to: 5, multiplier: 1.1, note: '' });
  const [error, setError] = useState<unknown>(null);
  const add = async () => {
    setError(null);
    const { error: err } = await db()
      .from('admin_biases')
      .insert({
        team_id: form.team,
        scope: form.scope,
        edition_id: form.edition || null,
        from_matchday: form.scope === 'matchday_range' ? form.from : null,
        to_matchday: form.scope === 'matchday_range' ? form.to : null,
        multiplier: form.multiplier,
        note: form.note || null,
      });
    if (err) setError(new Error(err.message));
    else qc.invalidateQueries({ queryKey: ['biases'] });
  };
  return (
    <Card className="space-y-3 border-secondary/40">
      <h3 className="flex items-center gap-2 font-semibold">
        <Lock size={16} className="text-secondary" aria-hidden /> Sesgos secretos
      </h3>
      <p className="flex items-center gap-1.5 text-sm text-muted">
        <EyeOff size={14} aria-hidden /> Solo tú los ves. Nunca entran en cuotas, probabilidades ni estadísticas esperadas.
      </p>
      <ul className="space-y-1">
        {(q.data ?? []).map((b: Record<string, unknown>) => (
          <li key={String(b.id)} className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 px-2 py-1.5 text-sm">
            <TeamName team={byId.get(String(b.team_id))} size={18} link={false} />
            <Badge tone={Number(b.multiplier) >= 1 ? 'win' : 'loss'}>×{Number(b.multiplier).toFixed(2)}</Badge>
            <span className="flex-1 text-xs text-muted">
              {b.scope === 'competition' ? (b.edition_id ? editions.data?.find((e) => e.id === b.edition_id)?.name : 'todas las competiciones') : `jornadas ${b.from_matchday}-${b.to_matchday}`}
              {b.note ? ` · ${b.note}` : ''}
            </span>
            <button
              onClick={async () => {
                await db().from('admin_biases').update({ active: !b.active }).eq('id', String(b.id));
                qc.invalidateQueries({ queryKey: ['biases'] });
              }}
              className="focus-ring rounded px-2 text-xs"
            >
              {b.active ? 'Activo' : 'Pausado'}
            </button>
            <button
              onClick={async () => {
                await db().from('admin_biases').delete().eq('id', String(b.id));
                qc.invalidateQueries({ queryKey: ['biases'] });
              }}
              className="focus-ring rounded p-1 text-muted hover:text-loss"
              aria-label="Borrar sesgo"
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
        {!(q.data ?? []).length && <li className="text-sm text-muted">Sin sesgos.</li>}
      </ul>
      <div className="grid gap-2 sm:grid-cols-3">
        <div>
          <Label htmlFor="bteam">Equipo</Label>
          <select id="bteam" className={sel} value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value })}>
            <option value="">Elige…</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="bscope">Alcance</Label>
          <select id="bscope" className={sel} value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}>
            <option value="competition">Competición completa</option>
            <option value="matchday_range">Rango de jornadas</option>
          </select>
        </div>
        <div>
          <Label htmlFor="bed">Competición</Label>
          <select id="bed" className={sel} value={form.edition} onChange={(e) => setForm({ ...form, edition: e.target.value })}>
            <option value="">Todas</option>
            {(editions.data ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
        {form.scope === 'matchday_range' && (
          <>
            <div>
              <Label htmlFor="bfrom">Desde jornada</Label>
              <Input id="bfrom" type="number" min={1} value={form.from} onChange={(e) => setForm({ ...form, from: Number(e.target.value) })} />
            </div>
            <div>
              <Label htmlFor="bto">Hasta jornada</Label>
              <Input id="bto" type="number" min={1} value={form.to} onChange={(e) => setForm({ ...form, to: Number(e.target.value) })} />
            </div>
          </>
        )}
        <div>
          <Label htmlFor="bmul">Multiplicador ({form.multiplier.toFixed(2)})</Label>
          <input id="bmul" type="range" min={0.7} max={1.3} step={0.01} value={form.multiplier} onChange={(e) => setForm({ ...form, multiplier: Number(e.target.value) })} className="w-full accent-[rgb(var(--team-primary))]" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="bnote">Nota privada</Label>
          <Input id="bnote" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </div>
      </div>
      {error ? <ErrorBox error={error} /> : null}
      <Button size="sm" onClick={add} disabled={!form.team}>
        <Plus size={14} /> Agregar sesgo
      </Button>
    </Card>
  );
}
