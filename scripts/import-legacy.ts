// Importa el historial (171 ediciones) a legacy_editions.
// Uso:
//   npx tsx scripts/import-legacy.ts ruta/al/export.md            → genera supabase/legacy.sql
//   psql "$DATABASE_URL" -f supabase/legacy.sql                     → lo carga
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseLegacyMarkdown } from './legacy-parser.ts';

const file = process.argv[2];
if (!file) {
  console.error('Uso: npx tsx scripts/import-legacy.ts <export.md>');
  process.exit(1);
}

const editions = parseLegacyMarkdown(readFileSync(file, 'utf8'));
const q = (v: unknown) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const teamRef = (name: string | null) => (name ? `(select id from teams where lower(name) = lower(${q(name)}))` : 'null');

const sql = [
  '-- Generado por scripts/import-legacy.ts',
  'begin;',
  "select set_config('arena.skip_log', 'on', true);",
  'delete from legacy_editions;',
  ...editions.map(
    (e) =>
      `insert into legacy_editions (competition_name, season_label, champion_name, champion_team_id, runner_up_name, runner_up_team_id, top3, standings, import_order) values (${[
        q(e.competition),
        q(e.season),
        q(e.champion),
        teamRef(e.champion),
        q(e.runnerUp),
        teamRef(e.runnerUp),
        `${q(JSON.stringify(e.standings.slice(0, 3).map((s) => s.team)))}::jsonb`,
        `${q(JSON.stringify(e.standings))}::jsonb`,
        e.order,
      ].join(', ')});`,
  ),
  'commit;',
].join('\n');

const out = fileURLToPath(new URL('../supabase/legacy.sql', import.meta.url));
writeFileSync(out, sql + '\n');

const champions = new Map<string, number>();
for (const e of editions) if (e.champion) champions.set(e.champion, (champions.get(e.champion) ?? 0) + 1);
console.log(`${editions.length} ediciones → ${out}`);
console.log('Títulos por equipo (para comparar con la sección 17):');
[...champions.entries()].sort((a, b) => b[1] - a[1]).forEach(([t, n]) => console.log(`  ${t}: ${n}`));
