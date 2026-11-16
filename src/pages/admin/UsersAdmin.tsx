import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminListProfiles, adminUsers } from '@/lib/api';
import { useTeams } from '@/lib/hooks';
import type { UserRole } from '@/lib/types';
import { Badge, Button, ErrorBox, Input, Label, SectionTitle, Spinner } from '@/components/ui';

const ROLE_LABEL: Record<UserRole, string> = { admin: 'Administrador', owner: 'Dueño', spectator: 'Espectador' };

/** Usuarios: crear códigos, asignar roles y clubes, silenciar en el chat. */
export function UsersAdmin() {
  const qc = useQueryClient();
  const { teams } = useTeams();
  const list = useQuery({ queryKey: ['admin', 'profiles'], queryFn: adminListProfiles });
  const [name, setName] = useState('');
  const [role, setRole] = useState<UserRole>('spectator');
  const [club, setClub] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [issued, setIssued] = useState<{ name: string; code: string } | null>(null);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await adminUsers({ action: 'create', name, role, clubTeamId: role === 'owner' ? club : null });
      setIssued({ name, code: res.code ?? '' });
      setName('');
      await qc.invalidateQueries({ queryKey: ['admin', 'profiles'] });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const act = async (body: Record<string, unknown>) => {
    setError(null);
    try {
      const res = await adminUsers(body);
      if (res.code) setIssued({ name: String(body.name ?? ''), code: res.code });
      await qc.invalidateQueries({ queryKey: ['admin', 'profiles'] });
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div className="space-y-6">
      <SectionTitle>Usuarios</SectionTitle>
      <form onSubmit={create} className="card grid gap-3 p-4 md:grid-cols-[1fr_180px_220px_auto] md:items-end">
        <div>
          <Label htmlFor="uname">Nombre</Label>
          <Input id="uname" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
        </div>
        <div>
          <Label htmlFor="urole">Rol</Label>
          <select
            id="urole"
            className="focus-ring min-h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-sm"
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
          >
            <option value="spectator">Espectador</option>
            <option value="owner">Dueño</option>
          </select>
        </div>
        <div>
          <Label htmlFor="uclub">Club (dueños)</Label>
          <select
            id="uclub"
            disabled={role !== 'owner'}
            required={role === 'owner'}
            className="focus-ring min-h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-sm disabled:opacity-50"
            value={club}
            onChange={(e) => setClub(e.target.value)}
          >
            <option value="">—</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <Button disabled={busy}>Crear código</Button>
      </form>

      {issued && (
        <div className="card border-primary p-4" role="status">
          <div className="text-sm text-muted">Entrega estos datos a {issued.name}. El código no se vuelve a mostrar.</div>
          <div className="mt-1 font-mono text-2xl font-bold tracking-widest text-primary">{issued.code}</div>
        </div>
      )}
      {error ? <ErrorBox error={error} /> : null}

      {list.isLoading ? (
        <Spinner />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wider text-muted">
              <tr className="border-b border-line">
                <th className="px-3 py-2">Nombre</th>
                <th className="px-3 py-2">Rol</th>
                <th className="px-3 py-2">Club</th>
                <th className="px-3 py-2 text-right">Créditos</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {(list.data ?? []).map((p) => (
                <tr key={p.id} className="border-b border-line/50 last:border-0">
                  <td className="px-3 py-2 font-medium">
                    {p.display_name}
                    {p.muted_until && new Date(p.muted_until) > new Date() && (
                      <span className="ml-2">
                        <Badge tone="loss">Silenciado</Badge>
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">{ROLE_LABEL[p.role]}</td>
                  <td className="px-3 py-2">
                    {p.role === 'admin' ? (
                      '—'
                    ) : (
                      <select
                        aria-label={`Club de ${p.display_name}`}
                        className="focus-ring max-w-40 rounded-lg border border-line bg-surface-2 px-2 py-1 text-sm"
                        value={p.club_team_id ?? ''}
                        onChange={(e) => act({ action: 'set_role', userId: p.id, role: e.target.value ? 'owner' : 'spectator', clubTeamId: e.target.value || null })}
                      >
                        <option value="">Espectador (sin club)</option>
                        {teams.map((t) => (
                          <option key={t.id} value={t.id}>
                            Dueño de {t.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular">{p.credits.toLocaleString('es-MX')}</td>
                  <td className="px-3 py-2 text-right">
                    {p.role !== 'admin' && (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => act({ action: 'reset_code', userId: p.id, name: p.display_name })}>
                          Nuevo código
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => act({ action: 'mute', userId: p.id, minutes: 60 })}>
                          Silenciar 1 h
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
