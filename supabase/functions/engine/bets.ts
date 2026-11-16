// Apuestas: cuotas bajo demanda, boleta, liquidación automática.
import { matchOdds, parlayOdds, price, settleMatchBet, TOTAL_LINES, type Market, type Selection, type ScorerShare } from '../../../shared/betting/odds.ts';
import { expectedGoals, power } from '../../../shared/engine/match.ts';
import { mergeEngineSettings } from '../../../shared/engine/settings.ts';
import type { EngineSettings, PlayStyle } from '../../../shared/engine/types.ts';
import { regularStandings, type MatchRow } from '../../../shared/competition/edition.ts';
import { AppError, all, getSetting, insertMany, q, type DB } from './db.ts';
import { lineupFor, loadContext, type SimPayload } from './run.ts';
import type { EditionRow, MatchDb, TeamRow } from './types.ts';

interface Offer {
  id: string;
  match_id: string | null;
  edition_id: string | null;
  market: Market;
  selection: Selection & { label?: string };
  odds: number;
  closes_at: string | null;
  active: boolean;
}

async function betting(db: DB) {
  return getSetting(db, 'betting', { initialCredits: 1000, dailyBonus: 100, houseMargin: 0.06, clubStakeCap: 0.1, maxParlayLegs: 5 });
}

/** Participación de cada jugador en los goles de su equipo (misma regla que el motor). */
function scorerShares(lineup: ReturnType<typeof lineupFor>, s: EngineSettings): ScorerShare[] {
  const w: { id: string; w: number }[] = [];
  lineup.lines.forEach((line, i) => line.forEach((p) => w.push({ id: p.id, w: p.rating * (s.lineWeights[i] ?? 0.1) })));
  lineup.pairs.forEach((pair, i) => pair.forEach((p) => w.push({ id: p.id, w: p.rating * (s.pairWeights[i] ?? 0.1) * 0.25 })));
  const total = w.reduce((t, x) => t + x.w, 0) || 1;
  return w.map((x) => ({ playerId: x.id, share: x.w / total })).sort((a, b) => b.share - a.share);
}

/** Crea (si hacen falta) y devuelve las cuotas de un partido programado. */
export async function oddsForMatch(db: DB, matchId: string) {
  const m = await q<MatchDb>(db.from('matches').select('*').eq('id', matchId).single());
  const existing = await q<Offer[]>(db.from('odds_offers').select('*').eq('match_id', matchId).eq('active', true));
  if (m.status !== 'scheduled') {
    if (existing.length) await q(db.from('odds_offers').update({ active: false }).eq('match_id', matchId));
    return { match: m, offers: [] as Offer[], open: false };
  }
  if (existing.length) return { match: m, offers: existing, open: true };

  const e = await q<EditionRow>(db.from('editions').select('*').eq('id', m.edition_id).single());
  const ctx = await loadContext(db, [m.home_team_id, m.away_team_id]);
  const s = ctx.engine;
  const home = ctx.teams.get(m.home_team_id)!;
  const away = ctx.teams.get(m.away_team_id)!;
  const hl = lineupFor(ctx, home.id);
  const al = lineupFor(ctx, away.id);
  const hr = { attack: Number(home.attack), defense: Number(home.defense), goalie: Number(home.goalie) };
  const ar = { attack: Number(away.attack), defense: Number(away.defense), goalie: Number(away.goalie) };
  // Sin sesgos: solo atributos públicos y estilos.
  const ex = expectedGoals(hr, ar, home.play_style as PlayStyle, away.play_style as PlayStyle, m.neutral_venue, s);
  const overtime = m.stage === 'playoff' ? m.leg !== 1 : e.config.overtime !== false;
  const { houseMargin } = await betting(db);
  const input = {
    lambdaHome: ex.home,
    lambdaAway: ex.away,
    overtimeEnabled: overtime,
    otHome: power(hr) / (power(hr) + power(ar)),
    margin: houseMargin,
    homeScorers: scorerShares(hl, s),
    awayScorers: scorerShares(al, s),
  };
  const names = new Map([...(ctx.players.get(home.id) ?? []), ...(ctx.players.get(away.id) ?? [])].map((p) => [p.id, `${p.first_name} ${p.last_name}`]));

  const rows: Record<string, unknown>[] = [];
  const add = (market: Market, selection: Selection & { label: string }) => {
    const odds = matchOdds(market, selection, input);
    if (odds && odds > 1.01) rows.push({ match_id: m.id, edition_id: m.edition_id, market, selection, odds, closes_at: m.scheduled_at });
  };
  add('winner', { pick: 'home', label: home.name });
  add('winner', { pick: 'away', label: away.name });
  if (!overtime) add('winner', { pick: 'draw', label: 'Empate' });
  for (const line of TOTAL_LINES) {
    add('total', { pick: 'over', line, label: `Más de ${line}` });
    add('total', { pick: 'under', line, label: `Menos de ${line}` });
  }
  for (let h = 0; h <= 8; h++) for (let a = 0; a <= 8; a++) if (h + a <= 11) add('exact', { home: h, away: a, label: `${h}-${a}` });
  for (const sh of [...input.homeScorers.slice(0, 6), ...input.awayScorers.slice(0, 6)]) add('scorer', { playerId: sh.playerId, label: names.get(sh.playerId) ?? 'Jugador' });
  if (m.is_main_event) {
    for (const sh of [...input.homeScorers.slice(0, 5), ...input.awayScorers.slice(0, 5)]) add('mvp', { playerId: sh.playerId, label: names.get(sh.playerId) ?? 'Jugador' });
  }
  const offers = await insertMany<Offer>(db, 'odds_offers', rows, '*');
  return { match: m, offers, open: true, expected: ex };
}

