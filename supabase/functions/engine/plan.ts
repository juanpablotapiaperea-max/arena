// Planificador semanal: reparte jornadas y rondas entre días buscando un
// interés parecido por día, respetando el orden de cada competición.
import { AppError, all, getSetting, insertMany, q, type DB } from './db.ts';
import type { EditionRow, MatchDb } from './types.ts';
import type { Unit } from '../../../shared/competition/edition.ts';

interface PlanBlock {
  id: string;
  day_id: string;
  edition_id: string | null;
  kind: string;
  unit_index: number | null;
  label: string;
  sort_order: number;
  interest: number;
  matches_count: number;
  live_count: number;
  status: string;
}

export interface CalendarSettings {
  burstEveryMinutes: number;
  burstMin: number;
  burstMax: number;
  liveEventMinutes: number;
  maxLiveEventsPerDay: number;
  maxEventsPerDay: number;
  derbyThreshold: number;
  maxMatchesPerDay?: number;
  minLiveEventsPerDay?: number;
}

export const DEFAULT_CALENDAR: CalendarSettings = {
  burstEveryMinutes: 2,
  burstMin: 5,
  burstMax: 8,
  liveEventMinutes: 6,
  maxLiveEventsPerDay: 40,
  maxEventsPerDay: 40,
  derbyThreshold: 70,
  maxMatchesPerDay: 800,
  minLiveEventsPerDay: 30,
};

/** Puntaje de interés de una jornada o ronda (0-100). */
export function unitInterest(unit: Unit, totalUnits: number, weight: number): number {
  const w = Math.min(1, weight / 3);
  if (unit.stage === 'playoff') {
    const byRound: Record<string, number> = { previa: 35, dieciseisavos: 40, octavos: 50, cuartos: 70, semifinal: 85, final: 100 };
    return Math.round((byRound[unit.round ?? 'previa'] ?? 40) * (0.7 + 0.3 * w));
  }
  // Las últimas jornadas de la fase regular importan más.
  const regular = Math.max(1, totalUnits);
  const progress = unit.index / regular;
  return Math.round((12 + 18 * progress) * (0.6 + 0.4 * w));
}

const liveOf = (u: Unit) => (u.main ? u.matches : 0);

async function editionsWithUnits(db: DB, editionIds: string[]) {
  const eds = await q<EditionRow[]>(db.from('editions').select('*').in('id', editionIds).neq('status', 'finished'));
  const planned = await all<{ edition_id: string; unit_index: number }>(() =>
    db.from('plan_blocks').select('edition_id,unit_index').in('edition_id', editionIds),
  );
  const done = await all<{ edition_id: string; unit_index: number; status: string }>(() =>
    db.from('matches').select('edition_id,unit_index,status').in('edition_id', editionIds).neq('status', 'finished'),
  );
  return eds.map((e) => {
    const units = e.state.units ?? [];
    const plannedSet = new Set(planned.filter((p) => p.edition_id === e.id).map((p) => p.unit_index));
    const finishedUnits = new Set(units.map((u) => u.index));
    // una unidad está terminada si tiene partidos y ninguno pendiente; las que no tienen partidos aún no lo están
    const pendingByUnit = new Set(done.filter((d) => d.edition_id === e.id).map((d) => d.unit_index));
    const regularCount = units.filter((u) => u.stage !== 'playoff').length || units.length;
    const pending = units.filter((u) => !plannedSet.has(u.index) && (pendingByUnit.has(u.index) || !finishedUnits.has(u.index) || true));
    return { edition: e, units, pending, regularCount };
  });
}

/**
 * Genera el plan de varios días. Reemplaza los bloques de días aún no iniciados
 * de esas fechas. Devuelve el plan resultante.
 */
