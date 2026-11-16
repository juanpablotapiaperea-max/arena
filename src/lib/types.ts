// Tipos de las filas que lee el frontend.

export type UserRole = 'admin' | 'owner' | 'spectator';
export type Position = 'G' | 'D' | 'F';

export interface Team {
  id: string;
  key: string;
  name: string;
  short_name: string;
  primary_color: string;
  secondary_color: string;
  crest_url: string | null;
  attack: number;
  defense: number;
  goalie: number;
  play_style: string;
  play_style_locked?: boolean;
  division: 1 | 2 | null;
  fan_base: number;
  initial_rank: number | null;
}

export interface Player {
  id: string;
  team_id: string | null;
  first_name: string;
  last_name: string;
  number: number;
  position: Position;
  rating: number;
  age: number;
  potential: number;
  form: number;
  morale: number;
  salary: number;
  contract_years: number;
  injury_days: number;
  retired: boolean;
}

export interface RankingEntry {
  team_id: string;
  season_id: string | null;
  points: number;
  titles: number;
  runners_up: number;
}

export interface LegacyEdition {
  id: string;
  competition_name: string;
  season_label: string | null;
  champion_name: string | null;
  runner_up_name: string | null;
  champion_team_id: string | null;
  runner_up_team_id: string | null;
  top3: unknown;
  import_order: number | null;
}

export interface Profile {
  id: string;
  display_name: string;
  login_slug: string;
  role: UserRole;
  club_team_id: string | null;
  favorite_team_ids: string[];
  star_team_id: string | null;
  credits: number;
  muted_until: string | null;
}

export interface AdminLogEntry {
  id: number;
  created_at: string;
  action: string;
  entity: string;
  entity_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  undone_at: string | null;
}

export interface Competition {
  id: string;
  key: string;
  name: string;
  format: string;
  ranking_weight: number;
  permanent: boolean;
  participant_rule: Record<string, unknown>;
  config: Record<string, unknown>;
}

export const POSITION_LABEL: Record<Position, string> = { G: 'Portero', D: 'Defensa', F: 'Delantero' };
export const POSITION_SHORT: Record<Position, string> = { G: 'POR', D: 'DEF', F: 'DEL' };
