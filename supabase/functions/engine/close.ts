// Cierre de temporada (sección 12): ascensos y descensos, progresión y retiros,
// contratos, salarios y camisetas, nueva temporada, draft y mercado.
import { applyMoves, divisionMoves, playoffOrder } from '../../../shared/competition/divisions.ts';
import { eliminationRounds } from '../../../shared/competition/edition.ts';
import { MATCH_COLS, toMatchRow, type MatchDb } from './types.ts';
import { createRng, gaussian, hashSeed } from '../../../shared/engine/rng.ts';
import { salaryFor } from '../../../shared/data/generate.ts';
import { AppError, all, getSetting, insertMany, q, type DB } from './db.ts';
import { publish } from './news.ts';
import type { EditionRow, PlayerRow, TeamRow } from './types.ts';

async function divisionTables(db: DB, seasonId: string) {
  const eds = await q<EditionRow[]>(db.from('editions').select('*').eq('season_id', seasonId));
  const table = async (key: string) => {
    const e = eds.find((x) => x.config.competitionKey === key);
    if (!e) return null;
    const st = await q<{ team_id: string; position: number }[]>(db.from('edition_standings').select('team_id,position').eq('edition_id', e.id).order('position'));
    let order = st.map((s) => s.team_id);
    // Segunda: el ascenso sale de la liguilla (campeón, subcampeón, semifinalistas
    // y los mejores eliminados en cuartos según la tabla regular).
    if (key === 'segunda' && (e.config as { promotionVia?: string }).promotionVia !== 'table') {
      const ms = await all<MatchDb>(() => db.from('matches').select(MATCH_COLS).eq('edition_id', e.id).eq('stage', 'playoff'));
      if (ms.length) order = playoffOrder(order, eliminationRounds(ms.map(toMatchRow), e.config), e.champion_team_id);
    }
    return { edition: e, order };
  };
  return { primera: await table('primera'), segunda: await table('segunda'), editions: eds };
}

/** Ascensos y descensos que correspondían a una temporada ya terminada (sin aplicar). */
export async function movementsFor(db: DB, seasonId: string) {
  const { primera, segunda } = await divisionTables(db, seasonId);
  if (!primera || !segunda) return { promoted: [] as string[], relegated: [] as string[] };
  return divisionMoves(primera.order, segunda.order, Number(primera.edition.config.relegated ?? 6), Number(segunda.edition.config.promoted ?? 6));
}

/** Registra los cambios de división de la temporada que empieza. Idempotente. */
export async function recordMovements(db: DB, seasonId: string, moves: { promoted: string[]; relegated: string[] }) {
  const rows = [
    ...moves.promoted.map((t) => ({ season_id: seasonId, team_id: t, kind: 'promoted', from_division: 2, to_division: 1 })),
    ...moves.relegated.map((t) => ({ season_id: seasonId, team_id: t, kind: 'relegated', from_division: 1, to_division: 2 })),
  ];
  if (rows.length) await q(db.from('team_movements').upsert(rows, { onConflict: 'season_id,team_id' }));
  return rows.length;
}

/** Vista previa: qué va a pasar al cerrar (el administrador puede corregir). */
export async function closePreview(db: DB) {
  const season = await q<{ id: string; number: number }>(db.from('seasons').select('id,number').eq('status', 'active').order('number', { ascending: false }).limit(1).single());
  const { primera, segunda, editions } = await divisionTables(db, season.id);
  const pending = editions.filter((e) => e.status !== 'finished').map((e) => e.name);
  let moves = { promoted: [] as string[], relegated: [] as string[] };
  if (primera && segunda) moves = divisionMoves(primera.order, segunda.order, Number(primera.edition.config.relegated ?? 6), Number(segunda.edition.config.promoted ?? 6));
  const players = await all<PlayerRow>(() => db.from('players').select('*').eq('retired', false));
  const retiring = players.filter((p) => p.age >= 34).length;
  const expiring = players.filter((p) => p.contract_years <= 1 && p.team_id).length;
  return { season, pending, moves, retiringCandidates: retiring, expiringContracts: expiring };
}

/**
 * Ejecuta el cierre. `moves` permite al administrador corregir ascensos y
 * descensos antes de confirmar.
 */
