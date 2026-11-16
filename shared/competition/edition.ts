// Ciclo de vida de una edición: unidades del calendario (jornadas y rondas),
// partidos iniciales y avance (rondas suizas, playoffs, ida y vuelta, final).
import { mainBracket, nextRound, planBracket, roundNameFor, isMainEventRound, type RoundName } from './bracket.ts';
import { GROUP_LABELS, drawGroups, roundRobin, swissRound } from './schedule.ts';
import { computeStandings, DEFAULT_POINTS, DEFAULT_TIEBREAKERS, type PlayedMatch, type PointsConfig, type StandingRow, type Tiebreaker } from './standings.ts';
import type { Rng } from '../engine/rng.ts';
import type { SimMode } from '../engine/types.ts';

export type Format = 'league' | 'groups_knockout' | 'knockout' | 'swiss' | 'two_legged';

export interface EditionConfig {
  points?: PointsConfig;
  tiebreakers?: Tiebreaker[];
  randomness?: number;
  mode?: SimMode;
  overtime?: boolean;
  awayGoals?: boolean;
  roundsPerOpponent?: number;
  playoffTeams?: number;
  playoffLegs?: number;
  singleLegFinal?: boolean;
  neutralFinal?: boolean;
  swissRounds?: number;
  groups?: number;
  groupSize?: number;
  qualifyPerGroup?: number;
  seededTeams?: number;
  relegated?: number;
  promoted?: number;
  prelimLabel?: string;
}

export interface Unit {
  index: number;
  kind: 'matchday' | 'round';
  stage: 'regular' | 'group' | 'swiss' | 'playoff';
  matchday?: number;
  round?: RoundName;
  leg?: 1 | 2;
  label: string;
  matches: number;
  /** Todos sus partidos son eventos principales (cuartos, semifinal, final). */
  main: boolean;
}

export interface MatchSpec {
  unitIndex: number;
  stage: Unit['stage'];
  round?: RoundName;
  matchday?: number;
  group?: string;
  tieKey?: string;
  leg?: 1 | 2;
  slot?: number;
  home: string;
  away: string;
  neutral: boolean;
  isFinal: boolean;
  isMainEvent: boolean;
}

/** Fila mínima de un partido ya guardado. */
export interface MatchRow {
  unitIndex: number;
  stage: string;
  round?: string | null;
  leg?: number | null;
  slot?: number | null;
  group?: string | null;
  home: string;
  away: string;
  homeScore: number | null;
  awayScore: number | null;
  overtime: boolean;
  finished: boolean;
}

export interface EditionState {
  units: Unit[];
  groups?: Record<string, string[]>;
  playoffSeeds?: string[];
}

export const ROUND_LABEL: Record<RoundName, string> = {
  previa: 'Ronda previa',
  dieciseisavos: 'Dieciseisavos',
  octavos: 'Octavos de final',
  cuartos: 'Cuartos de final',
  semifinal: 'Semifinales',
  final: 'Final',
};

const legsOf = (c: EditionConfig) => (c.playoffLegs === 2 ? 2 : 1);

function playoffUnits(qualifiers: number, c: EditionConfig, startIndex: number): Unit[] {
  const out: Unit[] = [];
  if (qualifiers < 2) return out;
  const pow = 2 ** Math.ceil(Math.log2(qualifiers));
  const rounds: { round: RoundName; ties: number }[] = [];
  let size = qualifiers;
  if (pow !== qualifiers) {
    const main = pow / 2;
    rounds.push({ round: 'previa', ties: qualifiers - main });
    size = main;
  }
  for (; size >= 2; size /= 2) rounds.push({ round: roundNameFor(size), ties: size / 2 });
  for (const r of rounds) {
    const twoLegs = legsOf(c) === 2 && !(r.round === 'final' && c.singleLegFinal !== false);
    const base = r.round === 'previa' ? c.prelimLabel ?? ROUND_LABEL.previa : ROUND_LABEL[r.round];
    for (const leg of twoLegs ? ([1, 2] as const) : ([undefined] as const)) {
      out.push({
        index: startIndex + out.length,
        kind: 'round',
        stage: 'playoff',
        round: r.round,
        ...(leg ? { leg } : {}),
        label: leg ? `${base} · ${leg === 1 ? 'ida' : 'vuelta'}` : base,
        matches: r.ties,
        main: isMainEventRound(r.round),
      });
    }
  }
  return out;
}

