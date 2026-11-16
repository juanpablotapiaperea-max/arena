// Ascensos y descensos entre Primera y Segunda (sección 4) y puntos de
// ranking por resultado (sección 5).

export interface DivisionMoves {
  promoted: string[]; // de Segunda a Primera
  relegated: string[]; // de Primera a Segunda
}

/**
 * Los `relegated` peores de Primera bajan y los `promoted` mejores de la
 * tabla de Segunda suben. Las tablas vienen ordenadas de mejor a peor.
 */
export function divisionMoves(primera: string[], segunda: string[], relegated = 6, promoted = 6): DivisionMoves {
  return {
    relegated: primera.slice(Math.max(0, primera.length - relegated)),
    promoted: segunda.slice(0, promoted),
  };
}

export function applyMoves(primera: string[], segunda: string[], moves: DivisionMoves): { primera: string[]; segunda: string[] } {
  const down = new Set(moves.relegated);
  const up = new Set(moves.promoted);
  return {
    primera: [...primera.filter((t) => !down.has(t)), ...moves.promoted],
    segunda: [...moves.relegated, ...segunda.filter((t) => !up.has(t))],
  };
}

export interface RankingBase {
  champion: number;
  runnerUp: number;
  semifinal: number;
  quarterfinal: number;
  roundOf16: number;
  playoffs: number;
  leagueMax: number;
}

export const DEFAULT_RANKING_BASE: RankingBase = {
  champion: 100,
  runnerUp: 70,
  semifinal: 50,
  quarterfinal: 35,
  roundOf16: 25,
  playoffs: 15,
  leagueMax: 20,
};

export type BestRound = 'champion' | 'runnerUp' | 'semifinal' | 'quarterfinal' | 'roundOf16' | 'playoffs' | null;

/** Puntos de liga regular: 20 × (1 − (posición − 1) / (equipos − 1)). */
export function leaguePoints(position: number, teams: number, max = 20): number {
  if (teams <= 1) return max;
  return max * (1 - (position - 1) / (teams - 1));
}

/**
 * Puntos de ranking de un equipo en una edición: posición en liga (si aplica)
 * + la ronda más alta alcanzada, todo multiplicado por el peso de la competición.
 */
export function rankingPoints(
  opts: { leaguePosition?: number; leagueTeams?: number; bestRound: BestRound; weight: number },
  base: RankingBase = DEFAULT_RANKING_BASE,
): number {
  let pts = 0;
  if (opts.leaguePosition && opts.leagueTeams) pts += leaguePoints(opts.leaguePosition, opts.leagueTeams, base.leagueMax);
  if (opts.bestRound) pts += base[opts.bestRound];
  return Math.round(pts * opts.weight * 100) / 100;
}

/** Ronda más alta alcanzada según dónde fue eliminado el equipo. */
export function bestRoundFromElimination(eliminatedIn: string | null, isChampion: boolean): BestRound {
  if (isChampion) return 'champion';
  switch (eliminatedIn) {
    case 'final':
      return 'runnerUp';
    case 'semifinal':
      return 'semifinal';
    case 'cuartos':
      return 'quarterfinal';
    case 'octavos':
      return 'roundOf16';
    case 'dieciseisavos':
    case 'previa':
      return 'playoffs';
    default:
      return null;
  }
}

export interface RankingRow {
  teamId: string;
  name: string;
  points: number;
  titles: number;
  runnersUp: number;
}

/** Desempate del ranking: más títulos, luego más subcampeonatos, luego alfabético. */
export function sortRanking(rows: RankingRow[]): RankingRow[] {
  return [...rows].sort(
    (a, b) => b.points - a.points || b.titles - a.titles || b.runnersUp - a.runnersUp || a.name.localeCompare(b.name, 'es'),
  );
}
