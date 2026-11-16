import { clamp, teamRatings } from './rating.ts';
import { createRng, poisson, randInt, weightedIndex, type Rng } from './rng.ts';
import type {
  EnginePlayer,
  EngineSettings,
  GoalEvent,
  Injury,
  Lineup,
  MatchContext,
  MatchResult,
  PenaltyEvent,
  PlayStyle,
  PlayerBox,
  TeamBox,
  TeamInput,
  TeamRatings,
  TimelineEvent,
} from './types.ts';

type Side = 'home' | 'away';

/**
 * Goles esperados con la fórmula original:
 *   m_local = A_local - (D_visit + P_visit) / 2
 *   λ_local = clamp((2.8 + 0.06 · m_local) · h, 0.2, 8)
 * Los estilos de juego multiplican ataque y defensa antes de la fórmula.
 * NO incluye sesgos secretos: es lo que usan cuotas y probabilidades.
 */
export function expectedGoals(
  home: TeamRatings,
  away: TeamRatings,
  homeStyle: PlayStyle,
  awayStyle: PlayStyle,
  neutralVenue: boolean,
  s: EngineSettings,
): { home: number; away: number } {
  const hs = s.styles[homeStyle] ?? s.styles.equilibrado;
  const as = s.styles[awayStyle] ?? s.styles.equilibrado;
  const hA = home.attack * hs.attack;
  const hD = home.defense * hs.defense;
  const aA = away.attack * as.attack;
  const aD = away.defense * as.defense;
  const h = neutralVenue ? 1 : s.homeAdvantage;

  const mHome = hA - (aD + away.goalie) / 2;
  const mAway = aA - (hD + home.goalie) / 2;
  return {
    home: clamp((s.baseGoals + s.scale * mHome) * h, s.minLambda, s.maxLambda),
    away: clamp(s.baseGoals + s.scale * mAway, s.minLambda, s.maxLambda),
  };
}

/** Fuerza media usada para decidir el tiempo extra. */
export function power(r: TeamRatings): number {
  return (r.attack + r.defense + r.goalie) / 3;
}

/** Ruido efectivo de una competición: aleatoriedad × escala del modo (× 1.3 en finales). */
export function effectiveNoise(ctx: Pick<MatchContext, 'mode' | 'randomness' | 'isFinal'>, s: EngineSettings): number {
  let randomness = ctx.randomness / 100;
  if (ctx.isFinal) randomness *= s.finalRandomnessMultiplier;
  return randomness * (s.modeScale[ctx.mode] ?? s.modeScale.realista);
}

