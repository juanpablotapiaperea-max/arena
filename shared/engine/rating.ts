import type { EnginePlayer, EngineSettings, Lineup, TeamRatings } from './types.ts';

/** Atributo ajustado por forma y moral (hasta ±range). */
export function effectiveRating(p: EnginePlayer, range: number): number {
  const form = (clamp(p.form, 0, 100) - 50) / 50; // -1..1
  const morale = (clamp(p.morale, 0, 100) - 50) / 50;
  const factor = 1 + ((form + morale) / 2) * range;
  return p.rating * factor;
}

/**
 * Arma la alineación titular sola: el mejor portero, las 3 mejores parejas
 * de defensas y las 4 mejores líneas de delanteros, sin lesionados.
 * Si faltan jugadores sanos de una posición, se completa con los mejores
 * disponibles de otra (nunca deja huecos).
 */
export function buildLineup(players: EnginePlayer[], settings: EngineSettings): Lineup {
  const healthy = players.filter((p) => p.injuryDays <= 0);
  const byRating = (a: EnginePlayer, b: EnginePlayer) =>
    effectiveRating(b, settings.formMoraleRange) - effectiveRating(a, settings.formMoraleRange);

  const goalies = healthy.filter((p) => p.position === 'G').sort(byRating);
  const defs = healthy.filter((p) => p.position === 'D').sort(byRating);
  const fwds = healthy.filter((p) => p.position === 'F').sort(byRating);

  const used = new Set<string>();
  const take = (pool: EnginePlayer[], n: number): EnginePlayer[] => {
    const out: EnginePlayer[] = [];
    for (const p of pool) {
      if (out.length >= n) break;
      if (!used.has(p.id)) {
        used.add(p.id);
        out.push(p);
      }
    }
    return out;
  };
  const fill = (list: EnginePlayer[], n: number) => {
    if (list.length < n) {
      const rest = healthy.filter((p) => !used.has(p.id)).sort(byRating);
      list.push(...take(rest, n - list.length));
    }
    // Último recurso: un jugador genérico para no romper el motor.
    while (list.length < n) list.push(placeholder(list.length));
    return list;
  };

  const goalie = fill(take(goalies, 1), 1)[0];
  const backup = take(goalies, 1)[0];
  const d = fill(take(defs, 6), 6);
  const f = fill(take(fwds, 12), 12);

  return {
    goalie,
    backupGoalie: backup,
    pairs: [d.slice(0, 2), d.slice(2, 4), d.slice(4, 6)],
    lines: [f.slice(0, 3), f.slice(3, 6), f.slice(6, 9), f.slice(9, 12)],
  };
}

function placeholder(i: number): EnginePlayer {
  return { id: `placeholder-${i}`, name: 'Suplente', number: 0, position: 'F', rating: 40, form: 50, morale: 50, injuryDays: 0 };
}

/** Rating del equipo a partir de la alineación titular. */
export function teamRatings(lineup: Lineup, settings: EngineSettings, gamesToday = 0): TeamRatings {
  const r = (p: EnginePlayer) => effectiveRating(p, settings.formMoraleRange);
  const avg = (ps: EnginePlayer[]) => ps.reduce((s, p) => s + r(p), 0) / Math.max(1, ps.length);

  const lw = normalize(settings.lineWeights);
  const pw = normalize(settings.pairWeights);
  const attack = lineup.lines.reduce((s, line, i) => s + avg(line) * (lw[i] ?? 0), 0);
  const defense = lineup.pairs.reduce((s, pair, i) => s + avg(pair) * (pw[i] ?? 0), 0);
  const goalie = r(lineup.goalie);

  const fatigue = Math.max(0, 1 - Math.max(0, gamesToday) * settings.fatiguePerExtraGame);
  return { attack: attack * fatigue, defense: defense * fatigue, goalie: goalie * fatigue };
}

function normalize(ws: number[]): number[] {
  const t = ws.reduce((s, w) => s + w, 0) || 1;
  return ws.map((w) => w / t);
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
