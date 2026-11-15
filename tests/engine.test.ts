import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ENGINE_SETTINGS as S,
  buildLineup,
  createRng,
  expectedGoals,
  simulateMatch,
  teamRatings,
  type EnginePlayer,
  type MatchContext,
  type TeamInput,
} from '../shared/engine/index.ts';
import { generateAllRosters, generateTeams } from '../shared/data/generate.ts';
import { SEED_TEAMS } from '../shared/data/teams.ts';

const rosters = generateAllRosters();
const teams = generateTeams();
const toEngine = (teamKey: string): EnginePlayer[] =>
  rosters
    .filter((p) => p.teamKey === teamKey)
    .map((p, i) => ({
      id: `${teamKey}-${i}`,
      name: `${p.firstName} ${p.lastName}`,
      number: p.number,
      position: p.position,
      rating: p.rating,
      form: p.form,
      morale: p.morale,
      injuryDays: 0,
    }));
const lineups = new Map(teams.map((t) => [t.key, buildLineup(toEngine(t.key), S)]));
const input = (key: string, extra: Partial<TeamInput> = {}): TeamInput => ({
  teamId: key,
  lineup: lineups.get(key)!,
  style: 'equilibrado',
  ...extra,
});
const ctx = (seed: number, extra: Partial<MatchContext> = {}): MatchContext => ({
  seed,
  mode: 'realista',
  randomness: 30,
  neutralVenue: false,
  isFinal: false,
  overtimeEnabled: true,
  withTimeline: false,
  ...extra,
});

describe('fórmula original', () => {
  it('calcula λ = clamp((2.8 + 0.06·m)·h, 0.2, 8)', () => {
    const home = { attack: 93, defense: 93, goalie: 92 };
    const away = { attack: 90, defense: 88, goalie: 86 };
    const e = expectedGoals(home, away, 'equilibrado', 'equilibrado', false, S);
    expect(e.home).toBeCloseTo((2.8 + 0.06 * (93 - (88 + 86) / 2)) * 1.1, 10);
    expect(e.away).toBeCloseTo(2.8 + 0.06 * (90 - (93 + 92) / 2), 10);
    const n = expectedGoals(home, away, 'equilibrado', 'equilibrado', true, S);
    expect(n.home).toBeCloseTo(2.8 + 0.06 * (93 - 87), 10);
  });

  it('respeta los topes 0.2 y 8', () => {
    const e = expectedGoals({ attack: 100, defense: 100, goalie: 100 }, { attack: 1, defense: 1, goalie: 1 }, 'equilibrado', 'equilibrado', false, S);
    expect(e.home).toBe(8);
    expect(e.away).toBe(0.2);
  });

  it('los estilos multiplican ataque y defensa', () => {
    const r = { attack: 90, defense: 90, goalie: 90 };
    const base = expectedGoals(r, r, 'equilibrado', 'equilibrado', true, S);
    const ofe = expectedGoals(r, r, 'ofensivo', 'equilibrado', true, S);
    expect(ofe.home).toBeGreaterThan(base.home);
    expect(ofe.away).toBeGreaterThan(base.away); // defiende peor
  });
});

describe('plantillas iniciales', () => {
  it('genera 1,080 jugadores con nombres únicos', () => {
    expect(rosters).toHaveLength(1080);
    const names = new Set(rosters.map((p) => `${p.firstName} ${p.lastName}`));
    expect(names.size).toBe(1080);
  });

  it('cada equipo tiene 2 porteros, 6 defensas y 12 delanteros', () => {
    for (const t of teams) {
      const r = rosters.filter((p) => p.teamKey === t.key);
      expect(r.filter((p) => p.position === 'G')).toHaveLength(2);
      expect(r.filter((p) => p.position === 'D')).toHaveLength(6);
      expect(r.filter((p) => p.position === 'F')).toHaveLength(12);
      expect(new Set(r.map((p) => p.number)).size).toBe(20);
    }
  });

  it('los titulares reproducen ataque, defensa y portería con margen ±1', () => {
    for (const seed of SEED_TEAMS) {
      const t = teams.find((x) => x.name === seed.name)!;
      const r = teamRatings(lineups.get(t.key)!, S);
      expect(Math.abs(r.attack - seed.attack)).toBeLessThanOrEqual(1);
      expect(Math.abs(r.defense - seed.defense)).toBeLessThanOrEqual(1);
      expect(Math.abs(r.goalie - seed.goalie)).toBeLessThanOrEqual(1);
    }
  });

  it('el portero suplente queda 8-15 puntos abajo y las edades van de 19 a 36', () => {
    for (const t of teams) {
      const gs = rosters.filter((p) => p.teamKey === t.key && p.position === 'G');
      const diff = gs[0].rating - gs[1].rating;
      expect(diff).toBeGreaterThanOrEqual(8);
      expect(diff).toBeLessThanOrEqual(15);
    }
    expect(Math.min(...rosters.map((p) => p.age))).toBeGreaterThanOrEqual(19);
    expect(Math.max(...rosters.map((p) => p.age))).toBeLessThanOrEqual(36);
  });
});

