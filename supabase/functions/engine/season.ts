// Temporadas y ediciones: participantes por regla, creación de partidos.
import { initialMatches, type MatchSpec } from '../../../shared/competition/edition.ts';
import { sortRanking } from '../../../shared/competition/divisions.ts';
import { createRng, hashSeed, shuffle } from '../../../shared/engine/rng.ts';
import { AppError, all, insertMany, q, type DB } from './db.ts';
import type { CompetitionRow, EditionRow, TeamRow } from './types.ts';

export async function currentSeason(db: DB): Promise<{ id: string; number: number }> {
  const s = await q<{ id: string; number: number } | null>(
    db.from('seasons').select('id,number').eq('status', 'active').order('number', { ascending: false }).limit(1).maybeSingle(),
  );
  if (s) return s;
  const last = await q<{ number: number } | null>(db.from('seasons').select('number').order('number', { ascending: false }).limit(1).maybeSingle());
  return q(db.from('seasons').insert({ number: (last?.number ?? 0) + 1, status: 'active' }).select('id,number').single());
}

/** Ranking ordenado (desempate: títulos, subcampeonatos, nombre). seasonId null = histórico. */
export async function ranking(db: DB, seasonId: string | null, teams: TeamRow[]): Promise<string[]> {
  const rows = await all<{ team_id: string; points: number; titles: number; runners_up: number }>(() => {
    const b = db.from('ranking_entries').select('team_id,points,titles,runners_up');
    return seasonId ? b.eq('season_id', seasonId) : b.is('season_id', null);
  });
  const adj = await all<{ team_id: string; points: number; season_id: string | null }>(() =>
    db.from('admin_ranking_adjustments').select('team_id,points,season_id'),
  );
  const byTeam = new Map(rows.map((r) => [r.team_id, r]));
  const list = teams.map((t) => {
    const r = byTeam.get(t.id);
    const extra = adj.filter((a) => a.team_id === t.id && (seasonId ? a.season_id === seasonId : true)).reduce((s, a) => s + Number(a.points), 0);
    return { teamId: t.id, name: t.name, points: Number(r?.points ?? 0) + extra, titles: r?.titles ?? 0, runnersUp: r?.runners_up ?? 0 };
  });
  return sortRanking(list).map((r) => r.teamId);
}

/** Ranking de temporada para clasificar: la última temporada cerrada, o el histórico si no hay. */
async function seasonRanking(db: DB, teams: TeamRow[]): Promise<string[]> {
  const last = await q<{ id: string } | null>(
    db.from('seasons').select('id').eq('status', 'closed').order('number', { ascending: false }).limit(1).maybeSingle(),
  );
  return last ? ranking(db, last.id, teams) : ranking(db, null, teams);
}

/** Resuelve la regla de participantes. Devuelve ids ordenados por siembra. */
export async function resolveParticipants(
  db: DB,
  comp: CompetitionRow,
  teams: TeamRow[],
  invited: string[] | undefined,
  seed: number,
): Promise<{ ids: string[]; seeded?: number }> {
  const hist = await ranking(db, null, teams);
  const rank = new Map(hist.map((t, i) => [t, i]));
  const byRank = (ids: string[]) => [...ids].sort((a, b) => (rank.get(a) ?? 999) - (rank.get(b) ?? 999));
  const rule = comp.participant_rule as { type: string; n?: number; division?: number; parts?: Record<string, unknown>[]; competition?: string };

  const resolve = async (r: Record<string, unknown>, exclude: Set<string>): Promise<string[]> => {
    const pool = (ids: string[]) => ids.filter((t) => !exclude.has(t));
    const n = Number(r.n ?? 0);
    switch (r.type) {
      case 'all':
        return byRank(pool(teams.map((t) => t.id)));
      case 'division':
        return byRank(pool(teams.filter((t) => t.division === Number(r.division)).map((t) => t.id)));
      case 'historical_top':
        return pool(hist).slice(0, n);
      case 'season_top':
        return pool(await seasonRanking(db, teams)).slice(0, n);
      case 'draw':
        return shuffle(createRng(seed), pool(hist)).slice(0, n);
      case 'competition_top': {
        const ed = await q<{ id: string } | null>(
          db.from('editions').select('id, competitions!inner(key)').eq('competitions.key', String(r.competition)).order('created_at', { ascending: false }).limit(1).maybeSingle(),
        );
        if (!ed) return [];
        const st = await q<{ team_id: string }[]>(db.from('edition_standings').select('team_id').eq('edition_id', ed.id).order('position').limit(n));
        return pool(st.map((s) => s.team_id));
      }
      case 'invite':
        return byRank(pool(invited ?? []));
      default:
        return [];
    }
  };

  if (invited && invited.length && rule.type !== 'combo') return { ids: byRank(invited) };
  if (rule.type === 'combo') {
    const out: string[] = [];
    let seeded: number | undefined;
    for (const part of rule.parts ?? []) {
      const ids = await resolve(part, new Set(out));
      if (part.seeded !== undefined && seeded === undefined) seeded = Number(part.seeded);
      out.push(...ids);
    }
    return { ids: out, seeded };
  }
  return { ids: await resolve(rule, new Set()) };
}

