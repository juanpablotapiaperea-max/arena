// Llamadas al motor del servidor (Edge Function «engine») y lecturas del juego.
import { DEMO_MODE, db, freshSession } from './supabase';

async function callEngine(action: string, body: Record<string, unknown>, token?: string) {
  return db().functions.invoke('engine', { body: { action, ...body }, ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}) });
}

async function errorText(error: unknown): Promise<{ status: number; message: string }> {
  const ctx = (error as { context?: Response }).context;
  const status = ctx?.status ?? 0;
  if (ctx && typeof ctx.json === 'function') {
    const j = await ctx.json().catch(() => null);
    if (j?.error) return { status, message: String(j.error) };
  }
  return { status, message: (error as Error).message };
}

export async function engine<T = unknown>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  if (DEMO_MODE) throw new Error('Conecta Supabase para usar esta función');
  // Siempre con un token vigente (en iPad la sesión puede vencer en segundo plano).
  let session = await freshSession();
  let { data, error } = await callEngine(action, body, session?.access_token);
  if (error) {
    let e = await errorText(error);
    if (e.status === 401) {
      // Token vencido o revocado: se renueva una vez y se reintenta.
      const r = await db().auth.refreshSession();
      session = r.data.session;
      if (!session) {
        await db().auth.signOut().catch(() => undefined);
        window.location.assign('/login');
        throw new Error('Tu sesión expiró. Vuelve a entrar con tu nombre y código.');
      }
      ({ data, error } = await callEngine(action, body, session.access_token));
      if (!error) return data as T;
      e = await errorText(error);
    }
    throw new Error(e.message);
  }
  if (data && typeof data === 'object' && 'error' in data) throw new Error(String((data as { error: unknown }).error));
  return data as T;
}

// ─── Tipos del juego ───

export interface Unit {
  index: number;
  kind: 'matchday' | 'round';
  stage: 'regular' | 'group' | 'swiss' | 'playoff';
  matchday?: number;
  round?: string;
  leg?: 1 | 2;
  label: string;
  matches: number;
  main: boolean;
  interest?: number;
}

export interface Edition {
  id: string;
  competition_id: string;
  season_id: string;
  name: string;
  status: 'setup' | 'in_progress' | 'playoffs' | 'finished';
  config: Record<string, unknown> & { format: string; weight: number; competitionKey: string; playoffTeams?: number; relegated?: number; promoted?: number };
  state: { units: Unit[]; groups?: Record<string, string[]>; playoffSeeds?: string[] };
  champion_team_id: string | null;
  runner_up_team_id: string | null;
  created_at: string;
}

