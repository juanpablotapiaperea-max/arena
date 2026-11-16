// Día de competencia (sección 3): al iniciar se arma el guion del día; una tarea
// programada despierta cada minuto y ejecuta lo que toca.
import { AppError, all, getSetting, insertMany, q, type DB } from './db.ts';
import { closeUnits, commitResults, editionMatches, loadContext, simulate, type SimPayload } from './run.ts';
import { newsDay, newsLiveEvent } from './news.ts';
import { DEFAULT_CALENDAR, type CalendarSettings } from './plan.ts';
import { MATCH_COLS, type DayRow, type EditionRow, type MatchDb, type ScheduleItem } from './types.ts';
import type { Unit } from '../../../shared/competition/edition.ts';

const MX_OFFSET = '-06:00'; // America/Mexico_City (sin horario de verano desde 2022)
const MIN = 60_000;

interface Block {
  id: string;
  day_id: string;
  edition_id: string;
  unit_index: number;
  label: string;
  sort_order: number;
}

/** Detector de derbis: puntaje 0-100 (sección 3). */
async function derbyScores(db: DB, ms: MatchDb[], editions: Map<string, EditionRow>): Promise<Map<string, { score: number; name: string }>> {
  const out = new Map<string, { score: number; name: string }>();
  if (!ms.length) return out;
  const cal = { ...DEFAULT_CALENDAR, ...(await getSetting<Partial<CalendarSettings> & { derbyWeights?: Record<string, number> }>(db, 'calendar', {})) };
  const w = { rivalry: 0.35, form: 0.25, closeness: 0.2, importance: 0.2, ...((cal as { derbyWeights?: Record<string, number> }).derbyWeights ?? {}) };
  const teams = await all<{ id: string; name: string }>(() => db.from('teams').select('id,name'));
  const name = new Map(teams.map((t) => [t.id, t.name]));
  const legacy = await all<{ champion_team_id: string | null; runner_up_team_id: string | null }>(() =>
    db.from('legacy_editions').select('champion_team_id,runner_up_team_id'),
  );
  const finals = await all<{ home_team_id: string; away_team_id: string }>(() =>
    db.from('matches').select('home_team_id,away_team_id').eq('round', 'final').eq('status', 'finished'),
  );
  const classics = await all<{ team_a: string; team_b: string; competition_id: string | null; name: string | null }>(() =>
    db.from('classics').select('team_a,team_b,competition_id,name'),
  );
  const rank = await all<{ team_id: string; points: number }>(() => db.from('ranking_entries').select('team_id,points').is('season_id', null));
  const rankPos = new Map([...rank].sort((a, b) => b.points - a.points).map((r, i) => [r.team_id, i]));
  const standings = await all<{ edition_id: string; team_id: string; position: number; form: string; group_label: string }>(() =>
    db.from('edition_standings').select('edition_id,team_id,position,form,group_label').in('edition_id', [...editions.keys()]),
  );
  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const rivalry = new Map<string, number>();
  for (const l of legacy) if (l.champion_team_id && l.runner_up_team_id) rivalry.set(key(l.champion_team_id, l.runner_up_team_id), (rivalry.get(key(l.champion_team_id, l.runner_up_team_id)) ?? 0) + 1);
  for (const f of finals) rivalry.set(key(f.home_team_id, f.away_team_id), (rivalry.get(key(f.home_team_id, f.away_team_id)) ?? 0) + 1);
  const formScore = (f: string) => (f ? [...f].reduce((s, c) => s + (c === 'W' ? 1 : c === 'D' ? 0.4 : 0), 0) / f.length : 0.5);

  for (const m of ms) {
    if (m.stage === 'playoff') continue;
    const e = editions.get(m.edition_id)!;
    const classic = classics.find(
      (c) => key(c.team_a, c.team_b) === key(m.home_team_id, m.away_team_id) && (!c.competition_id || c.competition_id === e.competition_id),
    );
    const st = standings.filter((s) => s.edition_id === m.edition_id);
    const sh = st.find((s) => s.team_id === m.home_team_id);
    const sa = st.find((s) => s.team_id === m.away_team_id);
    const size = Math.max(2, st.length);
    const closeness = sh && sa && sh.form ? 1 - Math.abs(sh.position - sa.position) / (size - 1) : 1 - Math.abs((rankPos.get(m.home_team_id) ?? 27) - (rankPos.get(m.away_team_id) ?? 27)) / 53;
    const form = (formScore(sh?.form ?? '') + formScore(sa?.form ?? '')) / 2;
    const riv = Math.min(1, (rivalry.get(key(m.home_team_id, m.away_team_id)) ?? 0) / 4);
    const importance = Math.min(1, Number(e.config.weight ?? 1) / 2.5);
    const score = Math.round(100 * (w.rivalry * riv + w.form * form + w.closeness * closeness + w.importance * importance));
    const label = `${name.get(m.home_team_id)} vs ${name.get(m.away_team_id)}`;
    out.set(m.id, { score: classic ? Math.max(score, 100) : score, name: classic ? `Clásico${classic.name ? ` ${classic.name}` : ''} · ${label}` : `Derbi · ${label}` });
  }
  return out;
}