/** Lista ordenada de jornadas y rondas de una edición. */
export function buildUnits(format: Format, c: EditionConfig, nTeams: number): Unit[] {
  const units: Unit[] = [];
  const md = (stage: Unit['stage'], count: number, matches: number) => {
    for (let i = 1; i <= count; i++) {
      units.push({ index: units.length, kind: 'matchday', stage, matchday: i, label: `Jornada ${i}`, matches, main: false });
    }
  };
  if (format === 'league') {
    const rounds = (nTeams % 2 === 0 ? nTeams - 1 : nTeams) * (c.roundsPerOpponent ?? 2);
    md('regular', rounds, Math.floor(nTeams / 2));
    units.push(...playoffUnits(Math.min(c.playoffTeams ?? 0, nTeams), c, units.length));
  } else if (format === 'swiss') {
    md('swiss', c.swissRounds ?? 8, Math.floor(nTeams / 2));
    units.push(...playoffUnits(Math.min(c.playoffTeams ?? 0, nTeams), c, units.length));
  } else if (format === 'groups_knockout') {
    const groups = c.groups ?? 8;
    const size = c.groupSize ?? Math.ceil(nTeams / groups);
    const rounds = (size % 2 === 0 ? size - 1 : size) * (c.roundsPerOpponent ?? 1);
    md('group', rounds, groups * Math.floor(size / 2));
    units.push(...playoffUnits(groups * (c.qualifyPerGroup ?? 2), c, units.length));
  } else {
    units.push(...playoffUnits(nTeams, c, 0));
  }
  return units;
}

const tieKey = (round: string, slot: number) => `${round}:${slot}`;

function roundSpecs(unit: Unit, pairs: { slot: number; high: string; low: string }[], c: EditionConfig): MatchSpec[] {
  const single = !unit.leg;
  const isFinal = unit.round === 'final';
  return pairs.map((p) => {
    // Partido único: local el mejor sembrado. Ida: local el peor sembrado.
    const home = single ? p.high : p.low;
    const away = single ? p.low : p.high;
    return {
      unitIndex: unit.index,
      stage: 'playoff',
      round: unit.round,
      tieKey: tieKey(unit.round!, p.slot),
      ...(unit.leg ? { leg: unit.leg } : {}),
      slot: p.slot,
      home,
      away,
      neutral: isFinal && single && c.neutralFinal !== false,
      isFinal: isFinal && (single || unit.leg === 2),
      isMainEvent: unit.main,
    };
  });
}

/** Partidos que se crean al arrancar la edición. `teams` viene ordenado por siembra. */
export function initialMatches(
  format: Format,
  c: EditionConfig,
  teams: string[],
  rng: Rng,
): { units: Unit[]; matches: MatchSpec[]; state: EditionState } {
  const units = buildUnits(format, c, teams.length);
  const state: EditionState = { units };
  let matches: MatchSpec[] = [];
  const base = { neutral: false, isFinal: false, isMainEvent: false };

  if (format === 'league') {
    matches = roundRobin(teams, c.roundsPerOpponent ?? 2).map((f) => ({
      ...base,
      unitIndex: f.matchday - 1,
      stage: 'regular' as const,
      matchday: f.matchday,
      home: f.home,
      away: f.away,
    }));
  } else if (format === 'groups_knockout') {
    const groups = c.groups ?? 8;
    const seeded = Math.min(c.seededTeams ?? groups, teams.length);
    const drawn = drawGroups(teams.slice(0, seeded), teams.slice(seeded), groups, rng);
    state.groups = {};
    drawn.forEach((g, i) => {
      const label = GROUP_LABELS[i];
      state.groups![label] = g;
      for (const f of roundRobin(g, c.roundsPerOpponent ?? 1, label)) {
        matches.push({ ...base, unitIndex: f.matchday - 1, stage: 'group', matchday: f.matchday, group: label, home: f.home, away: f.away });
      }
    });
  } else if (format === 'swiss') {
    // Primera ronda: mitad superior contra mitad inferior (1 vs 17, 2 vs 18…).
    const half = Math.floor(teams.length / 2);
    for (let i = 0; i < half; i++) {
      const [home, away] = rng() < 0.5 ? [teams[i], teams[i + half]] : [teams[i + half], teams[i]];
      matches.push({ ...base, unitIndex: 0, stage: 'swiss', matchday: 1, home, away });
    }
  } else {
    state.playoffSeeds = [...teams];
    const first = units[0];
    const plan = planBracket(teams);
    matches = roundSpecs(first, plan.preliminary.length ? plan.preliminary : mainBracket(teams), c);
  }
  return { units, matches, state };
}

