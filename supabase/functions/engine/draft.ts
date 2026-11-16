// Draft (sección 7): entre 60 y 80 novatos de 17 a 19 años. En la ronda 1 elige
// primero el peor del ranking de temporada; después, al azar. Los dueños eligen
// en turnos de 60 segundos; si no eligen o no hay dueño, la IA elige sola.
import { createRng, gaussian, hashSeed, randInt, shuffle } from '../../../shared/engine/rng.ts';
import { FIRST_NAMES, LAST_NAMES } from '../../../shared/data/names.ts';
import { salaryFor } from '../../../shared/data/generate.ts';
import { AppError, all, getSetting, insertMany, q, type DB } from './db.ts';
import { ranking } from './season.ts';
import { publish } from './news.ts';
import type { PlayerRow, TeamRow } from './types.ts';
import { fillRosters } from './close.ts';

interface Pick {
  id: string;
  season_id: string;
  round: number;
  pick_number: number;
  team_id: string;
  player_id: string | null;
  mode: 'owner' | 'auto';
  deadline: string | null;
  picked_at: string | null;
}

const AUTO_SECONDS = 4;

export async function draftState(db: DB) {
  const season = await q<{ id: string; number: number }>(db.from('seasons').select('id,number').eq('status', 'active').order('number', { ascending: false }).limit(1).single());
  const picks = await all<Pick>(() => db.from('draft_picks').select('*').eq('season_id', season.id).order('pick_number'));
  const rookies = await all<PlayerRow>(() => db.from('players').select('*').eq('draft_season_id', season.id));
  return { season, picks, rookies };
}

/** Genera la clase de novatos y el orden del draft. */
export async function prepareDraft(db: DB) {
  const { season, picks } = await draftState(db);
  if (picks.length) throw new AppError('El draft de esta temporada ya está preparado');
  const cfg = await getSetting(db, 'draft', { minRookies: 60, maxRookies: 80, rounds: 3, turnSeconds: 60 });
  const rng = createRng(hashSeed(`draft:${season.id}`));
  const n = randInt(rng, cfg.minRookies, cfg.maxRookies);
  const used = new Set((await all<{ first_name: string; last_name: string }>(() => db.from('players').select('first_name,last_name'))).map((p) => `${p.first_name} ${p.last_name}`));
  const rookies: Record<string, unknown>[] = [];
  for (let i = 0; i < n; i++) {
    let first = '';
    let last = '';
    for (let t = 0; t < 500; t++) {
      first = FIRST_NAMES[Math.floor(rng() * FIRST_NAMES.length)];
      last = LAST_NAMES[Math.floor(rng() * LAST_NAMES.length)];
      if (!used.has(`${first} ${last}`)) break;
    }
    used.add(`${first} ${last}`);
    const position = i % 10 === 0 ? 'G' : i % 10 < 4 ? 'D' : 'F';
    const rating = Math.max(55, Math.min(86, Math.round(72 + gaussian(rng) * 6)));
    const age = randInt(rng, 17, 19);
    rookies.push({
      team_id: null,
      first_name: first,
      last_name: last,
      number: randInt(rng, 1, 98),
      position,
      rating,
      age,
      potential: Math.min(100, rating + randInt(rng, 6, 22)),
      form: 55,
      morale: 70,
      salary: salaryFor(rating, age),
      contract_years: 3,
      draft_season_id: season.id,
    });
  }
  await insertMany(db, 'players', rookies);

  const teams = await all<TeamRow>(() => db.from('teams').select('id,key,name,short_name,attack,defense,goalie,play_style,division,fan_base'));
  const order1 = (await ranking(db, season.id, teams)).reverse(); // el peor elige primero
  const owners = new Set((await all<{ club_team_id: string | null }>(() => db.from('profiles').select('club_team_id').eq('role', 'owner'))).map((o) => o.club_team_id));
  const rows: Record<string, unknown>[] = [];
  let pick = 1;
  for (let r = 1; r <= cfg.rounds && pick <= n; r++) {
    const order = r === 1 ? order1 : shuffle(rng, order1);
    for (const t of order) {
      if (pick > n) break;
      rows.push({ season_id: season.id, round: r, pick_number: pick++, team_id: t, mode: owners.has(t) ? 'owner' : 'auto' });
    }
  }
  await insertMany(db, 'draft_picks', rows);
  return { rookies: n, picks: rows.length };
}

export async function startDraft(db: DB) {
  const { picks } = await draftState(db);
  if (!picks.length) throw new AppError('Primero prepara el draft');
  const first = picks.find((p) => !p.player_id);
  if (!first) throw new AppError('El draft ya terminó');
  await setDeadline(db, first);
  await q(db.from('settings').upsert({ key: 'draft_live', value: { running: true, startedAt: new Date().toISOString() }, is_public: true }));
  return draftState(db);
}

