// Generación determinista de los datos iniciales: identidad visual de los
// 54 equipos y sus 1,080 jugadores (20 por equipo).
import { FIRST_NAMES, LAST_NAMES } from './names.ts';
import { SEED_TEAMS, divisionForRank, INITIAL_BUDGET, type SeedTeam } from './teams.ts';
import { createRng, gaussian, hashSeed, randInt, shuffle, type Rng } from '../engine/rng.ts';
import { DEFAULT_ENGINE_SETTINGS } from '../engine/settings.ts';
import type { Position } from '../engine/types.ts';

export type AiStrategy = 'estrella' | 'cantera' | 'defensivo' | 'equilibrado' | 'austeridad';
export const AI_STRATEGIES: AiStrategy[] = ['estrella', 'cantera', 'defensivo', 'equilibrado', 'austeridad'];

export interface GeneratedTeam {
  key: string; // slug estable
  name: string;
  shortName: string;
  primaryColor: string;
  secondaryColor: string;
  division: 1 | 2;
  budget: number;
  aiStrategy: AiStrategy;
  targetAttack: number;
  targetDefense: number;
  targetGoalie: number;
  legacyTitles: number;
  legacyRunnersUp: number;
  legacyPoints: number;
  initialRank: number;
}

export interface GeneratedPlayer {
  teamKey: string;
  firstName: string;
  lastName: string;
  number: number;
  position: Position;
  rating: number;
  age: number;
  potential: number;
  form: number;
  morale: number;
  salary: number;
  contractYears: number;
  starter: boolean;
}

export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Siglas del escudo: iniciales de cada palabra (máx. 3) o 3 letras si es una sola palabra. */
export function shortNameFor(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.slice(0, 3).map((w) => w[0]).join('').toUpperCase();
}