function windowStart(day: DayRow, mode: 'real' | 'now'): number {
  const now = Date.now();
  if (mode === 'now') return now;
  const start = Date.parse(`${day.date}T08:00:00${MX_OFFSET}`);
  return Math.max(now, start);
}

/** Inicia el día: forma, lesiones, estilos bloqueados y guion completo. */
export async function startDay(db: DB, dayId: string, mode: 'real' | 'now' = 'real') {
  const day = await q<DayRow>(db.from('competition_days').select('*').eq('id', dayId).single());
  if (day.status !== 'planned') throw new AppError('Ese día ya se inició');
  const running = await q<{ id: string }[]>(db.from('competition_days').select('id').in('status', ['running', 'paused']));
  if (running.length) throw new AppError('Ya hay un día en curso. Ciérralo antes de iniciar otro.');
  const blocks = await q<Block[]>(db.from('plan_blocks').select('*').eq('day_id', dayId).eq('kind', 'unit').order('sort_order'));
  if (!blocks.length) throw new AppError('El día no tiene jornadas planeadas');

  await q(db.rpc('begin_competition_day'));
  const cal = { ...DEFAULT_CALENDAR, ...(await getSetting<Partial<CalendarSettings>>(db, 'calendar', {})) };
  const editionIds = [...new Set(blocks.map((b) => b.edition_id))];
  const eds = await q<EditionRow[]>(db.from('editions').select('*').in('id', editionIds));
  const editions = new Map(eds.map((e) => [e.id, e]));
  const allMs = (await all<MatchDb>(() => db.from('matches').select(MATCH_COLS).in('edition_id', editionIds).eq('status', 'scheduled')));
  const unitMatches = (b: Block) => allMs.filter((m) => m.edition_id === b.edition_id && m.unit_index === b.unit_index);

  // Eventos principales: rondas de cuartos en adelante, derbis, clásicos y forzados.
  const regular = blocks.flatMap((b) => unitMatches(b).filter((m) => m.stage !== 'playoff'));
  const derbies = await derbyScores(db, regular, editions);
  type Live = { block: Block; unit: Unit; matchId: string | null; slot: number; score: number; name: string; final: boolean };
  const lives: Live[] = [];
  const burstUnits: { block: Block; unit: Unit; count: number }[] = [];
  for (const b of blocks) {
    const e = editions.get(b.edition_id)!;
    const unit = e.state.units.find((u) => u.index === b.unit_index)!;
    const ms = unitMatches(b);
    const compName = e.name.split(' · ')[0];
    if (unit.main) {
      const n = ms.length || unit.matches;
      for (let i = 0; i < n; i++) {
        lives.push({ block: b, unit, matchId: ms[i]?.id ?? null, slot: i, score: 100, name: `${compName} · ${unit.label}`, final: unit.round === 'final' });
      }
      continue;
    }
    let normal = ms.length || unit.matches;
    for (const m of ms) {
      const d = derbies.get(m.id);
      if (m.is_main_event || (d && d.score >= cal.derbyThreshold)) {
        lives.push({ block: b, unit, matchId: m.id, slot: -1, score: m.is_main_event ? 100 : d!.score, name: m.event_name ?? d?.name ?? compName, final: false });
        normal--;
      }
    }
    if (normal > 0) burstUnits.push({ block: b, unit, count: normal });
  }

  // Cada día lleva al menos un evento en vivo cuando hay material: si ningún
  // partido llegó al umbral, se transmiten los mejores derbis del día (hasta 3).
  if (!lives.length && regular.length) {
    const best = regular
      .map((m) => ({ m, d: derbies.get(m.id)! }))
      .filter((x) => x.d)
      .sort((a, b) => b.d.score - a.d.score)
      .slice(0, Math.min(3, Math.max(1, Math.floor(regular.length / 60))));
    for (const { m, d } of best) {
      const b = blocks.find((x) => x.edition_id === m.edition_id && x.unit_index === m.unit_index)!;
      const e = editions.get(b.edition_id)!;
      lives.push({ block: b, unit: e.state.units.find((u) => u.index === b.unit_index)!, matchId: m.id, slot: -1, score: d.score, name: d.name, final: false });
      const bu = burstUnits.find((x) => x.block.id === b.id);
      if (bu) bu.count--;
    }
  }

  // Máximo de eventos en vivo: los de menor interés pasan a ráfagas.
  lives.sort((a, b) => b.score - a.score);
  const kept = lives.slice(0, cal.maxLiveEventsPerDay);
  for (const dropped of lives.slice(cal.maxLiveEventsPerDay)) {
    const bu = burstUnits.find((x) => x.block.id === dropped.block.id);
    if (bu) bu.count++;
    else burstUnits.push({ block: dropped.block, unit: dropped.unit, count: 1 });
  }
  // Orden: por bloque del plan; las finales al último horario.
  kept.sort((a, b) => Number(a.final) - Number(b.final) || a.block.sort_order - b.block.sort_order || a.slot - b.slot);

  const t0 = windowStart(day, mode);
  const windowMin = 6 * 60;
  const items: Record<string, unknown>[] = [];
  const liveMinutes = cal.liveEventMinutes;
  const keptIds = new Set(kept);

  // Tamaño de ráfaga: de 3 a 6 partidos; más si no cabe en la ventana de 6 horas.
  const totalNormal = burstUnits.reduce((s, b) => s + b.count, 0);
  const slots = Math.floor(windowMin / cal.burstEveryMinutes);
  // El menor tamaño de ráfaga (desde 3) con el que todo cabe en la ventana.
  let size = cal.burstMin;
  const burstsFor = (n: number) => burstUnits.reduce((acc, b) => acc + Math.ceil(Math.max(0, b.count) / n), 0);
  while (size < 50 && burstsFor(size) > slots - 2) size++;
  void totalNormal;

  // Se recorre el plan en orden: las ráfagas avanzan cada 5 minutos y los
  // eventos en vivo van uno tras otro; una ronda en vivo arranca cuando ya
  // terminó todo lo anterior.
  let burstAt = 1; // minutos desde t0
  let liveAt = 5;
  let k = 0;
  const pushLive = (l: Live, at: number) => {
    items.push({
      day_id: dayId,
      kind: 'event',
      block_id: l.block.id,
      edition_id: l.block.edition_id,
      unit_index: l.block.unit_index,
      match_id: l.matchId,
      sort_order: l.slot,
      scheduled_at: new Date(t0 + at * MIN).toISOString(),
      label: l.name,
    });
  };
  const finals = kept.filter((l) => l.final);
  for (const b of blocks) {
    const bu = burstUnits.find((x) => x.block.id === b.id);
    const blockLives = kept.filter((l) => l.block.id === b.id && !l.final);
    const isMainUnit = blockLives.some((l) => l.slot >= 0);
    if (isMainUnit) {
      liveAt = Math.max(liveAt, burstAt);
      for (const l of blockLives) {
        pushLive(l, liveAt);
        liveAt += liveMinutes;
      }
      burstAt = Math.max(burstAt, liveAt);
    } else {
      // Derbis de jornada: en la siguiente franja libre de vivos, sin esperar.
      for (const l of blockLives) {
        liveAt = Math.max(liveAt, burstAt);
        pushLive(l, liveAt);
        liveAt += liveMinutes;
      }
    }
    if (bu) {
      let left = bu.count;
      while (left > 0) {
        const n = Math.min(size, left);
        left -= n;
        items.push({
          day_id: dayId,
          kind: 'burst',
          block_id: b.id,
          edition_id: b.edition_id,
          unit_index: b.unit_index,
          burst_size: n,
          sort_order: k++,
          scheduled_at: new Date(t0 + burstAt * MIN).toISOString(),
          label: b.label,
        });
        burstAt += cal.burstEveryMinutes;
      }
    }
  }
  // Las finales ocupan el último horario del día.
  let finalAt = Math.max(liveAt, burstAt);
  for (const l of finals) {
    pushLive(l, finalAt);
    finalAt += liveMinutes;
  }
  void keptIds;
  items.push({
    day_id: dayId,
    kind: 'summary',
    sort_order: 0,
    scheduled_at: new Date(t0 + (Math.max(finalAt, liveAt, burstAt) + 2) * MIN).toISOString(),
    label: 'Cierre del día',
  });
  await insertMany(db, 'schedule_items', items);

  // Hora programada de cada partido (cierra las apuestas a esa hora).
  for (const l of kept) {
    if (l.matchId) {
      const it = items.find((x) => x.match_id === l.matchId)!;
      await q(db.from('matches').update({ scheduled_at: it.scheduled_at, is_main_event: true, event_name: l.name, derby_score: derbies.get(l.matchId)?.score ?? null }).eq('id', l.matchId));
    }
  }
  for (const it of items.filter((x) => x.kind === 'burst')) {
    const ms = unitMatches(blocks.find((b) => b.id === it.block_id)!).filter((m) => !kept.some((l) => l.matchId === m.id));
    // reparto aproximado: los partidos de la unidad en orden
    const before = items.filter((x) => x.kind === 'burst' && x.block_id === it.block_id && (x.sort_order as number) < (it.sort_order as number)).reduce((s, x) => s + (x.burst_size as number), 0);
    const ids = ms.slice(before, before + (it.burst_size as number)).map((m) => m.id);
    if (ids.length) await q(db.from('matches').update({ scheduled_at: it.scheduled_at }).in('id', ids));
  }
  await q(db.from('competition_days').update({ status: 'running', mode, published: true, started_at: new Date().toISOString() }).eq('id', dayId));
  await q(
    db.from('competition_days').update({
      announced: items.filter((x) => x.kind === 'event').map((x) => ({ name: x.label, at: x.scheduled_at })),
    }).eq('id', dayId),
  );
  return { lives: kept.length, bursts: k, startsAt: new Date(t0).toISOString() };
}

