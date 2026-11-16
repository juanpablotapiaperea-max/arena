// Simulación de probabilidades (sección 10): juega miles de veces lo que falta
// de una edición con el mismo motor de goles, sin sesgos secretos, y cuenta
// cuántas veces cada equipo es campeón, clasifica, asciende o desciende.
import { advance, regularStandings, type EditionConfig, type EditionState, type Format, type MatchRow } from '../competition/edition.ts';
import { expectedGoals, power } from '../engine/match.ts';
import { createRng, poisson, type Rng } from '../engine/rng.ts';
import type { EngineSettings, PlayStyle, TeamRatings } from '../engine/types.ts';

export interface SimTeam extends TeamRatings {
  id: string;
  style: PlayStyle;
}

export interface Probabilities {
  champion: number;
  playoffs: number;
  promotion: number;
  relegation: number;
}

/** Partido rápido solo con ratings de equipo (sin jugadores ni box score). */
export function quickMatch(
  rng: Rng,
  home: SimTeam,
  away: SimTeam,
  neutral: boolean,
  s: EngineSettings,
  overtime: boolean,
  noise = 0,
): { home: number; away: number; overtime: boolean } {
  const e = expectedGoals(home, away, home.style, away.style, neutral, s);
  let h = Math.min(s.maxGoals, poisson(rng, Math.max(s.minLambda, e.home + (rng() - 0.5) * 2 * noise)));
  let a = Math.min(s.maxGoals, poisson(rng, Math.max(s.minLambda, e.away + (rng() - 0.5) * 2 * noise)));
  let ot = false;
  if (h === a && overtime) {
    ot = true;
    const ph = power(home);
    if (rng() < ph / (ph + power(away))) h++;
    else a++;
  }
  return { home: h, away: a, overtime: ot };
}

/** Iteraciones que caben en el presupuesto de cómputo según los partidos que faltan. */
export function iterationsFor(requested: number, remainingMatches: number, budget = 1_200_000): number {
  if (remainingMatches <= 0) return 1;
  return Math.max(100, Math.min(requested, Math.floor(budget / remainingMatches)));
}

/**
 * Simula el resto de la edición `iterations` veces.
 * Reutiliza advance(), así que respeta formato, siembras, descansos e ida y vuelta.
 */
export function simulateProbabilities(
  format: Format,
  c: EditionConfig,
  teamIds: string[],
  teams: Map<string, SimTeam>,
  state: EditionState,
  matches: MatchRow[],
  s: EngineSettings,
  iterations: number,
  seed: number,
): Map<string, Probabilities> {
  const count = new Map<string, Probabilities>(teamIds.map((t) => [t, { champion: 0, playoffs: 0, promotion: 0, relegation: 0 }]));
  const rng = createRng(seed);
  const overtime = c.overtime !== false;
  const hasRegular = state.units.some((u) => u.stage !== 'playoff');
  const playoffStarted = matches.some((m) => m.stage === 'playoff');

  for (let it = 0; it < iterations; it++) {
    const ms: MatchRow[] = matches.map((m) => ({ ...m }));
    let st: EditionState = { ...state };
    let regularCounted = false;

    for (let guard = 0; guard < 200; guard++) {
      // Juega todo lo pendiente.
      for (const m of ms) {
        if (m.finished) continue;
        const home = teams.get(m.home);
        const away = teams.get(m.away);
        if (!home || !away) {
          m.homeScore = 1;
          m.awayScore = 0;
        } else {
          const isLeg1 = m.stage === 'playoff' && m.leg === 1;
          const r = quickMatch(rng, home, away, false, s, isLeg1 ? false : overtime);
          m.homeScore = r.home;
          m.awayScore = r.away;
          m.overtime = r.overtime;
          if (m.stage === 'playoff' && m.leg === 2) {
            // Global empatado: lo decide un gol extra por fuerza media.
            const first = ms.find((x) => x.stage === 'playoff' && x.round === m.round && x.slot === m.slot && x.leg === 1);
            if (first && (first.awayScore ?? 0) + r.home === (first.homeScore ?? 0) + r.away) {
              const ph = power(home);
              if (rng() < ph / (ph + power(away))) m.homeScore++;
              else m.awayScore++;
              m.overtime = true;
            }
          }
        }
        m.finished = true;
      }

      // Al terminar la fase regular: clasificados, ascensos y descensos.
      if (hasRegular && !regularCounted && ms.filter((m) => m.stage !== 'playoff').every((m) => m.finished)) {
        const next = advance(format, c, teamIds, st, ms, rng);
        const regularDone = next.enteredPlayoffs || next.finished || playoffStarted || next.create.every((x) => x.stage === 'playoff');
        if (regularDone) {
          regularCounted = true;
          const table = regularStandings(teamIds, ms, c).map((r) => r.teamId);
          const seeds = next.statePatch?.playoffSeeds ?? st.playoffSeeds ?? [];
          for (const t of seeds) count.get(t)!.playoffs++;
          table.slice(0, c.promoted ?? 0).forEach((t) => count.get(t)!.promotion++);
          if (c.relegated) table.slice(-c.relegated).forEach((t) => count.get(t)!.relegation++);
        }
        if (next.statePatch) st = { ...st, ...next.statePatch };
        if (next.finished) {
          count.get(next.finished.champion)!.champion++;
          break;
        }
        pushSpecs(ms, next.create);
        if (!next.create.length) break;
        continue;
      }

      const next = advance(format, c, teamIds, st, ms, rng);
      if (next.statePatch) st = { ...st, ...next.statePatch };
      if (!hasRegular && !regularCounted) {
        regularCounted = true;
      }
      if (next.finished) {
        count.get(next.finished.champion)!.champion++;
        break;
      }
      if (!next.create.length) break;
      pushSpecs(ms, next.create);
    }
  }

  for (const p of count.values()) {
    p.champion /= iterations;
    p.playoffs /= iterations;
    p.promotion /= iterations;
    p.relegation /= iterations;
  }
  return count;
}

function pushSpecs(ms: MatchRow[], specs: { unitIndex: number; stage: string; round?: string; leg?: number; slot?: number; group?: string; home: string; away: string }[]) {
  for (const x of specs) {
    ms.push({
      unitIndex: x.unitIndex,
      stage: x.stage,
      round: x.round ?? null,
      leg: x.leg ?? null,
      slot: x.slot ?? null,
      group: x.group ?? null,
      home: x.home,
      away: x.away,
      homeScore: null,
      awayScore: null,
      overtime: false,
      finished: false,
    });
  }
}
