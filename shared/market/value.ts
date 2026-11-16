// Valor de mercado y reglas de la IA de fichajes (sección 7).

export type Strategy = 'estrella' | 'cantera' | 'defensivo' | 'equilibrado' | 'austeridad';

export interface MarketPlayer {
  id: string;
  team_id: string | null;
  position: 'G' | 'D' | 'F';
  rating: number;
  age: number;
  potential: number;
  contract_years: number;
  salary: number;
}

/** Valor de traspaso en USD: atributo, edad, potencial y años de contrato. */
export function playerValue(p: Pick<MarketPlayer, 'rating' | 'age' | 'potential' | 'contract_years'>): number {
  const q = Math.max(0, (p.rating - 55) / 45);
  const base = 300_000 + Math.pow(q, 3) * 14_000_000;
  const age = p.age <= 21 ? 1.25 : p.age <= 25 ? 1.15 : p.age <= 29 ? 1 : p.age <= 32 ? 0.8 : 0.55;
  const growth = 1 + Math.max(0, p.potential - p.rating) / 40;
  const contract = 0.7 + 0.1 * Math.min(5, Math.max(0, p.contract_years));
  return Math.round((base * age * growth * contract) / 50_000) * 50_000;
}

/** Cuánto pide el vendedor sobre el valor según su estrategia y si es pieza clave. */
export function sellerAsk(value: number, strategy: Strategy, isKey: boolean, age: number): number {
  let f = strategy === 'austeridad' ? 1.0 : strategy === 'estrella' ? 1.25 : 1.12;
  if (strategy === 'cantera' && age >= 29) f -= 0.15; // vende veteranos
  if (isKey) f += 0.35;
  return Math.round(value * f);
}

/** Lo máximo que paga el comprador sobre el valor. */
export function buyerMax(value: number, strategy: Strategy, budget: number): number {
  const f = strategy === 'estrella' ? 1.35 : strategy === 'austeridad' ? 0.95 : 1.15;
  const cap = strategy === 'estrella' ? 0.6 : strategy === 'austeridad' ? 0.2 : 0.35;
  return Math.min(Math.round(value * f), Math.floor(budget * cap));
}

/**
 * Negociación de hasta 3 rondas: oferta, contraoferta y cierre a mitad de
 * camino. Devuelve el precio acordado o null si no hay trato.
 */
export function negotiate(value: number, ask: number, max: number, rounds = 3): { price: number | null; steps: { by: 'buyer' | 'seller'; amount: number }[] } {
  const steps: { by: 'buyer' | 'seller'; amount: number }[] = [];
  let offer = Math.min(max, Math.round(value * 0.85));
  let counter = ask;
  for (let r = 0; r < rounds; r++) {
    steps.push({ by: 'buyer', amount: offer });
    if (offer >= counter) return { price: offer, steps };
    steps.push({ by: 'seller', amount: counter });
    if (counter <= max && r === rounds - 1) return { price: counter, steps };
    const mid = Math.round((offer + counter) / 2);
    offer = Math.min(max, mid);
    counter = Math.max(offer, Math.round(counter * 0.95));
  }
  return { price: null, steps };
}

/** Qué posición quiere reforzar cada estrategia y con qué filtro. */
export function wants(strategy: Strategy, roster: MarketPlayer[]) {
  const by = (pos: 'G' | 'D' | 'F') => roster.filter((p) => p.position === pos).sort((a, b) => b.rating - a.rating);
  const starters = { G: by('G').slice(0, 1), D: by('D').slice(0, 6), F: by('F').slice(0, 12) };
  const avg = (xs: MarketPlayer[]) => xs.reduce((s, p) => s + p.rating, 0) / Math.max(1, xs.length);
  const gap = (pos: 'G' | 'D' | 'F') => avg(starters[pos]) - (starters[pos][starters[pos].length - 1]?.rating ?? 0);
  let order: ('G' | 'D' | 'F')[] = (['G', 'D', 'F'] as const).slice().sort((a, b) => gap(b) - gap(a));
  if (strategy === 'defensivo') order = ['G', 'D', 'F'];
  if (strategy === 'estrella') order = ['F', 'D', 'G'];
  const position = order[0];
  const weakest = starters[position][starters[position].length - 1];
  return {
    position,
    weakest,
    filter: (p: MarketPlayer) => {
      if (p.position !== position) return false;
      if (!weakest || p.rating < weakest.rating + 2) return false;
      if (strategy === 'cantera') return p.age <= 23 && p.potential >= p.rating + 4;
      if (strategy === 'estrella') return p.rating >= 88;
      return true;
    },
  };
}
