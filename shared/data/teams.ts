// Datos iniciales (sección 17): 54 equipos ordenados por puntos iniciales
// (100 por título y 70 por subcampeonato) con el desempate de la sección 5.
// Aletico y Acletico Metropolitano están unificados.

export interface SeedTeam {
  rank: number;
  name: string;
  attack: number;
  defense: number;
  goalie: number;
  titles: number;
  runnersUp: number;
  points: number;
}

const RAW: [string, number, number, number, number, number, number][] = [
  ['Kings', 93, 93, 92, 17, 16, 2820],
  ['Ducks', 93, 93, 92, 15, 15, 2550],
  ['Ice Breakers', 93, 92, 90, 10, 14, 1980],
  ['Ice Dragons', 93, 93, 92, 11, 11, 1870],
  ['The Lightnings', 93, 91, 95, 13, 8, 1860],
  ['IMALAYAS HC', 92, 93, 92, 11, 8, 1660],
  ['Teletes', 94, 92, 94, 11, 7, 1590],
  ['Falcons', 94, 93, 92, 11, 6, 1520],
  ['Penguins', 90, 90, 95, 7, 7, 1190],
  ['Aletico Metropolitano', 93, 88, 89, 9, 3, 1110],
  ['Horizon', 93, 91, 92, 6, 6, 1020],
  ['Cuervos', 93, 88, 88, 6, 5, 950],
  ['Berserkers', 97, 87, 87, 1, 8, 660],
  ['Titans', 90, 96, 89, 2, 6, 620],
  ['Vikings', 90, 83, 90, 2, 6, 620],
  ['Wolves', 94, 85, 86, 4, 3, 610],
  ['Panthers', 93, 87, 85, 3, 4, 580],
  ['Dolphins', 84, 86, 89, 3, 3, 510],
  ['Bears', 91, 88, 90, 2, 4, 480],
  ['Raptors', 94, 92, 93, 2, 3, 410],
  ['Boing', 93, 95, 90, 1, 4, 380],
  ['Angels', 87, 83, 96, 3, 1, 370],
  ['Axolotls', 88, 91, 88, 2, 2, 340],
  ['Demons', 87, 100, 85, 2, 2, 340],
  ['Salamaders', 91, 82, 88, 1, 3, 310],
  ['Black Horses', 95, 88, 85, 3, 0, 300],
  ['RHINOS', 92, 84, 75, 3, 0, 300],
  ['AZTECZ', 91, 88, 85, 2, 1, 270],
  ['Foxes', 87, 87, 92, 1, 2, 240],
  ['YETIS', 88, 89, 90, 1, 2, 240],
  ['OWLS', 90, 84, 93, 1, 1, 170],
  ['Perry the platypus', 93, 89, 89, 1, 1, 170],
  ['Salmons', 88, 86, 87, 1, 1, 170],
  ['Phantoms', 93, 91, 91, 0, 2, 140],
  ['Cobras', 90, 84, 89, 1, 0, 100],
  ['Krakens', 91, 89, 95, 1, 0, 100],
  ['Toros', 88, 91, 88, 1, 0, 100],
  ['HEX Clankers', 88, 83, 81, 0, 1, 70],
  ['Huskys', 87, 91, 89, 0, 1, 70],
  ['Pirates', 88, 97, 86, 0, 1, 70],
  ['Tigers', 86, 86, 89, 0, 1, 70],
  ['United', 92, 89, 93, 0, 1, 70],
  ['Wyvers', 87, 91, 82, 0, 1, 70],
  ['Coyotes', 86, 88, 88, 0, 0, 0],
  ['Griffins', 89, 89, 93, 0, 0, 0],
  ['Knights', 93, 91, 93, 0, 0, 0],
  ['Mamuts', 81, 94, 90, 0, 0, 0],
  ['Only', 81, 79, 100, 0, 0, 0],
  ['Ronins', 94, 88, 89, 0, 0, 0],
  ['Scorpions', 93, 89, 82, 0, 0, 0],
  ['Sharks', 92, 80, 85, 0, 0, 0],
  ['Spartans', 86, 88, 90, 0, 0, 0],
  ['Whales', 87, 92, 86, 0, 0, 0],
  ['Zuricatas', 93, 84, 87, 0, 0, 0],
];

export const SEED_TEAMS: SeedTeam[] = RAW.map(([name, attack, defense, goalie, titles, runnersUp, points], i) => ({
  rank: i + 1,
  name: name.trim(),
  attack,
  defense,
  goalie,
  titles,
  runnersUp,
  points,
}));

/** Puestos 1-27 empiezan en Primera División; 28-54 en Segunda. */
export const divisionForRank = (rank: number): 1 | 2 => (rank <= 27 ? 1 : 2);

export const INITIAL_BUDGET = 50_000_000;
