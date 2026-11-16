// Generación de calendarios: liga todos contra todos (método del círculo),
// grupos de copa, ronda suiza y reparto en jornadas.
import { createRng, shuffle, type Rng } from '../engine/rng.ts';

export interface Fixture {
  matchday: number;
  home: string;
  away: string;
  group?: string;
}

/**
 * Todos contra todos con `roundsPerOpponent` vueltas, alternando local.
 * Cada jornada tiene a cada equipo como máximo una vez.
 */
export function roundRobin(teams: string[], roundsPerOpponent = 2, group?: string): Fixture[] {
  const list = [...teams];
  if (list.length % 2 === 1) list.push('__descanso__');
  const n = list.length;
  const rounds: [string, string][][] = [];
  const arr = [...list];
  for (let r = 0; r < n - 1; r++) {
    const pairs: [string, string][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      // alterna local para equilibrar
      pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(pairs);
    arr.splice(1, 0, arr.pop()!); // rota todos menos el primero
  }
  const out: Fixture[] = [];
  let md = 0;
  for (let leg = 0; leg < roundsPerOpponent; leg++) {
    for (const pairs of rounds) {
      md++;
      for (const [a, b] of pairs) {
        if (a === '__descanso__' || b === '__descanso__') continue;
        const [home, away] = leg % 2 === 0 ? [a, b] : [b, a];
        out.push({ matchday: md, home, away, ...(group ? { group } : {}) });
      }
    }
  }
  return out;
}

/**
 * Reparte equipos en grupos: los cabezas de serie uno por grupo y el resto
 * por sorteo (sección 4, COPA).
 */
export function drawGroups(seeds: string[], others: string[], groups: number, rng: Rng): string[][] {
  const out: string[][] = Array.from({ length: groups }, () => []);
  seeds.slice(0, groups).forEach((t, i) => out[i].push(t));
  const pool = shuffle(rng, [...seeds.slice(groups), ...others]);
  let g = 0;
  for (const t of pool) {
    // siempre al grupo con menos equipos, empezando donde se quedó
    let best = g;
    for (let k = 0; k < groups; k++) {
      const idx = (g + k) % groups;
      if (out[idx].length < out[best].length) best = idx;
    }
    out[best].push(t);
    g = (best + 1) % groups;
  }
  return out;
}

export const GROUP_LABELS = 'ABCDEFGHIJKLMNOP'.split('');

/**
 * Una ronda suiza: empareja equipos con puntaje parecido que no se hayan
 * enfrentado. `ranking` viene ordenado de mejor a peor según la tabla actual.
 */
export function swissRound(ranking: string[], played: Set<string>, matchday: number, rng: Rng = createRng(matchday)): Fixture[] {
  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const pending = [...ranking];
  const out: Fixture[] = [];
  const solve = (rest: string[]): [string, string][] | null => {
    if (rest.length === 0) return [];
    const [a, ...others] = rest;
    for (let i = 0; i < others.length; i++) {
      const b = others[i];
      if (played.has(key(a, b))) continue;
      const sub = solve([...others.slice(0, i), ...others.slice(i + 1)]);
      if (sub) return [[a, b], ...sub];
    }
    return null;
  };
  // Backtracking con límite práctico: con 32 equipos y 8 rondas siempre encuentra.
  const pairs = solve(pending) ?? fallbackPairs(pending);
  for (const [a, b] of pairs) {
    const home = rng() < 0.5 ? a : b;
    out.push({ matchday, home, away: home === a ? b : a });
  }
  return out;
}

function fallbackPairs(list: string[]): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i + 1 < list.length; i += 2) out.push([list[i], list[i + 1]]);
  return out;
}