export interface Match {
  id: string;
  edition_id: string;
  stage: string;
  round: string | null;
  matchday: number | null;
  group_label: string | null;
  tie_key: string | null;
  leg: number | null;
  bracket_slot: number | null;
  unit_index: number;
  home_team_id: string;
  away_team_id: string;
  status: 'scheduled' | 'live' | 'finished' | 'cancelled';
  scheduled_at: string | null;
  neutral_venue: boolean;
  is_final: boolean;
  home_score: number | null;
  away_score: number | null;
  period_scores: number[][] | null;
  overtime: boolean;
  expected_home: number | null;
  expected_away: number | null;
  is_main_event: boolean;
  event_name: string | null;
  derby_score: number | null;
  mvp_player_id: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface Standing {
  edition_id: string;
  team_id: string;
  group_label: string;
  position: number;
  prev_position: number | null;
  played: number;
  wins: number;
  ot_wins: number;
  draws: number;
  ot_losses: number;
  losses: number;
  goals_for: number;
  goals_against: number;
  points: number;
  form: string;
}

export interface PlanBlock {
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

export interface PlanDay {
  id: string;
  date: string;
  status: 'planned' | 'running' | 'paused' | 'closed';
  published: boolean;
  mode: string;
  interest: number;
  matches: number;
  lives: number;
  blocks: PlanBlock[];
}

export interface Plan {
  days: PlanDay[];
  warnings: string[];
}

export interface ScheduleItem {
  id: string;
  day_id: string;
  kind: 'burst' | 'event' | 'summary' | 'draft' | 'market';
  edition_id: string | null;
  unit_index: number | null;
  match_id: string | null;
  match_ids: string[];
  burst_size: number | null;
  scheduled_at: string;
  sort_order: number;
  status: 'pending' | 'running' | 'done' | 'cancelled';
  label: string | null;
  result: { matches?: number; scores?: { id: string; h: string; a: string; hs: number; as: number; ot: boolean }[]; hs?: number; as?: number } | null;
}

export interface CompetitionDay {
  id: string;
  date: string;
  status: 'planned' | 'running' | 'paused' | 'closed';
  mode: string;
  published: boolean;
  announced: { name: string; at: string }[];
  started_at: string | null;
  closed_at: string | null;
}

export interface Offer {
  id: string;
  match_id: string | null;
  edition_id: string | null;
  market: 'winner' | 'total' | 'exact' | 'scorer' | 'mvp' | 'champion' | 'playoffs' | 'promotion' | 'relegation';
  selection: { pick?: string; line?: number; home?: number; away?: number; playerId?: string; teamId?: string; label?: string };
  odds: number;
  closes_at: string | null;
  active: boolean;
}

export interface Bet {
  id: string;
  user_id: string;
  source: 'credits' | 'club';
  parlay_id: string | null;
  match_id: string | null;
  edition_id: string | null;
  market: Offer['market'];
  selection: Offer['selection'];
  odds: number;
  stake: number;
  status: 'open' | 'won' | 'lost' | 'void';
  payout: number | null;
  created_at: string;
  settled_at: string | null;
}

export interface News {
  id: string;
  kind: string;
  tone: string;
  title: string;
  body: string;
  status: string;
  rumor_status: string;
  team_id: string | null;
  match_id: string | null;
  edition_id: string | null;
  pinned: boolean;
  ai_generated: boolean;
  published_at: string | null;
  created_at: string;
}

export interface TimelineEvent {
  second: number;
  type: 'period_start' | 'shot' | 'save' | 'goal' | 'penalty' | 'period_end' | 'overtime_start' | 'final';
  side?: 'home' | 'away';
  period: number;
  playerId?: string;
  player?: { name?: string; number?: number };
  assists?: string[];
  data?: { score?: [number, number]; powerPlay?: boolean; gameWinning?: boolean; minutes?: number };
}

export interface LiveFeed {
  status: Match['status'];
  server_now: string;
  started_at?: string;
  elapsed?: number;
  duration?: number;
  period_seconds?: number;
  events: TimelineEvent[];
}

export interface Probability {
  edition_id: string;
  team_id: string;
  champion: number;
  playoffs: number;
  promotion: number;
  relegation: number;
  iterations: number;
}

export interface PlayerStat {
  player_id: string;
  edition_id: string;
  team_id: string | null;
  gp: number;
  goals: number;
  assists: number;
  plus_minus: number;
  shots: number;
  pim: number;
  gwg: number;
  hat_tricks: number;
  mvps: number;
  saves: number;
  goals_against: number;
  shutouts: number;
  wins: number;
  goalie_gp: number;
}

// ─── Lecturas ───

async function rows<T>(p: PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export const getEditions = () => (DEMO_MODE ? Promise.resolve([]) : rows<Edition>(db().from('editions').select('*').order('created_at', { ascending: false })));

export async function getMatches(editionId: string): Promise<Match[]> {
  const out: Match[] = [];
  for (let from = 0; ; from += 1000) {
    const page = await rows<Match>(db().from('matches').select('*').eq('edition_id', editionId).order('unit_index').order('bracket_slot').range(from, from + 999));
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}

export const getStandings = (editionId: string) =>
  rows<Standing>(db().from('edition_standings').select('*').eq('edition_id', editionId).order('group_label').order('position'));

export const getProbabilities = (editionId: string) => rows<Probability>(db().from('probability_snapshots').select('*').eq('edition_id', editionId));

export const getTopPlayers = (editionId: string, order: 'goals' | 'assists' | 'mvps' | 'saves' = 'goals', limit = 20) =>
  rows<PlayerStat>(db().from('player_edition_stats').select('*').eq('edition_id', editionId).order(order, { ascending: false }).limit(limit));

export const getNews = (limit = 40) =>
  DEMO_MODE
    ? Promise.resolve([] as News[])
    : rows<News>(db().from('news').select('*').eq('status', 'published').order('pinned', { ascending: false }).order('published_at', { ascending: false }).limit(limit));

export async function getCurrentDay(): Promise<CompetitionDay | null> {
  if (DEMO_MODE) return null;
  const live = await rows<CompetitionDay>(db().from('competition_days').select('*').in('status', ['running', 'paused']).order('date').limit(1));
  if (live[0]) return live[0];
  const next = await rows<CompetitionDay>(db().from('competition_days').select('*').eq('status', 'planned').eq('published', true).order('date').limit(1));
  if (next[0]) return next[0];
  const last = await rows<CompetitionDay>(db().from('competition_days').select('*').eq('status', 'closed').order('date', { ascending: false }).limit(1));
  return last[0] ?? null;
}

export const getDayItems = (dayId: string) => rows<ScheduleItem>(db().from('schedule_items').select('*').eq('day_id', dayId).order('scheduled_at'));

export const getLiveMatches = () => (DEMO_MODE ? Promise.resolve([] as Match[]) : rows<Match>(db().from('matches').select('*').eq('status', 'live').order('started_at')));

export const getMatchesByIds = (ids: string[]) => (ids.length ? rows<Match>(db().from('matches').select('*').in('id', ids)) : Promise.resolve([] as Match[]));

export async function getLiveFeed(matchId: string): Promise<LiveFeed | null> {
  const { data, error } = await db().rpc('live_timeline', { p_match: matchId });
  if (error) throw new Error(error.message);
  return data as LiveFeed | null;
}

export const getMyBets = (userId: string) => rows<Bet>(db().from('bets').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(200));

export const getBettorBoard = async () => {
  const { data, error } = await db().rpc('bettor_leaderboard');
  if (error) throw new Error(error.message);
  return (data ?? []) as { user_id: string; display_name: string; bets: number; won: number; net: number }[];
};

export const getMatchBox = async (matchId: string) => {
  const { data, error } = await db().from('match_boxes').select('*').eq('match_id', matchId).maybeSingle();
  if (error) throw new Error(error.message);
  return data as { players: { playerId: string; side: string; name?: string; number?: number; goals: number; assists: number; shots: number; plusMinus: number; pim: number; saves: number; goalsAgainst: number; isMvp: boolean; isGoalie: boolean }[]; goals: { side: string; period: number; second: number; scorerId: string; assistIds: string[]; powerPlay: boolean }[] } | null;
};

export const getTeamStats = (matchId: string) =>
  rows<{ team_id: string; is_home: boolean; goals: number; shots: number; saves: number; penalties: number; pim: number; power_plays: number; power_play_goals: number; period_goals: number[] }>(
    db().from('match_team_stats').select('*').eq('match_id', matchId),
  );

export const getChat = (channel: string, limit = 60) =>
  rows<{ id: number; channel: string; user_id: string; body: string; created_at: string }>(
    db().from('chat_messages').select('*').eq('channel', channel).order('created_at', { ascending: false }).limit(limit),
  );

export const getPublicProfiles = () =>
  rows<{ id: string; display_name: string; role: string; star_team_id: string | null }>(db().from('public_profiles').select('id,display_name,role,star_team_id'));