export async function generatePlan(db: DB, dates: string[], editionIds: string[]) {
  if (!dates.length || !editionIds.length) throw new AppError('Elige al menos un día y una competición');
  const cal = { ...DEFAULT_CALENDAR, ...(await getSetting<Partial<CalendarSettings>>(db, 'calendar', {})) };

  // Días: crear o reutilizar (solo los planeados se pueden rehacer).
  const existing = await q<{ id: string; date: string; status: string }[]>(db.from('competition_days').select('id,date,status').in('date', dates));
  for (const d of existing) if (d.status !== 'planned') throw new AppError(`El día ${d.date} ya empezó; no se puede replanear`);
  if (existing.length) await q(db.from('plan_blocks').delete().in('day_id', existing.map((d) => d.id)));
  const toCreate = dates.filter((d) => !existing.some((e) => e.date === d));
  const created = toCreate.length
    ? await insertMany<{ id: string; date: string }>(db, 'competition_days', toCreate.map((date) => ({ date, status: 'planned' })), 'id,date')
    : [];
  const days = [...existing, ...created].sort((a, b) => a.date.localeCompare(b.date));

  // Unidades pendientes (sin planear y sin terminar).
  const unfinished = await all<{ edition_id: string; unit_index: number }>(() =>
    db.from('matches').select('edition_id,unit_index').in('edition_id', editionIds).neq('status', 'finished'),
  );
  const finishedAny = await all<{ edition_id: string; unit_index: number }>(() =>
    db.from('matches').select('edition_id,unit_index').in('edition_id', editionIds).eq('status', 'finished'),
  );
  const planned = await all<{ edition_id: string; unit_index: number }>(() =>
    db.from('plan_blocks').select('edition_id,unit_index').in('edition_id', editionIds),
  );
  const eds = await q<EditionRow[]>(db.from('editions').select('*').in('id', editionIds).neq('status', 'finished'));

  const queues = eds.map((e) => {
    const units: Unit[] = e.state.units ?? [];
    const unfinishedSet = new Set(unfinished.filter((m) => m.edition_id === e.id).map((m) => m.unit_index));
    const finishedSet = new Set(finishedAny.filter((m) => m.edition_id === e.id).map((m) => m.unit_index));
    const plannedSet = new Set(planned.filter((p) => p.edition_id === e.id).map((p) => p.unit_index));
    const regular = units.filter((u) => u.stage !== 'playoff').length || units.length;
    const pending = units.filter((u) => !plannedSet.has(u.index) && (unfinishedSet.has(u.index) || !finishedSet.has(u.index)));
    return { e, pending, regular, cursor: 0, total: pending.length };
  });

  const interestOf = (q0: (typeof queues)[number], u: Unit) => unitInterest(u, q0.regular, Number(q0.e.config.weight ?? 1));
  const totalInterest = queues.reduce((s, x) => s + x.pending.reduce((t, u) => t + interestOf(x, u), 0), 0);
  const target = totalInterest / days.length;
  // El tope diario crece lo necesario para que todo lo elegido termine en los
  // días elegidos (por ejemplo, la temporada completa en una semana).
  const pendingMatches = queues.reduce((s, x) => s + x.pending.reduce((t, u) => t + (u.main ? 0 : u.matches), 0), 0);
  const maxMatches = Math.max(cal.maxMatchesPerDay ?? 800, Math.ceil((pendingMatches * 1.08) / days.length));
  const matchTarget = Math.ceil(pendingMatches / days.length);

  const blocks: Record<string, unknown>[] = [];
  for (let d = 0; d < days.length; d++) {
    const isLast = d === days.length - 1;
    let interest = 0;
    let matches = 0;
    let lives = 0;
    let order = 0;
    for (let guard = 0; guard < 500; guard++) {
      // La competición más atrasada en proporción avanza primero.
      const candidates = queues
        .filter((x) => x.cursor < x.pending.length)
        .sort((a, b) => a.cursor / Math.max(1, a.total) - b.cursor / Math.max(1, b.total));
      const next = candidates.find((x) => {
        const u = x.pending[x.cursor];
        const m = u.main ? 0 : u.matches;
        return matches + m <= maxMatches && lives + liveOf(u) <= cal.maxLiveEventsPerDay;
      });
      if (!next) break;
      // Reparto parejo: cada día lleva la misma cantidad de partidos (o de interés
      // si solo quedan eventos en vivo), y las competiciones avanzan a la par.
      if (!isLast && order > 0 && (pendingMatches > 0 ? matches >= matchTarget : interest >= target)) break;
      const u = next.pending[next.cursor++];
      const score = interestOf(next, u);
      interest += score;
      matches += u.main ? 0 : u.matches;
      lives += liveOf(u);
      blocks.push({
        day_id: days[d].id,
        edition_id: next.e.id,
        kind: 'unit',
        unit_index: u.index,
        label: `${next.e.name.split(' · ')[0]} · ${u.label}`,
        sort_order: order++,
        interest: score,
        matches_count: u.matches,
        live_count: liveOf(u),
      });
    }
  }
  // Las finales van al final de su día.
  if (blocks.length) await insertMany(db, 'plan_blocks', blocks);
  await reorderFinalsLast(db, days.map((d) => d.id));
  return getPlan(db, days.map((d) => d.id));
}

async function reorderFinalsLast(db: DB, dayIds: string[]) {
  const blocks = await all<PlanBlock>(() => db.from('plan_blocks').select('*').in('day_id', dayIds));
  for (const dayId of dayIds) {
    const bs = blocks.filter((b) => b.day_id === dayId).sort((a, b) => a.sort_order - b.sort_order);
    const ordered = [...bs.filter((b) => !/· Final$/.test(b.label)), ...bs.filter((b) => /· Final$/.test(b.label))];
    for (let i = 0; i < ordered.length; i++) {
      if (ordered[i].sort_order !== i) await q(db.from('plan_blocks').update({ sort_order: i }).eq('id', ordered[i].id));
    }
  }
}

