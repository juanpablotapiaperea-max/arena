import type { Team } from '@/lib/types';
import { textOn } from '@/lib/theme';

type CrestTeam = Pick<Team, 'short_name' | 'primary_color' | 'secondary_color' | 'crest_url' | 'name'>;

/**
 * Escudo del equipo. Si el administrador no subió una imagen, se genera uno
 * con sus colores y sus iniciales (sección 13).
 */
export function Crest({ team, size = 40, className = '' }: { team: CrestTeam; size?: number; className?: string }) {
  if (team.crest_url) {
    return (
      <img
        src={team.crest_url}
        alt={`Escudo de ${team.name}`}
        width={size}
        height={size}
        className={`shrink-0 object-contain ${className}`}
      />
    );
  }
  const letters = team.short_name.slice(0, 3);
  const fontSize = letters.length >= 3 ? 30 : 36;
  return (
    <svg
      viewBox="0 0 100 110"
      width={size}
      height={size * 1.1}
      role="img"
      aria-label={`Escudo de ${team.name}`}
      className={`shrink-0 ${className}`}
    >
      <path d="M50 3 L95 18 V55 C95 82 74 100 50 107 C26 100 5 82 5 55 V18 Z" fill={team.secondary_color} />
      <path d="M50 11 L87 23 V55 C87 77 70 92 50 99 C30 92 13 77 13 55 V23 Z" fill={team.primary_color} />
      <path d="M13 62 H87" stroke={team.secondary_color} strokeWidth="4" opacity="0.7" />
      <text
        x="50"
        y="56"
        textAnchor="middle"
        fontFamily="'Barlow Condensed', system-ui, sans-serif"
        fontWeight="800"
        fontSize={fontSize}
        fill={textOn(team.primary_color)}
      >
        {letters}
      </text>
    </svg>
  );
}
