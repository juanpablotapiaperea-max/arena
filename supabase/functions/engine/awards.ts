// Balón de Oro: el administrador elige al ganador entre los nominados.
import { AppError, q, type DB } from './db.ts';
import { publish } from './news.ts';

export async function giveBalonOro(db: DB, playerId: string) {
  const season = await q<{ id: string; number: number }>(db.from('seasons').select('id,number').eq('status', 'active').order('number', { ascending: false }).limit(1).single());
  const race = await q<{ player_id: string; team_id: string; score: number; goals: number; assists: number; mvps: number; titles: string[] }[]>(
    db.rpc('balon_oro_race', { p_season: season.id, p_limit: 50 }),
  );
  const pick = race.find((r) => r.player_id === playerId);
  if (!pick) throw new AppError('Ese jugador no está entre los candidatos de esta temporada');
  const p = await q<{ first_name: string; last_name: string; position: string }>(db.from('players').select('first_name,last_name,position').eq('id', playerId).single());
  const team = await q<{ name: string }>(db.from('teams').select('name').eq('id', pick.team_id).single());
  const name = `${p.first_name} ${p.last_name}`;
  // Reemplaza si ya se había entregado esta temporada.
  await q(db.from('awards').delete().eq('season_id', season.id).eq('kind', 'balon_oro'));
  await q(
    db.from('awards').insert({ season_id: season.id, kind: 'balon_oro', player_id: playerId, team_id: pick.team_id, value: pick.score, label: `Balón de Oro · Temporada ${season.number}` }),
  );
  const facts = `${name} (${team.name}) gana el Balón de Oro de la temporada ${season.number} de ARENA. Números de la temporada: ${pick.goals} goles, ${pick.assists} asistencias, ${pick.mvps} veces MVP de partido y títulos: ${pick.titles.length ? pick.titles.join(', ') : 'ninguno'}.`;
  await publish(db, {
    kind: 'campeon',
    facts,
    tone: 'medio',
    teamId: pick.team_id,
    playerId,
    fallback: {
      title: `¡${name} gana el Balón de Oro!`,
      body: `${name}, figura de ${team.name}, es el mejor jugador de la temporada ${season.number}.\n\nCerró el año con ${pick.goals} goles, ${pick.assists} asistencias y ${pick.mvps} premios al jugador del partido${pick.titles.length ? `, además de ganar ${pick.titles.join(' y ')} con su club` : ''}.\n\nUn premio que ya brilla en la vitrina de ${team.name}.`,
    },
  });
  return { ok: true, player: name, team: team.name };
}