export function simulateMatch(home: TeamInput, away: TeamInput, ctx: MatchContext, s: EngineSettings): MatchResult {
  const rng = createRng(ctx.seed);

  const hr = teamRatings(home.lineup, s, home.gamesToday ?? 0);
  const ar = teamRatings(away.lineup, s, away.gamesToday ?? 0);
  const expected = expectedGoals(hr, ar, home.style, away.style, ctx.neutralVenue, s);
  if (ctx.homeBonus && !ctx.neutralVenue) expected.home = clamp(expected.home * (1 + ctx.homeBonus), s.minLambda, s.maxLambda);

  // Sesgos secretos: solo afectan al resultado real, nunca a "expected".
  const hBias = clamp(home.bias ?? 1, 0.7, 1.3);
  const aBias = clamp(away.bias ?? 1, 0.7, 1.3);
  const noiseAmp = effectiveNoise(ctx, s);
  const noise = () => (rng() - 0.5) * noiseAmp * 2;
  const hLambda = Math.max(s.minLambda, clamp(expected.home * hBias, s.minLambda, s.maxLambda) + noise());
  const aLambda = Math.max(s.minLambda, clamp(expected.away * aBias, s.minLambda, s.maxLambda) + noise());

  let hGoals = Math.min(poisson(rng, hLambda), s.maxGoals);
  let aGoals = Math.min(poisson(rng, aLambda), s.maxGoals);

  // Tiempo extra: gana con probabilidad proporcional a su fuerza media.
  let overtime = false;
  let otWinner: Side | null = null;
  let needsOvertime = hGoals === aGoals && ctx.overtimeEnabled;
  if (ctx.aggregate) {
    needsOvertime = hGoals + ctx.aggregate.home === aGoals + ctx.aggregate.away;
    // Gol de visitante: el visitante de hoy anotó aGoals fuera; el local anotó aggregate.home fuera en la ida.
    if (needsOvertime && ctx.aggregate.awayGoalsRule && aGoals !== ctx.aggregate.home) needsOvertime = false;
  }
  if (needsOvertime) {
    overtime = true;
    const ph = power(hr);
    const pa = power(ar);
    otWinner = rng() < ph / (ph + pa) ? 'home' : 'away';
  }

  const styles = { home: s.styles[home.style] ?? s.styles.equilibrado, away: s.styles[away.style] ?? s.styles.equilibrado };
  const lineups = { home: home.lineup, away: away.lineup };
  const P = s.periodSeconds;

  // --- Goles: periodo, segundo, autor y asistencias ---
  const goals: GoalEvent[] = [];
  const placeGoals = (side: Side, n: number) => {
    for (let i = 0; i < n; i++) {
      const period = (weightedIndex(rng, styles[side].periodWeights) + 1) as 1 | 2 | 3;
      const second = (period - 1) * P + randInt(rng, 5, P - 5);
      goals.push({ side, period, second, ...pickScorer(rng, lineups[side], s), powerPlay: false });
    }
  };
  placeGoals('home', hGoals);
  placeGoals('away', aGoals);
  if (otWinner) {
    const second = 3 * P + randInt(rng, 5, s.overtimeSeconds - 5);
    goals.push({ side: otWinner, period: 4, second, ...pickScorer(rng, lineups[otWinner], s), powerPlay: false });
    if (otWinner === 'home') hGoals++;
    else aGoals++;
  }
  goals.sort((a, b) => a.second - b.second);

  // --- Penalizaciones (derivadas del estilo) ---
  const penalties: PenaltyEvent[] = [];
  for (const side of ['home', 'away'] as Side[]) {
    const n = poisson(rng, 3 * styles[side].penalties);
    for (let i = 0; i < n; i++) {
      const period = randInt(rng, 1, 3) as 1 | 2 | 3;
      const skaters = allSkaters(lineups[side]);
      const p = skaters[Math.floor(rng() * skaters.length)];
      penalties.push({ side, period, second: (period - 1) * P + randInt(rng, 5, P - 30), playerId: p.id, minutes: 2 });
    }
  }
  penalties.sort((a, b) => a.second - b.second);

  // Un gol es de power play si cae dentro de los 2 min (escalados) de una penalización rival.
  const ppWindow = Math.round((P / 20) * 2); // 2 min de 20 escalados a la duración del periodo
  for (const g of goals) {
    if (g.period === 4) continue;
    g.powerPlay = penalties.some((p) => p.side !== g.side && g.second >= p.second && g.second <= p.second + ppWindow);
  }

  // Gol ganador: el gol (perdedor + 1) del ganador.
  const winner: Side | 'draw' = hGoals > aGoals ? 'home' : aGoals > hGoals ? 'away' : 'draw';
  if (winner !== 'draw') {
    const loserGoals = winner === 'home' ? aGoals : hGoals;
    let count = 0;
    for (const g of goals) {
      if (g.side === winner) {
        count++;
        if (count === loserGoals + 1) {
          g.gameWinning = true;
          break;
        }
      }
    }
  }

  // --- Tiros y atajadas (derivados de los goles esperados y del estilo) ---
  const shotMult = styles.home.shots * styles.away.shots;
  const shotsFor = (side: Side, g: number) => {
    const lambda = side === 'home' ? expected.home : expected.away;
    const base = 26 * Math.pow(lambda / 2.9, 0.4) * shotMult;
    return Math.max(g + 3, g + poisson(rng, Math.max(4, base - g)));
  };
  const hShots = shotsFor('home', hGoals);
  const aShots = shotsFor('away', aGoals);

  const box = (side: Side, g: number, shots: number, oppShots: number, oppGoals: number): TeamBox => {
    const own = penalties.filter((p) => p.side === side);
    const opp = penalties.filter((p) => p.side !== side);
    const periodGoals = [0, 0, 0, 0];
    for (const x of goals) if (x.side === side) periodGoals[x.period - 1]++;
    return {
      goals: g,
      shots,
      saves: oppShots - oppGoals,
      penalties: own.length,
      pim: own.reduce((t, p) => t + p.minutes, 0),
      powerPlays: opp.length,
      powerPlayGoals: goals.filter((x) => x.side === side && x.powerPlay).length,
      periodGoals,
    };
  };
  const homeBox = box('home', hGoals, hShots, aShots, aGoals);
  const awayBox = box('away', aGoals, aShots, hShots, hGoals);

  // --- Estadísticas por jugador ---
  const players = buildPlayerBoxes(rng, lineups, goals, penalties, { home: hShots, away: aShots }, { home: hGoals, away: aGoals }, s);
  const mvpId = chooseMvp(players, winner);
  for (const p of players) p.isMvp = p.playerId === mvpId;

  // --- Lesiones ---
  const injuries: Injury[] = [];
  for (const side of ['home', 'away'] as Side[]) {
    for (const p of [lineups[side].goalie, ...allSkaters(lineups[side])]) {
      if (p.id.startsWith('placeholder')) continue;
      if (rng() < s.injuryChancePerMatch) {
        injuries.push({ playerId: p.id, side, days: randInt(rng, s.injuryDays[0], s.injuryDays[1]) });
      }
    }
  }

  const durationSeconds = 3 * P + (overtime ? s.overtimeSeconds : 0);
  const timeline = ctx.withTimeline
    ? buildTimeline(rng, goals, penalties, { home: hShots, away: aShots }, lineups, overtime, s, durationSeconds)
    : null;

  return {
    seed: ctx.seed,
    homeScore: hGoals,
    awayScore: aGoals,
    overtime,
    winner,
    expected,
    ratings: { home: hr, away: ar },
    home: homeBox,
    away: awayBox,
    players,
    goals,
    penalties,
    injuries,
    mvpId,
    timeline,
    durationSeconds,
  };
}

