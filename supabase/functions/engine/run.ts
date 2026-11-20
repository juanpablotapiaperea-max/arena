// Simulación de partidos, aplicación de resultados, cierre de jornadas,
// avance de playoffs y fin de ediciones.
import { advance, eliminationRounds, regularStandings, ROUND_LABEL, type EditionConfig, type MatchRow } from '../../../shared/competition/edition.ts';
import { bestRoundFromElimination, rankingPoints, DEFAULT_RANKING_BASE, type RankingBase } from '../../../shared/competition/divisions.ts';
import { buildLineup } from '../../../shared/engine/rating.ts';
import { createRng, hashSeed, newSeed } from '../../../shared/engine/rng.ts';
import { simulateMatch } from '../../../shared/engine/match.ts';
import { mergeEngineSettings } from '../../../shared/engine/settings.ts';
import type { EnginePlayer, EngineSettings, Lineup, MatchResult, PlayStyle } from '../../../shared/engine/types.ts';
import { iterationsFor, simulateProbabilities, type SimTeam } from '../../../shared/sim/probabilities.ts';
import { all, getSetting, insertMany, q, type DB } from './db.ts';
import { MATCH_COLS, toMatchRow, type EditionRow, type MatchDb, type PlayerRow, type TeamRow } from './types.ts';
import { settleLongTerm, settleMatches } from './bets.ts';
import { newsChampion, newsUnit } from './news.ts';
import { specToRow } from './season.ts';

export interface SimContext {
  db: DB;
  engine: EngineSettings;
  teams: Map<string, TeamRow>;
  players: Map<string, PlayerRow[]>;
  biases: { team_id: string; scope: string; competition_id: string | null; edition_id: string | null; from_matchday: number | null; to_matchday: number | null; match_id: string | null; multiplier: number; active: boolean }[];
  gamesToday: Map<string, number>;
  stadiumsEnabled: boolean;
  stadiums: Map<string, { capacity: number; level: number; upgrades: Record<string, number>; home_bonus: number }>;
  economy: { ticketPrice: number; genericCapacityByLevel: Record<string, number>; baseOccupancy: number };
}

export async function loadContext(db: DB, teamIds: string[]): Promise<SimContext> {
  const ids = [...new Set(teamIds)];
  const [teams, players, biases, engineRaw, stadiumsEnabled, stadiums, economy] = await Promise.all([
    all<TeamRow>(() => db.from('teams').select('id,key,name,short_name,attack,defense,goalie,play_style,division,fan_base')),
    ids.length ? all<PlayerRow>(() => db.from('players').select('*').in('team_id', ids).eq('retired', false)) : Promise.resolve([] as PlayerRow[]),
    all<SimContext['biases'][number]>(() => db.from('admin_biases').select('*').eq('active', true)),
    getSetting<Partial<EngineSettings>>(db, 'engine', {}),
    getSetting<boolean>(db, 'stadiums_enabled', false),
    all<{ team_id: string; capacity: number; level: number; upgrades: Record<string, number>; home_bonus: number }>(() =>
      db.from('stadiums').select('team_id,capacity,level,upgrades,home_bonus'),
    ),
    getSetting(db, 'economy', { ticketPrice: 45, genericCapacityByLevel: { 1: 6000, 2: 9000, 3: 12000, 4: 16000 }, baseOccupancy: 0.55 }),
  ]);
  const byTeam = new Map<string, PlayerRow[]>();
  for (const p of players) {
    if (!p.team_id) continue;
    if (!byTeam.has(p.team_id)) byTeam.set(p.team_id, []);
    byTeam.get(p.team_id)!.push(p);
  }
  return {
    db,
    engine: mergeEngineSettings(engineRaw),
    teams: new Map(teams.map((t) => [t.id, t])),
    players: byTeam,
    biases,
    gamesToday: new Map(),
    stadiumsEnabled,
    stadiums: new Map(stadiums.map((s) => [s.team_id, s])),
    economy,
  };
}

const toEngine = (p: PlayerRow): EnginePlayer => ({
  id: p.id,
  name: `${p.first_name} ${p.last_name}`,
  number: p.number,
  position: p.position,
  rating: p.rating,
  form: p.form,
  morale: p.morale,
  injuryDays: p.injury_days,
});

export function lineupFor(ctx: SimContext, teamId: string): Lineup {
  return buildLineup((ctx.players.get(teamId) ?? []).map(toEngine), ctx.engine);
}

