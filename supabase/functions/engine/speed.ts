// «Indicar fin de temporada»: todo lo que falta se reparte desde hoy hasta la
// fecha elegida y el ritmo se aprieta para terminar antes de la hora límite.
import { AppError, getSetting, q, type DB } from './db.ts';
import { generatePlan } from './plan.ts';
import { compactDay, resumeDay } from './day.ts';

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

export async function finishSeasonBy(db: DB, endDate: string, endHour = 22) {
  const today = mxToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new AppError('Fecha inválida');
  if (endDate < today) throw new AppError('La fecha de cierre ya pasó');
  const hour = Math.min(23, Math.max(9, Math.round(endHour)));

  // 1. El día en pausa se reanuda (sin huecos) para no frenar a los demás.
  const open = await q<{ id: string; date: string; status: string }[]>(db.from('competition_days').select('id,date,status').in('status', ['running', 'paused']));
  for (const d of open) {
    if (d.status === 'paused') await resumeDay(db, d.id);
    else await compactDay(db, d.id);
  }

  // 2. Los días planeados que no han empezado se rehacen.
  await q(db.from('competition_days').delete().eq('status', 'planned'));

  // 3. Días disponibles: desde hoy (o mañana si hoy ya hay un día en curso con fecha de hoy).
  let dates = datesBetween(today, endDate);
  if (open.some((d) => d.date === today)) dates = dates.filter((d) => d !== today);
  if (!dates.length) throw new AppError('Hoy ya hay un día en curso: elige mañana como fecha de cierre, o ciérralo primero.');

  // 4. Ritmo: hora límite de cada día.
  const cal = await getSetting<Record<string, unknown>>(db, 'calendar', {});
  await q(db.from('settings').update({ value: { ...cal, dayEndHour: hour, autoStart: true }, updated_at: new Date().toISOString() }).eq('key', 'calendar'));

  // 5. Reparto de todo lo pendiente de todas las competiciones en curso.
  const eds = await q<{ id: string }[]>(db.from('editions').select('id').neq('status', 'finished'));
  if (!eds.length) throw new AppError('No hay competiciones en curso');
  const plan = await generatePlan(db, dates, eds.map((e) => e.id));
  return { dates, endHour: hour, plan };
}