function allSkaters(l: Lineup): EnginePlayer[] {
  return [...l.lines.flat(), ...l.pairs.flat()];
}

/** Autor: probabilidad proporcional a su ataque y al peso de su línea; hasta 2 asistencias. */
function pickScorer(rng: Rng, l: Lineup, s: EngineSettings): { scorerId: string; assistIds: string[] } {
  const cands: { p: EnginePlayer; w: number }[] = [];
  l.lines.forEach((line, i) => line.forEach((p) => cands.push({ p, w: p.rating * (s.lineWeights[i] ?? 0.1) })));
  // Los defensas anotan menos: su peso se reduce a un cuarto.
  l.pairs.forEach((pair, i) => pair.forEach((p) => cands.push({ p, w: p.rating * (s.pairWeights[i] ?? 0.1) * 0.25 })));
  const si = weightedIndex(rng, cands.map((c) => c.w));
  const scorer = cands[si].p;

  const assistIds: string[] = [];
  const pool = cands.filter((c) => c.p.id !== scorer.id);
  const assistChances = [0.9, 0.65];
  for (const chance of assistChances) {
    if (rng() >= chance) break;
    const avail = pool.filter((c) => !assistIds.includes(c.p.id));
    if (!avail.length) break;
    // Las asistencias pesan igual para defensas que para delanteros.
    const idx = weightedIndex(rng, avail.map((c) => c.p.rating));
    assistIds.push(avail[idx].p.id);
  }
  return { scorerId: scorer.id, assistIds };
}

function buildPlayerBoxes(
  rng: Rng,
  lineups: Record<Side, Lineup>,
  goals: GoalEvent[],
  penalties: PenaltyEvent[],
  shots: Record<Side, number>,
  score: Record<Side, number>,
  s: EngineSettings,
): PlayerBox[] {
  const boxes = new Map<string, PlayerBox>();
  const ensure = (id: string, side: Side) => {
    let b = boxes.get(id);
    if (!b) {
      b = { playerId: id, side, goals: 0, assists: 0, plusMinus: 0, shots: 0, pim: 0, saves: 0, goalsAgainst: 0, gameWinningGoals: 0, isMvp: false };
      boxes.set(id, b);
    }
    return b;
  };
  for (const side of ['home', 'away'] as Side[]) {
    const l = lineups[side];
    for (const p of [l.goalie, ...allSkaters(l)]) ensure(p.id, side);
  }

  const lineOf = (l: Lineup, id: string) => l.lines.findIndex((line) => line.some((p) => p.id === id));
  const pairOf = (l: Lineup, id: string) => l.pairs.findIndex((pair) => pair.some((p) => p.id === id));
  const other = (side: Side): Side => (side === 'home' ? 'away' : 'home');

  for (const g of goals) {
    const l = lineups[g.side];
    const b = ensure(g.scorerId, g.side);
    b.goals++;
    b.shots++;
    if (g.gameWinning) b.gameWinningGoals++;
    for (const a of g.assistIds) ensure(a, g.side).assists++;

    // Más/menos: no cuenta en power play.
    if (!g.powerPlay) {
      const onIce = new Set<string>([g.scorerId, ...g.assistIds]);
      let li = lineOf(l, g.scorerId);
      if (li < 0) li = weightedIndex(rng, s.lineWeights);
      let pi = pairOf(l, g.scorerId);
      if (pi < 0) pi = weightedIndex(rng, s.pairWeights);
      l.lines[li].forEach((p) => onIce.add(p.id));
      l.pairs[pi].forEach((p) => onIce.add(p.id));
      onIce.forEach((id) => boxes.has(id) && boxes.get(id)!.side === g.side && (boxes.get(id)!.plusMinus += 1));

      const ol = lineups[other(g.side)];
      ol.lines[weightedIndex(rng, s.lineWeights)].forEach((p) => (ensure(p.id, other(g.side)).plusMinus -= 1));
      ol.pairs[weightedIndex(rng, s.pairWeights)].forEach((p) => (ensure(p.id, other(g.side)).plusMinus -= 1));
    }
  }

  // Reparte los tiros que no fueron gol entre los patinadores.
  for (const side of ['home', 'away'] as Side[]) {
    const l = lineups[side];
    const skaters = allSkaters(l);
    const weights = skaters.map((p) => {
      const li = lineOf(l, p.id);
      return li >= 0 ? s.lineWeights[li] ?? 0.1 : (s.pairWeights[pairOf(l, p.id)] ?? 0.1) * 0.5;
    });
    const remaining = shots[side] - score[side];
    for (let i = 0; i < remaining; i++) ensure(skaters[weightedIndex(rng, weights)].id, side).shots++;

    const gb = ensure(l.goalie.id, side);
    gb.goalsAgainst = score[other(side)];
    gb.saves = shots[other(side)] - score[other(side)];
  }

  for (const p of penalties) ensure(p.playerId, p.side).pim += p.minutes;

  return [...boxes.values()];
}