function biasFor(ctx: SimContext, teamId: string, m: MatchDb, e: EditionRow): number {
  let b = 1;
  for (const x of ctx.biases) {
    if (x.team_id !== teamId) continue;
    const hit =
      (x.scope === 'match' && x.match_id === m.id) ||
      (x.scope === 'competition' && (x.edition_id === e.id || (x.competition_id && x.competition_id === e.competition_id) || (!x.edition_id && !x.competition_id))) ||
      (x.scope === 'matchday_range' &&
        (x.edition_id === e.id || x.competition_id === e.competition_id) &&
        m.matchday !== null &&
        m.matchday >= (x.from_matchday ?? 0) &&
        m.matchday <= (x.to_matchday ?? 9999));
    if (hit) b *= Number(x.multiplier);
  }
  return Math.max(0.7, Math.min(1.3, b));
}

export interface SimPayload {
  matchId: string;
  editionId: string;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  overtime: boolean;
  winner: string;
  periodScores: number[][];
  expectedHome: number;
  expectedAway: number;
  mvpId: string | null;
  seed: number;
  homeBias: number;
  awayBias: number;
  homeStyle: string;
  awayStyle: string;
  home: MatchResult['home'];
  away: MatchResult['away'];
  players: (MatchResult['players'][number] & { isGoalie: boolean; name?: string; number?: number })[];
  goals: MatchResult['goals'];
  penalties: MatchResult['penalties'];
  injuries: MatchResult['injuries'];
  gate: { amount: number; attendance: number };
}

/** Simula un partido y prepara el resultado para guardarlo. */
export async function simulate(ctx: SimContext, m: MatchDb, e: EditionRow, withTimeline: boolean): Promise<{ payload: SimPayload; result: MatchResult }> {
  const home = ctx.teams.get(m.home_team_id)!;
  const away = ctx.teams.get(m.away_team_id)!;
  const hl = lineupFor(ctx, home.id);
  const al = lineupFor(ctx, away.id);
  const cfg = e.config as EditionConfig;

  let aggregate: { home: number; away: number; awayGoalsRule: boolean } | undefined;
  if (m.stage === 'playoff' && m.leg === 2 && m.tie_key) {
    const first = await q<{ home_score: number; away_score: number } | null>(
      ctx.db.from('matches').select('home_score,away_score').eq('edition_id', m.edition_id).eq('tie_key', m.tie_key).eq('leg', 1).maybeSingle(),
    );
    if (first) aggregate = { home: first.away_score, away: first.home_score, awayGoalsRule: !!cfg.awayGoals };
  }
  const seed = newSeed();
  const homeBias = biasFor(ctx, home.id, m, e);
  const awayBias = biasFor(ctx, away.id, m, e);
  const st = ctx.stadiums.get(home.id);
  const result = simulateMatch(
    { teamId: home.id, lineup: hl, style: home.play_style as PlayStyle, bias: homeBias, gamesToday: ctx.gamesToday.get(home.id) ?? 0 },
    { teamId: away.id, lineup: al, style: away.play_style as PlayStyle, bias: awayBias, gamesToday: ctx.gamesToday.get(away.id) ?? 0 },
    {
      seed,
      mode: cfg.mode ?? 'realista',
      randomness: cfg.randomness ?? 30,
      neutralVenue: m.neutral_venue,
      isFinal: m.is_final,
      // La ida de una eliminatoria puede terminar empatada.
      overtimeEnabled: m.stage === 'playoff' ? m.leg !== 1 : cfg.overtime !== false,
      withTimeline,
      aggregate,
      homeBonus: ctx.stadiumsEnabled && st ? Number(st.home_bonus) : 0,
    },
    ctx.engine,
  );
  ctx.gamesToday.set(home.id, (ctx.gamesToday.get(home.id) ?? 0) + 1);
  ctx.gamesToday.set(away.id, (ctx.gamesToday.get(away.id) ?? 0) + 1);

  const goalies = new Set([hl.goalie.id, al.goalie.id]);
  const roster = new Map([...(ctx.players.get(home.id) ?? []), ...(ctx.players.get(away.id) ?? [])].map((p) => [p.id, p]));
  const periodScores = [0, 1, 2, 3]
    .filter((i) => i < 3 || result.overtime)
    .map((i) => [result.home.periodGoals[i] ?? 0, result.away.periodGoals[i] ?? 0]);

  return {
    result,
    payload: {
      matchId: m.id,
      editionId: m.edition_id,
      homeTeamId: home.id,
      awayTeamId: away.id,
      homeScore: result.homeScore,
      awayScore: result.awayScore,
      overtime: result.overtime,
      winner: result.winner,
      periodScores,
      expectedHome: Math.round(result.expected.home * 1000) / 1000,
      expectedAway: Math.round(result.expected.away * 1000) / 1000,
      mvpId: result.mvpId,
      seed,
      homeBias,
      awayBias,
      homeStyle: home.play_style,
      awayStyle: away.play_style,
      home: result.home,
      away: result.away,
      players: result.players
        .filter((p) => !p.playerId.startsWith('placeholder'))
        .map((p) => {
          const r = roster.get(p.playerId);
          return { ...p, isGoalie: goalies.has(p.playerId), name: r ? `${r.first_name} ${r.last_name}` : undefined, number: r?.number };
        }),
      goals: result.goals,
      penalties: result.penalties,
      injuries: result.injuries,
      gate: gate(ctx, home, m),
    },
  };
}

