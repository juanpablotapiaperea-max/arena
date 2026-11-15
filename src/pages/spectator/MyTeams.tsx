import { Link } from 'react-router-dom';
import { Star } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useTeams } from '@/lib/hooks';
import { Crest } from '@/components/Crest';
import { Button, SectionTitle } from '@/components/ui';

export function MyTeamsPage() {
  const { profile } = useAuth();
  const { byId } = useTeams();
  const favs = (profile?.favorite_team_ids ?? []).map((id) => byId.get(id)).filter(Boolean);
  const star = profile?.star_team_id ? byId.get(profile.star_team_id) : undefined;

  if (!favs.length && !star) {
    return (
      <div>
        <SectionTitle>Mi equipo</SectionTitle>
        <div className="card flex flex-col items-center gap-3 p-8 text-center">
          <p className="text-sm text-muted">Aún no eliges tus equipos. Escoge hasta 3 principales y un estelar.</p>
          <Link to="/perfil">
            <Button>Elegir equipos</Button>
          </Link>
        </div>
      </div>
    );
  }

  const list = [star, ...favs.filter((t) => t!.id !== star?.id)].filter(Boolean);
  return (
    <div>
      <SectionTitle>Mi equipo</SectionTitle>
      <ul className="grid gap-3 sm:grid-cols-2">
        {list.map((t) => (
          <li key={t!.id}>
            <Link
              to={`/equipos/${t!.key}`}
              className="focus-ring card flex items-center gap-4 p-4 transition hover:border-primary/60"
              style={{ boxShadow: `inset 4px 0 0 ${t!.primary_color}` }}
            >
              <Crest team={t!} size={56} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 font-display text-2xl font-bold uppercase">
                  {t!.name}
                  {t!.id === star?.id && <Star size={18} className="text-secondary" fill="currentColor" aria-label="Estelar" />}
                </div>
                <div className="text-sm text-muted">
                  Próximo partido, posición y noticias aparecerán cuando arranque la temporada.
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
