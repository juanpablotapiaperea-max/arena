import { useState } from 'react';
import { Star } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useTeams } from '@/lib/hooks';
import { updateFavorites } from '@/lib/api';
import { Crest } from '@/components/Crest';
import { Button, ErrorBox, SectionTitle, Spinner, cn } from '@/components/ui';
import { AccessibilityPanel } from '@/components/AccessibilityPanel';

/** Hasta 3 equipos principales y 1 estelar que tiñe toda la interfaz. */
export function ProfilePage() {
  const { profile, setLocalProfile } = useAuth();
  const { teams, isLoading } = useTeams();
  const [favorites, setFavorites] = useState<string[]>(profile?.favorite_team_ids ?? []);
  const [star, setStar] = useState<string | null>(profile?.star_team_id ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  if (!profile) return null;
  if (isLoading) return <Spinner />;

  const toggle = (id: string) => {
    setSaved(false);
    setFavorites((f) => (f.includes(id) ? f.filter((x) => x !== id) : f.length >= 3 ? f : [...f, id]));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateFavorites(profile.id, favorites, star);
      setLocalProfile({ favorite_team_ids: favorites, star_team_id: star });
      setSaved(true);
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <SectionTitle>Perfil</SectionTitle>
      <div className="card flex flex-wrap items-center gap-4 p-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted">Usuario</div>
          <div className="font-display text-2xl font-bold">{profile.display_name}</div>
        </div>
        <div className="ml-auto text-right">
          <div className="text-xs uppercase tracking-wider text-muted">Créditos</div>
          <div className="font-display text-2xl font-bold tabular">{profile.credits.toLocaleString('es-MX')}</div>
        </div>
      </div>

      <section>
        <h3 className="mb-1 font-semibold">Mis equipos</h3>
        <p className="mb-3 text-sm text-muted">
          Elige hasta 3 equipos principales ({favorites.length}/3) y marca uno con la estrella como tu estelar: la app tomará sus colores.
        </p>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {teams
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name, 'es'))
            .map((t) => {
              const fav = favorites.includes(t.id);
              const isStar = star === t.id;
              return (
                <li key={t.id} className={cn('card flex items-center gap-2 p-2', fav && 'border-primary')}>
                  <button
                    onClick={() => toggle(t.id)}
                    aria-pressed={fav}
                    className="focus-ring flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg text-left"
                    disabled={!fav && favorites.length >= 3}
                  >
                    <Crest team={t} size={28} />
                    <span className="truncate text-sm font-medium">{t.name}</span>
                  </button>
                  <button
                    onClick={() => {
                      setSaved(false);
                      setStar(isStar ? null : t.id);
                    }}
                    aria-pressed={isStar}
                    aria-label={isStar ? `Quitar ${t.name} como estelar` : `Elegir ${t.name} como estelar`}
                    className={cn('focus-ring rounded-lg p-2', isStar ? 'text-secondary' : 'text-muted hover:text-fg')}
                  >
                    <Star size={18} fill={isStar ? 'currentColor' : 'none'} />
                  </button>
                </li>
              );
            })}
        </ul>
      </section>

      <AccessibilityPanel />

      {error ? <ErrorBox error={error} /> : null}
      <div className="sticky bottom-20 flex justify-end md:bottom-4">
        <Button onClick={save} disabled={saving}>
          {saving ? 'Guardando…' : saved ? 'Guardado ✓' : 'Guardar'}
        </Button>
      </div>
    </div>
  );
}