/** Cuotas de largo plazo de una edición a partir de las probabilidades simuladas. */
export async function longTermOdds(db: DB, editionId: string) {
  const e = await q<EditionRow>(db.from('editions').select('*').eq('id', editionId).single());
  if (e.status === 'finished') return [];
  const probs = await q<{ team_id: string; champion: number; playoffs: number; promotion: number; relegation: number }[]>(
    db.from('probability_snapshots').select('team_id,champion,playoffs,promotion,relegation').eq('edition_id', editionId),
  );
  const { houseMargin } = await betting(db);
  await q(db.from('odds_offers').update({ active: false }).eq('edition_id', editionId).is('match_id', null));
  const regularOpen = e.status === 'in_progress';
  const rows: Record<string, unknown>[] = [];
  for (const p of probs) {
    const add = (market: Market, prob: number) => {
      const o = price(Number(prob), houseMargin);
      if (o && o > 1.01 && Number(prob) < 0.995) rows.push({ edition_id: editionId, market, selection: { teamId: p.team_id }, odds: o });
    };
    add('champion', p.champion);
    if (regularOpen && (e.config.playoffTeams ?? 0) > 0) add('playoffs', p.playoffs);
    if (regularOpen && (e.config.promoted ?? 0) > 0) add('promotion', p.promotion);
    if (regularOpen && (e.config.relegated ?? 0) > 0) add('relegation', p.relegation);
  }
  return insertMany(db, 'odds_offers', rows, '*');
}

/**
 * Apuesta simple o combinada. Las cuotas siempre salen de odds_offers (el
 * navegador nunca las fija).
 */
export async function placeBet(db: DB, userId: string, offerIds: string[], stake: number, source: 'credits' | 'club') {
  const cfg = await betting(db);
  const ids = [...new Set(offerIds)];
  if (!ids.length) throw new AppError('Agrega al menos una selección');
  if (ids.length > cfg.maxParlayLegs) throw new AppError(`Una combinada admite hasta ${cfg.maxParlayLegs} selecciones`);
  if (!Number.isFinite(stake) || stake < 1) throw new AppError('Monto inválido');
  const offers = await q<Offer[]>(db.from('odds_offers').select('*').in('id', ids).eq('active', true));
  if (offers.length !== ids.length) throw new AppError('Alguna cuota ya no está disponible. Actualiza tu boleta.');

  const matchIds = offers.map((o) => o.match_id).filter(Boolean) as string[];
  if (new Set(matchIds).size !== matchIds.length && ids.length > 1) throw new AppError('Una combinada no puede llevar dos selecciones del mismo partido');
  if (matchIds.length) {
    const ms = await q<{ id: string; status: string; scheduled_at: string | null }[]>(db.from('matches').select('id,status,scheduled_at').in('id', matchIds));
    const now = Date.now();
    for (const m of ms) {
      if (m.status !== 'scheduled' || (m.scheduled_at && Date.parse(m.scheduled_at) <= now)) throw new AppError('Ese partido ya empezó: las apuestas están cerradas');
    }
  }
  const legs = offers.map((o) => ({ matchId: o.match_id ?? '', editionId: o.edition_id ?? '', market: o.market, selection: o.selection, odds: Number(o.odds) }));
  const ticket = await q<string>(db.rpc('place_bet_tx', { p_user: userId, p_source: source, p_legs: legs, p_stake: Math.round(stake) }));

  // Si un dueño apuesta contra su propio equipo, es noticia.
  if (source === 'club' || true) {
    const prof = await q<{ display_name: string; club_team_id: string | null; role: string }>(db.from('profiles').select('display_name,club_team_id,role').eq('id', userId).single());
    if (prof.role === 'owner' && prof.club_team_id) {
      for (const o of offers.filter((x) => x.market === 'winner' && x.match_id)) {
        const m = await q<{ home_team_id: string; away_team_id: string }>(db.from('matches').select('home_team_id,away_team_id').eq('id', o.match_id!).single());
        const against =
          (m.home_team_id === prof.club_team_id && o.selection.pick === 'away') || (m.away_team_id === prof.club_team_id && o.selection.pick === 'home');
        if (against) {
          const team = await q<{ name: string }>(db.from('teams').select('name').eq('id', prof.club_team_id).single());
          await q(
            db.from('news').insert({
              kind: 'polemica',
              tone: 'picante',
              title: `¡Escándalo! La directiva de ${team.name} apuesta contra su propio equipo`,
              body: `${prof.display_name}, dueño de ${team.name}, puso dinero a que su club pierde. En el vestuario nadie lo puede creer.`,
              status: 'pending',
              team_id: prof.club_team_id,
              match_id: o.match_id,
              ai_generated: false,
            }),
          );
        }
      }
    }
  }
  return { ticket, odds: parlayOdds(legs.map((l) => l.odds)), potential: Math.floor(stake * parlayOdds(legs.map((l) => l.odds))) };
}

