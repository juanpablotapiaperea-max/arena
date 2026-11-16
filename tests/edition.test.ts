// Juega completas las 8 competiciones con el ciclo real (initialMatches + advance)
// y comprueba formato, número de partidos y que siempre hay un campeón.
import { describe, expect, it } from 'vitest';
import { advance, buildUnits, eliminationRounds, initialMatches, type EditionConfig, type Format, type MatchRow, type MatchSpec } from '../shared/competition/edition.ts';
import { COMPETITIONS } from '../shared/data/competitions.ts';
import { SEED_TEAMS } from '../shared/data/teams.ts';
import { DEFAULT_ENGINE_SETTINGS as S } from '../shared/engine/settings.ts';
import { createRng } from '../shared/engine/rng.ts';
import { quickMatch, simulateProbabilities, type SimTeam } from '../shared/sim/probabilities.ts';
import { matchModel, matchOdds, price, settleMatchBet, parlayOdds } from '../shared/betting/odds.ts';

const teams = new Map<string, SimTeam>(
  SEED_TEAMS.map((t) => [t.name, { id: t.name, attack: t.attack, defense: t.defense, goalie: t.goalie, style: 'equilibrado' }]),
);
const names = SEED_TEAMS.map((t) => t.name);
const toRow = (x: MatchSpec): MatchRow => ({
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

function playEdition(format: Format, c: EditionConfig, ids: string[], seed = 1) {
  const rng = createRng(seed);
  const init = initialMatches(format, c, ids, rng);
  let state = init.state;
  const ms = init.matches.map(toRow);
  for (let guard = 0; guard < 300; guard++) {
    for (const m of ms) {
      if (m.finished) continue;
      const leg1 = m.stage === 'playoff' && m.leg === 1;
      const r = quickMatch(rng, teams.get(m.home)!, teams.get(m.away)!, false, S, leg1 ? false : c.overtime !== false);
      m.homeScore = r.home;
      m.awayScore = r.away;
      m.overtime = r.overtime;
      if (m.stage === 'playoff' && m.leg === 2) {
        const first = ms.find((x) => x.round === m.round && x.slot === m.slot && x.leg === 1)!;
        if (first.awayScore! + r.home === first.homeScore! + r.away) m.homeScore++;
      }
      m.finished = true;
    }
    const next = advance(format, c, ids, state, ms, rng);
    if (next.statePatch) state = { ...state, ...next.statePatch };
    if (next.finished) return { ms, state, units: init.units, ...next.finished };
    expect(next.create.length).toBeGreaterThan(0);
    ms.push(...next.create.map(toRow));
  }
  throw new Error('La edición no terminó');
}

const comp = (key: string) => COMPETITIONS.find((c) => c.key === key)!;
const cfg = (key: string) => comp(key).config as EditionConfig;

describe('ciclo completo de cada competición', () => {
  it('OHL: 106 jornadas, previa con 8 descansos y campeón', () => {
    const units = buildUnits('league', cfg('ohl'), 54);
    expect(units.filter((u) => u.stage === 'regular')).toHaveLength(106);
    expect(units.filter((u) => u.stage === 'playoff').map((u) => u.round)).toEqual(['previa', 'octavos', 'cuartos', 'semifinal', 'final']);
    const r = playEdition('league', cfg('ohl'), names);
    expect(r.ms.filter((m) => m.stage === 'regular')).toHaveLength(2862);
    expect(r.ms.filter((m) => m.round === 'previa')).toHaveLength(8);
    expect(r.ms.filter((m) => m.round === 'octavos')).toHaveLength(8);
    expect(r.ms.filter((m) => m.round === 'final')).toHaveLength(1);
    // Los 8 mejores no juegan la previa
    const previaTeams = new Set(r.ms.filter((m) => m.round === 'previa').flatMap((m) => [m.home, m.away]));
    r.state.playoffSeeds!.slice(0, 8).forEach((t) => expect(previaTeams.has(t)).toBe(false));
    expect(r.state.playoffSeeds).toHaveLength(24);
    expect(names).toContain(r.champion);
    expect(eliminationRounds(r.ms, cfg('ohl')).get(r.runnerUp)).toBe('final');
  });

  it('Primera (27): 8 a playoffs desde cuartos · Segunda: 16 desde octavos', () => {
    const p = playEdition('league', cfg('primera'), names.slice(0, 27));
    expect(p.ms.filter((m) => m.stage === 'playoff').map((m) => m.round)).toEqual(expect.arrayContaining(['cuartos', 'semifinal', 'final']));
    expect(p.ms.filter((m) => m.stage === 'playoff')).toHaveLength(7);
    const s = playEdition('league', cfg('segunda'), names.slice(27));
    expect(s.ms.filter((m) => m.stage === 'playoff')).toHaveLength(15);
  });

  it('ALL STARS: 8 rondas suizas sin repetir rival, repechaje y octavos', () => {
    const r = playEdition('swiss', { ...cfg('all_stars'), playoffTeams: 24 }, names.slice(0, 32));
    const swiss = r.ms.filter((m) => m.stage === 'swiss');
    expect(swiss).toHaveLength(8 * 16);
    const pairs = swiss.map((m) => [m.home, m.away].sort().join('|'));
    expect(new Set(pairs).size).toBe(pairs.length);
    expect(r.ms.filter((m) => m.round === 'previa')).toHaveLength(8);
    expect(r.ms.filter((m) => m.round === 'octavos')).toHaveLength(8);
  });

  it('CHAMPIONS: ida y vuelta, final a partido único en sede neutral', () => {
    const c = cfg('champions');
    const units = buildUnits('two_legged', c, 32);
    expect(units.map((u) => u.label)).toContain('Dieciseisavos · ida');
    expect(units[units.length - 1]).toMatchObject({ round: 'final', matches: 1 });
    expect(units[units.length - 1].leg).toBeUndefined();
    const r = playEdition('two_legged', c, names.slice(0, 32));
    expect(r.ms).toHaveLength(16 * 2 + 8 * 2 + 4 * 2 + 2 * 2 + 1);
    // la vuelta invierte la localía
    const ida = r.ms.find((m) => m.round === 'cuartos' && m.leg === 1 && m.slot === 0)!;
    const vuelta = r.ms.find((m) => m.round === 'cuartos' && m.leg === 2 && m.slot === 0)!;
    expect(vuelta.home).toBe(ida.away);
  });

  it('COPA: 8 grupos de 4, pasan 2 por grupo a octavos', () => {
    const r = playEdition('groups_knockout', { ...cfg('copa'), seededTeams: 8 }, names.slice(0, 32));
    expect(Object.keys(r.state.groups!)).toHaveLength(8);
    expect(r.ms.filter((m) => m.stage === 'group')).toHaveLength(8 * 6);
    expect(r.state.playoffSeeds).toHaveLength(16);
    expect(r.ms.filter((m) => m.round === 'octavos')).toHaveLength(8);
  });

  it('CENTENARIO: 12 equipos, 4 partidos por rival, 8 a playoffs', () => {
    const r = playEdition('league', cfg('centenario'), names.slice(0, 12));
    expect(r.ms.filter((m) => m.stage === 'regular')).toHaveLength((12 * 11 * 4) / 2);
    expect(r.ms.filter((m) => m.stage === 'playoff')).toHaveLength(7);
  });
});

describe('probabilidades', () => {
  it('suman 1 para campeón y respetan cupos de playoffs y descenso', () => {
    const c = cfg('primera');
    const ids = names.slice(0, 27);
    const init = initialMatches('league', c, ids, createRng(5));
    const probs = simulateProbabilities('league', c, ids, teams, init.state, init.matches.map(toRow), S, 150, 9);
    const sum = (k: 'champion' | 'playoffs' | 'relegation') => [...probs.values()].reduce((s, p) => s + p[k], 0);
    expect(sum('champion')).toBeCloseTo(1, 5);
    expect(sum('playoffs')).toBeCloseTo(8, 5);
    expect(sum('relegation')).toBeCloseTo(6, 5);
  });
});

describe('cuotas', () => {
  it('las probabilidades del modelo suman 1 y el tiempo extra elimina el empate', () => {
    const m = matchModel(3.2, 2.9, true, 0.52);
    expect(m.home + m.away + m.draw).toBeCloseTo(1, 6);
    expect(m.draw).toBeCloseTo(0, 9);
    expect(m.totals.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    const n = matchModel(3.2, 2.9, false);
    expect(n.draw).toBeGreaterThan(0.1);
  });

  it('el margen de la casa baja la cuota', () => {
    expect(price(0.5, 0)).toBe(2);
    expect(price(0.5, 0.06)!).toBeLessThan(2);
    const input = { lambdaHome: 3.2, lambdaAway: 2.9, overtimeEnabled: true, otHome: 0.5, margin: 0.06 };
    const h = matchOdds('winner', { pick: 'home' }, input)!;
    const a = matchOdds('winner', { pick: 'away' }, input)!;
    expect(1 / h + 1 / a).toBeGreaterThan(1.04); // sobre-ronda ≈ margen
    expect(matchOdds('winner', { pick: 'draw' }, input)).toBeNull();
  });

  it('liquida apuestas', () => {
    const r = { homeScore: 4, awayScore: 3, scorerIds: ['p1'], mvpId: 'p1' };
    expect(settleMatchBet('winner', { pick: 'home' }, r)).toBe('won');
    expect(settleMatchBet('total', { pick: 'over', line: 6.5 }, r)).toBe('won');
    expect(settleMatchBet('total', { pick: 'under', line: 6.5 }, r)).toBe('lost');
    expect(settleMatchBet('exact', { home: 4, away: 3 }, r)).toBe('won');
    expect(settleMatchBet('scorer', { playerId: 'p2' }, r)).toBe('lost');
    expect(parlayOdds([2, 1.5, 3])).toBe(9);
  });
});