export function specToRow(editionId: string, x: MatchSpec) {
  return {
    edition_id: editionId,
    stage: x.stage,
    round: x.round ?? null,
    matchday: x.matchday ?? null,
    group_label: x.group ?? null,
    tie_key: x.tieKey ?? null,
    leg: x.leg ?? null,
    bracket_slot: x.slot ?? null,
    unit_index: x.unitIndex,
    home_team_id: x.home,
    away_team_id: x.away,
    neutral_venue: x.neutral,
    is_final: x.isFinal,
    is_main_event: x.isMainEvent,
    event_name: x.isMainEvent ? null : null,
  };
}

/** Crea una edición de una competición en la temporada activa. */
export async function createEdition(
  db: DB,
  competitionKey: string,
  opts: { invited?: string[]; name?: string } = {},
): Promise<EditionRow> {
  const comp = await q<CompetitionRow | null>(db.from('competitions').select('*').eq('key', competitionKey).maybeSingle());
  if (!comp) throw new AppError(`No existe la competición ${competitionKey}`);
  const season = await currentSeason(db);
  const dupe = await q<{ id: string } | null>(db.from('editions').select('id').eq('competition_id', comp.id).eq('season_id', season.id).maybeSingle());
  if (dupe) throw new AppError(`${comp.name} ya tiene edición en la temporada ${season.number}`);

  const teams = await all<TeamRow>(() => db.from('teams').select('id,key,name,short_name,attack,defense,goalie,play_style,division,fan_base'));
  const seed = hashSeed(`${comp.key}:${season.id}`);
  const { ids, seeded } = await resolveParticipants(db, comp, teams, opts.invited, seed);
  if (ids.length < 2) throw new AppError(`${comp.name}: no hay suficientes participantes`);

  const config = { ...comp.config, ...(seeded !== undefined ? { seededTeams: seeded } : {}) };
  const { matches, state } = initialMatches(comp.format, config, ids, createRng(seed));

  const edition = await q<EditionRow>(
    db
      .from('editions')
      .insert({
        competition_id: comp.id,
        season_id: season.id,
        name: opts.name ?? `${comp.name} · Temporada ${season.number}`,
        status: 'in_progress',
        config: { ...config, format: comp.format, weight: Number(comp.ranking_weight), competitionKey: comp.key },
        state,
      })
      .select('*')
      .single(),
  );
  const groupOf = new Map<string, string>();
  for (const [label, members] of Object.entries(state.groups ?? {})) for (const t of members) groupOf.set(t, label);
  await insertMany(
    db,
    'edition_teams',
    ids.map((t, i) => ({ edition_id: edition.id, team_id: t, seed: i + 1, group_label: groupOf.get(t) ?? null })),
  );
  await insertMany(db, 'matches', matches.map((m) => specToRow(edition.id, m)));
  await insertMany(
    db,
    'edition_standings',
    ids.map((t, i) => ({ edition_id: edition.id, team_id: t, group_label: groupOf.get(t) ?? '', position: i + 1 })),
  );
  return edition;
}