interface BetRow {
  id: string;
  user_id: string;
  source: 'credits' | 'club';
  club_team_id: string | null;
  parlay_id: string | null;
  match_id: string | null;
  edition_id: string | null;
  market: Market;
  selection: Selection;
  odds: number;
  stake: number;
  status: 'open' | 'won' | 'lost' | 'void';
}

/** Liquida las apuestas de los partidos que acaban de terminar. */
export async function settleMatches(db: DB, payloads: SimPayload[]) {
  const ids = payloads.map((p) => p.matchId);
  const open = await all<BetRow>(() => db.from('bets').select('*').in('match_id', ids).eq('status', 'open'));
  await q(db.from('odds_offers').update({ active: false }).in('match_id', ids));
  if (!open.length) return;
  const byMatch = new Map(payloads.map((p) => [p.matchId, p]));
  const now = new Date().toISOString();
  for (const b of open) {
    const p = byMatch.get(b.match_id!)!;
    const status = settleMatchBet(b.market, b.selection, {
      homeScore: p.homeScore,
      awayScore: p.awayScore,
      scorerIds: p.goals.map((g) => g.scorerId),
      mvpId: p.mvpId,
    });
    await q(db.from('bets').update({ status, settled_at: now }).eq('id', b.id));
  }
  await payTickets(db, [...new Set(open.map((b) => b.parlay_id ?? b.id))]);
}

/** Paga boletas (simples o combinadas) cuyas selecciones ya están todas decididas. */
async function payTickets(db: DB, ticketIds: string[]) {
  for (const t of ticketIds) {
    const legs = await q<(BetRow & { payout: number | null })[]>(db.from('bets').select('*').or(`id.eq.${t},parlay_id.eq.${t}`));
    if (!legs.length || legs.some((l) => l.status === 'open') || legs.some((l) => l.payout !== null)) continue;
    const lost = legs.some((l) => l.status === 'lost');
    const stake = Number(legs[0].stake);
    const payout = lost ? 0 : Math.floor(stake * legs.reduce((p, l) => p * (l.status === 'won' ? Number(l.odds) : 1), 1));
    await q(db.from('bets').update({ payout }).in('id', legs.map((l) => l.id)));
    if (payout > 0) {
      await q(db.rpc('pay_bet', { p_user: legs[0].user_id, p_source: legs[0].source, p_club: legs[0].club_team_id, p_amount: payout, p_note: 'Apuesta ganada' }));
    }
    await q(
      db.from('notifications').insert({
        user_id: legs[0].user_id,
        kind: 'bet',
        payload: { won: !lost, payout, stake, legs: legs.length, source: legs[0].source },
      }),
    );
  }
}

/** Mercados de largo plazo: al cerrar la fase regular y al terminar la edición. */
export async function settleLongTerm(db: DB, e: EditionRow, rows: MatchRow[], teamIds: string[], phase: 'regular' | 'final', champion?: string) {
  const markets: Market[] = phase === 'regular' ? ['playoffs', 'promotion', 'relegation'] : ['champion', 'playoffs', 'promotion', 'relegation'];
  const open = await all<BetRow>(() => db.from('bets').select('*').eq('edition_id', e.id).is('match_id', null).eq('status', 'open').in('market', markets));
  await q(db.from('odds_offers').update({ active: false }).eq('edition_id', e.id).is('match_id', null).in('market', markets));
  if (!open.length) return;
  const table = rows.some((m) => m.stage !== 'playoff') ? regularStandings(teamIds, rows, e.config).map((r) => r.teamId) : teamIds;
  const playoffTeams = new Set(e.state.playoffSeeds ?? []);
  const promoted = new Set(table.slice(0, e.config.promoted ?? 0));
  const relegated = new Set(e.config.relegated ? table.slice(-e.config.relegated) : []);
  for (const b of open) {
    const t = b.selection.teamId!;
    const won =
      b.market === 'champion' ? t === champion : b.market === 'playoffs' ? playoffTeams.has(t) : b.market === 'promotion' ? promoted.has(t) : relegated.has(t);
    await q(db.from('bets').update({ status: won ? 'won' : 'lost', settled_at: new Date().toISOString() }).eq('id', b.id));
  }
  await payTickets(db, [...new Set(open.map((b) => b.parlay_id ?? b.id))]);
}

export type { TeamRow };
