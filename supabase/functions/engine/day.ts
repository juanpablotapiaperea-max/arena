// Día de competencia (sección 3): al iniciar se arma el guion del día; una tarea
// programada despierta cada minuto y ejecuta lo que toca.
import { AppError, all, getSetting, insertMany, q, type DB } from './db.ts';
import { closeUnits, commitResults, editionMatches, loadContext, simulate, type SimPayload } from './run.ts';
import { newsDay, newsLiveEvent } from './news.ts';
import { DEFAULT_CALENDAR, enforcePlayoffStart, type CalendarSettings } from './plan.ts';
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

/** Hora de fin del día (México): `dayEndTime` "HH:MM" o `dayEndHour`. */
export function dayDeadline(date: string, cal: Record<string, unknown>): number {
  const t = typeof cal.dayEndTime === 'string' && /^\d{1,2}:\d{2}$/.test(cal.dayEndTime) ? cal.dayEndTime : `${Number(cal.dayEndHour ?? 14)}:00`;
  const [h, m] = t.split(':').map(Number);
  return Date.parse(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00${MX_OFFSET}`);
}

function windowStart(day: DayRow, mode: 'real' | 'now'): number {
  const now = Date.now();
  if (mode === 'now') return now;
  const start = Date.parse(`${day.date}T08:00:00${MX_OFFSET}`);
  return Math.max(now, start);
}

/** Inicia el día: forma, lesiones, estilos bloqueados y guion completo. */
export async function startDay(db: DB, dayId: string, mode: 'real' | 'now' = 'real') {
  // Se aparta el día de forma atómica: si dos arranques llegan a la vez, solo uno sigue.
  const claimed = await q<DayRow[]>(
    db.from('competition_days').update({ status: 'running', mode, published: true, started_at: new Date().toISOString() }).eq('id', dayId).eq('status', 'planned').select('*'),
  );
  if (!claimed.length) throw new AppError('Ese día ya se inició');
  try {
    return await buildDay(db, claimed[0], dayId, mode);
  } catch (e) {
    // Si algo falla a la mitad, el día vuelve a quedar listo para reintentar.
    await db.from('schedule_items').delete().eq('day_id', dayId);
    await db.from('competition_days').update({ status: 'planned', started_at: null }).eq('id', dayId);
    throw e;
  }
}

async function buildDay(db: DB, day: DayRow, dayId: string, mode: 'real' | 'now') {
  // Se permite arrancar aunque otro día siga en curso: corren en paralelo y los
  // eventos en vivo hacen fila entre todos los días.
  const blocks = await q<Block[]>(db.from('plan_blocks').select('*').eq('day_id', dayId).eq('kind', 'unit').order('sort_order'));
  // Dentro de cada torneo, siempre en orden (jornada 1 antes que 2, cuartos antes
  // que semis), aunque en el planificador hayan quedado al revés. Se respeta cómo
  // se intercalan los torneos entre sí.
  const byEdition = new Map<string, number[]>();
  blocks.forEach((b, i) => {
    const k = b.edition_id ?? '';
    if (!byEdition.has(k)) byEdition.set(k, []);
    byEdition.get(k)!.push(i);
  });
  for (const idx of byEdition.values()) {
    const sorted = idx.map((i) => blocks[i]).sort((a, b) => a.unit_index - b.unit_index);
    idx.forEach((i, j) => (blocks[i] = sorted[j]));
  }
  if (!blocks.length) throw new AppError('El día no tiene jornadas planeadas');

  await q(db.rpc('begin_competition_day'));
  // Si un arranque anterior se interrumpió a la mitad, se empieza limpio.
  await q(db.from('schedule_items').delete().eq('day_id', dayId));
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

  // Mínimo de eventos en vivo por día: si los derbis que pasaron el umbral no
  // alcanzan, se completan con los mejores partidos, repartidos entre todas las
  // jornadas del día para que siempre haya algo en vivo y sin huecos largos.
  // Ventana del día: desde el arranque hasta la hora de fin (México).
  const t0 = windowStart(day, mode);
  const deadline = dayDeadline(day.date, cal);
  const windowMin = Math.max(20, Math.floor((deadline - t0) / MIN) - 3);
  // Si se programó la hora de fin, todo se ajusta para acabar justo a esa hora;
  // si no, las ráfagas buscan terminar en ~5 h.
  const fit = (cal as { fitToDeadline?: boolean }).fitToDeadline === true;
  const dayTarget = fit ? windowMin : Math.min(windowMin, (cal as { targetDayMinutes?: number }).targetDayMinutes ?? 300);
  // Las rondas en vivo obligatorias (cuartos en adelante) van una tras otra al
  // final: se les reserva su tiempo y las ráfagas terminan antes.
  const mainLiveMin = lives.filter((l) => l.slot >= 0 || l.final).length * cal.liveEventMinutes;
  const targetMin = Math.max(15, dayTarget - mainLiveMin);
  const liveCap = Math.max(1, Math.floor(targetMin / cal.liveEventMinutes));
  const maxLives = Math.min(cal.maxLiveEventsPerDay, Math.max(liveCap, lives.length));
  // Vivos para cubrir el día: uno tras otro mientras corren las ráfagas.
  const minLives = Math.min(maxLives, Math.max(cal.minLiveEventsPerDay ?? 8, liveCap));
  if (lives.length < minLives && regular.length) {
    const chosen = new Set(lives.map((l) => l.matchId));
    const byBlock = new Map<string, { m: MatchDb; d: { score: number; name: string } }[]>();
    for (const m of regular) {
      const d = derbies.get(m.id);
      if (!d || chosen.has(m.id)) continue;
      const b = blocks.find((x) => x.edition_id === m.edition_id && x.unit_index === m.unit_index)!;
      if (!byBlock.has(b.id)) byBlock.set(b.id, []);
      byBlock.get(b.id)!.push({ m, d });
    }
    for (const list of byBlock.values()) list.sort((a, b) => b.d.score - a.d.score);
    // Ronda a ronda: el mejor de cada jornada, luego el segundo mejor, etc.
    const orderBlocks = blocks.filter((b) => byBlock.has(b.id));
    let need = minLives - lives.length;
    for (let r = 0; need > 0 && orderBlocks.some((b) => byBlock.get(b.id)!.length > r); r++) {
      const step = Math.max(1, Math.floor(orderBlocks.length / need));
      for (let i = 0; i < orderBlocks.length && need > 0; i += r === 0 ? step : 1) {
        const pick = byBlock.get(orderBlocks[i].id)![r];
        if (!pick || chosen.has(pick.m.id)) continue;
        const b = orderBlocks[i];
        const e = editions.get(b.edition_id)!;
        lives.push({ block: b, unit: e.state.units.find((u) => u.index === b.unit_index)!, matchId: pick.m.id, slot: -1, score: pick.d.score, name: pick.d.name, final: false });
        chosen.add(pick.m.id);
        const bu = burstUnits.find((x) => x.block.id === b.id);
        if (bu) bu.count--;
        need--;
      }
    }
  }

  // Máximo de eventos en vivo: los de menor interés pasan a ráfagas.
  lives.sort((a, b) => b.score - a.score);
  const kept = lives.slice(0, maxLives);
  for (const dropped of lives.slice(maxLives)) {
    const bu = burstUnits.find((x) => x.block.id === dropped.block.id);
    if (bu) bu.count++;
    else burstUnits.push({ block: dropped.block, unit: dropped.unit, count: 1 });
  }
  // Orden: por bloque del plan; las finales al último horario.
  kept.sort((a, b) => Number(a.final) - Number(b.final) || a.block.sort_order - b.block.sort_order || a.slot - b.slot);

  const items: Record<string, unknown>[] = [];
  const liveMinutes = cal.liveEventMinutes;
  const keptIds = new Set(kept);

  // Tamaño de ráfaga: el menor (desde burstMin) con el que todo termina en la
  // duración objetivo; con muchos partidos, las ráfagas crecen (resultados rápidos).
  const slots = Math.max(1, Math.floor(targetMin / cal.burstEveryMinutes) - 2);
  let size = cal.burstMin;
  const burstsFor = (n: number) => burstUnits.reduce((acc, b) => acc + Math.ceil(Math.max(0, b.count) / n), 0);
  while (size < 60 && burstsFor(size) > slots) size++;

  // Se recorre el plan en orden: las ráfagas avanzan cada 5 minutos y los
  // eventos en vivo van uno tras otro; una ronda en vivo arranca cuando ya
  // terminó todo lo anterior.
  let burstAt = 1; // minutos desde t0
  // Si otro día sigue en curso con vivos pendientes, los de este día van después.
  const otherLives = await q<{ scheduled_at: string }[]>(
    db.from('schedule_items').select('scheduled_at').neq('day_id', dayId).eq('kind', 'event').in('status', ['pending', 'running']).order('scheduled_at', { ascending: false }).limit(1),
  );
  const liveStart = otherLives[0] ? Math.max(1, Math.ceil((Date.parse(otherLives[0].scheduled_at) - t0) / MIN + cal.liveEventMinutes)) : 1;
  // Dos vivos a la vez solo si con uno no alcanza el tiempo del día.
  const tight = kept.length * liveMinutes > Math.max(1, windowMin - liveStart);
  const trackAt = tight ? [liveStart, 1] : [liveStart];
  let k = 0;
  const pushLive = (l: Live, at: number, track: number) => {
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
      ...(track > 0 ? { result: { track: track + 1 } } : {}),
    });
  };
  /** Siguiente hueco en la pista de vivos más libre, no antes de `from`. */
  const nextSlot = (l: Live, from: number) => {
    let t = 0;
    for (let i = 1; i < trackAt.length; i++) if (trackAt[i] < trackAt[t]) t = i;
    const at = Math.max(trackAt[t], from);
    trackAt[t] = at + liveMinutes;
    pushLive(l, at, t);
  };
  const livesEnd = () => Math.max(...trackAt);
  const finals = kept.filter((l) => l.final);
  for (const b of blocks) {
    const bu = burstUnits.find((x) => x.block.id === b.id);
    const blockLives = kept.filter((l) => l.block.id === b.id && !l.final);
    const isMainUnit = blockLives.some((l) => l.slot >= 0);
    if (isMainUnit) {
      // Ronda en vivo: arranca cuando terminó todo lo anterior.
      const from = Math.max(burstAt, livesEnd());
      for (const l of blockLives) nextSlot(l, from);
      burstAt = Math.max(burstAt, livesEnd());
    } else {
      // Derbis de jornada: en la siguiente franja libre de vivos, sin esperar.
      for (const l of blockLives) nextSlot(l, burstAt);
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
  // Las finales ocupan el último horario del día, una sola a la vez.
  let finalAt = Math.max(livesEnd(), burstAt);
  for (const l of finals) {
    pushLive(l, finalAt, 0);
    finalAt += liveMinutes;
  }
  const liveAt = livesEnd();
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
  // Hora de cada partido de ráfaga, en lote (miles de partidos en pocas llamadas).
  const keptMatch = new Set(kept.map((l) => l.matchId));
  const timeIds: string[] = [];
  const timeAt: string[] = [];
  const usedByBlock = new Map<string, number>();
  for (const it of items.filter((x) => x.kind === 'burst')) {
    const b = blocks.find((x) => x.id === it.block_id)!;
    const ms = unitMatches(b).filter((m) => !keptMatch.has(m.id));
    const before = usedByBlock.get(b.id) ?? 0;
    usedByBlock.set(b.id, before + (it.burst_size as number));
    for (const m of ms.slice(before, before + (it.burst_size as number))) {
      timeIds.push(m.id);
      timeAt.push(it.scheduled_at as string);
    }
  }
  for (let i = 0; i < timeIds.length; i += 1000) {
    await q(db.rpc('set_match_times', { p_ids: timeIds.slice(i, i + 1000), p_times: timeAt.slice(i, i + 1000) }));
  }
  await q(
    db.from('competition_days').update({
      announced: items.filter((x) => x.kind === 'event').map((x) => ({ name: x.label, at: x.scheduled_at })),
    }).eq('id', dayId),
  );
  return { lives: kept.length, bursts: k, startsAt: new Date(t0).toISOString() };
}

/** Garantiza que existan los partidos de una unidad (playoffs que dependen de la anterior). */
async function ensureUnit(db: DB, editionId: string, unitIndex: number): Promise<MatchDb[]> {
  // Solo los partidos de esa jornada (no toda la competición: miles de filas).
  const unit = (u: number) => all<MatchDb>(() => db.from('matches').select(MATCH_COLS).eq('edition_id', editionId).eq('unit_index', u).order('id'));
  let ms = await unit(unitIndex);
  if (ms.length) return ms;
  // Si falta algún partido de jornadas anteriores la ronda aún no puede armarse.
  // Se revisa barato antes de recalcular la competición (es lo más pesado y,
  // repetido cada 15 s, agotaba al servidor).
  const missing = await q<{ id: string }[]>(
    db.from('matches').select('id').eq('edition_id', editionId).lt('unit_index', unitIndex).neq('status', 'finished').limit(1),
  );
  if (missing.length) return [];
  const prev = await unit(unitIndex - 1);
  if (prev.length && prev.every((m) => m.status === 'finished')) {
    await closeUnits(db, editionId, [unitIndex - 1]);
    ms = await unit(unitIndex);
  }
  return ms;
}

async function postpone(db: DB, item: ScheduleItem, minutes: number) {
  await q(db.from('schedule_items').update({ scheduled_at: new Date(Date.now() + minutes * MIN).toISOString() }).eq('id', item.id));
}

const BURST_CAP = 12;

async function runBurst(db: DB, item: ScheduleItem): Promise<number> {
  const ms = await ensureUnit(db, item.edition_id!, item.unit_index!);
  if (!ms.length) {
    await postpone(db, item, 2);
    return 0;
  }
  const pending = ms.filter((m) => m.status === 'scheduled' && !m.is_main_event);
  if (!pending.length) {
    await q(db.from('schedule_items').update({ status: 'done', result: { matches: 0 } }).eq('id', item.id));
    return 0;
  }
  // La última ráfaga del bloque se lleva todo lo que quede de la jornada.
  // Sin bloque (ráfagas de rescate), la ráfaga se lleva todo lo de su jornada.
  const others = item.block_id
    ? await q<{ id: string }[]>(db.from('schedule_items').select('id').eq('block_id', item.block_id).eq('kind', 'burst').eq('status', 'pending').neq('id', item.id))
    : [];
  const want = others.length ? Math.min(pending.length, item.burst_size ?? 4) : pending.length;
  // El servidor da muy poco procesador por vuelta: se simulan a lo más BURST_CAP
  // partidos y, si la ráfaga es más grande, el resto sale en la siguiente vuelta (15 s).
  const pick = pending.slice(0, Math.min(want, BURST_CAP));
  const leftover = want - pick.length;
  const e = await q<EditionRow>(db.from('editions').select('*').eq('id', item.edition_id).single());
  const teamIds = pick.flatMap((m) => [m.home_team_id, m.away_team_id]);
  const ctx = await loadContext(db, teamIds);
  await countGamesToday(db, ctx.gamesToday, item.day_id, teamIds);
  const payloads: SimPayload[] = [];
  for (const m of pick) payloads.push((await simulate(ctx, m, e, false)).payload);
  if (leftover > 0) {
    // Se guarda lo jugado y la ráfaga sigue pendiente con lo que falta.
    await q(db.from('schedule_items').update({ burst_size: leftover, scheduled_at: new Date().toISOString() }).eq('id', item.id));
    await commitResults(db, payloads);
    return pick.length;
  }
  await commitResults(db, payloads);
  // Si quedan partidos normales de la unidad sin ráfaga asignada, este bloque los absorbe después.
  await q(
    db.from('schedule_items').update({
      status: 'done',
      match_ids: pick.map((m) => m.id),
      result: { matches: pick.length, scores: payloads.map((p) => ({ id: p.matchId, h: p.homeTeamId, a: p.awayTeamId, hs: p.homeScore, as: p.awayScore, ot: p.overtime })) },
    }).eq('id', item.id),
  );
  return pick.length;
}

/** Partidos que ya jugó hoy cada equipo (para el cansancio), solo de los equipos que juegan. */
async function countGamesToday(db: DB, map: Map<string, number>, dayId: string, teamIds: string[]) {
  const ids = [...new Set(teamIds)];
  if (!ids.length) return;
  const day = await q<{ started_at: string | null }>(db.from('competition_days').select('started_at').eq('id', dayId).single());
  const since = day.started_at ?? new Date(Date.now() - 12 * 3600_000).toISOString();
  const list = ids.join(',');
  const ms = await all<{ home_team_id: string; away_team_id: string }>(() =>
    db.from('matches').select('home_team_id,away_team_id').eq('status', 'finished').gte('finished_at', since).or(`home_team_id.in.(${list}),away_team_id.in.(${list})`),
  );
  const want = new Set(ids);
  for (const m of ms) for (const t of [m.home_team_id, m.away_team_id]) if (want.has(t)) map.set(t, (map.get(t) ?? 0) + 1);
}

async function startLive(db: DB, item: ScheduleItem): Promise<void> {
  // Nunca dos eventos en vivo a la vez.
  // Un vivo a la vez; dos solo cuando el horario está apretado (hay vivos en la segunda pista).
  const live = await q<{ id: string }[]>(db.from('schedule_items').select('id').eq('kind', 'event').eq('status', 'running'));
  if (live.length) {
    const second = await q<{ id: string }[]>(db.from('schedule_items').select('id').eq('kind', 'event').in('status', ['pending', 'running']).eq('result->>track', '2').limit(1));
    if (live.length >= (second.length ? 2 : 1)) return postpone(db, item, 1);
  }
  // Rondas de eliminación: nunca antes que la ronda anterior de su competición
  // (ida antes que vuelta). Los clásicos de liga no esperan.
  if (!item.match_id && item.edition_id != null && item.unit_index != null) {
    const earlier = await q<{ id: string; status: string; scheduled_at: string; match_id: string | null }[]>(
      db.from('schedule_items').select('id,status,scheduled_at,match_id').eq('kind', 'event').eq('edition_id', item.edition_id).lt('unit_index', item.unit_index).in('status', ['pending', 'running']).order('scheduled_at').limit(50),
    );
    if (earlier.length) {
      // Si la ronda anterior quedó programada después (por ejemplo, semis antes que
      // cuartos), se intercambian los turnos: la anterior juega ya y nadie espera en vano.
      const first = earlier.find((x) => x.status === 'pending');
      if (!earlier.some((x) => x.status === 'running') && first && Date.parse(first.scheduled_at) > Date.parse(item.scheduled_at)) {
        await q(db.from('schedule_items').update({ scheduled_at: item.scheduled_at }).eq('id', first.id));
        await q(db.from('schedule_items').update({ scheduled_at: first.scheduled_at }).eq('id', item.id));
        if (first.match_id) await q(db.from('matches').update({ scheduled_at: item.scheduled_at }).eq('id', first.match_id));
        return;
      }
      return postpone(db, item, 1);
    }
  }
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
  // Dos vivos a la vez solo con equipos distintos: un equipo no juega dos partidos al mismo tiempo.
  const onAir = await q<{ home_team_id: string; away_team_id: string }[]>(db.from('matches').select('home_team_id,away_team_id').eq('status', 'live'));
  const busy = new Set(onAir.flatMap((x) => [x.home_team_id, x.away_team_id]));
  if (busy.has(m.home_team_id) || busy.has(m.away_team_id)) return postpone(db, item, 1);
  const e = await q<EditionRow>(db.from('editions').select('*').eq('id', m.edition_id).single());
  const ctx = await loadContext(db, [m.home_team_id, m.away_team_id]);
  await countGamesToday(db, ctx.gamesToday, item.day_id, [m.home_team_id, m.away_team_id]);
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
  // Si el resultado ya se guardó (una vuelta anterior se cortó a la mitad), solo se cierra.
  if (m.status === 'finished') {
    await q(db.from('schedule_items').update({ status: 'done', result: { matches: 1, hs: m.home_score, as: m.away_score } }).eq('id', item.id));
    return;
  }
  const secret = await q<{ pending_result: SimPayload | null }>(db.from('match_secrets').select('pending_result').eq('match_id', m.id).single());
  const payload = secret.pending_result;
  if (!payload) {
    // Sin resultado guardado: se vuelve a jugar como evento (no debería pasar).
    await q(db.from('matches').update({ status: 'scheduled', started_at: null }).eq('id', m.id));
    await q(db.from('schedule_items').update({ status: 'pending', scheduled_at: new Date(Date.now() + MIN).toISOString() }).eq('id', item.id));
    return;
  }
  // Primero se marca en la agenda; así un corte después no deja el vivo atorado.
  await q(db.from('schedule_items').update({ status: 'done', result: { matches: 1, hs: payload.homeScore, as: payload.awayScore } }).eq('id', item.id));
  await commitResults(db, [payload]);
  const e = await q<EditionRow>(db.from('editions').select('*').eq('id', m.edition_id).single());
  const fin = await q<MatchDb>(db.from('matches').select(MATCH_COLS).eq('id', m.id).single());
  const names = new Map(payload.players.map((p) => [p.playerId, p.name ?? '']));
  await newsLiveEvent(db, fin, e, payload.goals.map((g) => names.get(g.scorerId) ?? ''), payload.mvpId ? names.get(payload.mvpId) ?? null : null).catch(() => undefined);
}

/** Ejecuta lo que toca ahora. La llama la tarea programada cada minuto. */
/** Arranque automático: el día planeado de hoy empieza a las 8:00 (México) si no hay otro en curso. */
async function autoStart(db: DB): Promise<string | null> {
  const cal = { ...DEFAULT_CALENDAR, ...(await getSetting<Partial<CalendarSettings> & { autoStart?: boolean }>(db, 'calendar', {})) };
  if ((cal as { autoStart?: boolean }).autoStart === false) return null;
  // Un día en pausa lo detiene todo (el administrador lo pausó a propósito).
  const paused = await q<{ id: string }[]>(db.from('competition_days').select('id').eq('status', 'paused'));
  if (paused.length) return null;
  const nowMx = new Date(Date.now() - 6 * 3600_000);
  const today = nowMx.toISOString().slice(0, 10);
  if (nowMx.getUTCHours() < 8) return null;
  // El más antiguo pendiente: si un día planeado se quedó sin jugar, se juega ahora.
  const day = (await q<{ id: string }[]>(db.from('competition_days').select('id').lte('date', today).eq('status', 'planned').order('date').limit(1)))[0];
  if (!day) return null;
  const blocks = await q<{ id: string }[]>(db.from('plan_blocks').select('id').eq('day_id', day.id).limit(1));
  if (!blocks.length) return null;
  await startDay(db, day.id, 'now');
  return day.id;
}

export async function tick(db: DB, budgetMs = 20_000) {
  const t = Date.now();
  // Una sola ejecución a la vez: el motor despierta cada 15 s.
  const { data: got } = await db.rpc('acquire_tick_lease', { p_seconds: 45 });
  if (got === false) return { ran: [], busy: true, ms: 0 };
  try {
    return await tickInner(db, budgetMs, t);
  } finally {
    await db.rpc('release_tick_lease');
  }
}

async function tickInner(db: DB, budgetMs: number, t: number) {
  const started = await autoStart(db).catch((e) => {
    console.error('autoStart', e);
    return null;
  });
  const orphaned = await scheduleOrphans(db).catch((e) => {
    console.error('scheduleOrphans', e);
    return 0;
  });
  const days = await q<DayRow[]>(db.from('competition_days').select('*').eq('status', 'running'));
  const log: string[] = orphaned ? [`huérfanos:${orphaned}`] : [];
  for (const day of days) {
    // Eventos en vivo que ya terminaron.
    const running = await q<ScheduleItem[]>(db.from('schedule_items').select('*').eq('day_id', day.id).eq('status', 'running'));
    for (const it of running) {
      try {
        await finishLive(db, it);
      } catch (e) {
        console.error('finishLive', it.id, e);
        log.push(`error:${it.label}`);
      }
    }

    // Pocas tareas por vuelta: el servidor corta las ejecuciones que gastan mucho
    // procesador; el motor despierta cada 15 s, así que no se pierde ritmo.
    let simulated = 0;
    // Primero las ráfagas (resultados), luego vivos y cierre: un vivo que aún
    // no puede empezar no le quita turno a los resultados.
    const skip = new Set<string>();
    const editionCache = new Map<string, { start?: string; playoff: Set<number> }>();
    for (let guard = 0; guard < 12 && Date.now() - t < budgetMs; guard++) {
      const nowIso = new Date().toISOString();
      let due = simulated < BURST_CAP
        ? await q<ScheduleItem[]>(db.from('schedule_items').select('*').eq('day_id', day.id).eq('status', 'pending').eq('kind', 'burst').lte('scheduled_at', nowIso).order('scheduled_at').limit(5))
        : [];
      due = due.filter((d) => !skip.has(d.id));
      if (!due.length) {
        due = (await q<ScheduleItem[]>(db.from('schedule_items').select('*').eq('day_id', day.id).eq('status', 'pending').neq('kind', 'burst').lte('scheduled_at', nowIso).order('scheduled_at').limit(10))).filter((d) => !skip.has(d.id));
      }
      const item = due[0];
      if (!item) break;
      skip.add(item.id);
      if (item.kind === 'burst' || item.kind === 'event') {
        // Eliminatorias con fecha de inicio posterior a este día: se van a su fecha.
        if (item.edition_id && item.unit_index != null && (await beforePlayoffDate(db, item, day.date, editionCache))) {
          await enforcePlayoffStart(db, item.edition_id);
          const fresh = await q<{ status: string }[]>(db.from('schedule_items').select('status').eq('id', item.id));
          if (!fresh[0] || fresh[0].status !== 'pending') {
            log.push(`aplazado:${item.label}`);
            continue;
          }
        }
        try {
          if (item.kind === 'burst') simulated += await runBurst(db, item);
          else await startLive(db, item);
        } catch (e) {
          // Un elemento con problemas no frena la fila: se reintenta en 2 minutos.
          console.error('item', item.id, e);
          log.push(`error:${item.label}`);
          await postpone(db, item, 2).catch(() => undefined);
          continue;
        }
      } else if (item.kind === 'summary') {
        const left = await q<{ scheduled_at: string }[]>(
          db.from('schedule_items').select('scheduled_at').eq('day_id', day.id).in('status', ['pending', 'running']).neq('kind', 'summary').order('scheduled_at', { ascending: false }).limit(1),
        );
        if (left.length) {
          // Aún hay trabajo: el cierre se mueve detrás de lo último y la fila sigue.
          const after = Math.max(Date.now(), Date.parse(left[0].scheduled_at)) + 2 * MIN;
          await q(db.from('schedule_items').update({ scheduled_at: new Date(after).toISOString() }).eq('id', item.id));
          continue;
        }
        await q(db.from('schedule_items').update({ status: 'done' }).eq('id', item.id));
        await closeDay(db, day.id);
        break;
      }
      // Lo que no pudo correr se pospuso a un minuto futuro: la cola sigue con lo demás.
      const fresh = await q<ScheduleItem>(db.from('schedule_items').select('status').eq('id', item.id).single());
      if (fresh.status !== 'pending') log.push(`${item.kind}:${item.label}`);
    }
  }
  return { ran: log, started, ms: Date.now() - t };
}

/** ¿Es una ronda de eliminatorias que, por su fecha de inicio, aún no toca este día? */
async function beforePlayoffDate(db: DB, item: ScheduleItem, date: string, cache: Map<string, { start?: string; playoff: Set<number> }>) {
  let info = cache.get(item.edition_id!);
  if (!info) {
    const e = await q<{ config: Record<string, unknown>; state: { units?: Unit[] } }>(db.from('editions').select('config,state').eq('id', item.edition_id!).single());
    info = {
      start: e.config.playoffStart as string | undefined,
      playoff: new Set((e.state.units ?? []).filter((u) => u.stage === 'playoff').map((u) => u.index)),
    };
    cache.set(item.edition_id!, info);
  }
  return !!info.start && date < info.start && info.playoff.has(item.unit_index!);
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

/**
 * Reanuda: el evento en vivo que estaba en curso se recorre lo que duró la
 * pausa, y todo lo pendiente se reacomoda desde ahora con el ritmo actual
 * (ráfagas cada pocos minutos y vivos uno tras otro, sin huecos).
 */
export async function resumeDay(db: DB, dayId: string) {
  const day = await q<DayRow>(db.from('competition_days').select('*').eq('id', dayId).single());
  if (day.status !== 'paused') throw new AppError('El día no está en pausa');
  const pausedMs = Date.now() - Date.parse(day.closed_at ?? new Date().toISOString());
  const items = await q<ScheduleItem[]>(db.from('schedule_items').select('*').eq('day_id', dayId).in('status', ['pending', 'running']));
  let liveBusyUntil = Date.now();
  for (const it of items.filter((x) => x.status === 'running' && x.match_id)) {
    const m = await q<{ started_at: string }>(db.from('matches').select('started_at').eq('id', it.match_id!).single());
    const started = Date.parse(m.started_at) + pausedMs;
    await q(db.from('matches').update({ started_at: new Date(started).toISOString() }).eq('id', it.match_id!));
    liveBusyUntil = Math.max(liveBusyUntil, started + (await liveMinutesOf(db)) * MIN);
  }
  await q(db.from('competition_days').update({ status: 'running', closed_at: null }).eq('id', dayId));
  await compactDay(db, dayId, liveBusyUntil);
}

async function liveMinutesOf(db: DB) {
  const cal = { ...DEFAULT_CALENDAR, ...(await getSetting<Partial<CalendarSettings>>(db, 'calendar', {})) };
  return cal.liveEventMinutes;
}

/**
 * Reacomoda lo pendiente del día desde ahora. Con `deadline`, el ritmo de las
 * ráfagas se aprieta (hasta 4 por minuto) para que todo acabe a esa hora.
 */
export async function compactDay(db: DB, dayId: string, liveFrom = Date.now(), deadline?: number) {
  const cal = { ...DEFAULT_CALENDAR, ...(await getSetting<Partial<CalendarSettings>>(db, 'calendar', {})) };
  const pending = (await q<ScheduleItem[]>(db.from('schedule_items').select('*').eq('day_id', dayId).eq('status', 'pending'))).sort(
    (a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at) || a.sort_order - b.sort_order,
  );
  const start = Date.now() + 0.25 * MIN;
  let every = cal.burstEveryMinutes;
  if (deadline) {
    const bursts = pending.filter((i) => i.kind === 'burst').length;
    const mainLives = pending.filter((i) => i.kind === 'event' && !i.match_id).length;
    const avail = (deadline - start) / MIN - mainLives * cal.liveEventMinutes - 3;
    if (bursts) every = Math.max(0.25, Math.min(cal.burstEveryMinutes, avail / bursts));
  }
  let burstAt = start;
  const events = pending.filter((i) => i.kind === 'event').length;
  // Dos pistas de vivos solo si con una no se llega a la hora de fin.
  const twoTracks = !!deadline && events * cal.liveEventMinutes * MIN > deadline - Math.max(liveFrom, start);
  const tracks = twoTracks ? [Math.max(liveFrom, start), start] : [Math.max(liveFrom, start)];
  let end = burstAt;
  const ids: string[] = [];
  const times: string[] = [];
  for (const it of pending) {
    let at: number;
    let track = 0;
    if (it.kind === 'burst') {
      at = burstAt;
      burstAt += every * MIN;
    } else if (it.kind === 'event') {
      for (let i = 1; i < tracks.length; i++) if (tracks[i] < tracks[track]) track = i;
      at = Math.max(tracks[track], burstAt - every * MIN);
      tracks[track] = at + cal.liveEventMinutes * MIN;
    } else continue;
    end = Math.max(end, it.kind === 'event' ? Math.max(...tracks) : burstAt);
    const iso = new Date(at).toISOString();
    await q(db.from('schedule_items').update({ scheduled_at: iso, ...(it.kind === 'event' ? { result: track > 0 ? { track: 2 } : null } : {}) }).eq('id', it.id));
    if (it.match_id) {
      ids.push(it.match_id);
      times.push(iso);
    }
  }
  if (ids.length) await q(db.rpc('set_match_times', { p_ids: ids, p_times: times }));
  for (const it of pending.filter((x) => x.kind === 'summary')) {
    await q(db.from('schedule_items').update({ scheduled_at: new Date(end + 1 * MIN).toISOString() }).eq('id', it.id));
  }
  return { end: new Date(end).toISOString(), burstEveryMinutes: every };
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

/**
 * Convierte un partido en evento en vivo (o lo regresa a normal). Si su jornada
 * está en el día en curso, entra de inmediato a la fila de vivos (o a una ráfaga).
 */
export async function setMatchEvent(db: DB, matchId: string, on: boolean, name?: string) {
  const m = await q<MatchDb>(db.from('matches').select(MATCH_COLS).eq('id', matchId).single());
  if (m.status !== 'scheduled') throw new AppError('Ese partido ya se jugó o está en vivo');
  const teams = await q<{ id: string; name: string }[]>(db.from('teams').select('id,name').in('id', [m.home_team_id, m.away_team_id]));
  const tn = (id: string) => teams.find((t) => t.id === id)?.name ?? '';
  await q(
    db.from('matches').update({
      is_main_event: on,
      event_name: on ? (name ?? `Evento del momento · ${tn(m.home_team_id)} vs ${tn(m.away_team_id)}`) : null,
    }).eq('id', matchId),
  );

  const days = await q<DayRow[]>(db.from('competition_days').select('*').in('status', ['running', 'paused']));
  const day = days[0];
  if (!day) return { scheduled: null };
  const block = (await q<Block[]>(db.from('plan_blocks').select('*').eq('day_id', day.id).eq('edition_id', m.edition_id).eq('unit_index', m.unit_index)))[0];
  if (!block) return { scheduled: null }; // su jornada se juega otro día: saldrá en vivo ese día
  const cal = { ...DEFAULT_CALENDAR, ...(await getSetting<Partial<CalendarSettings>>(db, 'calendar', {})) };
  const items = await q<ScheduleItem[]>(db.from('schedule_items').select('*').eq('day_id', day.id).in('status', ['pending', 'running']));

  if (on) {
    if (items.some((i) => i.match_id === matchId)) return { scheduled: items.find((i) => i.match_id === matchId)!.scheduled_at };
    // Siguiente hueco libre en la fila de vivos.
    const lives = items.filter((i) => i.kind === 'event');
    let at = Date.now() + MIN;
    for (const l of lives) {
      const start = Date.parse(l.scheduled_at);
      const startedAt = l.status === 'running' && l.match_id ? Date.now() : start;
      at = Math.max(at, startedAt + cal.liveEventMinutes * MIN);
    }
    const iso = new Date(at).toISOString();
    await insertMany(db, 'schedule_items', [
      { day_id: day.id, kind: 'event', block_id: block.id, edition_id: m.edition_id, unit_index: m.unit_index, match_id: matchId, sort_order: -1, scheduled_at: iso, label: on ? (name ?? `Evento del momento · ${tn(m.home_team_id)} vs ${tn(m.away_team_id)}`) : '' },
    ]);
    await q(db.from('matches').update({ scheduled_at: iso }).eq('id', matchId));
    // El cierre del día espera a este vivo.
    for (const s of items.filter((i) => i.kind === 'summary' && i.status === 'pending')) {
      if (Date.parse(s.scheduled_at) < at + (cal.liveEventMinutes + 2) * MIN) {
        await q(db.from('schedule_items').update({ scheduled_at: new Date(at + (cal.liveEventMinutes + 2) * MIN).toISOString() }).eq('id', s.id));
      }
    }
    return { scheduled: iso };
  }

  // Quitar: se cancela su vivo pendiente y entra en la siguiente ráfaga de su jornada.
  for (const it of items.filter((i) => i.match_id === matchId && i.status === 'pending')) {
    await q(db.from('schedule_items').update({ status: 'cancelled' }).eq('id', it.id));
  }
  const pendingBurst = items.find((i) => i.kind === 'burst' && i.status === 'pending' && i.block_id === block.id);
  if (!pendingBurst) {
    const iso = new Date(Date.now() + MIN).toISOString();
    await insertMany(db, 'schedule_items', [
      { day_id: day.id, kind: 'burst', block_id: block.id, edition_id: m.edition_id, unit_index: m.unit_index, burst_size: 1, sort_order: 999, scheduled_at: iso, label: block.label },
    ]);
  }
  return { scheduled: null };
}

/**
 * Reacomoda todos los vivos pendientes de los días en curso:
 * 1) clásicos de liga (la temporada regular debe terminar antes de su liguilla),
 * 2) eliminatorias ronda por ronda (cada ronda espera a la anterior de su torneo),
 * 3) finales al final, una sola a la vez.
 * Usa dos pistas solo si con una no se llega a la hora de fin.
 */
export async function resequenceLives(db: DB) {
  const cal = { ...DEFAULT_CALENDAR, ...(await getSetting<Partial<CalendarSettings>>(db, 'calendar', {})) };
  const days = await q<{ id: string }[]>(db.from('competition_days').select('id').in('status', ['running', 'paused']));
  if (!days.length) return { items: 0 };
  const dayIds = days.map((d) => d.id);
  const items = await q<ScheduleItem[]>(db.from('schedule_items').select('*').in('day_id', dayIds).eq('kind', 'event').in('status', ['pending', 'running']));
  const matchIds = items.map((i) => i.match_id).filter(Boolean) as string[];
  const ms = matchIds.length ? await q<{ id: string; stage: string; started_at: string | null }[]>(db.from('matches').select('id,stage,started_at').in('id', matchIds)) : [];
  const stage = new Map(ms.map((m) => [m.id, m]));
  const L = cal.liveEventMinutes * MIN;
  const now = Date.now();

  const running = items.filter((i) => i.status === 'running');
  const pending = items.filter((i) => i.status === 'pending');
  const isFinal = (i: ScheduleItem) => /· Final$/.test(i.label ?? '');
  const isMain = (i: ScheduleItem) => !i.match_id || stage.get(i.match_id)?.stage === 'playoff';
  const derbies = pending.filter((i) => !isMain(i)).sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at));
  const rounds = pending.filter((i) => isMain(i) && !isFinal(i)).sort((a, b) => (a.unit_index ?? 0) - (b.unit_index ?? 0) || a.sort_order - b.sort_order);
  const finals = pending.filter(isFinal);

  const deadline = dayDeadline(new Date(now - 6 * 3600_000).toISOString().slice(0, 10), cal);
  const tight = (derbies.length + rounds.length) * L + finals.length * L > deadline - now;
  // Pistas: libres cuando termine lo que ya está en vivo.
  const tracks: number[] = [];
  for (const r of running) {
    const st = r.match_id ? Date.parse(stage.get(r.match_id)?.started_at ?? r.scheduled_at) : now;
    tracks.push(st + L);
  }
  while (tracks.length < (tight ? 2 : 1)) tracks.push(now + 0.25 * MIN);
  if (tracks.length > (tight ? 2 : 1)) tracks.sort((a, b) => a - b);
  const nTracks = tight ? 2 : 1;

  const editionEnd = new Map<string, number>(); // fin de lo ya asignado por torneo
  const unitEnd = new Map<string, number>(); // `${edition}|${unit}` -> fin
  const updates: { id: string; at: number; track: number }[] = [];
  const place = (it: ScheduleItem, notBefore: number) => {
    let t = 0;
    for (let i = 1; i < nTracks; i++) if (tracks[i] < tracks[t]) t = i;
    const at = Math.max(tracks[t], notBefore);
    tracks[t] = at + L;
    updates.push({ id: it.id, at, track: t });
    const e = it.edition_id ?? '';
    editionEnd.set(e, Math.max(editionEnd.get(e) ?? 0, at + L));
    const k = `${e}|${it.unit_index}`;
    unitEnd.set(k, Math.max(unitEnd.get(k) ?? 0, at + L));
  };
  for (const it of derbies) place(it, now);
  // Lo ya en vivo cuenta para su torneo.
  for (const r of running) {
    const e = r.edition_id ?? '';
    const end = (r.match_id ? Date.parse(stage.get(r.match_id)?.started_at ?? r.scheduled_at) : now) + L;
    editionEnd.set(e, Math.max(editionEnd.get(e) ?? 0, end));
  }
  for (const it of rounds) {
    const e = it.edition_id ?? '';
    // Espera a todo lo anterior de su torneo (clásicos y rondas previas), no a su propia ronda.
    let nb = now;
    for (const [k, end] of unitEnd) {
      const [ke, ku] = k.split('|');
      if (ke === e && Number(ku) < (it.unit_index ?? 0)) nb = Math.max(nb, end);
    }
    for (const d of derbies) if (d.edition_id === e) nb = Math.max(nb, unitEnd.get(`${e}|${d.unit_index}`) ?? 0);
    place(it, nb);
  }
  // Finales: una tras otra, al final de todo.
  let fAt = Math.max(...tracks, ...[...editionEnd.values()]);
  for (const it of finals.sort((a, b) => (a.unit_index ?? 0) - (b.unit_index ?? 0))) {
    updates.push({ id: it.id, at: fAt, track: 0 });
    fAt += L;
  }
  for (const u of updates) {
    await q(db.from('schedule_items').update({ scheduled_at: new Date(u.at).toISOString(), result: u.track > 0 ? { track: 2 } : null }).eq('id', u.id));
  }
  const byId = new Map(items.map((i) => [i.id, i]));
  const ids = updates.map((u) => byId.get(u.id)?.match_id).filter(Boolean) as string[];
  const times = updates.filter((u) => byId.get(u.id)?.match_id).map((u) => new Date(u.at).toISOString());
  if (ids.length) await q(db.rpc('set_match_times', { p_ids: ids, p_times: times }));
  // Cierre de cada día después de su último vivo.
  for (const d of dayIds) {
    const last = Math.max(now, ...updates.filter((u) => byId.get(u.id)?.day_id === d).map((u) => u.at + L));
    await q(db.from('schedule_items').update({ scheduled_at: new Date(last + MIN).toISOString() }).eq('day_id', d).eq('kind', 'summary').eq('status', 'pending'));
  }
  return { items: updates.length, tracks: nTracks, endsAt: new Date(fAt).toISOString() };
}

/**
 * Partidos huérfanos: de temporada regular, sin jugar y sin ningún elemento
 * pendiente que los vaya a jugar (por ejemplo, de un día que se cerró antes de
 * tiempo). Sin ellos la liguilla nunca puede empezar: se meten en ráfagas ya.
 */
export async function scheduleOrphans(db: DB) {
  const days = await q<{ id: string }[]>(db.from('competition_days').select('id').eq('status', 'running').order('date', { ascending: false }).limit(1));
  if (!days[0]) return 0;
  const open = await q<{ edition_id: string | null; unit_index: number | null; match_id: string | null }[]>(
    db.from('schedule_items').select('edition_id,unit_index,match_id').in('status', ['pending', 'running']),
  );
  const covered = new Set(open.map((i) => `${i.edition_id}|${i.unit_index}`));
  const coveredMatch = new Set(open.map((i) => i.match_id).filter(Boolean));
  const ms = await all<{ id: string; edition_id: string; unit_index: number; is_main_event: boolean; stage: string }>(() =>
    db.from('matches').select('id,edition_id,unit_index,is_main_event,stage').eq('status', 'scheduled').neq('stage', 'playoff'),
  );
  // Solo es huérfano lo que SÍ se planeó en un día que ya cerró sin jugarlo. Lo que
  // nunca se planeó (por ejemplo, un torneo arrancado pero que no elegiste para
  // ningún día) no se toca: se juega cuando tú lo pongas en el calendario.
  const closed = (await q<{ id: string }[]>(db.from('competition_days').select('id').eq('status', 'closed'))).map((d) => d.id);
  const plannedInClosed = closed.length
    ? await all<{ edition_id: string; unit_index: number }>(() => db.from('plan_blocks').select('edition_id,unit_index').in('day_id', closed))
    : [];
  const wasPlanned = new Set(plannedInClosed.map((b) => `${b.edition_id}|${b.unit_index}`));
  const orphans = ms.filter((m) => wasPlanned.has(`${m.edition_id}|${m.unit_index}`) && !covered.has(`${m.edition_id}|${m.unit_index}`) && !coveredMatch.has(m.id));
  if (!orphans.length) return 0;
  // Derbis huérfanos pasan a ráfaga (su transmisión ya no se programó).
  const mainIds = orphans.filter((m) => m.is_main_event).map((m) => m.id);
  if (mainIds.length) await q(db.from('matches').update({ is_main_event: false }).in('id', mainIds));
  const units = new Map<string, { edition_id: string; unit_index: number; n: number }>();
  for (const m of orphans) {
    const k = `${m.edition_id}|${m.unit_index}`;
    const u = units.get(k) ?? { edition_id: m.edition_id, unit_index: m.unit_index, n: 0 };
    u.n++;
    units.set(k, u);
  }
  const eds = await q<{ id: string; name: string }[]>(db.from('editions').select('id,name').in('id', [...new Set(orphans.map((m) => m.edition_id))]));
  const name = new Map(eds.map((e) => [e.id, e.name.split(' · ')[0]]));
  const now = Date.now();
  const rows = [...units.values()]
    .sort((a, b) => a.unit_index - b.unit_index)
    .map((u, i) => ({
      day_id: days[0].id,
      kind: 'burst',
      edition_id: u.edition_id,
      unit_index: u.unit_index,
      burst_size: u.n,
      sort_order: -100 + i,
      scheduled_at: new Date(now - 60_000 + i * 1000).toISOString(),
      label: `${name.get(u.edition_id)} · Jornada ${u.unit_index + 1} (pendiente)`,
    }));
  await insertMany(db, 'schedule_items', rows);
  return orphans.length;
}
