// Lee el documento "Información completa de la aplicación" exportado desde la
// app anterior (botón de copiar toda la información) y extrae las ediciones
// del historial con su campeón, subcampeón y tabla final.

export interface LegacyStanding {
  position: number;
  team: string;
  points: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
}

export interface LegacyEditionParsed {
  competition: string;
  season: string | null;
  champion: string | null;
  runnerUp: string | null;
  standings: LegacyStanding[];
  order: number;
}

/** Aletico y Acletico Metropolitano son el mismo equipo; se limpian espacios finales. */
export function normalizeTeamName(name: string): string {
  const n = name.trim().replace(/\s+/g, ' ');
  if (/^a(c|)letico metropolitano$/i.test(n)) return 'Aletico Metropolitano';
  return n;
}

export function parseLegacyMarkdown(md: string): LegacyEditionParsed[] {
  const lines = md.split(/\r?\n/);
  const out: LegacyEditionParsed[] = [];
  let cur: LegacyEditionParsed | null = null;

  const clean = (v: string) => {
    const t = v.trim();
    return t === '—' || t === '' ? null : normalizeTeamName(t);
  };

  for (const raw of lines) {
    const line = raw.trim();
    const heading = /^####\s+(.+?)\s+—\s+Temporada\s+(.+)$/.exec(line);
    if (heading) {
      cur = {
        competition: heading[1].trim(),
        season: heading[2].trim() === '—' ? null : heading[2].trim(),
        champion: null,
        runnerUp: null,
        standings: [],
        order: out.length + 1,
      };
      out.push(cur);
      continue;
    }
    if (!cur) continue;
    if (/^#{1,3}\s/.test(line)) {
      cur = null; // terminó la sección del historial
      continue;
    }
    const champ = /^-\s*Campeón:\s*(.*)$/.exec(line);
    if (champ) {
      cur.champion = clean(champ[1]);
      continue;
    }
    const runner = /^-\s*Subcampeón:\s*(.*)$/.exec(line);
    if (runner) {
      cur.runnerUp = clean(runner[1]);
      continue;
    }
    const row = /^\|\s*(\d+)\s*\|(.+)\|\s*(-?\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|$/.exec(line);
    if (row) {
      cur.standings.push({
        position: Number(row[1]),
        team: normalizeTeamName(row[2]),
        points: Number(row[3]),
        wins: Number(row[4]),
        draws: Number(row[5]),
        losses: Number(row[6]),
        goalsFor: Number(row[7]),
        goalsAgainst: Number(row[8]),
      });
    }
  }
  return out;
}
