// «Indicar fin de temporada»: todo lo que falta se reparte desde hoy hasta la
// fecha elegida y el ritmo se aprieta para terminar antes de la hora límite.
import { AppError, getSetting, q, type DB } from './db.ts';
import { generatePlan, getPlan } from './plan.ts';
import { compactDay, dayDeadline, resumeDay } from './day.ts';

const MX_SHIFT = 6 * 3600_000; // México (UTC-6)

const mxToday = () => new Date(Date.now() - MX_SHIFT).toISOString().slice(0, 10);

function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  for (let guard = 0; d <= end && guard < 60; guard++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export async function finishSeasonBy(db: DB, endDate: string, endTime = '22:00') {
  const today = mxToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new AppError('Fecha inválida');
  if (!/^\d{1,2}:\d{2}$/.test(endTime)) throw new AppError('Hora inválida');
  if (endDate < today) throw new AppError('La fecha de cierre ya pasó');

  // 1. Hora de fin de cada día y ajuste para acabar justo a esa hora.
  const cal = await getSetting<Record<string, unknown>>(db, 'calendar', {});
  const nextCal = { ...cal, dayEndTime: endTime, dayEndHour: Number(endTime.split(':')[0]), fitToDeadline: true, autoStart: true };
  const lastDeadline = dayDeadline(endDate, nextCal);
  if (lastDeadline < Date.now() + 20 * 60_000) throw new AppError('Esa hora ya pasó o está demasiado cerca: elige al menos 20 minutos a partir de ahora.');
  await q(db.from('settings').update({ value: nextCal, updated_at: new Date().toISOString() }).eq('key', 'calendar'));

  // 2. Lo que ya se está jugando se reanuda y se aprieta para acabar a tiempo.
  const open = await q<{ id: string; date: string; status: string }[]>(db.from('competition_days').select('id,date,status').in('status', ['running', 'paused']));
  const todayDeadline = dayDeadline(today, nextCal);
  for (const d of open) {
    if (d.status === 'paused') await resumeDay(db, d.id);
    await compactDay(db, d.id, Date.now(), todayDeadline > Date.now() + 10 * 60_000 ? todayDeadline : lastDeadline);
  }

  // 3. Los días planeados que no han empezado se rehacen.
  await q(db.from('competition_days').delete().eq('status', 'planned'));

  // 4. Días disponibles: desde hoy (o mañana si hoy ya hay un día en curso con fecha de hoy,
  //    o si la hora de fin de hoy ya pasó).
  let dates = datesBetween(today, endDate);
  if (open.some((d) => d.date === today) || todayDeadline < Date.now() + 20 * 60_000) dates = dates.filter((d) => d !== today);
  // Todo lo que falta ya está en los días en curso: basta con haberlos apretado.
  if (!dates.length) return { dates: open.map((d) => d.date), endTime, plan: await getPlan(db) };

  // 5. Reparto de todo lo pendiente; los días arrancan solos (el de hoy, en segundos).
  const eds = await q<{ id: string }[]>(db.from('editions').select('id').neq('status', 'finished'));
  if (!eds.length) throw new AppError('No hay competiciones en curso');
  const plan = await generatePlan(db, dates, eds.map((e) => e.id));
  return { dates, endTime, plan };
}