export async function closeSeason(db: DB, moves?: { promoted: string[]; relegated: string[] }) {
  const preview = await closePreview(db);
  const season = preview.season;
  const rng = createRng(hashSeed(`close:${season.id}`));
  const log: string[] = [];

  // 1. Divisiones
  const m = moves ?? preview.moves;
  if (m.promoted.length || m.relegated.length) {
    const teams = await all<TeamRow>(() => db.from('teams').select('id,key,name,short_name,attack,defense,goalie,play_style,division,fan_base'));
    const prim = teams.filter((t) => t.division === 1).map((t) => t.id);
    const seg = teams.filter((t) => t.division === 2).map((t) => t.id);
    const after = applyMoves(prim, seg, m);
    for (const id of after.primera) await q(db.from('teams').update({ division: 1 }).eq('id', id));
    for (const id of after.segunda) await q(db.from('teams').update({ division: 2 }).eq('id', id));
    const name = new Map(teams.map((t) => [t.id, t.name]));
    log.push(`Ascienden: ${m.promoted.map((t) => name.get(t)).join(', ')}`, `Descienden: ${m.relegated.map((t) => name.get(t)).join(', ')}`);
    await publish(db, {
      kind: 'historia',
      tone: 'medio',
      facts: `Cierre de la temporada ${season.number}. Ascienden a Primera: ${m.promoted.map((t) => name.get(t)).join(', ')}. Descienden a Segunda: ${m.relegated.map((t) => name.get(t)).join(', ')}.`,
      fallback: { title: `Temporada ${season.number}: ascensos y descensos`, body: log.join('\n') },
    }).catch(() => undefined);
  }

  // 2. Progresión, edad, retiros y contratos
  const players = await all<PlayerRow>(() => db.from('players').select('*').eq('retired', false));
  const retired: PlayerRow[] = [];
  const updates: { id: string; patch: Record<string, unknown> }[] = [];
  for (const p of players) {
    const age = p.age + 1;
    let delta = 0;
    if (age < 23) delta = Math.min(p.potential - p.rating, Math.round(2 + rng() * 4));
    else if (age <= 29) delta = Math.round(gaussian(rng) * 1.2);
    else delta = -Math.round(1 + rng() * (age - 29) * 0.7);
    const rating = Math.max(30, Math.min(100, p.rating + delta));
    const retireChance = age >= 34 ? 0.15 + (age - 34) * 0.15 : 0;
    if (rng() < retireChance) {
      retired.push(p);
      updates.push({ id: p.id, patch: { retired: true, team_id: null, age } });
      continue;
    }
    let contract = p.contract_years - 1;
    let team = p.team_id;
    if (contract <= 0 && team) {
      // Renueva (2-3 temporadas) o sale al mercado.
      if (rng() < 0.7) contract = 2 + Math.floor(rng() * 2);
      else team = null;
    }
    updates.push({ id: p.id, patch: { age, rating, potential: Math.max(rating, p.potential), contract_years: Math.max(0, contract), team_id: team, salary: salaryFor(rating, age), form: 50, morale: 55, injury_days: 0 } });
  }
  for (let i = 0; i < updates.length; i += 50) {
    await Promise.all(updates.slice(i, i + 50).map((u) => q(db.from('players').update(u.patch).eq('id', u.id))));
  }
  log.push(`${retired.length} retiros`);
  for (const p of retired.filter((x) => x.rating >= 88).slice(0, 3)) {
    await publish(db, {
      kind: 'historia',
      tone: 'suave',
      playerId: p.id,
      teamId: p.team_id,
      facts: `Se retira ${p.first_name} ${p.last_name} a los ${p.age + 1} años, con atributo ${p.rating}. Fue una figura de su equipo.`,
      fallback: { title: `Adiós a ${p.first_name} ${p.last_name}`, body: `Se retira a los ${p.age + 1} años.` },
    }).catch(() => undefined);
  }

  // 3. Economía de la temporada: salarios y camisetas (fama de sus 5 mejores).
  const economy = await getSetting(db, 'economy', { jerseyPerFame: 22_000 });
  const teams = await all<{ id: string }>(() => db.from('teams').select('id'));
  const stats = await all<{ player_id: string; goals: number; mvps: number }>(() => db.from('player_edition_stats').select('player_id,goals,mvps'));
  const fame = new Map<string, number>();
  for (const s of stats) fame.set(s.player_id, (fame.get(s.player_id) ?? 0) + s.goals * 2 + s.mvps * 5);
  const nowPlayers = await all<PlayerRow>(() => db.from('players').select('*').eq('retired', false).not('team_id', 'is', null));
  const finance: Record<string, unknown>[] = [];
  for (const t of teams) {
    const roster = nowPlayers.filter((p) => p.team_id === t.id);
    const salaries = roster.reduce((s, p) => s + Number(p.salary), 0);
    const top5 = [...roster].sort((a, b) => b.rating + (fame.get(b.id) ?? 0) / 5 - (a.rating + (fame.get(a.id) ?? 0) / 5)).slice(0, 5);
    const jerseys = Math.round(top5.reduce((s, p) => s + Math.max(0, p.rating - 70) * 3 + (fame.get(p.id) ?? 0), 0) * economy.jerseyPerFame / 10);
    finance.push({ team_id: t.id, season_id: season.id, concept: 'salarios', amount: -salaries }, { team_id: t.id, season_id: season.id, concept: 'camisetas', amount: jerseys });
    const b = await q<{ budget: number }>(db.from('team_private').select('budget').eq('team_id', t.id).single());
    await q(db.from('team_private').update({ budget: Number(b.budget) - salaries + jerseys }).eq('team_id', t.id));
  }
  await insertMany(db, 'finance_entries', finance);

  // 4. Nueva temporada
  await q(db.from('seasons').update({ status: 'closed', closed_at: new Date().toISOString() }).eq('id', season.id));
  const next = await q<{ id: string; number: number }>(db.from('seasons').insert({ number: season.number + 1, status: 'active' }).select('id,number').single());
  log.push(`Empieza la temporada ${next.number}`);
  await recordMovements(db, next.id, m);

  // 5. Plantillas completas: los huecos se cubren con agentes libres.
  await fillRosters(db);
  await q(db.rpc('recompute_all_ratings'));
  return { log, newSeason: next.number };
}

