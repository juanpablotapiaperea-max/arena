// Editor de estadios: nombre, aforo, nivel, mejoras, bono de local e imagen.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import { db } from '@/lib/supabase';
import { useTeams } from '@/lib/hooks';
import { useA11y } from '@/lib/a11y';
import { Button, Card, ErrorBox, Input, Label, Spinner } from '@/components/ui';
import { StadiumView, type StadiumData } from '@/components/Stadium';

export function StadiumsEditor() {
  const qc = useQueryClient();
  const { say } = useA11y();
  const { teams, byId } = useTeams();
  const q = useQuery({ queryKey: ['stadiums'], queryFn: async () => ((await db().from('stadiums').select('*')).data ?? []) as (StadiumData & { id: string })[] });
  const [teamId, setTeamId] = useState('');
  const [form, setForm] = useState<(StadiumData & { id: string }) | null>(null);
  const [error, setError] = useState<unknown>(null);
  const pick = (id: string) => {
    setTeamId(id);
    setForm((q.data ?? []).find((s) => s.team_id === id) ?? null);
  };
  const save = async () => {
    if (!form) return;
    setError(null);
    const { id, ...rest } = form;
    const { error: err } = await db().from('stadiums').update(rest).eq('id', id);
    if (err) setError(new Error(err.message));
    else {
      say('Estadio guardado');
      qc.invalidateQueries({ queryKey: ['stadiums'] });
      qc.invalidateQueries({ queryKey: ['stadium'] });
    }
  };
  const upload = async (file: File) => {
    if (!form) return;
    // Imagen embebida (sin servidor de archivos): se reduce a 1200 px.
    const img = await createImageBitmap(file);
    const scale = Math.min(1, 1200 / img.width);
    const canvas = document.createElement('canvas');
    canvas.width = img.width * scale;
    canvas.height = img.height * scale;
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    setForm({ ...form, image_url: canvas.toDataURL('image/jpeg', 0.82) });
  };
  if (q.isLoading) return <Spinner />;
  return (
    <Card className="space-y-3">
      <h3 className="flex items-center gap-2 font-semibold">
        <Building2 size={16} aria-hidden /> Estadios
      </h3>
      <select aria-label="Equipo" className="focus-ring min-h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-sm" value={teamId} onChange={(e) => pick(e.target.value)}>
        <option value="">Elige un equipo…</option>
        {teams.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      {form && byId.get(teamId) && (
        <div className="grid gap-4 lg:grid-cols-2">
          <StadiumView s={form} team={byId.get(teamId)!} />
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label htmlFor="sname">Nombre</Label>
              <Input id="sname" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="scap">Aforo</Label>
              <Input id="scap" type="number" min={1000} value={form.capacity} onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })} />
            </div>
            <div>
              <Label htmlFor="slevel">Nivel</Label>
              <Input id="slevel" type="number" min={1} max={5} value={form.level} onChange={(e) => setForm({ ...form, level: Number(e.target.value) })} />
            </div>
            {(['capacity', 'comfort', 'lighting'] as const).map((k) => (
              <div key={k}>
                <Label htmlFor={`up-${k}`}>{k === 'capacity' ? 'Ampliación' : k === 'comfort' ? 'Comodidades' : 'Iluminación'}</Label>
                <Input id={`up-${k}`} type="number" min={0} max={3} value={form.upgrades[k] ?? 0} onChange={(e) => setForm({ ...form, upgrades: { ...form.upgrades, [k]: Number(e.target.value) } })} />
              </div>
            ))}
            <div>
              <Label htmlFor="sbonus">Bono de local (%)</Label>
              <Input id="sbonus" type="number" min={0} max={5} step={0.5} value={Number(form.home_bonus) * 100} onChange={(e) => setForm({ ...form, home_bonus: Number(e.target.value) / 100 })} />
            </div>
            <div className="col-span-2">
              <Label htmlFor="simg">Imagen (opcional)</Label>
              <input id="simg" type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} className="text-sm" />
              {form.image_url && (
                <button onClick={() => setForm({ ...form, image_url: null })} className="focus-ring ml-2 rounded text-xs text-muted">
                  Quitar imagen
                </button>
              )}
            </div>
            {error ? (
              <div className="col-span-2">
                <ErrorBox error={error} />
              </div>
            ) : null}
            <Button className="col-span-2" onClick={save}>
              Guardar estadio
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