/** Taquilla: aforo × ocupación × precio (aforo genérico con estadios apagados). */
function gate(ctx: SimContext, home: TeamRow, m: MatchDb): { amount: number; attendance: number } {
  if (m.neutral_venue) return { amount: 0, attendance: 0 };
  const st = ctx.stadiums.get(home.id);
  const level = st?.level ?? 2;
  let capacity = Number(ctx.economy.genericCapacityByLevel?.[String(level)] ?? 9000);
  let occupancy = ctx.economy.baseOccupancy + 0.25 * (home.fan_base / 100);
  if (m.is_main_event) occupancy += 0.15;
  if (m.stage === 'playoff') occupancy += 0.1;
  if (ctx.stadiumsEnabled && st) {
    capacity = st.capacity + 1000 * (st.upgrades?.capacity ?? 0);
    occupancy += 0.03 * ((st.upgrades?.comfort ?? 0) + (st.upgrades?.lighting ?? 0));
  }
  occupancy = Math.min(1, occupancy);
  const attendance = Math.round(capacity * occupancy);
  const price = ctx.economy.ticketPrice * (ctx.stadiumsEnabled && st ? 1 + 0.05 * (st.upgrades?.comfort ?? 0) : 1);
  return { amount: Math.round(attendance * price), attendance };
}

/** Guarda resultados, liquida apuestas y cierra las jornadas que hayan terminado. */
export async function commitResults(db: DB, payloads: SimPayload[]) {
  if (!payloads.length) return;
  await q(db.rpc('apply_match_results', { p_results: payloads }));
  await settleMatches(db, payloads);
  const units = new Map<string, Set<number>>();
  const matchUnits = await q<{ edition_id: string; unit_index: number }[]>(
    db.from('matches').select('edition_id,unit_index').in('id', payloads.map((p) => p.matchId)),
  );
  for (const m of matchUnits) {
    if (!units.has(m.edition_id)) units.set(m.edition_id, new Set());
    units.get(m.edition_id)!.add(m.unit_index);
  }
  for (const [editionId, set] of units) await closeUnits(db, editionId, [...set]);
}

export async function editionMatches(db: DB, editionId: string): Promise<MatchDb[]> {
  return all<MatchDb>(() => db.from('matches').select(MATCH_COLS).eq('edition_id', editionId).order('unit_index').order('id'));
}

/** Tras terminar partidos: tablas, siguiente ronda, fin de edición y probabilidades. */
export async function closeUnits(db: DB, editionId: string, unitIndexes: number[]) {
  const e = await q<EditionRow>(db.from('editions').select('*').eq('id', editionId).single());
  if (e.status === 'finished') return;
  let ms = await editionMatches(db, editionId);
  const closed = unitIndexes.filter((u) => {
    const um = ms.filter((m) => m.unit_index === u);
    return um.length > 0 && um.every((m) => m.status === 'finished');
  });
  if (!closed.length) return; // la tabla se actualiza al cerrar cada jornada
  await updateStandings(db, e, ms);

  const teamIds = (await q<{ team_id: string; seed: number }[]>(db.from('edition_teams').select('team_id,seed').eq('edition_id', editionId).order('seed'))).map((t) => t.team_id);
  const rng = createRng(hashSeed(`${editionId}:${ms.length}`));
  let state = e.state;
  for (let guard = 0; guard < 4; guard++) {
    const next = advance(e.config.format, e.config, teamIds, state, ms.map(toMatchRow), rng);
    if (next.statePatch) {
      state = { ...state, ...next.statePatch };
      await q(db.from('editions').update({ state }).eq('id', editionId));
    }
    if (next.enteredPlayoffs) {
      await q(db.from('editions').update({ status: 'playoffs' }).eq('id', editionId));
      await settleLongTerm(db, e, ms.map(toMatchRow), teamIds, 'regular');
    }
    if (next.finished) {
      await finishEdition(db, { ...e, state }, ms, teamIds, next.finished.champion, next.finished.runnerUp);
      return;
    }
    if (!next.create.length) break;
    const rows = next.create.map((x) => {
      const r = specToRow(editionId, x);
      const label = x.round ? ROUND_LABEL[x.round] : '';
      return { ...r, event_name: x.isMainEvent ? `${e.name.split(' · ')[0]} · ${label}` : null };
    });
    await insertMany(db, 'matches', rows);
    ms = await editionMatches(db, editionId);
  }

  for (const u of closed) await newsUnit(db, e, u, ms).catch(() => undefined);
  await snapshotProbabilities(db, { ...e, state }, ms, teamIds).catch(() => undefined);
}