/** Garantiza que existan los partidos de una unidad (playoffs que dependen de la anterior). */
async function ensureUnit(db: DB, editionId: string, unitIndex: number): Promise<MatchDb[]> {
  let ms = (await editionMatches(db, editionId)).filter((m) => m.unit_index === unitIndex);
  if (ms.length) return ms;
  const prev = (await editionMatches(db, editionId)).filter((m) => m.unit_index === unitIndex - 1);
  if (prev.length && prev.every((m) => m.status === 'finished')) {
    await closeUnits(db, editionId, [unitIndex - 1]);
    ms = (await editionMatches(db, editionId)).filter((m) => m.unit_index === unitIndex);
  }
  return ms;
}

async function postpone(db: DB, item: ScheduleItem, minutes: number) {
  await q(db.from('schedule_items').update({ scheduled_at: new Date(Date.now() + minutes * MIN).toISOString() }).eq('id', item.id));
}

async function runBurst(db: DB, item: ScheduleItem): Promise<void> {
  const ms = await ensureUnit(db, item.edition_id!, item.unit_index!);
  if (!ms.length) return postpone(db, item, 5);
  const pending = ms.filter((m) => m.status === 'scheduled' && !m.is_main_event);
  if (!pending.length) {
    await q(db.from('schedule_items').update({ status: 'done', result: { matches: 0 } }).eq('id', item.id));
    return;
  }
  // La última ráfaga del bloque se lleva todo lo que quede de la jornada.
  const others = await q<{ id: string }[]>(
    db.from('schedule_items').select('id').eq('block_id', item.block_id).eq('kind', 'burst').eq('status', 'pending').neq('id', item.id),
  );
  const pick = others.length ? pending.slice(0, item.burst_size ?? 4) : pending;
  const e = await q<EditionRow>(db.from('editions').select('*').eq('id', item.edition_id).single());
  const ctx = await loadContext(db, pick.flatMap((m) => [m.home_team_id, m.away_team_id]));
  await countGamesToday(db, ctx.gamesToday, item.day_id);
  const payloads: SimPayload[] = [];
  for (const m of pick) payloads.push((await simulate(ctx, m, e, false)).payload);
  await commitResults(db, payloads);
  // Si quedan partidos normales de la unidad sin ráfaga asignada, este bloque los absorbe después.
  await q(
    db.from('schedule_items').update({
      status: 'done',
      match_ids: pick.map((m) => m.id),
      result: { matches: pick.length, scores: payloads.map((p) => ({ id: p.matchId, h: p.homeTeamId, a: p.awayTeamId, hs: p.homeScore, as: p.awayScore, ot: p.overtime })) },
    }).eq('id', item.id),
  );
}

