// Pruebas obligatorias (sección 18): desempates, cuadro de playoffs con
// descansos, y ascensos y descensos.
import { describe, expect, it } from 'vitest';
import { computeStandings, type PlayedMatch } from '../shared/competition/standings.ts';
import { bracketOrder, mainBracket, nextRound, planBracket, roundNameFor } from '../shared/competition/bracket.ts';
import { drawGroups, roundRobin, swissRound } from '../shared/competition/schedule.ts';
import { applyMoves, divisionMoves, leaguePoints, rankingPoints, sortRanking } from '../shared/competition/divisions.ts';
import { createRng } from '../shared/engine/rng.ts';
import { SEED_TEAMS } from '../shared/data/teams.ts';

const m = (home: string, away: string, homeScore: number, awayScore: number, overtime = false): PlayedMatch => ({
  home,
  away,
  homeScore,
  awayScore,
  overtime,
});

describe('tabla y desempates', () => {
  it('puntos: 3 victoria, 1 empate, 0 derrota; tiempo extra 2 y 1', () => {
    const t = computeStandings(['A', 'B', 'C'], [m('A', 'B', 3, 1), m('B', 'C', 2, 2), m('C', 'A', 4, 3, true)]);
    const byId = Object.fromEntries(t.map((r) => [r.teamId, r]));
    expect(byId.A.points).toBe(3 + 1);
    expect(byId.B.points).toBe(0 + 1);
    expect(byId.C.points).toBe(1 + 2);
  });

  it('empate a puntos se decide por diferencia de goles', () => {
    const t = computeStandings(['A', 'B', 'C'], [m('A', 'C', 5, 0), m('B', 'C', 1, 0), m('A', 'B', 0, 1), m('C', 'A', 0, 0)]);
    // A: 3+0+1 = 4 pts, DG +4 ; B: 3+3 = 6 pts
    expect(t.map((r) => r.teamId)).toEqual(['B', 'A', 'C']);
  });

  it('luego goles a favor', () => {
    const t = computeStandings(['A', 'B', 'C', 'D'], [m('A', 'C', 4, 2), m('B', 'D', 2, 0)]);
    expect(t[0].teamId).toBe('A'); // mismos pts y DG (+2), A anotó más
  });

  it('luego enfrentamiento directo', () => {
    // A y B: 3 pts, DG 0 y GF 4 cada uno; B le ganó a A
    const t = computeStandings(['A', 'B', 'C', 'D'], [m('B', 'A', 2, 1), m('A', 'C', 3, 2), m('D', 'B', 3, 2)]);
    const ab = t.filter((r) => r.teamId === 'A' || r.teamId === 'B').map((r) => r.teamId);
    expect(t.find((r) => r.teamId === 'A')!.goalsFor).toBe(t.find((r) => r.teamId === 'B')!.goalsFor);
    expect(t.find((r) => r.teamId === 'A')!.points).toBe(t.find((r) => r.teamId === 'B')!.points);
    expect(ab).toEqual(['B', 'A']);
  });

  it('luego victorias (las de tiempo extra cuentan)', () => {
    // A: 2 victorias en TE (4 pts, DG +2, GF 5); B: 1 victoria + 1 derrota en TE (4 pts, DG +2, GF 5)
    const t = computeStandings(
      ['A', 'B', 'X', 'Y'],
      [m('A', 'X', 3, 2, true), m('A', 'Y', 2, 1, true), m('B', 'X', 3, 0), m('Y', 'B', 3, 2, true)],
    );
    const a = t.find((r) => r.teamId === 'A')!;
    const b = t.find((r) => r.teamId === 'B')!;
    expect(a.points).toBe(b.points);
    expect(a.goalDiff).toBe(b.goalDiff);
    expect(a.goalsFor).toBe(b.goalsFor);
    expect(t.indexOf(a)).toBeLessThan(t.indexOf(b));
  });
});