/** Recalcula y guarda la tabla (fase regular o grupos). */
export async function updateStandings(db: DB, e: EditionRow, ms: MatchDb[]) {
  const rows = ms.map(toMatchRow);
  if (!rows.some((m) => m.stage !== 'playoff')) return;
  const prev = await q<{ team_id: string; position: number }[]>(db.from('edition_standings').select('team_id,position').eq('edition_id', e.id));
  const prevPos = new Map(prev.map((p) => [p.team_id, p.position]));
  const teams = (await q<{ team_id: string; group_label: string | null }[]>(db.from('edition_teams').select('team_id,group_label').eq('edition_id', e.id)));
  const groups = new Map<string, string[]>();
  for (const t of teams) {
    const g = e.config.format === 'groups_knockout' ? t.group_label ?? '' : '';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(t.team_id);
  }
  const upserts: Record<string, unknown>[] = [];
  for (const [g, ids] of groups) {
    const table = regularStandings(ids, rows, e.config, g === '' ? undefined : g);
    table.forEach((r, i) =>
      upserts.push({
        edition_id: e.id,
        team_id: r.teamId,
        group_label: g,
        position: i + 1,
        prev_position: prevPos.get(r.teamId) ?? i + 1,
        played: r.played,
        wins: r.wins,
        ot_wins: r.otWins,
        draws: r.draws,
        ot_losses: r.otLosses,
        losses: r.losses,
        goals_for: r.goalsFor,
        goals_against: r.goalsAgainst,
        points: r.points,
        form: r.form.join(''),
      }),
    );
  }
  for (let i = 0; i < upserts.length; i += 500) {
    await q(db.from('edition_standings').upsert(upserts.slice(i, i + 500), { onConflict: 'edition_id,team_id' }));
  }
}

async function finishEdition(db: DB, e: EditionRow, ms: MatchDb[], teamIds: string[], champion: string, runnerUp: string) {
  await q(
    db.from('editions').update({ status: 'finished', champion_team_id: champion, runner_up_team_id: runnerUp, finished_at: new Date().toISOString() }).eq('id', e.id),
  );
  const rows = ms.map(toMatchRow);
  const elim = eliminationRounds(rows, e.config);
  const hasRegular = rows.some((m) => m.stage === 'regular' || m.stage === 'swiss');
  const table = hasRegular ? regularStandings(teamIds, rows, e.config).map((r) => r.teamId) : [];
  const playoffTeams = new Set(rows.filter((m) => m.stage === 'playoff').flatMap((m) => [m.home, m.away]));
  const base = { ...DEFAULT_RANKING_BASE, ...((await getSetting<{ base?: Partial<RankingBase> }>(db, 'ranking', {})).base ?? {}) };
  const economy = await getSetting(db, 'economy', { prizeByRound: {} as Record<string, number> });
  const weight = Number(e.config.weight ?? 1);

  const awards = teamIds.map((t) => {
    let best = bestRoundFromElimination(elim.get(t) ?? null, t === champion);
    if (!best && playoffTeams.has(t)) best = 'playoffs';
    const pos = table.indexOf(t);
    const pts = rankingPoints({ leaguePosition: pos >= 0 ? pos + 1 : undefined, leagueTeams: table.length || undefined, bestRound: best, weight }, base);
    return { teamId: t, best, pts };
  });

  // Ranking de temporada e histórico.
  const existing = await all<{ id: string; team_id: string; season_id: string | null; points: number; titles: number; runners_up: number; breakdown: Record<string, number> }>(
    () => db.from('ranking_entries').select('*').in('team_id', teamIds),
  );
  for (const a of awards) {
    for (const seasonId of [e.season_id, null]) {
      const row = existing.find((r) => r.team_id === a.teamId && r.season_id === seasonId);
      const breakdown = { ...(row?.breakdown ?? {}), [e.config.competitionKey]: Math.round(((row?.breakdown?.[e.config.competitionKey] ?? 0) + a.pts) * 100) / 100 };
      const patch = {
        team_id: a.teamId,
        season_id: seasonId,
        points: Number(row?.points ?? 0) + a.pts,
        titles: (row?.titles ?? 0) + (a.teamId === champion ? 1 : 0),
        runners_up: (row?.runners_up ?? 0) + (a.teamId === runnerUp ? 1 : 0),
        breakdown,
        updated_at: new Date().toISOString(),
      };
      if (row) await q(db.from('ranking_entries').update(patch).eq('id', row.id));
      else await q(db.from('ranking_entries').insert(patch));
    }
    // Premios en dinero por ronda alcanzada.
    const prize = a.best ? Number(economy.prizeByRound?.[a.best] ?? 0) * weight : 0;
    if (prize > 0) {
      await q(db.from('finance_entries').insert({ team_id: a.teamId, season_id: e.season_id, concept: 'premio', amount: Math.round(prize), note: e.name }));
      const tp = await q<{ budget: number }>(db.from('team_private').select('budget').eq('team_id', a.teamId).single());
      await q(db.from('team_private').update({ budget: Number(tp.budget) + Math.round(prize) }).eq('team_id', a.teamId));
    }
  }
  await settleLongTerm(db, e, rows, teamIds, 'final', champion);
  await newsChampion(db, e, champion, runnerUp).catch(() => undefined);
  await q(db.from('probability_snapshots').delete().eq('edition_id', e.id));
}

