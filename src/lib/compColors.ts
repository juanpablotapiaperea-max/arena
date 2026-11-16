// Color fijo por competición para reconocerlas de un vistazo en el calendario.
const COLORS: Record<string, string> = {
  ohl: '#38bdf8',
  primera: '#a78bfa',
  segunda: '#f472b6',
  all_stars: '#facc15',
  champions: '#60a5fa',
  copa: '#34d399',
  open: '#fb923c',
  centenario: '#f87171',
};

export function compColor(key?: string | null): string {
  if (!key) return '#94a3b8';
  if (COLORS[key]) return COLORS[key];
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 70% 62%)`;
}

export const FORMAT_LABEL: Record<string, string> = {
  league: 'Liga',
  groups_knockout: 'Grupos + eliminatoria',
  knockout: 'Eliminación directa',
  swiss: 'Formato suizo',
  two_legged: 'Ida y vuelta',
};

export const STATUS_LABEL: Record<string, string> = {
  setup: 'Preparando',
  in_progress: 'En curso',
  playoffs: 'Playoffs',
  finished: 'Terminada',
};
