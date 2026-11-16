// Mercado de fichajes con IA por reglas (sección 7): en cada ventana los clubes
// buscan refuerzos según su estrategia, negocian hasta 3 rondas y, al cerrar la
// ventana, los traspasos aceptados se ejecutan. El administrador puede vetar o
// forzar cualquier fichaje en secreto.
import { buyerMax, negotiate, playerValue, sellerAsk, wants, type MarketPlayer, type Strategy } from '../../../shared/market/value.ts';
import { createRng, shuffle } from '../../../shared/engine/rng.ts';
import { AppError, all, getSetting, q, type DB } from './db.ts';
import { publish } from './news.ts';
import type { PlayerRow, TeamRow } from './types.ts';
import { fillRosters } from './close.ts';

interface Window {
  open: boolean;
  label: string;
  openedAt?: string;
  closesAt?: string;
}

const pname = (p: PlayerRow) => `${p.first_name} ${p.last_name}`;

export async function marketStatus(db: DB) {
  const w = await getSetting<Window>(db, 'market_window', { open: false, label: '' });
  const transfers = await all<Record<string, unknown>>(() => db.from('transfers').select('*').order('created_at', { ascending: false }).limit(200));
  return { window: w, transfers };
}

/** Abre una ventana: la IA de cada club busca y negocia. */
export async function openWindow(db: DB, label: string, minutes = 30) {
  const w = await getSetting<Window>(db, 'market_window', { open: false, label: '' });
  if (w.open) throw new AppError('Ya hay una ventana de mercado abierta');
  const season = await q<{ id: string }>(db.from('seasons').select('id').eq('status', 'active').order('number', { ascending: false }).limit(1).single());
  const teams = await all<TeamRow>(() => db.from('teams').select('id,key,name,short_name,attack,defense,goalie,play_style,division,fan_base'));
  const priv = await all<{ team_id: string; budget: number; ai_strategy: Strategy }>(() => db.from('team_private').select('team_id,budget,ai_strategy'));
  const players = await all<PlayerRow & MarketPlayer>(() => db.from('players').select('*').eq('retired', false).not('team_id', 'is', null));
  const wish = await all<{ team_id: string; player_id: string; priority: number }>(() => db.from('owner_wishlist').select('team_id,player_id,priority'));
  const cfg = await getSetting(db, 'market', { maxNegotiationRounds: 3, wishlistWeight: 1.5 });
  const rng = createRng(Date.now() & 0xffffffff);

  const byTeam = new Map<string, (PlayerRow & MarketPlayer)[]>();
  for (const p of players) {
    if (!byTeam.has(p.team_id!)) byTeam.set(p.team_id!, []);
    byTeam.get(p.team_id!)!.push(p);
  }
  const budget = new Map(priv.map((p) => [p.team_id, Number(p.budget)]));
  const strategy = new Map(priv.map((p) => [p.team_id, p.ai_strategy]));
  const keyPlayers = new Map<string, Set<string>>();
  for (const [t, ps] of byTeam) keyPlayers.set(t, new Set([...ps].sort((a, b) => b.rating - a.rating).slice(0, 3).map((p) => p.id)));
  const taken = new Set<string>();
  const deals: Record<string, unknown>[] = [];
  const name = new Map(teams.map((t) => [t.id, t.name]));

  for (const team of shuffle(rng, teams)) {
    const st = strategy.get(team.id) ?? 'equilibrado';
    const roster = byTeam.get(team.id) ?? [];
    const attempts = st === 'austeridad' ? 1 : 2;
    for (let a = 0; a < attempts; a++) {
      const need = wants(st, roster);
      // Fichajes sugeridos por el dueño primero (la IA les da más peso).
      const wished = wish
        .filter((w) => w.team_id === team.id)
        .sort((x, y) => x.priority - y.priority)
        .map((w) => players.find((p) => p.id === w.player_id))
        .filter((p): p is PlayerRow & MarketPlayer => !!p && p.team_id !== team.id && !taken.has(p.id) && p.position === need.position);
      const pool = players
        .filter((p) => p.team_id !== team.id && !taken.has(p.id) && need.filter(p))
        .map((p) => ({ p, score: (p.rating + (p.potential - p.rating) * (st === 'cantera' ? 0.6 : 0.2)) / Math.sqrt(playerValue(p)) }))
        .sort((x, y) => y.score - x.score)
        .slice(0, 6)
        .map((x) => x.p);
      const candidates = [...wished.map((p) => ({ p, wishBoost: cfg.wishlistWeight })), ...pool.map((p) => ({ p, wishBoost: 1 }))];
      for (const { p, wishBoost } of candidates) {
        const seller = p.team_id!;
        const value = playerValue(p);
        const ask = sellerAsk(value, strategy.get(seller) ?? 'equilibrado', keyPlayers.get(seller)?.has(p.id) ?? false, p.age);
        const max = Math.round(buyerMax(value, st, budget.get(team.id) ?? 0) * wishBoost);
        const neg = negotiate(value, ask, max, cfg.maxNegotiationRounds);
        // El comprador manda a cambio a su peor jugador de esa posición (plantillas siempre completas).
        const outgoing = need.weakest;
        if (neg.price === null || !outgoing) {
          if (rng() < 0.35)
            deals.push({ player_id: p.id, from_team_id: seller, to_team_id: team.id, fee: neg.steps[neg.steps.length - 1]?.amount ?? 0, season_id: season.id, window_label: label, status: 'rejected', negotiation_round: Math.ceil(neg.steps.length / 2) });
          continue;
        }
        const swapValue = playerValue(outgoing);
        const fee = Math.max(0, neg.price - Math.round(swapValue * 0.6));
        if (fee > (budget.get(team.id) ?? 0)) continue;
        taken.add(p.id);
        taken.add(outgoing.id);
        budget.set(team.id, (budget.get(team.id) ?? 0) - fee);
        budget.set(seller, (budget.get(seller) ?? 0) + fee);
        deals.push({
          player_id: p.id,
          from_team_id: seller,
          to_team_id: team.id,
          fee,
          salary: Math.round(p.salary * 1.08),
          season_id: season.id,
          window_label: label,
          status: 'accepted',
          negotiation_round: Math.ceil(neg.steps.length / 2),
          swap_player_id: outgoing.id,
        });
        // La plantilla del comprador cambia para su siguiente intento.
        const idx = roster.findIndex((x) => x.id === outgoing.id);
        if (idx >= 0) roster.splice(idx, 1, { ...p, team_id: team.id });
        break;
      }
    }
  }

  const rows = deals.map(({ swap_player_id, ...d }) => ({ ...d, parent_id: null, ...(swap_player_id ? { salary: d.salary } : {}) }));
  const inserted = rows.length ? await q<{ id: string; player_id: string; status: string }[]>(db.from('transfers').insert(rows).select('id,player_id,status')) : [];
  // Guarda el intercambio de vuelta como transferencia hija.
  for (let i = 0; i < deals.length; i++) {
    const d = deals[i];
    if (d.status === 'accepted' && d.swap_player_id) {
      await q(
        db.from('transfers').insert({
          player_id: d.swap_player_id,
          from_team_id: d.to_team_id,
          to_team_id: d.from_team_id,
          fee: 0,
          season_id: season.id,
          window_label: label,
          status: 'accepted',
          parent_id: inserted[i].id,
        }),
      );
    }
  }

  const until = new Date(Date.now() + minutes * 60_000).toISOString();
  await q(db.from('settings').upsert({ key: 'market_window', value: { open: true, label, openedAt: new Date().toISOString(), closesAt: until }, is_public: true }));

  // Rumores en prensa (algunos se confirmarán y otros se desmentirán al cierre).
  const pById = new Map(players.map((p) => [p.id, p]));
  const rumors = shuffle(rng, deals).slice(0, 6);
  for (const d of rumors) {
    const p = pById.get(d.player_id as string)!;
    await publish(db, {
      kind: 'rumor',
      rumor: true,
      tone: 'medio',
      teamId: d.to_team_id as string,
      playerId: p.id,
      facts: `Rumor de mercado: ${name.get(d.to_team_id as string)} negocia por ${pname(p)} (${p.position === 'G' ? 'portero' : p.position === 'D' ? 'defensa' : 'delantero'}, ${p.age} años, atributo ${p.rating}) de ${name.get(d.from_team_id as string)}. Cifra que se comenta: ${Math.round(Number(d.fee) / 100_000) / 10} millones de dólares.`,
      fallback: {
        title: `Rumor: ${name.get(d.to_team_id as string)} va por ${pname(p)}`,
        body: `Se habla de una oferta cercana a ${Math.round(Number(d.fee) / 100_000) / 10} M USD por el ${p.position === 'F' ? 'delantero' : p.position === 'D' ? 'defensa' : 'portero'} de ${name.get(d.from_team_id as string)}.`,
      },
    }).catch(() => undefined);
  }
  return { deals: deals.filter((d) => d.status === 'accepted').length, rejected: deals.filter((d) => d.status === 'rejected').length, closesAt: until };
}

