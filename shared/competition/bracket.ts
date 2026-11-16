// Cuadros de playoffs (sección 4): siembra clásica 1 vs último, 2 vs penúltimo…
// Si el número de equipos no es potencia de 2, los mejores sembrados descansan
// la primera ronda (ronda previa). Al completarse una ronda se crean solo los
// cruces que faltan, sin duplicados.

export const ROUND_NAMES = ['previa', 'dieciseisavos', 'octavos', 'cuartos', 'semifinal', 'final'] as const;
export type RoundName = (typeof ROUND_NAMES)[number];

/** Nombre de la ronda según cuántos equipos la juegan. */
export function roundNameFor(teamsInRound: number): RoundName {
  if (teamsInRound <= 2) return 'final';
  if (teamsInRound <= 4) return 'semifinal';
  if (teamsInRound <= 8) return 'cuartos';
  if (teamsInRound <= 16) return 'octavos';
  if (teamsInRound <= 32) return 'dieciseisavos';
  return 'previa';
}

export const isMainEventRound = (r: string) => r === 'cuartos' || r === 'semifinal' || r === 'final';

export interface Pairing {
  /** Posición en el cuadro (0 = arriba). */
  slot: number;
  high: string; // mejor sembrado (local en partido único)
  low: string;
}

/** Orden de siembra estándar para un cuadro de tamaño n (potencia de 2): 1,16,8,9,4,13,5,12,… */
export function bracketOrder(n: number): number[] {
  let order = [1];
  while (order.length < n) {
    const size = order.length * 2;
    order = order.flatMap((s) => [s, size + 1 - s]);
  }
  return order;
}

const nextPow2 = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(1, n)));

export interface BracketPlan {
  /** Cruces de la ronda previa (los peor sembrados). Vacío si no hace falta. */
  preliminary: Pairing[];
  /** Equipos que descansan la primera ronda (mejores sembrados). */
  byes: string[];
  /** Tamaño del cuadro principal (potencia de 2). */
  mainSize: number;
}

/**
 * Planea la primera ronda para `seeds` ordenados de mejor a peor.
 * Ej.: 24 equipos → cuadro principal de 16; los 8 mejores descansan y los
 * puestos 9-24 juegan la previa (9 vs 24, 10 vs 23…).
 */
export function planBracket(seeds: string[]): BracketPlan {
  const n = seeds.length;
  const pow = nextPow2(n);
  if (pow === n) return { preliminary: [], byes: [], mainSize: n };
  const mainSize = pow / 2;
  const byesCount = 2 * mainSize - n; // equipos que pasan directo
  const byes = seeds.slice(0, byesCount);
  const rest = seeds.slice(byesCount);
  const preliminary: Pairing[] = [];
  for (let i = 0; i < rest.length / 2; i++) {
    preliminary.push({ slot: i, high: rest[i], low: rest[rest.length - 1 - i] });
  }
  return { preliminary, byes, mainSize };
}

/**
 * Arma los cruces del cuadro principal a partir de los equipos ya
 * clasificados, ordenados por siembra original (mejor primero).
 */
export function mainBracket(seeded: string[]): Pairing[] {
  const n = seeded.length;
  const order = bracketOrder(n);
  const pairs: Pairing[] = [];
  for (let i = 0; i < n; i += 2) {
    const a = seeded[order[i] - 1];
    const b = seeded[order[i + 1] - 1];
    pairs.push({ slot: i / 2, high: a, low: b });
  }
  return pairs;
}

/**
 * Siguiente ronda: los ganadores de los slots 0-1, 2-3… se enfrentan.
 * Devuelve solo los cruces nuevos (no repite los que ya existen).
 * `winners[slot]` es el ganador de cada cruce de la ronda actual (o undefined
 * si aún no termina). `seedRank` decide quién es local (mejor sembrado).
 */
export function nextRound(
  winners: (string | undefined)[],
  existingSlots: Set<number>,
  seedRank: Map<string, number>,
): Pairing[] {
  const out: Pairing[] = [];
  for (let i = 0; i + 1 < winners.length; i += 2) {
    const slot = i / 2;
    const a = winners[i];
    const b = winners[i + 1];
    if (!a || !b || existingSlots.has(slot)) continue;
    const [high, low] = (seedRank.get(a) ?? 999) <= (seedRank.get(b) ?? 999) ? [a, b] : [b, a];
    out.push({ slot, high, low });
  }
  return out;
}
