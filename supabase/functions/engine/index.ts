// Edge Function «engine»: todo lo que debe ser secreto o justo corre aquí.
// Rutas por `action`. El cron llama a `tick` con el secreto del servidor.
import { AppError, q, serviceClient, userClient } from './db.ts';
import { createEdition } from './season.ts';
import { addBlock, createDay, deleteDay, generatePlan, getPlan, mergeDays, moveBlock, publishDay, removeBlock, unplanned } from './plan.ts';
import { cancelItem, closeDay, compactDay, dayStatus, forceItem, pauseDay, resumeDay, setMatchEvent, shiftItem, startDay, tick } from './day.ts';
import { longTermOdds, oddsForMatch, placeBet } from './bets.ts';
import { simulateUnitNow, snapshotProbabilities, editionMatches } from './run.ts';
import type { EditionRow } from './types.ts';
import { autoCloseWindow, closeWindow, forceTransfer, marketStatus, openWindow, vetoTransfer } from './market.ts';
import { advanceDraft, draftState, ownerPick, prepareDraft, startDraft } from './draft.ts';
import { closePreview, closeSeason } from './close.ts';
import { maybeGossip, newsGossip } from './news.ts';
import { finishSeasonBy } from './speed.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const ADMIN = new Set([
  'season.createEdition',
  'season.createEditions',
  'plan.get',
  'plan.generate',
  'plan.move',
  'plan.merge',
  'plan.deleteDay',
  'plan.removeBlock',
  'plan.addBlock',
  'plan.createDay',
  'plan.publish',
  'plan.unplanned',
  'day.start',
  'day.pause',
  'day.resume',
  'day.close',
  'day.status',
  'day.compact',
  'match.event',
  'press.gossip',
  'season.finishBy',
  'item.shift',
  'item.cancel',
  'item.force',
  'unit.simulateNow',
  'edition.probabilities',
  'tick',
  'market.status',
  'market.open',
  'market.close',
  'transfer.veto',
  'transfer.force',
  'draft.prepare',
  'draft.start',
  'season.closePreview',
  'season.close',
]);
const USER = new Set(['odds.match', 'odds.edition', 'bet.place', 'draft.state', 'draft.advance', 'draft.pick']);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const db = serviceClient();
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? '');

    // Tarea programada.
    const cronSecret = req.headers.get('x-cron-secret');
    if (cronSecret) {
      const row = await q<{ value: string } | null>(db.from('private_config').select('value').eq('key', 'cron_secret').maybeSingle());
      if (!row || row.value !== cronSecret) return json({ error: 'No autorizado' }, 401);
      const out = await tick(db);
      await autoCloseWindow(db).catch(() => null);
      await advanceDraft(db).catch(() => null);
      await maybeGossip(db).catch(() => null);
      return json(out);
    }

    const auth = req.headers.get('Authorization');
    if (!auth) return json({ error: 'Sin sesión' }, 401);
    const uc = userClient(auth);
    const { data: u } = await uc.auth.getUser();
    if (!u.user) return json({ error: 'Sesión inválida' }, 401);

    if (ADMIN.has(action)) {
      const { data: isAdmin } = await uc.rpc('is_admin');
      if (isAdmin !== true) return json({ error: 'Solo el administrador' }, 403);
    } else if (!USER.has(action)) {
      return json({ error: 'Acción desconocida' }, 400);
    }

    switch (action) {
      case 'season.createEdition':
        return json(await createEdition(db, body.competitionKey, { invited: body.invited, name: body.name }));
      case 'season.createEditions': {
        const out: { key: string; ok: boolean; error?: string }[] = [];
        for (const key of body.competitionKeys ?? []) {
          try {
            await createEdition(db, key);
            out.push({ key, ok: true });
          } catch (e) {
            out.push({ key, ok: false, error: (e as Error).message });
          }
        }
        return json(out);
      }
      case 'plan.get':
        return json(await getPlan(db));
      case 'plan.generate':
        return json(await generatePlan(db, body.dates ?? [], body.editionIds ?? []));
      case 'plan.move':
        return json(await moveBlock(db, body.blockId, body.dayId, Number(body.index ?? 0)));
      case 'plan.merge':
        return json(await mergeDays(db, body.intoDayId, body.fromDayId));
      case 'plan.deleteDay':
        return json(await deleteDay(db, body.dayId));
      case 'plan.removeBlock':
        return json(await removeBlock(db, body.blockId));
      case 'plan.addBlock':
        return json(await addBlock(db, body.dayId, body.editionId, Number(body.unitIndex)));
      case 'plan.createDay':
        return json(await createDay(db, body.date));
      case 'plan.publish':
        return json(await publishDay(db, body.dayId, !!body.published));
      case 'plan.unplanned':
        return json(await unplanned(db));
      case 'day.start':
        return json(await startDay(db, body.dayId, body.mode === 'now' ? 'now' : 'real'));
      case 'day.pause':
        await pauseDay(db, body.dayId);
        return json(await dayStatus(db, body.dayId));
      case 'day.resume':
        await resumeDay(db, body.dayId);
        return json(await dayStatus(db, body.dayId));
      case 'day.close':
        await closeDay(db, body.dayId);
        return json(await dayStatus(db, body.dayId));
      case 'day.status':
        return json(await dayStatus(db, body.dayId));
      case 'day.compact':
        await compactDay(db, body.dayId);
        return json(await dayStatus(db, body.dayId));
      case 'season.finishBy':
        return json(await finishSeasonBy(db, String(body.endDate ?? ''), Number(body.endHour ?? 22)));
      case 'press.gossip':
        return json({ made: await newsGossip(db, Math.min(20, Math.max(1, Number(body.count ?? 5)))) });
      case 'match.event':
        return json(await setMatchEvent(db, body.matchId, !!body.on, body.name));
      case 'item.shift':
        await shiftItem(db, body.itemId, Number(body.minutes ?? 5));
        return json({ ok: true });
      case 'item.cancel':
        await cancelItem(db, body.itemId);
        return json({ ok: true });
      case 'item.force':
        return json(await forceItem(db, body.itemId));
      case 'unit.simulateNow':
        return json(await simulateUnitNow(db, body.editionId, Number(body.unitIndex)));
      case 'edition.probabilities': {
        const e = await q<EditionRow>(db.from('editions').select('*').eq('id', body.editionId).single());
        const teams = (await q<{ team_id: string }[]>(db.from('edition_teams').select('team_id').eq('edition_id', e.id).order('seed'))).map((t) => t.team_id);
        await snapshotProbabilities(db, e, await editionMatches(db, e.id), teams);
        return json(await longTermOdds(db, e.id));
      }
      case 'tick':
        return json(await tick(db));
      case 'odds.match':
        return json(await oddsForMatch(db, body.matchId));
      case 'odds.edition':
        return json(await longTermOdds(db, body.editionId));
      case 'market.status':
        return json(await marketStatus(db));
      case 'market.open':
        return json(await openWindow(db, String(body.label ?? 'Ventana de mercado'), Number(body.minutes ?? 30)));
      case 'market.close':
        return json(await closeWindow(db));
      case 'transfer.veto':
        await vetoTransfer(db, body.transferId);
        return json({ ok: true });
      case 'transfer.force':
        await forceTransfer(db, body.playerId, body.toTeamId, Number(body.fee ?? 0));
        return json({ ok: true });
      case 'draft.prepare':
        return json(await prepareDraft(db));
      case 'draft.start':
        return json(await startDraft(db));
      case 'draft.state':
        return json(await draftState(db));
      case 'draft.advance':
        await advanceDraft(db, 3);
        return json(await draftState(db));
      case 'draft.pick':
        return json(await ownerPick(db, u.user.id, body.playerId));
      case 'season.closePreview':
        return json(await closePreview(db));
      case 'season.close':
        return json(await closeSeason(db, body.moves));
      case 'bet.place':
        return json(await placeBet(db, u.user.id, body.offerIds ?? [], Number(body.stake), body.source === 'club' ? 'club' : 'credits'));
    }
    return json({ error: 'Acción desconocida' }, 400);
  } catch (e) {
    const status = e instanceof AppError ? e.status : 500;
    return json({ error: e instanceof Error ? e.message : String(e) }, status);
  }
});
