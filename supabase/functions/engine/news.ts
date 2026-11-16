// Prensa (sección 9): un detector de hechos produce sucesos con sus datos y
// Claude redacta cada pieza. Sin clave o con el tope diario agotado, se usan
// plantillas de respaldo. La clave vive solo en los secretos del servidor.
import Anthropic from 'npm:@anthropic-ai/sdk';
import { all, getSetting, q, type DB } from './db.ts';
import type { EditionRow, MatchDb, TeamRow } from './types.ts';

type Tone = 'suave' | 'medio' | 'picante';

interface PressSettings {
  tone: Tone;
  autoPublish: Record<Tone, boolean>;
  dailyBudgetUsd: number;
  aiEnabled: boolean;
}

const MODEL = 'claude-opus-5-5';
// Precio por millón de tokens (entrada / salida) para llevar el gasto diario.
const PRICE_IN = 4;
const PRICE_OUT = 20;

const SYSTEM = `Eres el redactor de ARENA, una liga ficticia de hockey 5v5 que sigue una clase como si fuera una transmisión deportiva.
Escribe en español de México, con ritmo de crónica deportiva: frases cortas, datos concretos, nombres propios.
Los equipos, jugadores y directivas son ficticios: puedes inventar declaraciones, rumores y dramas de vestuario sobre ellos.
Nunca hables de personas reales ni de los alumnos; si aparece un dueño o un usuario, menciona solo lo que hizo dentro del juego.
Usa únicamente los datos que te doy; no inventes marcadores ni estadísticas.
Responde exactamente con este formato:
TÍTULO: <titular de máximo 90 caracteres>
<cuerpo de 2 a 4 párrafos cortos>`;

const TONE_HINT: Record<Tone, string> = {
  suave: 'Tono: informativo y amable.',
  medio: 'Tono: con emoción y algo de opinión, como un comentarista apasionado.',
  picante: 'Tono: picante, con polémica, rivalidades y frases provocadoras, sin insultos ni groserías.',
};

async function settings(db: DB): Promise<PressSettings> {
  return getSetting(db, 'press', { tone: 'medio', autoPublish: { suave: true, medio: true, picante: false }, dailyBudgetUsd: 1, aiEnabled: true });
}

async function spentToday(db: DB): Promise<number> {
  const day = new Date().toISOString().slice(0, 10);
  const row = await q<{ cost_usd: number } | null>(db.from('ai_usage').select('cost_usd').eq('day', day).maybeSingle());
  return Number(row?.cost_usd ?? 0);
}

async function track(db: DB, input: number, output: number) {
  const day = new Date().toISOString().slice(0, 10);
  const cost = (input * PRICE_IN + output * PRICE_OUT) / 1_000_000;
  const row = await q<{ requests: number; input_tokens: number; output_tokens: number; cost_usd: number } | null>(
    db.from('ai_usage').select('*').eq('day', day).maybeSingle(),
  );
  await q(
    db.from('ai_usage').upsert({
      day,
      requests: (row?.requests ?? 0) + 1,
      input_tokens: Number(row?.input_tokens ?? 0) + input,
      output_tokens: Number(row?.output_tokens ?? 0) + output,
      cost_usd: Number(row?.cost_usd ?? 0) + cost,
    }),
  );
}

/** Pide la pieza a Claude. Devuelve null si no hay clave, se agotó el tope o falla. */
async function writeWithClaude(db: DB, facts: string, tone: Tone): Promise<{ title: string; body: string } | null> {
  const cfg = await settings(db);
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key || !cfg.aiEnabled) return null;
  if ((await spentToday(db)) >= cfg.dailyBudgetUsd) return null;
  try {
    const client = new Anthropic({ apiKey: key });
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 1200,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: SYSTEM,
      messages: [{ role: 'user', content: `${TONE_HINT[tone]}\n\nHechos:\n${facts}` }],
    } as Parameters<typeof client.beta.messages.create>[0]);
    const msg = response as Anthropic.Beta.BetaMessage;
    await track(db, msg.usage.input_tokens, msg.usage.output_tokens);
    if (msg.stop_reason === 'refusal') return null;
    const text = msg.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    const m = /^T[IÍ]TULO:\s*(.+)\n+([\s\S]+)$/i.exec(text);
    if (!m) return null;
    return { title: m[1].trim().slice(0, 140), body: m[2].trim() };
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.APIError) return null;
    return null;
  }
}

