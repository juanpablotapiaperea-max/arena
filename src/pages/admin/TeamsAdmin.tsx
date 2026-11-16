import { useMemo, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { usePlayers, useTeams } from '@/lib/hooks';
import { adminUpdatePlayer } from '@/lib/api';
import { db } from '@/lib/supabase';
import { POSITION_SHORT, type Player } from '@/lib/types';
import { Crest } from '@/components/Crest';
import { Button, ErrorBox, Input, Label, SectionTitle, Spinner, cn, money } from '@/components/ui';

/** Equipos y jugadores: editar atributos, contrato, lesión, forma, moral y mover de equipo. */
export function TeamsAdmin() {
  const { teams, byId } = useTeams();
  const sorted = useMemo(() => teams.slice().sort((a, b) => a.name.localeCompare(b.name, 'es')), [teams]);
  const [teamId, setTeamId] = useState<string | null>(null);
  const selected = teamId ? byId.get(teamId) : sorted[0];
  const players = usePlayers(selected?.id);
  const [editing, setEditing] = useState<Player | null>(null);

  return (
    <div className="space-y-4">
      <SectionTitle>Equipos y jugadores</SectionTitle>
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <div className="card max-h-[70vh] overflow-y-auto p-1">
          {sorted.map((t) => (
            <button
              key={t.id}
              onClick={() => setTeamId(t.id)}
              className={cn(
                'focus-ring flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm',
                selected?.id === t.id ? 'bg-primary/15 text-primary' : 'hover:bg-surface-2',
              )}
            >
              <Crest team={t} size={22} />
              <span className="flex-1 truncate">{t.name}</span>
              <span className="font-mono text-[11px] text-muted">
                {Math.round(t.attack)}/{Math.round(t.defense)}/{Math.round(t.goalie)}
              </span>
            </button>
          ))}
        </div>

        <div className="card overflow-x-auto">
          {selected && (
            <div className="flex items-center gap-3 border-b border-line p-3">
              <Crest team={selected} size={36} />
              <div className="font-display text-2xl font-bold uppercase">{selected.name}</div>
              <div className="ml-auto text-xs text-muted">
                ATQ {Number(selected.attack).toFixed(1)} · DEF {Number(selected.defense).toFixed(1)} · POR {Number(selected.goalie).toFixed(1)}
              </div>
            </div>
          )}
          {selected && <TeamIdentity team={selected} />}
          {players.isLoading ? (
            <Spinner />
          ) : (
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wider text-muted">
                <tr className="border-b border-line">
                  {['#', 'Jugador', 'Pos', 'Atr', 'Edad', 'Pot', 'Forma', 'Moral', 'Salario', 'Contrato', 'Lesión', ''].map((h) => (
                    <th key={h} className="px-2 py-2">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(players.data ?? [])
                  .slice()
                  .sort((a, b) => 'GDF'.indexOf(a.position) - 'GDF'.indexOf(b.position) || b.rating - a.rating)
                  .map((p) => (
                    <tr key={p.id} className="border-b border-line/50 last:border-0">
                      <td className="px-2 py-1.5 tabular text-muted">{p.number}</td>
                      <td className="px-2 py-1.5 font-medium">
                        {p.first_name} {p.last_name}
                      </td>
                      <td className="px-2 py-1.5">{POSITION_SHORT[p.position]}</td>
                      <td className="px-2 py-1.5 font-bold tabular">{p.rating}</td>
                      <td className="px-2 py-1.5 tabular">{p.age}</td>
                      <td className="px-2 py-1.5 tabular">{p.potential}</td>
                      <td className="px-2 py-1.5 tabular">{p.form}</td>
                      <td className="px-2 py-1.5 tabular">{p.morale}</td>
                      <td className="px-2 py-1.5 tabular">{money(p.salary)}</td>
                      <td className="px-2 py-1.5 tabular">{p.contract_years} t</td>
                      <td className="px-2 py-1.5 tabular">{p.injury_days ? `${p.injury_days} d` : '—'}</td>
                      <td className="px-2 py-1.5">
                        <button onClick={() => setEditing(p)} className="focus-ring rounded p-1.5 text-muted hover:text-fg" aria-label={`Editar ${p.first_name} ${p.last_name}`}>
                          <Pencil size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {editing && <PlayerEditor player={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** Escudo y colores del equipo: el escudo se puede reemplazar por una imagen. */
function TeamIdentity({ team }: { team: import('@/lib/types').Team }) {
  const qc = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const save = async (patch: Record<string, unknown>) => {
    setError(null);
    const { error: err } = await db().from('teams').update(patch).eq('id', team.id);
    if (err) setError(new Error(err.message));
    else qc.invalidateQueries({ queryKey: ['teams'] });
  };
  const upload = async (file: File) => {
    const img = await createImageBitmap(file);
    const size = 256;
    const canvas = document.createElement('canvas');
    const scale = Math.min(size / img.width, size / img.height);
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    await save({ crest_url: canvas.toDataURL('image/png') });
  };
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line p-3 text-sm">
      <label className="flex items-center gap-2">
        Primario
        <input type="color" value={team.primary_color} onChange={(e) => save({ primary_color: e.target.value })} className="h-9 w-12 rounded border border-line bg-transparent" />
      </label>
      <label className="flex items-center gap-2">
        Secundario
        <input type="color" value={team.secondary_color} onChange={(e) => save({ secondary_color: e.target.value })} className="h-9 w-12 rounded border border-line bg-transparent" />
      </label>
      <label className="flex items-center gap-2">
        Escudo
        <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} className="max-w-48 text-xs" />
      </label>
      {team.crest_url && (
        <Button size="sm" variant="ghost" onClick={() => save({ crest_url: null })}>
          Volver al escudo generado
        </Button>
      )}
      {error ? <ErrorBox error={error} /> : null}
    </div>
  );
}

function PlayerEditor({ player, onClose }: { player: Player; onClose: () => void }) {
  const { teams } = useTeams();
  const qc = useQueryClient();
  const [form, setForm] = useState({ ...player });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const num = (k: keyof Player, min: number, max: number) => ({
    type: 'number',
    min,
    max,
    value: String(form[k] ?? ''),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: Number(e.target.value) })),
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { id, ...rest } = form;
      const patch: Partial<Player> = {};
      (Object.keys(rest) as (keyof Player)[]).forEach((k) => {
        if (form[k] !== player[k]) (patch as Record<string, unknown>)[k] = form[k];
      });
      if (Object.keys(patch).length) await adminUpdatePlayer(id, patch);
      await qc.invalidateQueries({ queryKey: ['players'] });
      await qc.invalidateQueries({ queryKey: ['teams'] });
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Editar jugador"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-line bg-surface p-5 sm:rounded-3xl"
      >
        <h3 className="mb-4 font-display text-2xl font-bold uppercase">Editar jugador</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="fn">Nombre</Label>
            <Input id="fn" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="ln">Apellido</Label>
            <Input id="ln" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="team">Equipo</Label>
            <select
              id="team"
              className="focus-ring min-h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-sm"
              value={form.team_id ?? ''}
              onChange={(e) => setForm({ ...form, team_id: e.target.value || null })}
            >
              <option value="">Agente libre</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="pos">Posición</Label>
            <select
              id="pos"
              className="focus-ring min-h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-sm"
              value={form.position}
              onChange={(e) => setForm({ ...form, position: e.target.value as Player['position'] })}
            >
              <option value="G">Portero</option>
              <option value="D">Defensa</option>
              <option value="F">Delantero</option>
            </select>
          </div>
          {(
            [
              ['number', 'Número', 0, 99],
              ['rating', 'Atributo', 1, 100],
              ['age', 'Edad', 15, 45],
              ['potential', 'Potencial', 1, 100],
              ['form', 'Forma', 0, 100],
              ['morale', 'Moral', 0, 100],
              ['salary', 'Salario (USD)', 0, 100_000_000],
              ['contract_years', 'Contrato (temporadas)', 0, 5],
              ['injury_days', 'Lesión (días)', 0, 60],
            ] as const
          ).map(([k, label, min, max]) => (
            <div key={k}>
              <Label htmlFor={k}>{label}</Label>
              <Input id={k} {...num(k, min, max)} />
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">El cambio es secreto y queda en la bitácora privada con opción de deshacer.</p>
        {error ? <div className="mt-3"><ErrorBox error={error} /></div> : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</Button>
        </div>
      </form>
    </div>
  );
}
