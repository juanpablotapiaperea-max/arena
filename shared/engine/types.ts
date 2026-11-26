// Tipos del motor de simulación de ARENA.

export type Position = 'G' | 'D' | 'F';

export type PlayStyle = 'equilibrado' | 'ofensivo' | 'defensivo' | 'presion' | 'contraataque';

export type SimMode = 'realista' | 'balanceado' | 'aleatorio';

export interface EnginePlayer {
  id: string;
  name: string;
  number: number;
  position: Position;
  /** Atributo principal 1-100 (ataque, defensa o portería según la posición). */
  rating: number;
  form: number; // 0-100
  morale: number; // 0-100
  injuryDays: number; // partidos de su equipo que le faltan para volver de la lesión (0 = sano)
}

export interface Lineup {
  goalie: EnginePlayer;
  backupGoalie?: EnginePlayer;
  /** 3 parejas de defensas. */
  pairs: EnginePlayer[][];
  /** 4 líneas de 3 delanteros. */
  lines: EnginePlayer[][];
}

export interface TeamRatings {
  attack: number;
  defense: number;
  goalie: number;
}

export interface StyleModifier {
  attack: number; // multiplicador, 1.04 = +4 %
  defense: number;
  /** Multiplicador de tiros generados por ambos equipos. */
  shots: number;
  /** Multiplicador de penalizaciones propias. */
  penalties: number;
  /** Pesos de los goles propios por periodo. */
  periodWeights: [number, number, number];
}

export interface EngineSettings {
  baseGoals: number; // 2.8
  scale: number; // 0.06
  minLambda: number; // 0.2
  maxLambda: number; // 8
  maxGoals: number; // 12
  homeAdvantage: number; // 1.1
  finalRandomnessMultiplier: number; // 1.3
  modeScale: Record<SimMode, number>;
  lineWeights: number[]; // delanteros: 0.40 0.30 0.20 0.10
  pairWeights: number[]; // defensas: 0.45 0.35 0.20
  styles: Record<PlayStyle, StyleModifier>;
  /** Variación máxima por forma y moral (0.05 = ±5 %). */
  formMoraleRange: number;
  /** Pérdida de rendimiento por cada partido adicional del día (0.01 = 1 %). */
  fatiguePerExtraGame: number;
  injuryChancePerMatch: number; // 0.005
  injuryDays: [number, number]; // 1-10
  /** Duración de reproducción en vivo (segundos). */
  periodSeconds: number; // 100 (3 periodos = 5 min)
  overtimeSeconds: number; // 40
}

export interface TeamInput {
  teamId: string;
  lineup: Lineup;
  style: PlayStyle;
  /** Sesgo secreto del administrador (0.7-1.3). Nunca entra en cuotas. */
  bias?: number;
  /** Partidos que este equipo ya jugó hoy (fatiga). */
  gamesToday?: number;
}

export interface MatchContext {
  seed: number;
  mode: SimMode;
  /** Aleatoriedad base de la competición (por defecto 30). */
  randomness: number;
  neutralVenue: boolean;
  isFinal: boolean;
  overtimeEnabled: boolean;
  /** Generar línea de tiempo jugada a jugada (solo eventos principales). */
  withTimeline: boolean;
  /**
   * Partido de vuelta: goles de la ida del local y del visitante de ESTE partido.
   * Si el global queda empatado (y el gol de visitante no lo decide) hay tiempo extra.
   */
  aggregate?: { home: number; away: number; awayGoalsRule: boolean };
  /** Bono de local del estadio (0.02 = +2 %), solo con estadios activos. */
  homeBonus?: number;
}

export interface GoalEvent {
  side: 'home' | 'away';
  period: 1 | 2 | 3 | 4; // 4 = tiempo extra
  second: number; // segundo de reproducción desde el inicio
  scorerId: string;
  assistIds: string[];
  powerPlay: boolean;
  gameWinning?: boolean;
}

export interface PenaltyEvent {
  side: 'home' | 'away';
  period: 1 | 2 | 3;
  second: number;
  playerId: string;
  minutes: number;
}

export interface TeamBox {
  goals: number;
  shots: number;
  saves: number;
  penalties: number;
  pim: number;
  powerPlays: number;
  powerPlayGoals: number;
  periodGoals: number[]; // [p1, p2, p3, ot]
}

export interface PlayerBox {
  playerId: string;
  side: 'home' | 'away';
  goals: number;
  assists: number;
  plusMinus: number;
  shots: number;
  pim: number;
  saves: number;
  goalsAgainst: number;
  gameWinningGoals: number;
  isMvp: boolean;
}

export type TimelineType =
  | 'period_start'
  | 'shot'
  | 'save'
  | 'goal'
  | 'penalty'
  | 'period_end'
  | 'overtime_start'
  | 'final';

export interface TimelineEvent {
  second: number;
  type: TimelineType;
  side?: 'home' | 'away';
  period: number;
  playerId?: string;
  data?: Record<string, unknown>;
}

export interface Injury {
  playerId: string;
  side: 'home' | 'away';
  days: number;
}

export interface MatchResult {
  seed: number;
  homeScore: number;
  awayScore: number;
  overtime: boolean;
  winner: 'home' | 'away' | 'draw';
  /** Goles esperados públicos (sin sesgos secretos). */
  expected: { home: number; away: number };
  ratings: { home: TeamRatings; away: TeamRatings };
  home: TeamBox;
  away: TeamBox;
  players: PlayerBox[];
  goals: GoalEvent[];
  penalties: PenaltyEvent[];
  injuries: Injury[];
  mvpId: string | null;
  timeline: TimelineEvent[] | null;
  /** Duración total de la reproducción en segundos. */
  durationSeconds: number;
}
