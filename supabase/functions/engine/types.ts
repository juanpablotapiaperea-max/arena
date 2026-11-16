// Filas de la base de datos que usa el servidor.
import type { EditionConfig, EditionState, Format, MatchRow } from '../../../shared/competition/edition.ts';

export interface TeamRow {
  id: string;
  key: string;
  name: string;
  short_name: string;
  attack: number;
  defense: number;
  goalie: number;
  play_style: string;
  division: number | null;
  fan_base: number;
}

export interface PlayerRow {
  id: string;
  team_id: string | null;
  first_name: string;
  last_name: string;
  number: number;
  position: 'G' | 'D' | 'F';
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

export interface CompetitionRow {
  id: string;
  key: string;
  name: string;
  format: Format;
  participant_rule: Record<string, unknown>;
  config: EditionConfig;
  ranking_weight: number;
  permanent: boolean;
}

export interface EditionRow {
  id: string;
  competition_id: string;
  season_id: string;
  name: string;
  status: 'setup' | 'in_progress' | 'playoffs' | 'finished';
  config: EditionConfig & { format: Format; weight: number; competitionKey: string };
  state: EditionState;
  champion_team_id: string | null;
  runner_up_team_id: string | null;
}

export interface MatchDb {
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
  overtime: boolean;
  is_main_event: boolean;
  event_name: string | null;
  derby_score: number | null;
  started_at: string | null;
}

export const MATCH_COLS =
  'id,edition_id,stage,round,matchday,group_label,tie_key,leg,bracket_slot,unit_index,home_team_id,away_team_id,status,scheduled_at,neutral_venue,is_final,home_score,away_score,overtime,is_main_event,event_name,derby_score,started_at';

export function toMatchRow(m: MatchDb): MatchRow {
  return {
    unitIndex: m.unit_index,
    stage: m.stage,
    round: m.round,
    leg: m.leg,
    slot: m.bracket_slot,
    group: m.group_label,
    home: m.home_team_id,
    away: m.away_team_id,
    homeScore: m.home_score,
    awayScore: m.away_score,
    overtime: m.overtime,
    finished: m.status === 'finished',
  };
}

export interface ScheduleItem {
  id: string;
  day_id: string;
  kind: 'burst' | 'event' | 'draft' | 'market' | 'summary';
  edition_id: string | null;
  block_id: string | null;
  unit_index: number | null;
  match_id: string | null;
  match_ids: string[];
  burst_size: number | null;
  scheduled_at: string;
  sort_order: number;
  status: 'pending' | 'running' | 'done' | 'cancelled';
  label: string | null;
  result: Record<string, unknown> | null;
}

export interface DayRow {
  id: string;
  date: string;
  status: 'planned' | 'running' | 'paused' | 'closed';
  mode: string;
  published: boolean;
  started_at: string | null;
  closed_at: string | null;
}