describe('cuadro de playoffs', () => {
  it('siembra clásica 1 vs 16, 8 vs 9…', () => {
    expect(bracketOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    const teams = Array.from({ length: 8 }, (_, i) => `T${i + 1}`);
    expect(mainBracket(teams).map((p) => [p.high, p.low])).toEqual([
      ['T1', 'T8'],
      ['T4', 'T5'],
      ['T2', 'T7'],
      ['T3', 'T6'],
    ]);
  });

  it('OHL: 24 equipos → los 8 mejores descansan y del 9 al 24 juegan la previa', () => {
    const seeds = Array.from({ length: 24 }, (_, i) => `T${i + 1}`);
    const plan = planBracket(seeds);
    expect(plan.mainSize).toBe(16);
    expect(plan.byes).toEqual(seeds.slice(0, 8));
    expect(plan.preliminary).toHaveLength(8);
    expect(plan.preliminary[0]).toMatchObject({ high: 'T9', low: 'T24' });
    expect(plan.preliminary[7]).toMatchObject({ high: 'T16', low: 'T17' });
  });

  it('potencia de 2 no tiene ronda previa', () => {
    const plan = planBracket(Array.from({ length: 16 }, (_, i) => `T${i}`));
    expect(plan.preliminary).toHaveLength(0);
    expect(plan.byes).toHaveLength(0);
  });

  it('crea solo los cruces que faltan, sin duplicados', () => {
    const rank = new Map(['A', 'B', 'C', 'D'].map((t, i) => [t, i + 1]));
    const first = nextRound(['A', 'D', undefined, 'B'], new Set(), rank);
    expect(first).toEqual([{ slot: 0, high: 'A', low: 'D' }]);
    const again = nextRound(['A', 'D', 'C', 'B'], new Set([0]), rank);
    expect(again).toEqual([{ slot: 1, high: 'B', low: 'C' }]);
  });

  it('nombres de ronda', () => {
    expect(roundNameFor(32)).toBe('dieciseisavos');
    expect(roundNameFor(16)).toBe('octavos');
    expect(roundNameFor(8)).toBe('cuartos');
    expect(roundNameFor(4)).toBe('semifinal');
    expect(roundNameFor(2)).toBe('final');
  });
});

describe('calendarios', () => {
  it('liga de 54 equipos a 2 vueltas: 106 jornadas y 2,862 partidos', () => {
    const teams = SEED_TEAMS.map((t) => t.name);
    const f = roundRobin(teams, 2);
    expect(f).toHaveLength(54 * 53);
    expect(new Set(f.map((x) => x.matchday)).size).toBe(106);
    for (const md of new Set(f.map((x) => x.matchday))) {
      const ids = f.filter((x) => x.matchday === md).flatMap((x) => [x.home, x.away]);
      expect(new Set(ids).size).toBe(ids.length); // nadie juega dos veces en una jornada
    }
    // cada par se enfrenta exactamente dos veces, una en cada cancha
    const pairs = new Map<string, number>();
    for (const x of f) pairs.set(`${x.home}>${x.away}`, (pairs.get(`${x.home}>${x.away}`) ?? 0) + 1);
    expect([...pairs.values()].every((v) => v === 1)).toBe(true);
  });

  it('liga impar (27): todos juegan lo mismo', () => {
    const teams = SEED_TEAMS.slice(0, 27).map((t) => t.name);
    const f = roundRobin(teams, 2);
    const games = new Map<string, number>();
    for (const x of f) for (const t of [x.home, x.away]) games.set(t, (games.get(t) ?? 0) + 1);
    expect([...games.values()].every((g) => g === 52)).toBe(true);
  });

  it('COPA: 8 grupos de 4 con un cabeza de serie por grupo', () => {
    const seeds = Array.from({ length: 10 }, (_, i) => `S${i}`);
    const others = Array.from({ length: 22 }, (_, i) => `O${i}`);
    const g = drawGroups(seeds, others, 8, createRng(3));
    expect(g).toHaveLength(8);
    expect(g.every((x) => x.length === 4)).toBe(true);
    g.forEach((x, i) => expect(x[0]).toBe(`S${i}`));
    expect(new Set(g.flat()).size).toBe(32);
  });

  it('suizo: 8 rondas sin repetir rival', () => {
    const teams = Array.from({ length: 32 }, (_, i) => `T${i}`);
    const played = new Set<string>();
    for (let r = 1; r <= 8; r++) {
      const f = swissRound(teams, played, r);
      expect(f).toHaveLength(16);
      for (const x of f) {
        const k = x.home < x.away ? `${x.home}|${x.away}` : `${x.away}|${x.home}`;
        expect(played.has(k)).toBe(false);
        played.add(k);
      }
    }
  });
});

describe('divisiones y ranking', () => {
  it('6 ascensos y 6 descensos', () => {
    const primera = Array.from({ length: 27 }, (_, i) => `P${i + 1}`);
    const segunda = Array.from({ length: 27 }, (_, i) => `S${i + 1}`);
    const moves = divisionMoves(primera, segunda);
    expect(moves.relegated).toEqual(['P22', 'P23', 'P24', 'P25', 'P26', 'P27']);
    expect(moves.promoted).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
    const after = applyMoves(primera, segunda, moves);
    expect(after.primera).toHaveLength(27);
    expect(after.segunda).toHaveLength(27);
    expect(after.primera).toContain('S1');
    expect(after.segunda).toContain('P27');
    expect(after.primera).not.toContain('P27');
  });

  it('puntos de liga regular y de ronda con peso', () => {
    expect(leaguePoints(1, 54)).toBe(20);
    expect(leaguePoints(54, 54)).toBe(0);
    // Campeón de CHAMPIONS (×2.5), sin liga
    expect(rankingPoints({ bestRound: 'champion', weight: 2.5 })).toBe(250);
    // 1.º de OHL (20) + campeón (100), ×2
    expect(rankingPoints({ leaguePosition: 1, leagueTeams: 54, bestRound: 'champion', weight: 2 })).toBe(240);
  });

  it('desempate del ranking: títulos, subcampeonatos, alfabético', () => {
    const sorted = sortRanking([
      { teamId: 'v', name: 'Vikings', points: 620, titles: 2, runnersUp: 6 },
      { teamId: 't', name: 'Titans', points: 620, titles: 2, runnersUp: 6 },
      { teamId: 'b', name: 'Black Horses', points: 300, titles: 3, runnersUp: 0 },
      { teamId: 'r', name: 'RHINOS', points: 300, titles: 3, runnersUp: 0 },
    ]);
    expect(sorted.map((r) => r.name)).toEqual(['Titans', 'Vikings', 'Black Horses', 'RHINOS']);
  });
});
