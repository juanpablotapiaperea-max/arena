// Las ocho competiciones iniciales (sección 4), definidas por reglas y no por listas fijas.

export const DEFAULT_POINTS = { win: 3, draw: 1, loss: 0, otWin: 2, otLoss: 1 };
export const DEFAULT_TIEBREAKERS = ['points', 'goal_diff', 'goals_for', 'head_to_head', 'wins'] as const;

export interface CompetitionSeed {
  key: string;
  name: string;
  format: 'league' | 'groups_knockout' | 'knockout' | 'swiss' | 'two_legged';
  participantRule: Record<string, unknown>;
  config: Record<string, unknown>;
  rankingWeight: number;
  permanent: boolean;
  sortOrder: number;
}

const common = {
  points: DEFAULT_POINTS,
  tiebreakers: DEFAULT_TIEBREAKERS,
  randomness: 30,
  mode: 'realista',
  overtime: true,
  awayGoals: false,
};

export const COMPETITIONS: CompetitionSeed[] = [
  {
    key: 'ohl',
    name: 'OHL',
    format: 'league',
    participantRule: { type: 'all' },
    config: { ...common, roundsPerOpponent: 2, playoffTeams: 24, playoffByes: 8, playoffLegs: 1 },
    rankingWeight: 2,
    permanent: true,
    sortOrder: 1,
  },
  {
    key: 'primera',
    name: 'Primera División',
    format: 'league',
    participantRule: { type: 'division', division: 1 },
    config: { ...common, roundsPerOpponent: 2, playoffTeams: 8, relegated: 6, playoffLegs: 1 },
    rankingWeight: 2,
    permanent: true,
    sortOrder: 2,
  },
  {
    key: 'segunda',
    name: 'Segunda División',
    format: 'league',
    participantRule: { type: 'division', division: 2 },
    config: { ...common, roundsPerOpponent: 2, playoffTeams: 16, promoted: 6, playoffLegs: 1 },
    rankingWeight: 0.5,
    permanent: true,
    sortOrder: 3,
  },
  {
    key: 'all_stars',
    name: 'ALL STARS',
    format: 'swiss',
    participantRule: { type: 'historical_top', n: 32 },
    config: { ...common, swissRounds: 8, directQualifiers: 8, playoffFrom: 9, playoffTo: 24, playoffLegs: 1 },
    rankingWeight: 2,
    permanent: true,
    sortOrder: 4,
  },
  {
    key: 'champions',
    name: 'CHAMPIONS',
    format: 'two_legged',
    participantRule: { type: 'season_top', n: 32, fallback: 'historical_top' },
    config: { ...common, playoffLegs: 2, singleLegFinal: true, neutralFinal: true },
    rankingWeight: 2.5,
    permanent: true,
    sortOrder: 5,
  },
  {
    key: 'copa',
    name: 'COPA',
    format: 'groups_knockout',
    participantRule: {
      type: 'combo',
      parts: [
        { type: 'season_top', n: 10, fallback: 'historical_top', seeded: 8 },
        { type: 'draw', n: 22 },
      ],
    },
    config: { ...common, groups: 8, groupSize: 4, qualifyPerGroup: 2, roundsPerOpponent: 1, playoffLegs: 1 },
    rankingWeight: 1.5,
    permanent: true,
    sortOrder: 6,
  },
  {
    key: 'open',
    name: 'OPEN',
    format: 'league',
    participantRule: { type: 'invite' },
    config: { ...common, roundsPerOpponent: 2, playoffTeams: 8, playoffLegs: 1 },
    rankingWeight: 1,
    permanent: true,
    sortOrder: 7,
  },
  {
    key: 'centenario',
    name: 'Torneo CENTENARIO',
    format: 'league',
    participantRule: { type: 'historical_top', n: 12 },
    config: { ...common, roundsPerOpponent: 4, playoffTeams: 8, playoffLegs: 1, triggerEvery: 100 },
    rankingWeight: 3,
    permanent: false,
    sortOrder: 8,
  },
];
