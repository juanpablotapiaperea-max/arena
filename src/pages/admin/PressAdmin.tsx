// Prensa: cola de aprobación, tono, tope de gasto de la IA y noticias manuales.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, EyeOff, Pin, Sparkles } from 'lucide-react';
import { db } from '@/lib/supabase';
import { useTeams } from '@/lib/hooks';
import { useA11y } from '@/lib/a11y';
import type { News } from '@/lib/engine';
import { Badge, Button, Card, ErrorBox, Input, Label, SectionTitle, Spinner, cn } from '@/components/ui';
import { SettingsForm } from '@/components/SettingsForm';

export function PressAdmin() {
  const qc = useQueryClient();
  const { say } = useA11y();
  const { teams } = useTeams();
  const q = useQuery({ queryKey: ['admin-news'], queryFn: async () => ((await db().from('news').select('*').order('created_at', { ascending: false }).limit(120)).data ?? []) as News[] });
  const usage = useQuery({ queryKey: ['ai-usage'], queryFn: async () => (await db().from('ai_usage').select('*').order('day', { ascending: false }).limit(7)).data ?? [] });
  const [draft, setDraft] = useState({ title: '', body: '', team: '', tone: 'medio' });
  const [error, setError] = useState<unknown>(null);

  const update = async (id: string, patch: Partial<News>, msg: string) => {
    await db().from('news').update(patch).eq('id', id);
    say(msg);
    qc.invalidateQueries({ queryKey: ['admin-news'] });
  };
  const publishManual = async () => {
    setError(null);
    const { error: err } = await db()
      .from('news')
      .insert({ kind: 'manual', tone: draft.tone, title: draft.title, body: draft.body, team_id: draft.team || null, status: 'published', published_at: new Date().toISOString() });
    if (err) setError(new Error(err.message));
    else {
      setDraft({ title: '', body: '', team: '', tone: 'medio' });
      say('Noticia publicada');
      qc.invalidateQueries({ queryKey: ['admin-news'] });
    }
  };
  const pending = (q.data ?? []).filter((n) => n.status === 'pending');
  const today = usage.data?.[0] as { cost_usd?: number; requests?: number } | undefined;

  return (
    <div className="space-y-6">
      <SectionTitle>Prensa</SectionTitle>
      <Card>
        <h3 className="mb-1 flex items-center gap-2 font-semibold">
          <Sparkles size={16} className="text-primary" aria-hidden /> Redacción con IA (Claude)
        </h3>
        <p className="mb-3 text-sm text-muted">
          Hoy: {today?.requests ?? 0} piezas · ${Number(today?.cost_usd ?? 0).toFixed(3)} USD. Sin clave de API o con el tope agotado se usan plantillas.
        </p>
        <SettingsForm
          settingKey="press"
          title="Prensa"
          fields={[
            { path: 'tone', label: 'Tono general', type: 'select', options: [['suave', 'Suave'], ['medio', 'Medio'], ['picante', 'Picante']] },
            { path: 'dailyBudgetUsd', label: 'Tope diario de gasto (USD)', type: 'number', min: 0, step: 0.5 },
            { path: 'aiEnabled', label: 'Usar Claude para redactar', type: 'boolean' },
            { path: 'autoPublish.suave', label: 'Publicar solas las piezas suaves', type: 'boolean' },
            { path: 'autoPublish.medio', label: 'Publicar solas las piezas de tono medio', type: 'boolean' },
            { path: 'autoPublish.picante', label: 'Publicar solas las picantes (si no, pasan por tu cola)', type: 'boolean' },
          ]}
        />
      </Card>

      <Card className="p-0">
        <h3 className="border-b border-line px-4 py-3 font-semibold">Cola de aprobación ({pending.length})</h3>
        {q.isLoading ? (
          <Spinner />
        ) : (
          <ul className="divide-y divide-line/60">
            {pending.map((n) => (
              <li key={n.id} className="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="loss">{n.tone}</Badge>
                  <span className="font-semibold">{n.title}</span>
                </div>
                <p className="whitespace-pre-line text-sm text-muted">{n.body}</p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => update(n.id, { status: 'published', published_at: new Date().toISOString() } as Partial<News>, 'Publicada')}>
                    <Check size={14} /> Publicar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => update(n.id, { status: 'hidden' } as Partial<News>, 'Descartada')}>
                    Descartar
                  </Button>
                </div>
              </li>
            ))}
            {!pending.length && <li className="p-4 text-sm text-muted">Nada pendiente.</li>}
          </ul>
        )}
      </Card>

      <Card className="space-y-3">
        <h3 className="font-semibold">Escribir una noticia</h3>
        <div>
          <Label htmlFor="ntitle">Título</Label>
          <Input id="ntitle" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="nbody">Texto</Label>
          <textarea id="nbody" rows={5} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} className="focus-ring w-full rounded-xl border border-line bg-surface-2 p-3 text-sm" />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <select aria-label="Equipo" className="focus-ring min-h-11 rounded-xl border border-line bg-surface-2 px-3 text-sm" value={draft.team} onChange={(e) => setDraft({ ...draft, team: e.target.value })}>
            <option value="">Sin equipo</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <select aria-label="Tono" className="focus-ring min-h-11 rounded-xl border border-line bg-surface-2 px-3 text-sm" value={draft.tone} onChange={(e) => setDraft({ ...draft, tone: e.target.value })}>
            <option value="suave">Suave</option>
            <option value="medio">Medio</option>
            <option value="picante">Picante</option>
          </select>
        </div>
        {error ? <ErrorBox error={error} /> : null}
        <Button onClick={publishManual} disabled={!draft.title.trim() || !draft.body.trim()}>
          Publicar
        </Button>
      </Card>

      <Card className="p-0">
        <h3 className="border-b border-line px-4 py-3 font-semibold">Todas las noticias</h3>
        <ul className="max-h-[60vh] divide-y divide-line/60 overflow-y-auto">
          {(q.data ?? [])
            .filter((n) => n.status !== 'pending')
            .map((n) => (
              <li key={n.id} className={cn('flex flex-wrap items-center gap-2 px-4 py-2 text-sm', n.status === 'hidden' && 'opacity-50')}>
                <span className="min-w-0 flex-1 truncate">{n.title}</span>
                <button onClick={() => update(n.id, { pinned: !n.pinned } as Partial<News>, n.pinned ? 'Desfijada' : 'Fijada')} className={cn('focus-ring rounded p-1.5', n.pinned ? 'text-secondary' : 'text-muted')} aria-label={n.pinned ? 'Desfijar' : 'Fijar'}>
                  <Pin size={14} />
                </button>
                <button
                  onClick={() => update(n.id, { status: n.status === 'hidden' ? 'published' : 'hidden' } as Partial<News>, n.status === 'hidden' ? 'Visible' : 'Oculta')}
                  className="focus-ring rounded p-1.5 text-muted"
                  aria-label={n.status === 'hidden' ? 'Mostrar' : 'Ocultar'}
                >
                  <EyeOff size={14} />
                </button>
              </li>
            ))}
        </ul>
      </Card>
    </div>
  );
}