function hsl(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

/** Colores generados: tonos repartidos con el ángulo áureo para que no se repitan. */
export function teamColors(index: number, rng: Rng): { primary: string; secondary: string } {
  const hue = (index * 137.508) % 360;
  const primary = hsl(hue, 62 + rng() * 20, 42 + rng() * 10);
  const variant = index % 3;
  const secondary =
    variant === 0 ? hsl((hue + 180) % 360, 70, 62) : variant === 1 ? hsl(hue, 25, 92) : hsl((hue + 40) % 360, 80, 58);
  return { primary, secondary };
}

/** Salario anual según atributo y edad (calibrado para ~10-20 M por club). */
export function salaryFor(rating: number, age: number): number {
  const q = Math.max(0, (rating - 55) / 45);
  const base = 150_000 + Math.pow(q, 3) * 1_700_000;
  const ageFactor = age < 22 ? 0.6 : age > 32 ? 0.85 : 1;
  return Math.round((base * ageFactor) / 10_000) * 10_000;
}

/**
 * Ajusta una lista de valores (ordenados de mayor a menor) para que su media
 * ponderada sea el objetivo, respetando el rango 1-100.
 */
function fitToTarget(offsets: number[], weights: number[], target: number): number[] {
  let values = offsets.map((o) => target + o);
  for (let iter = 0; iter < 40; iter++) {
    const mean = values.reduce((s, v, i) => s + v * weights[i], 0);
    const delta = target - mean;
    if (Math.abs(delta) < 0.05) break;
    values = values.map((v) => Math.max(1, Math.min(100, v + delta)));
  }
  const rounded = values.map((v) => Math.round(v));
  // Mantener el orden descendente tras redondear.
  for (let i = 1; i < rounded.length; i++) rounded[i] = Math.min(rounded[i], rounded[i - 1]);
  return rounded;
}

function age(rng: Rng): number {
  return Math.max(19, Math.min(36, Math.round(27 + gaussian(rng) * 3.8)));
}

function potentialFor(rng: Rng, rating: number, a: number): number {
  const growth = Math.max(0, 26 - a) * (0.5 + rng() * 1.5);
  return Math.min(100, Math.round(rating + growth + rng() * 2));
}

export function generateTeams(): GeneratedTeam[] {
  const rng = createRng(hashSeed('arena:teams'));
  return SEED_TEAMS.map((t, i) => {
    const colors = teamColors(i, rng);
    return {
      key: slugify(t.name),
      name: t.name,
      shortName: shortNameFor(t.name),
      primaryColor: colors.primary,
      secondaryColor: colors.secondary,
      division: divisionForRank(t.rank),
      budget: INITIAL_BUDGET,
      aiStrategy: AI_STRATEGIES[Math.floor(rng() * AI_STRATEGIES.length)],
      targetAttack: t.attack,
      targetDefense: t.defense,
      targetGoalie: t.goalie,
      legacyTitles: t.titles,
      legacyRunnersUp: t.runnersUp,
      legacyPoints: t.points,
      initialRank: t.rank,
    };
  });
}

/**
 * Plantilla de 20: 2 porteros, 6 defensas y 12 delanteros.
 * Los titulares reproducen ataque, defensa y portería del equipo (±1).
 * El único suplente de la alineación (2.º portero) queda 8-15 puntos abajo.
 */
export function generateRoster(team: SeedTeam, usedNames: Set<string>): GeneratedPlayer[] {
  const rng = createRng(hashSeed(`arena:roster:${team.name}`));
  const s = DEFAULT_ENGINE_SETTINGS;
  const players: GeneratedPlayer[] = [];

  // Delanteros: 4 líneas de 3, la primera línea más fuerte.
  const lineOffsets = [4, 1, -2, -5];
  const fOffsets: number[] = [];
  const fWeights: number[] = [];
  const lwTotal = s.lineWeights.reduce((a, b) => a + b, 0);
  lineOffsets.forEach((o, li) => {
    for (let k = 0; k < 3; k++) {
      fOffsets.push(o + (1 - k) * 0.8 + (rng() - 0.5));
      fWeights.push(s.lineWeights[li] / lwTotal / 3);
    }
  });
  const fRatings = fitToTarget(fOffsets.sort((a, b) => b - a), fWeights, team.attack);

  const pairOffsets = [3, 0, -3];
  const dOffsets: number[] = [];
  const dWeights: number[] = [];
  const pwTotal = s.pairWeights.reduce((a, b) => a + b, 0);
  pairOffsets.forEach((o, pi) => {
    for (let k = 0; k < 2; k++) {
      dOffsets.push(o + (k === 0 ? 0.6 : -0.6));
      dWeights.push(s.pairWeights[pi] / pwTotal / 2);
    }
  });
  const dRatings = fitToTarget(dOffsets.sort((a, b) => b - a), dWeights, team.defense);

  const gStarter = Math.max(1, Math.min(100, team.goalie));
  const gBackup = Math.max(1, gStarter - randInt(rng, 8, 15));

  const numbers = shuffle(rng, Array.from({ length: 98 }, (_, i) => i + 1));
  const nextName = () => {
    for (let tries = 0; tries < 10_000; tries++) {
      const first = FIRST_NAMES[Math.floor(rng() * FIRST_NAMES.length)];
      const last = LAST_NAMES[Math.floor(rng() * LAST_NAMES.length)];
      const full = `${first} ${last}`;
      if (!usedNames.has(full)) {
        usedNames.add(full);
        return { first, last };
      }
    }
    throw new Error('Se agotaron las combinaciones de nombres');
  };

  const add = (position: Position, rating: number, starter: boolean) => {
    const a = age(rng);
    const { first, last } = nextName();
    players.push({
      teamKey: slugify(team.name),
      firstName: first,
      lastName: last,
      number: numbers[players.length],
      position,
      rating,
      age: a,
      potential: potentialFor(rng, rating, a),
      form: 50, // neutro al arrancar: el rating inicial reproduce los atributos actuales
      morale: 50,
      salary: salaryFor(rating, a),
      contractYears: randInt(rng, 1, 5),
      starter,
    });
  };

  add('G', gStarter, true);
  add('G', gBackup, false);
  dRatings.forEach((r) => add('D', r, true));
  fRatings.forEach((r) => add('F', r, true));
  return players;
}

export function generateAllRosters(): GeneratedPlayer[] {
  const used = new Set<string>();
  return SEED_TEAMS.flatMap((t) => generateRoster(t, used));
}
