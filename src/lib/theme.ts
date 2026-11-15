// Tema por equipo: la interfaz del espectador toma los colores de su estelar.
import type { Team } from './types';

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Luminancia relativa (WCAG) para decidir texto claro u oscuro. */
export function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export const textOn = (hex: string) => (luminance(hex) > 0.45 ? '#0b0d12' : '#ffffff');

/** Aclara un color hasta que tenga contraste suficiente sobre el fondo oscuro. */
function readableOnDark(hex: string): [number, number, number] {
  let rgb = hexToRgb(hex) ?? [56, 189, 248];
  for (let i = 0; i < 8 && luminance(toHex(rgb)) < 0.12; i++) {
    rgb = rgb.map((c) => Math.round(c + (255 - c) * 0.18)) as [number, number, number];
  }
  return rgb;
}
const toHex = (rgb: number[]) => '#' + rgb.map((c) => c.toString(16).padStart(2, '0')).join('');

export function applyTeamTheme(team: Pick<Team, 'primary_color' | 'secondary_color'> | null) {
  const root = document.documentElement;
  if (!team) {
    root.style.removeProperty('--team-primary');
    root.style.removeProperty('--team-secondary');
    return;
  }
  root.style.setProperty('--team-primary', readableOnDark(team.primary_color).join(' '));
  root.style.setProperty('--team-secondary', readableOnDark(team.secondary_color).join(' '));
}
