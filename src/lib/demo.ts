// Datos de demostración generados en el navegador a partir de la sección 17.
import { generateAllRosters, generateTeams } from '@shared/data/generate';
import { COMPETITIONS } from '@shared/data/competitions';
import type { Competition, Player, RankingEntry, Team } from './types';

let cache: { teams: Team[]; players: Player[]; ranking: RankingEntry[]; competitions: Competition[] } | null = null;

export function demoData() {
  if (cache) return cache;
  const gTeams = generateTeams();
  const teams: Team[] = gTeams.map((t) => ({
    id: t.key,
    key: t.key,
    name: t.name,
    short_name: t.shortName,
    primary_color: t.primaryColor,
    secondary_color: t.secondaryColor,
    crest_url: null,
    attack: t.targetAttack,
    defense: t.targetDefense,
    goalie: t.targetGoalie,
    play_style: 'equilibrado',
    division: t.division,
    fan_base: 50,
    initial_rank: t.initialRank,
  }));
  const players: Player[] = generateAllRosters().map((p, i) => ({
    id: `${p.teamKey}-${i}`,
    team_id: p.teamKey,
    first_name: p.firstName,
    last_name: p.lastName,
    number: p.number,
    position: p.position,
    rating: p.rating,
    age: p.age,
    potential: p.potential,
    form: p.form,
    morale: p.morale,
    salary: p.salary,
    contract_years: p.contractYears,
    injury_days: 0,
    retired: false,
  }));
  const ranking: RankingEntry[] = gTeams.map((t) => ({
    team_id: t.key,
    season_id: null,
    points: t.legacyPoints,
    titles: t.legacyTitles,
    runners_up: t.legacyRunnersUp,
  }));
  const competitions: Competition[] = COMPETITIONS.map((c) => ({
    id: c.key,
    key: c.key,
    name: c.name,
    format: c.format,
    ranking_weight: c.rankingWeight,
    permanent: c.permanent,
    participant_rule: c.participantRule,
    config: c.config,
  }));
  cache = { teams, players, ranking, competitions };
  return cache;
}
