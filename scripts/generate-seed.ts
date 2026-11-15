// Genera supabase/seed.sql con los datos iniciales (sección 17):
// 54 equipos, 1,080 jugadores, estadios, ranking histórico, competiciones,
// la temporada 1 y la configuración global. Es determinista.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { generateAllRosters, generateTeams } from '../shared/data/generate.ts';
import { COMPETITIONS } from '../shared/data/competitions.ts';
import { DEFAULT_SETTINGS } from '../shared/data/settings.ts';

/** UUID estable a partir de un texto, para que el seed sea reproducible. */
export function stableUuid(text: string): string {
  const h = createHash('sha256').update(`arena:${text}`).digest('hex');
  const v = (parseInt(h[16], 16) & 0x3) | 0x8;
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${v.toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const q = (v: unknown): string => {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return `'${String(v).replace(/'/g, "''")}'`;
};
const j = (v: unknown) => `${q(JSON.stringify(v))}::jsonb`;

export function buildSeedSql(): string {
  const teams = generateTeams();
  const players = generateAllRosters();
  const out: string[] = [];
  out.push('-- Generado por scripts/generate-seed.ts. No editar a mano.');
  out.push('begin;');
  out.push("select set_config('arena.skip_log', 'on', true);");

  // Configuración
  for (const s of DEFAULT_SETTINGS) {
    out.push(
      `insert into settings (key, value, is_public) values (${q(s.key)}, ${j(s.value)}, ${q(s.isPublic)}) on conflict (key) do nothing;`,
    );
  }

  // Equipos
  const teamId = new Map<string, string>();
  for (const t of teams) {
    const id = stableUuid(`team:${t.key}`);
    teamId.set(t.key, id);
    const fanBase = Math.round(30 + 70 * Math.sqrt(t.legacyPoints / 2820));
    out.push(
      `insert into teams (id, key, name, short_name, primary_color, secondary_color, attack, defense, goalie, division, fan_base, initial_rank) values (${[
        q(id), q(t.key), q(t.name), q(t.shortName), q(t.primaryColor), q(t.secondaryColor),
        q(t.targetAttack), q(t.targetDefense), q(t.targetGoalie), q(t.division), q(fanBase), q(t.initialRank),
      ].join(', ')});`,
    );
    out.push(`insert into team_private (team_id, budget, ai_strategy) values (${q(id)}, ${q(t.budget)}, ${q(t.aiStrategy)});`);
    const level = t.initialRank <= 10 ? 4 : t.initialRank <= 25 ? 3 : t.initialRank <= 40 ? 2 : 1;
    const capacity = { 1: 6000, 2: 9000, 3: 12000, 4: 16000 }[level];
    out.push(
      `insert into stadiums (id, team_id, name, capacity, level, color) values (${q(stableUuid(`stadium:${t.key}`))}, ${q(id)}, ${q(`Arena ${t.name}`)}, ${capacity}, ${level}, ${q(t.primaryColor)});`,
    );
    // Ranking histórico inicial: 100 por título y 70 por subcampeonato, sin pesos.
    out.push(
      `insert into ranking_entries (id, team_id, season_id, points, titles, runners_up, breakdown) values (${q(stableUuid(`rank:${t.key}`))}, ${q(id)}, null, ${t.legacyPoints}, ${t.legacyTitles}, ${t.legacyRunnersUp}, ${j({ legacy: t.legacyPoints })});`,
    );
  }

  // Jugadores (inserción en bloques)
  const rows = players.map((p, i) => {
    const id = stableUuid(`player:${p.teamKey}:${i}`);
    return `(${[
      q(id), q(teamId.get(p.teamKey)), q(p.firstName), q(p.lastName), q(p.number), q(p.position), q(p.rating),
      q(p.age), q(p.potential), q(p.form), q(p.morale), q(p.salary), q(p.contractYears),
    ].join(', ')})`;
  });
  for (let i = 0; i < rows.length; i += 200) {
    out.push(
      'insert into players (id, team_id, first_name, last_name, number, position, rating, age, potential, form, morale, salary, contract_years) values\n' +
        rows.slice(i, i + 200).join(',\n') +
        ';',
    );
  }

  // Competiciones
  for (const c of COMPETITIONS) {
    out.push(
      `insert into competitions (id, key, name, format, participant_rule, config, ranking_weight, permanent, sort_order) values (${[
        q(stableUuid(`competition:${c.key}`)), q(c.key), q(c.name), q(c.format), j(c.participantRule), j(c.config),
        q(c.rankingWeight), q(c.permanent), q(c.sortOrder),
      ].join(', ')});`,
    );
  }

  // Temporada 1
  out.push(`insert into seasons (id, number, status) values (${q(stableUuid('season:1'))}, 1, 'active');`);

  out.push('commit;');
  return out.join('\n') + '\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = fileURLToPath(new URL('../supabase/seed.sql', import.meta.url));
  writeFileSync(path, buildSeedSql());
  console.log(`seed escrito en ${path}`);
}