/** Publica una noticia: lo picante pasa por la cola del administrador. */
export async function publish(
  db: DB,
  n: { kind: string; facts: string; fallback: { title: string; body: string }; tone?: Tone; teamId?: string | null; matchId?: string | null; editionId?: string | null; playerId?: string | null; rumor?: boolean },
) {
  const cfg = await settings(db);
  const tone = n.tone ?? cfg.tone;
  const ai = await writeWithClaude(db, n.facts, tone);
  const piece = ai ?? n.fallback;
  const auto = cfg.autoPublish?.[tone] ?? tone !== 'picante';
  await q(
    db.from('news').insert({
      kind: n.kind,
      tone,
      title: piece.title,
      body: piece.body,
      status: auto ? 'published' : 'pending',
      rumor_status: n.rumor ? 'rumor' : 'none',
      team_id: n.teamId ?? null,
      match_id: n.matchId ?? null,
      edition_id: n.editionId ?? null,
      player_id: n.playerId ?? null,
      ai_generated: !!ai,
      facts: { text: n.facts },
      published_at: auto ? new Date().toISOString() : null,
    }),
  );
}

async function teamNames(db: DB, ids: string[]) {
  const rows = ids.length ? await q<TeamRow[]>(db.from('teams').select('id,name').in('id', [...new Set(ids)])) : [];
  return new Map(rows.map((t) => [t.id, t.name]));
}

const comp = (e: EditionRow) => e.name.split(' · ')[0];

/** Resumen de una jornada o ronda que acaba de cerrar. */
export async function newsUnit(db: DB, e: EditionRow, unitIndex: number, ms: MatchDb[]) {
  const unit = e.state.units?.find((u) => u.index === unitIndex);
  const um = ms.filter((m) => m.unit_index === unitIndex && m.status === 'finished');
  if (!unit || !um.length || unit.main) return; // las rondas en vivo ya tienen su crónica
  const names = await teamNames(db, um.flatMap((m) => [m.home_team_id, m.away_team_id]));
  const n = (id: string) => names.get(id) ?? '¿?';
  const lines = um.map((m) => `${n(m.home_team_id)} ${m.home_score}-${m.away_score} ${n(m.away_team_id)}${m.overtime ? ' (TE)' : ''}`);
  const biggest = [...um].sort((a, b) => Math.abs(b.home_score! - b.away_score!) - Math.abs(a.home_score! - a.away_score!))[0];
  const goals = um.reduce((s, m) => s + m.home_score! + m.away_score!, 0);

  let tableLine = '';
  if (unit.stage !== 'playoff') {
    const st = await q<{ team_id: string; position: number; prev_position: number | null; points: number }[]>(
      db.from('edition_standings').select('team_id,position,prev_position,points').eq('edition_id', e.id).order('position').limit(5),
    );
    const names2 = await teamNames(db, st.map((s) => s.team_id));
    tableLine = `Top 5 de la tabla: ${st.map((s) => `${s.position}. ${names2.get(s.team_id)} (${s.points} pts)`).join(', ')}.`;
  }
  const hats = await q<{ name: string | null }[]>(db.from('match_boxes').select('players').in('match_id', um.map((m) => m.id))).catch(() => []);
  const hatTricks: string[] = [];
  for (const h of hats as unknown as { players: { name?: string; goals: number }[] }[]) {
    for (const p of h.players ?? []) if (p.goals >= 3 && p.name) hatTricks.push(`${p.name} (${p.goals} goles)`);
  }

  const facts = [
    `Competición: ${comp(e)}. ${unit.label}.`,
    `Resultados: ${lines.join('; ')}.`,
    `Goles totales: ${goals} en ${um.length} partidos.`,
    biggest ? `Mayor diferencia: ${n(biggest.home_team_id)} ${biggest.home_score}-${biggest.away_score} ${n(biggest.away_team_id)}.` : '',
    hatTricks.length ? `Hat-tricks: ${hatTricks.join(', ')}.` : '',
    tableLine,
  ]
    .filter(Boolean)
    .join('\n');
  await publish(db, {
    kind: unit.stage === 'playoff' ? 'cronica' : 'jornada',
    facts,
    editionId: e.id,
    fallback: {
      title: `${comp(e)} · ${unit.label}: ${biggest ? `${n(biggest.home_team_id)} ${biggest.home_score}-${biggest.away_score} ${n(biggest.away_team_id)}` : 'resultados'}`,
      body: `${lines.join('\n')}\n\n${goals} goles en ${um.length} partidos.${hatTricks.length ? `\nHat-tricks: ${hatTricks.join(', ')}.` : ''}${tableLine ? `\n\n${tableLine}` : ''}`,
    },
  });
}