/** MVP: más puntos ponderados; los porteros cuentan atajadas y blanqueadas. */
function chooseMvp(players: PlayerBox[], winner: Side | 'draw'): string | null {
  let best: PlayerBox | null = null;
  let bestScore = -Infinity;
  for (const p of players) {
    let score = p.goals * 3 + p.assists * 2 + p.gameWinningGoals + p.plusMinus * 0.25;
    const isGoalie = p.saves > 0 || p.goalsAgainst > 0;
    if (isGoalie) {
      const total = p.saves + p.goalsAgainst;
      const pct = total ? p.saves / total : 0;
      score = (pct - 0.88) * 40 + (p.goalsAgainst === 0 ? 4 : 0);
    }
    if (winner !== 'draw' && p.side === winner) score += 1.5;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best?.playerId ?? null;
}

function buildTimeline(
  rng: Rng,
  goals: GoalEvent[],
  penalties: PenaltyEvent[],
  shots: Record<Side, number>,
  lineups: Record<Side, Lineup>,
  overtime: boolean,
  s: EngineSettings,
  duration: number,
): TimelineEvent[] {
  const P = s.periodSeconds;
  const ev: TimelineEvent[] = [];
  for (let period = 1; period <= 3; period++) {
    ev.push({ second: (period - 1) * P, type: 'period_start', period });
    ev.push({ second: period * P - 0.001, type: 'period_end', period });
  }
  if (overtime) ev.push({ second: 3 * P, type: 'overtime_start', period: 4 });

  // Tiros atajados repartidos en los 3 periodos.
  for (const side of ['home', 'away'] as Side[]) {
    const g = goals.filter((x) => x.side === side).length;
    const saved = shots[side] - g;
    const skaters = allSkaters(lineups[side]);
    const other: Side = side === 'home' ? 'away' : 'home';
    for (let i = 0; i < saved; i++) {
      const period = randInt(rng, 1, 3);
      const second = (period - 1) * P + randInt(rng, 3, P - 3);
      const shooter = skaters[Math.floor(rng() * skaters.length)];
      ev.push({ second, type: 'shot', side, period, playerId: shooter.id });
      ev.push({ second: second + 0.5, type: 'save', side: other, period, playerId: lineups[other].goalie.id });
    }
  }

  let h = 0;
  let a = 0;
  for (const g of goals) {
    if (g.side === 'home') h++;
    else a++;
    ev.push({
      second: g.second,
      type: 'goal',
      side: g.side,
      period: g.period,
      playerId: g.scorerId,
      data: { assists: g.assistIds, powerPlay: g.powerPlay, gameWinning: !!g.gameWinning, score: [h, a] },
    });
  }
  for (const p of penalties) {
    ev.push({ second: p.second, type: 'penalty', side: p.side, period: p.period, playerId: p.playerId, data: { minutes: p.minutes } });
  }
  ev.push({ second: duration, type: 'final', period: overtime ? 4 : 3, data: { score: [h, a] } });
  return ev.sort((x, y) => x.second - y.second);
}