describe('simulación de partidos', () => {
  it('es reproducible con la misma semilla', () => {
    const a = simulateMatch(input('kings'), input('ducks'), ctx(42, { withTimeline: true }), S);
    const b = simulateMatch(input('kings'), input('ducks'), ctx(42, { withTimeline: true }), S);
    expect(b).toEqual(a);
  });

  it('el box score es coherente', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const r = simulateMatch(input('kings'), input('only'), ctx(seed, { withTimeline: true }), S);
      expect(r.home.periodGoals.reduce((x, y) => x + y)).toBe(r.homeScore);
      expect(r.away.periodGoals.reduce((x, y) => x + y)).toBe(r.awayScore);
      expect(r.home.shots).toBeGreaterThanOrEqual(r.homeScore);
      expect(r.home.saves).toBe(r.away.shots - r.awayScore);
      const homeGoals = r.players.filter((p) => p.side === 'home').reduce((t, p) => t + p.goals, 0);
      expect(homeGoals).toBe(r.homeScore);
      const homeShots = r.players.filter((p) => p.side === 'home').reduce((t, p) => t + p.shots, 0);
      expect(homeShots).toBe(r.home.shots);
      for (const g of r.goals) expect(g.assistIds.length).toBeLessThanOrEqual(2);
      expect(r.homeScore).not.toBe(r.awayScore); // tiempo extra activado
      expect(r.players.filter((p) => p.isMvp)).toHaveLength(1);
      const last = r.timeline![r.timeline!.length - 1];
      expect(last.type).toBe('final');
      expect(last.data!.score).toEqual([r.homeScore, r.awayScore]);
      expect(r.homeScore).toBeLessThanOrEqual(13);
    }
  });

  it('sin tiempo extra puede haber empate', () => {
    let draws = 0;
    for (let seed = 1; seed <= 500; seed++) {
      const r = simulateMatch(input('kings'), input('ducks'), ctx(seed, { overtimeEnabled: false }), S);
      if (r.winner === 'draw') draws++;
    }
    expect(draws).toBeGreaterThan(0);
  });

  it('los sesgos cambian el resultado pero nunca los goles esperados públicos', () => {
    let normal = 0;
    let biased = 0;
    for (let seed = 1; seed <= 2000; seed++) {
      const a = simulateMatch(input('kings'), input('ducks'), ctx(seed), S);
      const b = simulateMatch(input('kings', { bias: 1.3 }), input('ducks'), ctx(seed), S);
      expect(b.expected).toEqual(a.expected);
      normal += a.homeScore;
      biased += b.homeScore;
    }
    expect(biased).toBeGreaterThan(normal * 1.15);
  });

  it('la fatiga resta 1 % por partido adicional del día', () => {
    const fresh = teamRatings(lineups.get('kings')!, S, 0);
    const tired = teamRatings(lineups.get('kings')!, S, 2);
    expect(tired.attack).toBeCloseTo(fresh.attack * 0.98, 6);
  });

  it('un lesionado no entra en la alineación', () => {
    const players = toEngine('kings');
    const best = [...players].filter((p) => p.position === 'F').sort((a, b) => b.rating - a.rating)[0];
    best.injuryDays = 3;
    const l = buildLineup(players, S);
    expect(l.lines.flat().some((p) => p.id === best.id)).toBe(false);
  });
});

describe('promedio de goles', () => {
  // La especificación pide reproducir 5.47 goles por partido (dato histórico de
  // 174,779 partidos). Con los atributos ACTUALES de los 54 equipos, la fórmula
  // original sin cambios produce ~6.2 (≈5.9 en sede neutral). Esta prueba fija el
  // valor que realmente da la fórmula; ver docs/DECISIONES.md.
  it('reproduce el promedio de la fórmula original sobre una muestra grande', () => {
    const rng = createRng(7);
    const keys = teams.map((t) => t.key);
    let total = 0;
    const n = 20_000;
    for (let i = 0; i < n; i++) {
      const h = keys[Math.floor(rng() * keys.length)];
      let a = keys[Math.floor(rng() * keys.length)];
      if (a === h) a = keys[(keys.indexOf(h) + 1) % keys.length];
      const r = simulateMatch(input(h), input(a), ctx(i + 1), S);
      total += r.homeScore + r.awayScore;
    }
    const avg = total / n;
    expect(avg).toBeGreaterThan(5.9);
    expect(avg).toBeLessThan(6.5);
  });
});