export async function getPlan(db: DB, dayIds?: string[]) {
  const days = await q<{ id: string; date: string; status: string; published: boolean; mode: string }[]>(
    dayIds?.length
      ? db.from('competition_days').select('id,date,status,published,mode').in('id', dayIds).order('date')
      : db.from('competition_days').select('id,date,status,published,mode').neq('status', 'closed').order('date'),
  );
  const blocks = days.length
    ? await all<PlanBlock>(() => db.from('plan_blocks').select('*').in('day_id', days.map((d) => d.id)).order('sort_order'))
    : [];
  return {
    days: days.map((d) => {
      const bs = blocks.filter((b) => b.day_id === d.id);
      return {
        ...d,
        interest: bs.reduce((s, b) => s + Number(b.interest), 0),
        matches: bs.reduce((s, b) => s + b.matches_count, 0),
        lives: bs.reduce((s, b) => s + b.live_count, 0),
        blocks: bs,
      };
    }),
    warnings: validate(days, blocks),
  };
}

/** Reglas: cada competición en orden; finales al final del día; tope de eventos en vivo. */
function validate(days: { id: string; date: string }[], blocks: PlanBlock[]): string[] {
  const warnings: string[] = [];
  const dayIndex = new Map(days.map((d, i) => [d.id, i]));
  const byEdition = new Map<string, PlanBlock[]>();
  for (const b of blocks) {
    if (!b.edition_id) continue;
    if (!byEdition.has(b.edition_id)) byEdition.set(b.edition_id, []);
    byEdition.get(b.edition_id)!.push(b);
  }
  for (const list of byEdition.values()) {
    const sorted = [...list].sort((a, b) => (a.unit_index ?? 0) - (b.unit_index ?? 0));
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      const dp = dayIndex.get(prev.day_id)!;
      const dc = dayIndex.get(cur.day_id)!;
      if (dc < dp || (dc === dp && cur.sort_order < prev.sort_order)) {
        warnings.push(`«${cur.label}» quedó antes que «${prev.label}». Se jugará en cuanto termine la anterior.`);
      }
    }
  }
  for (const d of days) {
    const bs = blocks.filter((b) => b.day_id === d.id);
    const lives = bs.reduce((s, b) => s + b.live_count, 0);
    if (lives > DEFAULT_CALENDAR.maxLiveEventsPerDay) warnings.push(`${d.date}: ${lives} eventos en vivo no caben en 6 horas; los de menor interés pasarán a ráfagas.`);
    const finals = bs.filter((b) => /· Final$/.test(b.label));
    const last = [...bs].sort((a, b) => a.sort_order - b.sort_order).slice(-finals.length);
    if (finals.some((f) => !last.includes(f))) warnings.push(`${d.date}: hay una final que no está en el último horario del día.`);
    if (bs.length && !bs.some((b) => b.live_count > 0)) warnings.push(`${d.date}: no tiene eventos en vivo garantizados (se usarán los derbis detectados).`);
  }
  return warnings;
}

export async function moveBlock(db: DB, blockId: string, dayId: string, index: number) {
  const block = await q<PlanBlock>(db.from('plan_blocks').select('*').eq('id', blockId).single());
  const day = await q<{ status: string }>(db.from('competition_days').select('status').eq('id', dayId).single());
  const from = await q<{ status: string }>(db.from('competition_days').select('status').eq('id', block.day_id).single());
  if (day.status !== 'planned' || from.status !== 'planned') throw new AppError('Solo se mueven bloques entre días que no han empezado');
  const target = (await q<PlanBlock[]>(db.from('plan_blocks').select('*').eq('day_id', dayId).order('sort_order'))).filter((b) => b.id !== blockId);
  const at = Math.max(0, Math.min(index, target.length));
  target.splice(at, 0, { ...block, day_id: dayId });
  for (let i = 0; i < target.length; i++) {
    await q(db.from('plan_blocks').update({ day_id: dayId, sort_order: i }).eq('id', target[i].id));
  }
  if (block.day_id !== dayId) {
    const rest = await q<PlanBlock[]>(db.from('plan_blocks').select('*').eq('day_id', block.day_id).order('sort_order'));
    for (let i = 0; i < rest.length; i++) if (rest[i].sort_order !== i) await q(db.from('plan_blocks').update({ sort_order: i }).eq('id', rest[i].id));
  }
  return getPlan(db);
}

