import type { EngineSettings } from './types.ts';

// Valores iniciales del motor. Todos son editables desde la configuración
// del administrador (tabla settings, clave "engine").
export const DEFAULT_ENGINE_SETTINGS: EngineSettings = {
  baseGoals: 2.8,
  scale: 0.06,
  minLambda: 0.2,
  maxLambda: 8,
  maxGoals: 12,
  homeAdvantage: 1.1,
  finalRandomnessMultiplier: 1.3,
  modeScale: { realista: 0.4, balanceado: 0.7, aleatorio: 1.2 },
  lineWeights: [0.4, 0.3, 0.2, 0.1],
  pairWeights: [0.45, 0.35, 0.2],
  styles: {
    equilibrado: { attack: 1, defense: 1, shots: 1, penalties: 1, periodWeights: [1, 1, 1] },
    ofensivo: { attack: 1.04, defense: 0.96, shots: 1.15, penalties: 1, periodWeights: [1, 1, 1] },
    defensivo: { attack: 0.96, defense: 1.04, shots: 0.85, penalties: 1, periodWeights: [1, 1, 1] },
    presion: { attack: 1.03, defense: 0.98, shots: 1.05, penalties: 1.2, periodWeights: [1, 1, 1] },
    contraataque: { attack: 0.98, defense: 1.03, shots: 1, penalties: 1, periodWeights: [0.85, 0.95, 1.3] },
  },
  formMoraleRange: 0.05,
  fatiguePerExtraGame: 0.01,
  injuryChancePerMatch: 0.005,
  injuryDays: [1, 10],
  periodSeconds: 100,
  overtimeSeconds: 40,
};

export const STYLE_LABELS: Record<keyof EngineSettings['styles'], string> = {
  equilibrado: 'Equilibrado',
  ofensivo: 'Ofensivo',
  defensivo: 'Defensivo',
  presion: 'Presión alta',
  contraataque: 'Contraataque',
};

export const MODE_LABELS = {
  realista: 'Realista',
  balanceado: 'Balanceado',
  aleatorio: 'Aleatorio',
} as const;

/** Combina ajustes guardados con los valores por defecto. */
export function mergeEngineSettings(partial?: Partial<EngineSettings> | null): EngineSettings {
  if (!partial) return DEFAULT_ENGINE_SETTINGS;
  return {
    ...DEFAULT_ENGINE_SETTINGS,
    ...partial,
    modeScale: { ...DEFAULT_ENGINE_SETTINGS.modeScale, ...(partial.modeScale ?? {}) },
    styles: { ...DEFAULT_ENGINE_SETTINGS.styles, ...(partial.styles ?? {}) },
  };
}