const played = (m: MatchRow): PlayedMatch => ({
  home: m.home,
  away: m.away,
  homeScore: m.homeScore ?? 0,
  awayScore: m.awayScore ?? 0,
  overtime: m.overtime,
});

/** Tabla de la fase regular (o de un grupo). */
export function regularStandings(teams: string[], matches: MatchRow[], c: EditionConfig, group?: string): StandingRow[] {
  const rows = matches.filter((m) => m.finished && m.stage !== 'playoff' && (group === undefined || m.group === group));
  return computeStandings(teams, rows.map(played), c.points ?? DEFAULT_POINTS, c.tiebreakers ?? DEFAULT_TIEBREAKERS);
}

/** Clasificados a playoffs, ordenados por siembra. */
export function qualifiers(format: Format, c: EditionConfig, teams: string[], matches: MatchRow[], state: EditionState): string[] {
  if (format === 'groups_knockout' && state.groups) {
    const perGroup = c.qualifyPerGroup ?? 2;
    const tiers: StandingRow[][] = Array.from({ length: perGroup }, () => []);
    for (const [label, members] of Object.entries(state.groups)) {
      regularStandings(members, matches, c, label)
        .slice(0, perGroup)
        .forEach((r, i) => tiers[i].push(r));
    }
    const byRecord = (a: StandingRow, b: StandingRow) =>
      b.points - a.points || b.goalDiff - a.goalDiff || b.goalsFor - a.goalsFor || a.teamId.localeCompare(b.teamId);
    return tiers.flatMap((t) => t.sort(byRecord).map((r) => r.teamId));
  }
  if (format === 'league' || format === 'swiss') {
    return regularStandings(teams, matches, c)
      .slice(0, c.playoffTeams ?? 0)
      .map((r) => r.teamId);
  }
  return teams;
}

/** Ganador de una eliminatoria (uno o dos partidos). null si no ha terminado. */
export function tieWinner(legs: MatchRow[], c: EditionConfig): { winner: string; loser: string } | null {
  if (!legs.length || legs.some((m) => !m.finished)) return null;
  const a = legs[0].home;
  const b = legs[0].away;
  let ga = 0;
  let gb = 0;
  let awayA = 0;
  let awayB = 0;
  for (const m of legs) {
    const hs = m.homeScore ?? 0;
    const as = m.awayScore ?? 0;
    if (m.home === a) {
      ga += hs;
      gb += as;
      awayB += as;
    } else {
      gb += hs;
      ga += as;
      awayA += as;
    }
  }
  let winA = ga > gb;
  if (ga === gb) winA = c.awayGoals && awayA !== awayB ? awayA > awayB : a < b; // el último caso no ocurre: el motor fuerza tiempo extra
  return winA ? { winner: a, loser: b } : { winner: b, loser: a };
}

export interface AdvanceResult {
  create: MatchSpec[];
  statePatch?: Partial<EditionState>;
  finished?: { champion: string; runnerUp: string };
  /** La edición pasó de fase regular a playoffs. */
  enteredPlayoffs?: boolean;
}

/**
 * Qué hay que crear ahora. Se llama cada vez que termina una unidad:
 * crea los partidos de la siguiente unidad si la anterior está completa.
 */
