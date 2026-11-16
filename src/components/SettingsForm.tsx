// Editor de un ajuste numérico/booleano guardado en la tabla settings.
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { db } from '@/lib/supabase';
import { useA11y } from '@/lib/a11y';
import { Button, ErrorBox, Input, Label, Spinner } from './ui';

export interface Field {
  path: string; // ruta dentro del JSON, p. ej. "salaryCap.enabled"
  label: string;
  type: 'number' | 'boolean' | 'percent' | 'money' | 'select';
  options?: [string, string][];
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
}

const get = (o: Record<string, unknown>, path: string) => path.split('.').reduce<unknown>((x, k) => (x as Record<string, unknown> | undefined)?.[k], o);
function set(o: Record<string, unknown>, path: string, v: unknown): Record<string, unknown> {
  const [k, ...rest] = path.split('.');
  return { ...o, [k]: rest.length ? set((o[k] as Record<string, unknown>) ?? {}, rest.join('.'), v) : v };
}

export function SettingsForm({ settingKey, fields, title }: { settingKey: string; fields: Field[]; title: string }) {
  const qc = useQueryClient();
  const { say } = useA11y();
  const q = useQuery({ queryKey: ['setting-row', settingKey], queryFn: async () => ((await db().from('settings').select('value').eq('key', settingKey).maybeSingle()).data?.value ?? {}) as Record<string, unknown> });
  const [val, setVal] = useState<Record<string, unknown> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (q.data && !val) setVal(q.data);
  }, [q.data, val]);
  if (q.isLoading || !val) return <Spinner />;
  const save = async () => {
    setSaving(true);
    setError(null);
    const { error: err } = await db().from('settings').upsert({ key: settingKey, value: val, updated_at: new Date().toISOString() });
    setSaving(false);
    if (err) setError(new Error(err.message));
    else {
      say(`${title} guardado`);
      qc.invalidateQueries({ queryKey: ['setting-row', settingKey] });
    }
  };
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => {
          const id = `${settingKey}-${f.path}`;
          const v = get(val, f.path);
          if (f.type === 'boolean')
            return (
              <label key={f.path} className="flex min-h-11 items-center gap-3 text-sm sm:col-span-2">
                <input id={id} type="checkbox" className="h-5 w-5" checked={!!v} onChange={(e) => setVal(set(val, f.path, e.target.checked))} />
                <span>
                  {f.label}
                  {f.hint && <span className="block text-xs text-muted">{f.hint}</span>}
                </span>
              </label>
            );
          if (f.type === 'select')
            return (
              <div key={f.path}>
                <Label htmlFor={id}>{f.label}</Label>
                <select id={id} className="focus-ring min-h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-sm" value={String(v ?? '')} onChange={(e) => setVal(set(val, f.path, e.target.value))}>
                  {f.options!.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            );
          const num = Number(v ?? 0);
          const shown = f.type === 'percent' ? Math.round(num * 1000) / 10 : num;
          return (
            <div key={f.path}>
              <Label htmlFor={id}>
                {f.label}
                {f.type === 'percent' ? ' (%)' : f.type === 'money' ? ' (USD)' : ''}
              </Label>
              <Input
                id={id}
                type="number"
                min={f.min}
                max={f.max}
                step={f.step ?? (f.type === 'percent' ? 0.5 : 1)}
                value={shown}
                onChange={(e) => setVal(set(val, f.path, f.type === 'percent' ? Number(e.target.value) / 100 : Number(e.target.value)))}
              />
              {f.hint && <p className="mt-1 text-xs text-muted">{f.hint}</p>}
            </div>
          );
        })}
      </div>
      {error ? <ErrorBox error={error} /> : null}
      <Button size="sm" onClick={save} disabled={saving}>
        {saving ? 'Guardando…' : 'Guardar'}
      </Button>
    </div>
  );
}
