import { describe, expect, it } from 'vitest';
import { normalizeTeamName, parseLegacyMarkdown } from '../scripts/legacy-parser.ts';

const SAMPLE = `
### Historial de temporadas (2)

#### OHL — Temporada 2026
- Campeón: Kings
- Subcampeón: Acletico Metropolitano

| # | Equipo | Pts | G | E | P | GF | GC |
|---|---|---|---|---|---|---|---|
| 1 | Kings | 80 | 26 | 2 | 4 | 150 | 90 |
| 2 | Acletico Metropolitano  | 75 | 24 | 3 | 5 | 140 | 95 |

#### TECATE — Temporada —
- Campeón: Ducks
- Subcampeón: —

### Noticias recientes (0)
`;

describe('importación del historial', () => {
  it('unifica Aletico y Acletico Metropolitano y limpia espacios', () => {
    expect(normalizeTeamName('Acletico Metropolitano ')).toBe('Aletico Metropolitano');
    expect(normalizeTeamName('  Aletico   Metropolitano')).toBe('Aletico Metropolitano');
  });

  it('extrae ediciones, campeón, subcampeón y tabla', () => {
    const eds = parseLegacyMarkdown(SAMPLE);
    expect(eds).toHaveLength(2);
    expect(eds[0]).toMatchObject({ competition: 'OHL', season: '2026', champion: 'Kings', runnerUp: 'Aletico Metropolitano' });
    expect(eds[0].standings).toHaveLength(2);
    expect(eds[0].standings[1]).toMatchObject({ team: 'Aletico Metropolitano', points: 75, goalsFor: 140 });
    expect(eds[1]).toMatchObject({ competition: 'TECATE', season: null, champion: 'Ducks', runnerUp: null });
  });
});

describe('historial real de la app anterior', () => {
  it('trae 171 ediciones y cuadra con los títulos de la sección 17', async () => {
    const { readFileSync } = await import('node:fs');
    const { SEED_TEAMS } = await import('../shared/data/teams.ts');
    const eds = parseLegacyMarkdown(readFileSync(new URL('../data/legacy/historial-base44.md', import.meta.url), 'utf8'));
    expect(eds).toHaveLength(171);
    const count = new Map<string, [number, number]>();
    for (const e of eds) {
      if (e.champion) count.set(e.champion, [(count.get(e.champion)?.[0] ?? 0) + 1, count.get(e.champion)?.[1] ?? 0]);
      if (e.runnerUp) count.set(e.runnerUp, [count.get(e.runnerUp)?.[0] ?? 0, (count.get(e.runnerUp)?.[1] ?? 0) + 1]);
    }
    for (const t of SEED_TEAMS) {
      expect(count.get(t.name) ?? [0, 0], t.name).toEqual([t.titles, t.runnersUp]);
    }
  });
});