/** Cierra la ventana y ejecuta los traspasos aceptados que no fueron vetados. */
export async function closeWindow(db: DB) {
  const w = await getSetting<Window>(db, 'market_window', { open: false, label: '' });
  if (!w.open) throw new AppError('No hay ventana abierta');
  const accepted = await all<{ id: string; player_id: string; from_team_id: string | null; to_team_id: string | null; fee: number; salary: number | null; parent_id: string | null }>(() =>
    db.from('transfers').select('*').eq('window_label', w.label).eq('status', 'accepted'),
  );
  const players = await all<PlayerRow>(() => db.from('players').select('*').in('id', accepted.map((t) => t.player_id)));
  const pById = new Map(players.map((p) => [p.id, p]));
  const teams = await all<{ id: string; name: string }>(() => db.from('teams').select('id,name'));
  const name = new Map(teams.map((t) => [t.id, t.name]));
  let done = 0;
  // Un traspaso y su intercambio de vuelta van juntos: si una mitad ya no es válida, se cae todo.
  const valid = (t: (typeof accepted)[number]) => {
    const p = pById.get(t.player_id);
    return !!p && p.team_id === t.from_team_id;
  };
  const bad = new Set<string>();
  for (const t of accepted) {
    const root = t.parent_id ?? t.id;
    if (!valid(t)) bad.add(root);
  }
  for (const t of accepted) {
    const p = pById.get(t.player_id);
    if (!p || bad.has(t.parent_id ?? t.id)) {
      await q(db.from('transfers').update({ status: 'rejected' }).eq('id', t.id));
      continue;
    }
    await q(db.from('players').update({ team_id: t.to_team_id, ...(t.salary ? { salary: t.salary } : {}), contract_years: Math.max(p.contract_years, 2), morale: 60 }).eq('id', p.id));
    if (Number(t.fee) > 0 && t.to_team_id && t.from_team_id) {
      await q(
        db.from('finance_entries').insert([
          { team_id: t.to_team_id, concept: 'compra_fichaje', amount: -Number(t.fee), note: pname(p) },
          { team_id: t.from_team_id, concept: 'venta_fichaje', amount: Number(t.fee), note: pname(p) },
        ]),
      );
      for (const [team, delta] of [
        [t.to_team_id, -Number(t.fee)],
        [t.from_team_id, Number(t.fee)],
      ] as const) {
        const b = await q<{ budget: number }>(db.from('team_private').select('budget').eq('team_id', team).single());
        await q(db.from('team_private').update({ budget: Number(b.budget) + delta }).eq('team_id', team));
      }
    }
    await q(db.from('transfers').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', t.id));
    done++;
    if (!t.parent_id && t.to_team_id) {
      await publish(db, {
        kind: 'fichaje',
        tone: 'medio',
        teamId: t.to_team_id,
        playerId: p.id,
        facts: `Fichaje confirmado: ${pname(p)} (${p.age} años, atributo ${p.rating}, potencial ${p.potential}) pasa de ${t.from_team_id ? name.get(t.from_team_id) : 'agente libre'} a ${name.get(t.to_team_id)} por ${Math.round(Number(t.fee) / 100_000) / 10} M USD.`,
        fallback: {
          title: `¡Oficial! ${pname(p)} firma con ${name.get(t.to_team_id)}`,
          body: `Llega desde ${t.from_team_id ? name.get(t.from_team_id) : 'la agencia libre'} por ${Math.round(Number(t.fee) / 100_000) / 10} M USD.`,
        },
      }).catch(() => undefined);
    }
  }
  // Rumores de esta ventana: confirmados o desmentidos.
  const rumors = await all<{ id: string; player_id: string | null }>(() => db.from('news').select('id,player_id').eq('rumor_status', 'rumor'));
  const moved = new Set(accepted.map((t) => t.player_id));
  for (const r of rumors) await q(db.from('news').update({ rumor_status: r.player_id && moved.has(r.player_id) ? 'confirmed' : 'denied' }).eq('id', r.id));
  await q(db.from('settings').upsert({ key: 'market_window', value: { open: false, label: w.label, closedAt: new Date().toISOString() }, is_public: true }));
  await fillRosters(db);
  await q(db.rpc('recompute_all_ratings'));
  return { completed: done };
}

export async function vetoTransfer(db: DB, id: string) {
  await q(db.from('transfers').update({ status: 'vetoed' }).or(`id.eq.${id},parent_id.eq.${id}`));
}

/** Forzar un fichaje: se ejecuta de inmediato, con o sin ventana abierta. */
export async function forceTransfer(db: DB, playerId: string, toTeamId: string, fee: number) {
  const p = await q<PlayerRow>(db.from('players').select('*').eq('id', playerId).single());
  const w = await getSetting<Window>(db, 'market_window', { open: false, label: 'Forzado' });
  const t = await q<{ id: string }>(
    db.from('transfers').insert({ player_id: p.id, from_team_id: p.team_id, to_team_id: toTeamId, fee, window_label: w.open ? w.label : 'Forzado', status: 'accepted' }).select('id').single(),
  );
  await q(db.from('players').update({ team_id: toTeamId }).eq('id', p.id));
  await q(db.from('transfers').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', t.id));
  await q(db.from('admin_log').insert({ action: 'custom', entity: 'transfers', entity_id: t.id, after: { forced: true, playerId, toTeamId, fee } }));
}

/** Cierre automático de la ventana cuando vence (lo llama el tick). */
export async function autoCloseWindow(db: DB) {
  const w = await getSetting<Window>(db, 'market_window', { open: false, label: '' });
  if (w.open && w.closesAt && Date.parse(w.closesAt) <= Date.now()) return closeWindow(db);
  return null;
}
