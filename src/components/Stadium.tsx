// Estadio interactivo (sección 14): ilustración vectorial con los colores del
// equipo, zonas seleccionables y mejoras construidas. Si hay imagen, se usa.
import { useState } from 'react';
import type { Team } from '@/lib/types';
import { cn } from './ui';

export interface StadiumData {
  team_id: string;
  name: string;
  capacity: number;
  level: number;
  upgrades: { capacity?: number; comfort?: number; lighting?: number };
  image_url: string | null;
  color: string | null;
  home_bonus: number;
}

type Zone = 'tribunas' | 'palcos' | 'campo';

const ZONE_INFO: Record<Zone, (s: StadiumData) => string> = {
  tribunas: (s) => `Aforo ${(s.capacity + 1000 * (s.upgrades.capacity ?? 0)).toLocaleString('es-MX')} personas · ampliación nivel ${s.upgrades.capacity ?? 0}`,
  palcos: (s) => `Comodidades nivel ${s.upgrades.comfort ?? 0}: suben la ocupación y el precio de entrada`,
  campo: (s) => `Iluminación nivel ${s.upgrades.lighting ?? 0} · bono de local ${(Number(s.home_bonus) * 100).toFixed(1)} %`,
};

export function StadiumView({ s, team }: { s: StadiumData; team: Team }) {
  const [zone, setZone] = useState<Zone>('tribunas');
  const c1 = s.color ?? team.primary_color;
  const c2 = team.secondary_color;
  const lights = s.upgrades.lighting ?? 0;
  const tiers = 1 + Math.min(3, s.upgrades.capacity ?? 0);
  const zoneBtn = (z: Zone, label: string) => (
    <button key={z} onClick={() => setZone(z)} aria-pressed={zone === z} className={cn('focus-ring min-h-9 rounded-xl px-3 text-xs font-semibold', zone === z ? 'bg-primary text-bg' : 'bg-surface-2 text-muted')}>
      {label}
    </button>
  );
  return (
    <section className="card overflow-hidden p-0" aria-label={`Estadio ${s.name}`}>
      {s.image_url ? (
        <img src={s.image_url} alt={`Estadio ${s.name}`} className="h-56 w-full object-cover" />
      ) : (
        <svg viewBox="0 0 400 220" className="h-56 w-full" role="img" aria-label={`Ilustración del estadio ${s.name}`}>
          <defs>
            <radialGradient id={`glow-${s.team_id}`} cx="50%" cy="50%" r="60%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity={0.12 + lights * 0.08} />
              <stop offset="100%" stopColor="#000000" stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect width="400" height="220" fill="rgb(var(--surface-2))" />
          {/* Tribunas: anillos según la ampliación */}
          {Array.from({ length: tiers }, (_, i) => (
            <ellipse
              key={i}
              cx="200"
              cy="115"
              rx={175 - i * 0}
              ry={95 - i * 0}
              transform={`scale(${1 - i * 0.07}) translate(${i * 14} ${i * 8})`}
              fill="none"
              stroke={i % 2 ? c2 : c1}
              strokeWidth="16"
              opacity={zone === 'tribunas' ? 1 : 0.55}
              onClick={() => setZone('tribunas')}
              className="cursor-pointer"
            />
          ))}
          {/* Palcos */}
          <rect x="150" y="12" width="100" height="16" rx="4" fill={c2} opacity={zone === 'palcos' ? 1 : 0.6} onClick={() => setZone('palcos')} className="cursor-pointer" />
          {Array.from({ length: s.upgrades.comfort ?? 0 }, (_, i) => (
            <rect key={i} x={158 + i * 22} y="15" width="14" height="10" rx="2" fill="#fff" opacity="0.8" />
          ))}
          {/* Pista */}
          <rect x="95" y="62" width="210" height="106" rx="48" fill="#e8f1f8" stroke={zone === 'campo' ? 'rgb(var(--team-primary))' : '#94a3b8'} strokeWidth={zone === 'campo' ? 4 : 2} onClick={() => setZone('campo')} className="cursor-pointer" />
          <line x1="200" y1="62" x2="200" y2="168" stroke="#dc2626" strokeWidth="3" />
          <line x1="150" y1="62" x2="150" y2="168" stroke="#2563eb" strokeWidth="3" />
          <line x1="250" y1="62" x2="250" y2="168" stroke="#2563eb" strokeWidth="3" />
          <circle cx="200" cy="115" r="18" fill="none" stroke="#2563eb" strokeWidth="2" />
          <circle cx="200" cy="115" r="3" fill="#2563eb" />
          <text x="200" y="120" textAnchor="middle" fontFamily="'Barlow Condensed', sans-serif" fontWeight="800" fontSize="16" fill={c1} opacity="0.35">
            {team.short_name}
          </text>
          {/* Torres de luz */}
          {lights > 0 &&
            [
              [40, 30],
              [360, 30],
              [40, 200],
              [360, 200],
            ].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r={4 + lights} fill="#fff7cc" />)}
          <rect width="400" height="220" fill={`url(#glow-${s.team_id})`} pointerEvents="none" />
        </svg>
      )}
      <div className="space-y-2 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-xl font-bold uppercase">{s.name}</h3>
          <span className="text-xs font-semibold text-muted">Nivel {s.level}</span>
        </div>
        <div className="flex gap-1" role="group" aria-label="Zonas del estadio">
          {zoneBtn('tribunas', 'Tribunas')}
          {zoneBtn('palcos', 'Palcos')}
          {zoneBtn('campo', 'Campo')}
        </div>
        <p className="text-sm text-muted" aria-live="polite">
          {ZONE_INFO[zone](s)}
        </p>
      </div>
    </section>
  );
}