async function countGamesToday(db: DB, map: Map<string, number>, dayId: string) {
  const done = await all<{ match_ids: string[]; match_id: string | null }>(() => db.from('schedule_items').select('match_ids,match_id').eq('day_id', dayId).eq('status', 'done'));
  const ids = done.flatMap((d) => [...(d.match_ids ?? []), ...(d.match_id ? [d.match_id] : [])]);
  if (!ids.length) return;
  for (let i = 0; i < ids.length; i += 300) {
    const ms = await q<{ home_team_id: string; away_team_id: string }[]>(db.from('matches').select('home_team_id,away_team_id').in('id', ids.slice(i, i + 300)));
    for (const m of ms) for (const t of [m.home_team_id, m.away_team_id]) map.set(t, (map.get(t) ?? 0) + 1);
  }
}

async function startLive(db: DB, item: ScheduleItem): Promise<void> {
  // Nunca dos eventos en vivo a la vez.
  const live = await q<{ id: string }[]>(db.from('schedule_items').select('id').eq('day_id', item.day_id).eq('kind', 'event').eq('status', 'running'));
  if (live.length) return postpone(db, item, 1);
  let matchId = item.match_id;
  if (!matchId) {
    const ms = await ensureUnit(db, item.edition_id!, item.unit_index!);
    if (!ms.length) return postpone(db, item, 3);
    const sorted = [...ms].sort((a, b) => (a.bracket_slot ?? 0) - (b.bracket_slot ?? 0));
    matchId = sorted[item.sort_order]?.id ?? null;
    if (!matchId) {
      await q(db.from('schedule_items').update({ status: 'cancelled' }).eq('id', item.id));
      return;
    }
  }
  const m = await q<MatchDb>(db.from('matches').select(MATCH_COLS).eq('id', matchId).single());
  if (m.status !== 'scheduled') {
    await q(db.from('schedule_items').update({ status: 'done', match_id: matchId }).eq('id', item.id));
    return;
  }
  const e = await q<EditionRow>(db.from('editions').select('*').eq('id', m.edition_id).single());
  const ctx = await loadContext(db, [m.home_team_id, m.away_team_id]);
  await countGamesToday(db, ctx.gamesToday, item.day_id);
  const { payload, result } = await simulate(ctx, m, e, true);
  // La línea de tiempo se guarda completa antes de empezar; el resultado queda oculto.
  await q(db.from('match_timelines').upsert({ match_id: m.id, events: enrichTimeline(result.timeline ?? [], payload), duration_seconds: result.durationSeconds }));
  await q(db.from('match_secrets').upsert({ match_id: m.id, seed: payload.seed, home_bias: payload.homeBias, away_bias: payload.awayBias, pending_result: payload }));
  const now = new Date().toISOString();
  await q(db.from('matches').update({ status: 'live', started_at: now, is_main_event: true, event_name: m.event_name ?? item.label }).eq('id', m.id));
  await q(db.from('odds_offers').update({ active: false }).eq('match_id', m.id));
  await q(db.from('schedule_items').update({ status: 'running', match_id: m.id }).eq('id', item.id));
}