export function advance(
  format: Format,
  c: EditionConfig,
  teams: string[],
  state: EditionState,
  matches: MatchRow[],
  rng: Rng,
): AdvanceResult {
  const units = state.units;
  const byUnit = (i: number) => matches.filter((m) => m.unitIndex === i);
  const complete = (i: number) => {
    const ms = byUnit(i);
    return ms.length > 0 && ms.every((m) => m.finished);
  };

  for (const unit of units) {
    const existing = byUnit(unit.index);
    if (existing.length > 0) {
      if (!existing.every((m) => m.finished)) return { create: [] }; // aún en juego
      continue;
    }
    // Primera unidad sin partidos: ¿las anteriores terminaron?
    if (unit.index > 0 && !complete(unit.index - 1)) return { create: [] };

    if (unit.stage === 'swiss') {
      const ranking = regularStandings(teams, matches, c).map((r) => r.teamId);
      const pairs = new Set(matches.filter((m) => m.stage === 'swiss').map((m) => (m.home < m.away ? `${m.home}|${m.away}` : `${m.away}|${m.home}`)));
      const fixtures = swissRound(ranking, pairs, unit.matchday!, rng);
      return {
        create: fixtures.map((f) => ({
          unitIndex: unit.index,
          stage: 'swiss' as const,
          matchday: unit.matchday,
          home: f.home,
          away: f.away,
          neutral: false,
          isFinal: false,
          isMainEvent: false,
        })),
      };
    }

    if (unit.stage !== 'playoff') return { create: [] }; // la liga y los grupos se crean al inicio

    // Vuelta: mismos cruces de la ida con la localía invertida.
    if (unit.leg === 2) {
      const first = byUnit(unit.index - 1);
      return {
        create: first.map((m) => ({
          unitIndex: unit.index,
          stage: 'playoff' as const,
          round: unit.round,
          tieKey: tieKey(unit.round!, m.slot ?? 0),
          leg: 2 as const,
          slot: m.slot ?? 0,
          home: m.away,
          away: m.home,
          neutral: false,
          isFinal: unit.round === 'final',
          isMainEvent: unit.main,
        })),
      };
    }

    const prevPlayoff = units.filter((u) => u.stage === 'playoff' && u.index < unit.index);
    if (prevPlayoff.length === 0) {
      // Primera ronda de playoffs.
      const seeds = state.playoffSeeds ?? qualifiers(format, c, teams, matches, state);
      const plan = planBracket(seeds);
      const pairs = unit.round === 'previa' ? plan.preliminary : mainBracket(seeds);
      return { create: roundSpecs(unit, pairs, c), statePatch: { playoffSeeds: seeds }, enteredPlayoffs: true };
    }

    const seeds = state.playoffSeeds ?? teams;
    const rank = new Map(seeds.map((t, i) => [t, i + 1]));
    const prevRound = prevPlayoff[prevPlayoff.length - 1].round!;
    const prevMatches = matches.filter((m) => m.stage === 'playoff' && m.round === prevRound);
    const slots = [...new Set(prevMatches.map((m) => m.slot ?? 0))].sort((x, y) => x - y);
    const winners = slots.map((s) => tieWinner(prevMatches.filter((m) => (m.slot ?? 0) === s), c)?.winner);
    if (winners.some((w) => !w)) return { create: [] };

    if (prevRound === 'previa') {
      const plan = planBracket(seeds);
      const reseeded = [...plan.byes, ...(winners as string[])].sort((x, y) => (rank.get(x) ?? 999) - (rank.get(y) ?? 999));
      return { create: roundSpecs(unit, mainBracket(reseeded), c) };
    }
    return { create: roundSpecs(unit, nextRound(winners, new Set(), rank), c) };
  }

  // Todas las unidades existen y terminaron: hay campeón.
  const finalMatches = matches.filter((m) => m.stage === 'playoff' && m.round === 'final');
  const res = tieWinner(finalMatches, c);
  if (res) return { create: [], finished: { champion: res.winner, runnerUp: res.loser } };
  // Liga sin playoffs: campeón el líder.
  if (!units.some((u) => u.stage === 'playoff') && matches.length && matches.every((m) => m.finished)) {
    const table = regularStandings(teams, matches, c);
    return { create: [], finished: { champion: table[0].teamId, runnerUp: table[1]?.teamId ?? table[0].teamId } };
  }
  return { create: [] };
}

/** Ronda en la que cada equipo quedó eliminado de los playoffs. */
export function eliminationRounds(matches: MatchRow[], c: EditionConfig): Map<string, string> {
  const out = new Map<string, string>();
  const rounds = [...new Set(matches.filter((m) => m.stage === 'playoff').map((m) => m.round!))];
  for (const round of rounds) {
    const ms = matches.filter((m) => m.stage === 'playoff' && m.round === round);
    for (const slot of new Set(ms.map((m) => m.slot ?? 0))) {
      const res = tieWinner(ms.filter((m) => (m.slot ?? 0) === slot), c);
      if (res) out.set(res.loser, round);
    }
  }
  return out;
}
