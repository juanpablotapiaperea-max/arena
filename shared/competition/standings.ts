// Tablas de posiciones con los desempates de la sección 4:
// puntos → diferencia de goles → goles a favor → enfrentamiento directo → victorias.

export interface PointsConfig {
  win: number;
  draw: number;
  loss: number;
  otWin: number;
  otLoss: number;
}

export interface PlayedMatch {
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  overtime: boolean;
}

export interface StandingRow {
  teamId: string;
  played: number;
  wins: number;
  otWins: number;
  draws: number;
  otLosses: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
  form: ('W' | 'L' | 'D')[]; // últimos 5, el más reciente al final
}

export type Tiebreaker = 'points' | 'goal_diff' | 'goals_for' | 'head_to_head' | 'wins';

export const DEFAULT_POINTS: PointsConfig = { win: 3, draw: 1, loss: 0, otWin: 2, otLoss: 1 };
export const DEFAULT_TIEBREAKERS: Tiebreaker[] = ['points', 'goal_diff', 'goals_for', 'head_to_head', 'wins'];

function emptyRow(teamId: string): StandingRow {
  return { teamId, played: 0, wins: 0, otWins: 0, draws: 0, otLosses: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, goalDiff: 0, points: 0, form: [] };
}

export function accumulate(teamIds: string[], matches: PlayedMatch[], pts: PointsConfig = DEFAULT_POINTS): Map<string, StandingRow> {
  const rows = new Map(teamIds.map((id) => [id, emptyRow(id)]));
  for (const m of matches) {
    const h = rows.get(m.home);
    const a = rows.get(m.away);
    if (!h || !a) continue;
    h.played++;
    a.played++;
    h.goalsFor += m.homeScore;
    h.goalsAgainst += m.awayScore;
    a.goalsFor += m.awayScore;
    a.goalsAgainst += m.homeScore;
    if (m.homeScore === m.awayScore) {
      h.draws++;
      a.draws++;
      h.points += pts.draw;
      a.points += pts.draw;
      h.form.push('D');
      a.form.push('D');
    } else {
      const [w, l] = m.homeScore > m.awayScore ? [h, a] : [a, h];
      if (m.overtime) {
        w.otWins++;
        l.otLosses++;
        w.points += pts.otWin;
        l.points += pts.otLoss;
      } else {
        w.wins++;
        l.losses++;
        w.points += pts.win;
        l.points += pts.loss;
      }
      w.form.push('W');
      l.form.push('L');
    }
  }
  for (const r of rows.values()) {
    r.goalDiff = r.goalsFor - r.goalsAgainst;
    r.form = r.form.slice(-5);
  }
  return rows;
}

const totalWins = (r: StandingRow) => r.wins + r.otWins;

/**
 * Ordena la tabla aplicando los desempates en orden. El enfrentamiento directo
 * se calcula como una mini-tabla solo entre los equipos empatados en ese punto.
 * Último recurso: orden alfabético por id para que el resultado sea estable.
 */
export function computeStandings(
  teamIds: string[],
  matches: PlayedMatch[],
  pts: PointsConfig = DEFAULT_POINTS,
  tiebreakers: Tiebreaker[] = DEFAULT_TIEBREAKERS,
): StandingRow[] {
  const rows = accumulate(teamIds, matches, pts);
  const all = [...rows.values()];
  return sortGroup(all, matches, pts, tiebreakers);
}

function sortGroup(group: StandingRow[], matches: PlayedMatch[], pts: PointsConfig, tbs: Tiebreaker[]): StandingRow[] {
  if (group.length <= 1 || tbs.length === 0) return [...group].sort((a, b) => a.teamId.localeCompare(b.teamId));
  const [tb, ...rest] = tbs;

  let key: (r: StandingRow) => number;
  if (tb === 'head_to_head') {
    const ids = new Set(group.map((r) => r.teamId));
    const h2h = accumulate(
      [...ids],
      matches.filter((m) => ids.has(m.home) && ids.has(m.away)),
      pts,
    );
    key = (r) => {
      const x = h2h.get(r.teamId)!;
      // puntos del mini-torneo y, dentro de él, diferencia de goles
      return x.points * 10_000 + x.goalDiff;
    };
  } else {
    key =
      tb === 'points'
        ? (r) => r.points
        : tb === 'goal_diff'
          ? (r) => r.goalDiff
          : tb === 'goals_for'
            ? (r) => r.goalsFor
            : totalWins;
  }

  const buckets = new Map<number, StandingRow[]>();
  for (const r of group) {
    const k = key(r);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(r);
  }
  const out: StandingRow[] = [];
  for (const k of [...buckets.keys()].sort((a, b) => b - a)) {
    const bucket = buckets.get(k)!;
    out.push(...(bucket.length > 1 ? sortGroup(bucket, matches, pts, rest) : bucket));
  }
  return out;
}
