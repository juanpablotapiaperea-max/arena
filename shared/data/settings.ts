// Parámetros globales iniciales (tabla settings). Todos editables por el administrador.
import { APP_NAME } from '../config.ts';
import { DEFAULT_ENGINE_SETTINGS } from '../engine/settings.ts';

export interface SettingSeed {
  key: string;
  value: unknown;
  isPublic: boolean;
}

export const DEFAULT_SETTINGS: SettingSeed[] = [
  { key: 'app_name', value: APP_NAME, isPublic: true },
  { key: 'stadiums_enabled', value: false, isPublic: true },
  { key: 'admin_require_mfa', value: true, isPublic: false },
  { key: 'engine', value: DEFAULT_ENGINE_SETTINGS, isPublic: false },
  {
    key: 'ranking',
    value: {
      base: { champion: 100, runnerUp: 70, semifinal: 50, quarterfinal: 35, roundOf16: 25, playoffs: 15, leagueMax: 20 },
      customWeight: 1,
    },
    isPublic: true,
  },
  {
    key: 'calendar',
    value: {
      burstEveryMinutes: 5,
      burstMin: 3,
      burstMax: 6,
      liveEventMinutes: 15,
      maxLiveEventsPerDay: 24,
      maxEventsPerDay: 24,
      derbyThreshold: 70,
      derbyWeights: { rivalry: 0.35, form: 0.25, closeness: 0.2, importance: 0.2 },
    },
    isPublic: true,
  },
  {
    key: 'economy',
    value: {
      initialBudget: 50_000_000,
      ticketPrice: 45,
      genericCapacityByLevel: { 1: 6000, 2: 9000, 3: 12000, 4: 16000 },
      baseOccupancy: 0.55,
      jerseyPerFame: 22_000,
      prizeByRound: { champion: 3_000_000, runnerUp: 1_800_000, semifinal: 1_000_000, quarterfinal: 600_000, roundOf16: 350_000, playoffs: 200_000 },
      salaryCap: { enabled: false, cap: 22_000_000, luxuryTaxRate: 0.5 },
    },
    isPublic: false,
  },
  {
    key: 'betting',
    value: {
      initialCredits: 1000,
      dailyBonus: 100,
      houseMargin: 0.06,
      clubStakeCap: 0.1,
      maxParlayLegs: 5,
    },
    isPublic: true,
  },
  {
    key: 'press',
    value: { tone: 'medio', autoPublish: { suave: true, medio: true, picante: false }, dailyBudgetUsd: 1, aiEnabled: true },
    isPublic: false,
  },
  { key: 'probabilities', value: { iterations: 10000 }, isPublic: false },
  {
    key: 'market',
    value: { maxNegotiationRounds: 3, wishlistWeight: 1.5 },
    isPublic: false,
  },
  {
    key: 'draft',
    value: { minRookies: 60, maxRookies: 80, rounds: 3, turnSeconds: 60 },
    isPublic: true,
  },
];
