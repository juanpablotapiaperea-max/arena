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