/** Agrega nombres y números a la línea de tiempo para mostrarla sin más consultas. */
function enrichTimeline(events: { playerId?: string; data?: Record<string, unknown> }[], p: SimPayload) {
  const byId = new Map(p.players.map((x) => [x.playerId, { name: x.name, number: x.number }]));
  return events.map((ev) => ({
    ...ev,
    player: ev.playerId ? byId.get(ev.playerId) : undefined,
    assists: Array.isArray(ev.data?.assists) ? (ev.data!.assists as string[]).map((id) => byId.get(id)?.name).filter(Boolean) : undefined,
  }));
}

async function finishLive(db: DB, item: ScheduleItem): Promise<void> {
  const m = await q<MatchDb>(db.from('matches').select(MATCH_COLS).eq('id', item.match_id).single());
  const tl = await q<{ duration_seconds: number }>(db.from('match_timelines').select('duration_seconds').eq('match_id', m.id).single());
  if (!m.started_at || Date.now() < Date.parse(m.started_at) + tl.duration_seconds * 1000) return;
  const secret = await q<{ pending_result: SimPayload }>(db.from('match_secrets').select('pending_result').eq('match_id', m.id).single());
  const payload = secret.pending_result;
  await commitResults(db, [payload]);
  await q(db.from('schedule_items').update({ status: 'done', result: { matches: 1, hs: payload.homeScore, as: payload.awayScore } }).eq('id', item.id));
  const e = await q<EditionRow>(db.from('editions').select('*').eq('id', m.edition_id).single());
  const fin = await q<MatchDb>(db.from('matches').select(MATCH_COLS).eq('id', m.id).single());
  const names = new Map(payload.players.map((p) => [p.playerId, p.name ?? '']));
  await newsLiveEvent(db, fin, e, payload.goals.map((g) => names.get(g.scorerId) ?? ''), payload.mvpId ? names.get(payload.mvpId) ?? null : null).catch(() => undefined);
}