export async function newsChampion(db: DB, e: EditionRow, champion: string, runnerUp: string) {
  const names = await teamNames(db, [champion, runnerUp]);
  const titles = await q<{ titles: number } | null>(db.from('ranking_entries').select('titles').eq('team_id', champion).is('season_id', null).maybeSingle());
  const facts = `${names.get(champion)} es campeón de ${comp(e)} al vencer en la final a ${names.get(runnerUp)}. Lleva ${titles?.titles ?? 1} títulos en total en la historia de la liga.`;
  await publish(db, {
    kind: 'campeon',
    tone: 'medio',
    facts,
    teamId: champion,
    editionId: e.id,
    fallback: { title: `¡${names.get(champion)} campeón de ${comp(e)}!`, body: facts },
  });
}

/** Crónica de un evento principal en vivo. */
export async function newsLiveEvent(db: DB, m: MatchDb, e: EditionRow, scorers: string[], mvp: string | null) {
  const names = await teamNames(db, [m.home_team_id, m.away_team_id]);
  const facts = `${m.event_name ?? comp(e)}: ${names.get(m.home_team_id)} ${m.home_score}-${m.away_score} ${names.get(m.away_team_id)}${m.overtime ? ' en tiempo extra' : ''}. Goles de: ${scorers.join(', ') || 'nadie'}. MVP: ${mvp ?? 'sin definir'}.`;
  await publish(db, {
    kind: 'cronica',
    facts,
    matchId: m.id,
    editionId: e.id,
    fallback: { title: `${names.get(m.home_team_id)} ${m.home_score}-${m.away_score} ${names.get(m.away_team_id)}`, body: facts },
  });
}

/** Resumen del día de competencia. */
export async function newsDay(db: DB, dayId: string) {
  const items = await all<{ result: Record<string, unknown> | null; label: string | null; kind: string }>(() =>
    db.from('schedule_items').select('result,label,kind').eq('day_id', dayId).eq('status', 'done'),
  );
  const matches = items.reduce((s, i) => s + Number((i.result?.matches as number) ?? (i.kind === 'event' ? 1 : 0)), 0);
  const events = items.filter((i) => i.kind === 'event').map((i) => i.label).filter(Boolean);
  const facts = `Cierre del día de competencia. Partidos jugados: ${matches}. Eventos en vivo: ${events.join('; ') || 'ninguno'}.`;
  await publish(db, { kind: 'cierre_dia', tone: 'suave', facts, fallback: { title: 'Así se vivió el día en ARENA', body: facts } });
}