/** Fusiona el día B dentro del día A (A conserva su fecha). */
export async function mergeDays(db: DB, intoDayId: string, fromDayId: string) {
  const days = await q<{ id: string; status: string; date: string }[]>(db.from('competition_days').select('id,status,date').in('id', [intoDayId, fromDayId]));
  if (days.length !== 2 || days.some((d) => d.status !== 'planned')) throw new AppError('Solo se fusionan días que no han empezado');
  const count = (await q<PlanBlock[]>(db.from('plan_blocks').select('id').eq('day_id', intoDayId))).length;
  const moving = await q<PlanBlock[]>(db.from('plan_blocks').select('*').eq('day_id', fromDayId).order('sort_order'));
  for (let i = 0; i < moving.length; i++) await q(db.from('plan_blocks').update({ day_id: intoDayId, sort_order: count + i }).eq('id', moving[i].id));
  const fromDate = days.find((d) => d.id === fromDayId)!.date;
  const into = await q<{ merged_dates: string[] }>(db.from('competition_days').select('merged_dates').eq('id', intoDayId).single());
  await q(db.from('competition_days').update({ merged_dates: [...(into.merged_dates ?? []), fromDate] }).eq('id', intoDayId));
  await q(db.from('competition_days').delete().eq('id', fromDayId));
  await reorderFinalsLast(db, [intoDayId]);
  return getPlan(db);
}

/** Quita un día del plan: sus bloques vuelven a quedar sin planear. */
export async function deleteDay(db: DB, dayId: string) {
  const d = await q<{ status: string }>(db.from('competition_days').select('status').eq('id', dayId).single());
  if (d.status !== 'planned') throw new AppError('Ese día ya empezó');
  await q(db.from('competition_days').delete().eq('id', dayId));
  return getPlan(db);
}

export async function removeBlock(db: DB, blockId: string) {
  await q(db.from('plan_blocks').delete().eq('id', blockId));
  return getPlan(db);
}

/** Jornadas y rondas sin planear, para agregarlas a mano. */
export async function unplanned(db: DB) {
  const eds = await q<EditionRow[]>(db.from('editions').select('*').neq('status', 'finished'));
  if (!eds.length) return [];
  const ids = eds.map((e) => e.id);
  const planned = await all<{ edition_id: string; unit_index: number }>(() => db.from('plan_blocks').select('edition_id,unit_index').in('edition_id', ids));
  const unfinished = await all<Pick<MatchDb, 'edition_id' | 'unit_index'>>(() =>
    db.from('matches').select('edition_id,unit_index').in('edition_id', ids).neq('status', 'finished'),
  );
  const finished = await all<Pick<MatchDb, 'edition_id' | 'unit_index'>>(() =>
    db.from('matches').select('edition_id,unit_index').in('edition_id', ids).eq('status', 'finished'),
  );
  return eds.map((e) => {
    const units: Unit[] = e.state.units ?? [];
    const p = new Set(planned.filter((x) => x.edition_id === e.id).map((x) => x.unit_index));
    const uf = new Set(unfinished.filter((x) => x.edition_id === e.id).map((x) => x.unit_index));
    const f = new Set(finished.filter((x) => x.edition_id === e.id).map((x) => x.unit_index));
    const regular = units.filter((u) => u.stage !== 'playoff').length || units.length;
    return {
      editionId: e.id,
      name: e.name,
      units: units
        .filter((u) => !p.has(u.index) && (uf.has(u.index) || !f.has(u.index)))
        .map((u) => ({ ...u, interest: unitInterest(u, regular, Number(e.config.weight ?? 1)) })),
    };
  });
}

export async function addBlock(db: DB, dayId: string, editionId: string, unitIndex: number) {
  const e = await q<EditionRow>(db.from('editions').select('*').eq('id', editionId).single());
  const u = (e.state.units ?? []).find((x) => x.index === unitIndex);
  if (!u) throw new AppError('Esa jornada no existe');
  const regular = e.state.units.filter((x) => x.stage !== 'playoff').length || e.state.units.length;
  const count = (await q<PlanBlock[]>(db.from('plan_blocks').select('id').eq('day_id', dayId))).length;
  await q(
    db.from('plan_blocks').insert({
      day_id: dayId,
      edition_id: editionId,
      kind: 'unit',
      unit_index: unitIndex,
      label: `${e.name.split(' · ')[0]} · ${u.label}`,
      sort_order: count,
      interest: unitInterest(u, regular, Number(e.config.weight ?? 1)),
      matches_count: u.matches,
      live_count: liveOf(u),
    }),
  );
  return getPlan(db);
}

export async function createDay(db: DB, date: string) {
  const ex = await q<{ id: string } | null>(db.from('competition_days').select('id').eq('date', date).maybeSingle());
  if (!ex) await q(db.from('competition_days').insert({ date, status: 'planned' }));
  return getPlan(db);
}

export async function publishDay(db: DB, dayId: string, published: boolean) {
  await q(db.from('competition_days').update({ published }).eq('id', dayId));
  return getPlan(db);
}

export { editionsWithUnits };