/** Ejecuta lo que toca ahora. La llama la tarea programada cada minuto. */
export async function tick(db: DB, budgetMs = 40_000) {
  const t = Date.now();
  const days = await q<DayRow[]>(db.from('competition_days').select('*').eq('status', 'running'));
  const log: string[] = [];
  for (const day of days) {
    // Eventos en vivo que ya terminaron.
    const running = await q<ScheduleItem[]>(db.from('schedule_items').select('*').eq('day_id', day.id).eq('status', 'running'));
    for (const it of running) await finishLive(db, it);

    for (let guard = 0; guard < 30 && Date.now() - t < budgetMs; guard++) {
      const due = await q<ScheduleItem[]>(
        db.from('schedule_items').select('*').eq('day_id', day.id).eq('status', 'pending').lte('scheduled_at', new Date().toISOString()).order('scheduled_at').limit(1),
      );
      const item = due[0];
      if (!item) break;
      if (item.kind === 'burst') await runBurst(db, item);
      else if (item.kind === 'event') await startLive(db, item);
      else if (item.kind === 'summary') {
        const left = await q<{ id: string }[]>(db.from('schedule_items').select('id').eq('day_id', day.id).in('status', ['pending', 'running']).neq('kind', 'summary'));
        if (left.length) {
          await postpone(db, item, 2);
        } else {
          await q(db.from('schedule_items').update({ status: 'done' }).eq('id', item.id));
          await closeDay(db, day.id);
        }
        break;
      }
      // Lo que no pudo correr se pospuso a un minuto futuro: la cola sigue con lo demás.
      const fresh = await q<ScheduleItem>(db.from('schedule_items').select('status').eq('id', item.id).single());
      if (fresh.status !== 'pending') log.push(`${item.kind}:${item.label}`);
    }
  }
  return { ran: log, ms: Date.now() - t };
}

