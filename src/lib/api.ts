// Capa de datos: consultas a Supabase (o a los datos de demostración).
import { DEMO_MODE, db } from './supabase';
import { demoData } from './demo';
import type { AdminLogEntry, Competition, LegacyEdition, Player, Profile, RankingEntry, Team } from './types';

async function rows<T>(p: PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getTeams(): Promise<Team[]> {
  if (DEMO_MODE) return demoData().teams;
  return rows<Team>(db().from('teams').select('*').order('name'));
}

export async function getPlayers(teamId?: string): Promise<Player[]> {
  if (DEMO_MODE) return demoData().players.filter((p) => !teamId || p.team_id === teamId);
  const query = () => {
    const q = db().from('players').select('*').eq('retired', false);
    return teamId ? q.eq('team_id', teamId) : q;
  };
  // Supabase devuelve hasta 1000 filas por consulta: se pagina para los 1,080+.
  const out: Player[] = [];
  for (let from = 0; ; from += 1000) {
    const page = await rows<Player>(query().order('rating', { ascending: false }).range(from, from + 999));
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}

export async function getHistoricalRanking(): Promise<RankingEntry[]> {
  if (DEMO_MODE) return demoData().ranking;
  return rows<RankingEntry>(db().from('ranking_entries').select('*').is('season_id', null));
}

export async function getLegacyEditions(): Promise<LegacyEdition[]> {
  if (DEMO_MODE) return demoData().legacy;
  return rows<LegacyEdition>(db().from('legacy_editions').select('*').order('import_order'));
}

export async function getCompetitions(): Promise<Competition[]> {
  if (DEMO_MODE) return demoData().competitions;
  return rows<Competition>(db().from('competitions').select('*').order('sort_order'));
}

export async function getMyProfile(userId: string): Promise<Profile | null> {
  if (DEMO_MODE) return null;
  const { data, error } = await db().from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data as Profile | null;
}

export async function updateFavorites(userId: string, favorites: string[], star: string | null) {
  if (DEMO_MODE) return;
  const { error } = await db()
    .from('profiles')
    .update({ favorite_team_ids: favorites.slice(0, 3), star_team_id: star })
    .eq('id', userId);
  if (error) throw new Error(error.message);
}

// ─── Administrador ───

export async function adminUpdatePlayer(id: string, patch: Partial<Player>) {
  if (DEMO_MODE) return;
  const { error } = await db().from('players').update(patch).eq('id', id);
  // Los atributos del equipo se recalculan solos con un trigger en la base de datos.
  if (error) throw new Error(error.message);
}

export async function adminListProfiles(): Promise<Profile[]> {
  if (DEMO_MODE) return [];
  return rows<Profile>(db().from('profiles').select('*').order('created_at', { ascending: false }));
}

export async function adminUsers(body: Record<string, unknown>): Promise<{ code?: string }> {
  const { data, error } = await db().functions.invoke('admin-users', { body });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data ?? {};
}

export async function adminGetLog(limit = 200): Promise<AdminLogEntry[]> {
  if (DEMO_MODE) return [];
  return rows<AdminLogEntry>(db().from('admin_log').select('*').order('created_at', { ascending: false }).limit(limit));
}

export async function adminUndo(logId: number) {
  const { error } = await db().rpc('undo_admin_change', { p_log_id: logId });
  if (error) throw new Error(error.message);
}

export async function getSetting<T>(key: string): Promise<T | null> {
  if (DEMO_MODE) return null;
  const { data, error } = await db().from('settings').select('value').eq('key', key).maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.value as T) ?? null;
}

export async function adminSetSetting(key: string, value: unknown) {
  if (DEMO_MODE) return;
  const { error } = await db().from('settings').update({ value, updated_at: new Date().toISOString() }).eq('key', key);
  if (error) throw new Error(error.message);
}