/** Probabilidades de título, playoffs, ascenso y descenso (sin sesgos). */
export async function snapshotProbabilities(db: DB, e: EditionRow, ms: MatchDb[], teamIds: string[], force = false) {
  if (e.status === 'finished') return;
  // Con días muy rápidos se cierran muchas jornadas seguidas: como máximo un
  // recálculo cada 5 minutos por competición (es lo más pesado del motor).
  if (!force) {
    const last = await q<{ created_at: string }[]>(db.from('probability_snapshots').select('created_at').eq('edition_id', e.id).order('created_at', { ascending: false }).limit(1));
    if (last[0] && Date.now() - Date.parse(last[0].created_at) < 5 * 60_000) return;
  }
  const teams = await all<TeamRow>(() => db.from('teams').select('id,attack,defense,goalie,play_style').in('id', teamIds));
  const engine = mergeEngineSettings(await getSetting<Partial<EngineSettings>>(db, 'engine', {}));
  const requested = (await getSetting<{ iterations: number }>(db, 'probabilities', { iterations: 10000 })).iterations;
  const remaining = ms.filter((m) => m.status !== 'finished').length + 20;
  const iterations = iterationsFor(requested, remaining, 30_000);
  const simTeams = new Map<string, SimTeam>(
    teams.map((t) => [t.id, { id: t.id, attack: Number(t.attack), defense: Number(t.defense), goalie: Number(t.goalie), style: t.play_style as PlayStyle }]),
  );
  const probs = simulateProbabilities(e.config.format, e.config, teamIds, simTeams, e.state, ms.map(toMatchRow), engine, iterations, hashSeed(`${e.id}:${Date.now()}`));
  await q(db.from('probability_snapshots').delete().eq('edition_id', e.id));
  await insertMany(
    db,
    'probability_snapshots',
    [...probs.entries()].map(([teamId, p]) => ({
      edition_id: e.id,
      team_id: teamId,
      champion: round5(p.champion),
      playoffs: round5(p.playoffs),
      promotion: round5(p.promotion),
      relegation: round5(p.relegation),
      iterations,
    })),
  );
}
const round5 = (x: number) => Math.round(x * 100000) / 100000;

/** Simula ya mismo una jornada completa (atajo del administrador). */
export async function simulateUnitNow(db: DB, editionId: string, unitIndex: number) {
  const e = await q<EditionRow>(db.from('editions').select('*').eq('id', editionId).single());
  const ms = (await editionMatches(db, editionId)).filter((m) => m.unit_index === unitIndex && m.status === 'scheduled');
  if (!ms.length) return { simulated: 0 };
  const ctx = await loadContext(db, ms.flatMap((m) => [m.home_team_id, m.away_team_id]));
  const payloads: SimPayload[] = [];
  for (const m of ms) payloads.push((await simulate(ctx, m, e, false)).payload);
  await commitResults(db, payloads);
  return { simulated: payloads.length };
}

export type { MatchRow };