/** Garantiza 2 porteros, 6 defensas y 12 delanteros por equipo. */
export async function fillRosters(db: DB) {
  const teams = await all<{ id: string }>(() => db.from('teams').select('id'));
  const all_ = await all<PlayerRow>(() => db.from('players').select('*').eq('retired', false));
  const free = all_.filter((p) => !p.team_id).sort((a, b) => b.rating - a.rating);
  const need = { G: 2, D: 6, F: 12 } as const;
  for (const t of teams) {
    const roster = all_.filter((p) => p.team_id === t.id);
    // Sobran jugadores: los peores de esa posición pasan a la agencia libre.
    for (const pos of ['G', 'D', 'F'] as const) {
      const extra = roster.filter((p) => p.position === pos).sort((a, b) => a.rating - b.rating);
      while (extra.length > need[pos]) {
        const p = extra.shift()!;
        await q(db.from('players').update({ team_id: null }).eq('id', p.id));
        roster.splice(roster.indexOf(p), 1);
        free.push(p);
      }
    }
    for (const pos of ['G', 'D', 'F'] as const) {
      let have = roster.filter((p) => p.position === pos).length;
      while (have < need[pos]) {
        const idx = free.findIndex((p) => p.position === pos);
        if (idx >= 0) {
          const p = free.splice(idx, 1)[0];
          await q(db.from('players').update({ team_id: t.id, contract_years: 2 }).eq('id', p.id));
        } else {
          // Sin agentes libres de esa posición: entra un juvenil de la cantera.
          await q(
            db.from('players').insert({ team_id: t.id, first_name: 'Juvenil', last_name: `${pos}${Math.floor(Math.random() * 900 + 100)}`, number: Math.floor(Math.random() * 98) + 1, position: pos, rating: 62, age: 18, potential: 80, salary: salaryFor(62, 18), contract_years: 2 }),
          );
        }
        have++;
      }
    }
  }
  if (!teams.length) throw new AppError('Sin equipos');
}