async function setDeadline(db: DB, p: Pick) {
  const cfg = await getSetting(db, 'draft', { turnSeconds: 60 });
  const secs = p.mode === 'owner' ? cfg.turnSeconds : AUTO_SECONDS;
  await q(db.from('draft_picks').update({ deadline: new Date(Date.now() + secs * 1000).toISOString() }).eq('id', p.id));
}

/** Mejor novato disponible por valor y necesidad del equipo. */
function autoChoice(available: PlayerRow[], roster: PlayerRow[]): PlayerRow {
  const count = (pos: string) => roster.filter((p) => p.position === pos).length;
  const need = (pos: string) => (pos === 'G' ? 2 - count('G') : pos === 'D' ? 6 - count('D') : 12 - count('F'));
  return [...available].sort((a, b) => b.rating + b.potential * 0.6 + need(b.position) * 6 - (a.rating + a.potential * 0.6 + need(a.position) * 6))[0];
}

async function makePick(db: DB, pick: Pick, playerId: string) {
  const player = await q<PlayerRow>(db.from('players').select('*').eq('id', playerId).single());
  if (player.team_id) throw new AppError('Ese novato ya fue elegido');
  await q(db.from('players').update({ team_id: pick.team_id }).eq('id', playerId));
  await q(db.from('draft_picks').update({ player_id: playerId, picked_at: new Date().toISOString() }).eq('id', pick.id));
  // La plantilla se mantiene en 20: sale el peor de esa posición a la agencia libre.
  const roster = await all<PlayerRow>(() => db.from('players').select('*').eq('team_id', pick.team_id).eq('retired', false));
  const limit = player.position === 'G' ? 2 : player.position === 'D' ? 6 : 12;
  const samePos = roster.filter((p) => p.position === player.position && p.id !== playerId).sort((a, b) => a.rating - b.rating);
  if (samePos.length + 1 > limit) await q(db.from('players').update({ team_id: null }).eq('id', samePos[0].id));
  if (pick.round === 1 && pick.pick_number <= 3) {
    const team = await q<{ name: string }>(db.from('teams').select('name').eq('id', pick.team_id).single());
    await publish(db, {
      kind: 'draft',
      tone: 'suave',
      teamId: pick.team_id,
      playerId,
      facts: `Draft: con la selección ${pick.pick_number}, ${team.name} elige a ${player.first_name} ${player.last_name}, ${player.age} años, atributo ${player.rating} y potencial ${player.potential}.`,
      fallback: { title: `${team.name} elige a ${player.first_name} ${player.last_name} en el puesto ${pick.pick_number}`, body: `${player.age} años, potencial ${player.potential}.` },
    }).catch(() => undefined);
  }
}

/** Avanza los turnos vencidos (lo llaman el tick y la sala del draft). */
export async function advanceDraft(db: DB, maxPicks = 25) {
  const live = await getSetting<{ running: boolean }>(db, 'draft_live', { running: false });
  if (!live.running) return { picked: 0 };
  let picked = 0;
  for (let i = 0; i < maxPicks; i++) {
    const { picks, rookies } = await draftState(db);
    const cur = picks.find((p) => !p.player_id);
    if (!cur) {
      await q(db.from('settings').upsert({ key: 'draft_live', value: { running: false, finishedAt: new Date().toISOString() }, is_public: true }));
      // Los novatos que nadie eligió quedan como agentes libres; las plantillas se cuadran.
      await fillRosters(db);
      await q(db.rpc('recompute_all_ratings'));
      break;
    }
    if (!cur.deadline) await setDeadline(db, cur);
    if (cur.deadline && Date.parse(cur.deadline) > Date.now()) break;
    const available = rookies.filter((r) => !r.team_id);
    if (!available.length) break;
    const roster = await all<PlayerRow>(() => db.from('players').select('*').eq('team_id', cur.team_id).eq('retired', false));
    await makePick(db, cur, autoChoice(available, roster).id);
    picked++;
    const next = (await draftState(db)).picks.find((p) => !p.player_id);
    if (next) await setDeadline(db, next);
  }
  return { picked };
}

/** Elección del dueño en su turno. */
export async function ownerPick(db: DB, userId: string, playerId: string) {
  const prof = await q<{ club_team_id: string | null; role: string }>(db.from('profiles').select('club_team_id,role').eq('id', userId).single());
  if (prof.role !== 'owner' || !prof.club_team_id) throw new AppError('Solo los dueños eligen en el draft');
  const { picks } = await draftState(db);
  const cur = picks.find((p) => !p.player_id);
  if (!cur || cur.team_id !== prof.club_team_id) throw new AppError('No es tu turno');
  await makePick(db, cur, playerId);
  const next = (await draftState(db)).picks.find((p) => !p.player_id);
  if (next) await setDeadline(db, next);
  return draftState(db);
}