export async function closeDay(db: DB, dayId: string) {
  await q(db.from('schedule_items').update({ status: 'cancelled' }).eq('day_id', dayId).eq('status', 'pending'));
  await q(db.from('competition_days').update({ status: 'closed', closed_at: new Date().toISOString() }).eq('id', dayId));
  await q(db.rpc('end_competition_day'));
  await newsDay(db, dayId).catch(() => undefined);
}

export async function pauseDay(db: DB, dayId: string) {
  await q(db.from('competition_days').update({ status: 'paused', closed_at: new Date().toISOString() }).eq('id', dayId).eq('status', 'running'));
}

/** Reanuda: todo lo pendiente (y el evento en vivo) se recorre lo que duró la pausa. */
export async function resumeDay(db: DB, dayId: string) {
  const day = await q<DayRow>(db.from('competition_days').select('*').eq('id', dayId).single());
  if (day.status !== 'paused') throw new AppError('El día no está en pausa');
  const pausedMs = Date.now() - Date.parse(day.closed_at ?? new Date().toISOString());
  const items = await q<ScheduleItem[]>(db.from('schedule_items').select('*').eq('day_id', dayId).in('status', ['pending', 'running']));
  for (const it of items) {
    if (it.status === 'pending') await q(db.from('schedule_items').update({ scheduled_at: new Date(Date.parse(it.scheduled_at) + pausedMs).toISOString() }).eq('id', it.id));
    else if (it.match_id) {
      const m = await q<{ started_at: string }>(db.from('matches').select('started_at').eq('id', it.match_id).single());
      await q(db.from('matches').update({ started_at: new Date(Date.parse(m.started_at) + pausedMs).toISOString() }).eq('id', it.match_id));
    }
  }
  await q(db.from('competition_days').update({ status: 'running', closed_at: null }).eq('id', dayId));
}

/** Adelanta (minutos negativos) o atrasa un elemento del guion. */
export async function shiftItem(db: DB, itemId: string, minutes: number) {
  const it = await q<ScheduleItem>(db.from('schedule_items').select('*').eq('id', itemId).single());
  if (it.status !== 'pending') throw new AppError('Solo se mueve lo que aún no empieza');
  const at = new Date(Math.max(Date.now(), Date.parse(it.scheduled_at) + minutes * MIN)).toISOString();
  await q(db.from('schedule_items').update({ scheduled_at: at }).eq('id', itemId));
  if (it.match_id) await q(db.from('matches').update({ scheduled_at: at }).eq('id', it.match_id));
}

export async function cancelItem(db: DB, itemId: string) {
  await q(db.from('schedule_items').update({ status: 'cancelled' }).eq('id', itemId).eq('status', 'pending'));
}

/** Forzar: ejecutar ya mismo. */
export async function forceItem(db: DB, itemId: string) {
  const it = await q<ScheduleItem>(db.from('schedule_items').select('*').eq('id', itemId).single());
  if (it.status !== 'pending') throw new AppError('Ese elemento ya se ejecutó');
  await q(db.from('schedule_items').update({ scheduled_at: new Date().toISOString() }).eq('id', itemId));
  return tick(db, 20_000);
}

export async function dayStatus(db: DB, dayId?: string) {
  const day = dayId
    ? await q<DayRow | null>(db.from('competition_days').select('*').eq('id', dayId).maybeSingle())
    : await q<DayRow | null>(db.from('competition_days').select('*').in('status', ['running', 'paused']).order('date').limit(1).maybeSingle());
  if (!day) return { day: null, items: [] };
  const items = await all<ScheduleItem>(() => db.from('schedule_items').select('*').eq('day_id', day.id).order('scheduled_at'));
  return { day, items };
}
