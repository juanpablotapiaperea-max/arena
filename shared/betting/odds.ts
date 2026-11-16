// Cuotas de apuestas a partir de la distribución exacta del motor (Poisson
// sobre los goles esperados públicos) más el margen de la casa (sección 8).
// Los sesgos secretos del administrador nunca entran aquí.

export const MAX_GOALS = 12;

function poissonPmf(lambda: number, max: number): number[] {
  const out = new Array<number>(max + 1);
  let p = Math.exp(-lambda);
  let cum = 0;
  for (let k = 0; k < max; k++) {
    out[k] = p;
    cum += p;
    p = (p * lambda) / (k + 1);
  }
  out[max] = Math.max(0, 1 - cum); // tope de 12 goles: la cola se acumula
  return out;
}

export interface MatchModel {
  /** Probabilidad del marcador final (incluye el gol del tiempo extra). */
  score: number[][];
  home: number;
  away: number;
  draw: number;
  /** Probabilidad de que el partido vaya a tiempo extra. */
  overtime: number;
  /** Distribución del total de goles. */
  totals: number[];
}

/**
 * Modelo de un partido.
 * @param otHome probabilidad de que el local gane el tiempo extra (fuerza media relativa)
 */
export function matchModel(lambdaHome: number, lambdaAway: number, overtimeEnabled: boolean, otHome = 0.5): MatchModel {
  const ph = poissonPmf(lambdaHome, MAX_GOALS);
  const pa = poissonPmf(lambdaAway, MAX_GOALS);
  const size = MAX_GOALS + 2;
  const score = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  let overtime = 0;
  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const p = ph[h] * pa[a];
      if (h === a && overtimeEnabled) {
        overtime += p;
        score[h + 1][a] += p * otHome;
        score[h][a + 1] += p * (1 - otHome);
      } else {
        score[h][a] += p;
      }
    }
  }
  let home = 0;
  let away = 0;
  let draw = 0;
  const totals = new Array<number>(2 * size).fill(0);
  for (let h = 0; h < size; h++) {
    for (let a = 0; a < size; a++) {
      const p = score[h][a];
      if (h > a) home += p;
      else if (a > h) away += p;
      else draw += p;
      totals[h + a] += p;
    }
  }
  return { score, home, away, draw, overtime, totals };
}

/** Cuota decimal con margen de la casa. */
export function price(probability: number, margin: number): number | null {
  if (!(probability > 0.0005)) return null;
  const p = Math.min(0.985, probability * (1 + margin));
  return Math.min(500, Math.max(1.01, Math.round((1 / p) * 100) / 100));
}

export type Market = 'winner' | 'total' | 'exact' | 'scorer' | 'mvp' | 'champion' | 'playoffs' | 'promotion' | 'relegation';

export interface Selection {
  pick?: 'home' | 'away' | 'draw' | 'over' | 'under';
  line?: number;
  home?: number;
  away?: number;
  playerId?: string;
  teamId?: string;
}

export const TOTAL_LINES = [4.5, 5.5, 6.5, 7.5];

/** Participación de cada jugador en los goles de su equipo (misma regla que el motor). */
export interface ScorerShare {
  playerId: string;
  share: number;
}

export interface MatchOddsInput {
  lambdaHome: number;
  lambdaAway: number;
  overtimeEnabled: boolean;
  otHome: number;
  margin: number;
  homeScorers?: ScorerShare[];
  awayScorers?: ScorerShare[];
}

/** Probabilidad de una selección sobre un partido. null = mercado no disponible. */
export function matchProbability(market: Market, sel: Selection, input: MatchOddsInput): number | null {
  const m = matchModel(input.lambdaHome, input.lambdaAway, input.overtimeEnabled, input.otHome);
  switch (market) {
    case 'winner':
      if (sel.pick === 'home') return m.home;
      if (sel.pick === 'away') return m.away;
      if (sel.pick === 'draw') return input.overtimeEnabled ? null : m.draw;
      return null;
    case 'total': {
      if (sel.line === undefined || !TOTAL_LINES.includes(sel.line)) return null;
      const over = m.totals.reduce((s, p, t) => (t > sel.line! ? s + p : s), 0);
      return sel.pick === 'over' ? over : sel.pick === 'under' ? 1 - over : null;
    }
    case 'exact': {
      const h = sel.home ?? -1;
      const a = sel.away ?? -1;
      if (h < 0 || a < 0 || h >= m.score.length || a >= m.score.length) return null;
      return m.score[h][a];
    }
    case 'scorer': {
      const inHome = input.homeScorers?.find((s) => s.playerId === sel.playerId);
      const inAway = input.awayScorers?.find((s) => s.playerId === sel.playerId);
      if (inHome) return 1 - Math.exp(-input.lambdaHome * inHome.share);
      if (inAway) return 1 - Math.exp(-input.lambdaAway * inAway.share);
      return null;
    }
    case 'mvp': {
      // Aproximación: proporcional a los goles esperados del jugador, con ventaja para el equipo favorito.
      const all = [
        ...(input.homeScorers ?? []).map((s) => ({ id: s.playerId, w: s.share * input.lambdaHome * (0.6 + m.home) })),
        ...(input.awayScorers ?? []).map((s) => ({ id: s.playerId, w: s.share * input.lambdaAway * (0.6 + m.away) })),
      ];
      const total = all.reduce((s, x) => s + x.w, 0);
      const me = all.find((x) => x.id === sel.playerId);
      return me && total > 0 ? (me.w / total) * 0.85 : null; // 15 % reservado a porteros
    }
    default:
      return null;
  }
}

export function matchOdds(market: Market, sel: Selection, input: MatchOddsInput): number | null {
  const p = matchProbability(market, sel, input);
  return p === null ? null : price(p, input.margin);
}

export interface SettleInput {
  homeScore: number;
  awayScore: number;
  scorerIds: string[];
  mvpId: string | null;
}

export function settleMatchBet(market: Market, sel: Selection, r: SettleInput): 'won' | 'lost' | 'void' {
  switch (market) {
    case 'winner': {
      const actual = r.homeScore > r.awayScore ? 'home' : r.awayScore > r.homeScore ? 'away' : 'draw';
      return sel.pick === actual ? 'won' : 'lost';
    }
    case 'total': {
      const over = r.homeScore + r.awayScore > (sel.line ?? 0);
      return (sel.pick === 'over') === over ? 'won' : 'lost';
    }
    case 'exact':
      return sel.home === r.homeScore && sel.away === r.awayScore ? 'won' : 'lost';
    case 'scorer':
      return sel.playerId && r.scorerIds.includes(sel.playerId) ? 'won' : 'lost';
    case 'mvp':
      return sel.playerId && sel.playerId === r.mvpId ? 'won' : 'lost';
    default:
      return 'void';
  }
}

/** Cuota de una combinada: producto de las cuotas de sus selecciones. */
export function parlayOdds(odds: number[]): number {
  return Math.round(odds.reduce((p, o) => p * o, 1) * 100) / 100;
}

export const MARKET_LABEL: Record<Market, string> = {
  winner: 'Ganador',
  total: 'Total de goles',
  exact: 'Marcador exacto',
  scorer: 'Anota gol',
  mvp: 'MVP del partido',
  champion: 'Campeón',
  playoffs: 'Clasifica a playoffs',
  promotion: 'Asciende',
  relegation: 'Desciende',
};
