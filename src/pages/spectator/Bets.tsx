// Apuestas con créditos virtuales (nunca dinero real). Cuotas calculadas en el
// servidor con la distribución exacta del motor y margen de la casa.
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Coins, Medal, Receipt, Ticket, Trash2, TrendingUp, X } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useTeams } from '@/lib/hooks';
import { useA11y, playCue } from '@/lib/a11y';
import { db } from '@/lib/supabase';
import { engine, getBettorBoard, getCurrentDay, getDayItems, getEditions, getMatchesByIds, getMyBets, type Bet, type Match, type Offer } from '@/lib/engine';
import { Badge, Button, ErrorBox, Input, SectionTitle, Spinner, cn } from '@/components/ui';
import { Countdown, EmptyState, MatchContextBadge, TeamName, fmtTime } from '@/components/game';
import { PrivateLeagues } from '@/components/Leagues';

const MARKET_TITLE: Record<string, string> = {
  winner: 'Ganador (incluye tiempo extra)',
  total: 'Total de goles',
  exact: 'Marcador exacto',
  scorer: 'Anota gol',
  mvp: 'MVP del partido',
  champion: 'Campeón',
  playoffs: 'Clasifica a playoffs',
  promotion: 'Asciende',
  relegation: 'Desciende',
};

type Tab = 'partidos' | 'futuros' | 'boletas' | 'ranking';

export function BetsPage() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<Tab>('partidos');
  const [slip, setSlip] = useState<{ offer: Offer; label: string }[]>([]);
  const toggle = (offer: Offer, label: string) =>
    setSlip((s) => (s.some((x) => x.offer.id === offer.id) ? s.filter((x) => x.offer.id !== offer.id) : [...s.filter((x) => !offer.match_id || x.offer.match_id !== offer.match_id), { offer, label }]));

  if (!profile) return null;
  return (
    <div className="space-y-4 pb-28">
      <SectionTitle right={<span className="flex items-center gap-1 text-sm font-semibold tabular"><Coins size={16} className="text-secondary" />{profile.credits.toLocaleString('es-MX')}</span>}>
        Apuestas
      </SectionTitle>
      <p className="text-xs text-muted">Créditos virtuales, nunca dinero real. Las apuestas cierran cuando empieza cada partido.</p>
      <div className="-mx-4 flex gap-1 overflow-x-auto px-4" role="tablist">
        {(
          [
            ['partidos', 'Partidos de hoy'],
            ['futuros', 'Largo plazo'],
            ['boletas', 'Mis boletas'],
            ['ranking', 'Ranking'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn('focus-ring min-h-10 shrink-0 rounded-xl px-3.5 text-sm font-semibold', tab === k ? 'bg-primary text-bg' : 'bg-surface-2 text-muted')}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'partidos' && <MatchMarkets slip={slip} toggle={toggle} />}
      {tab === 'futuros' && <FutureMarkets slip={slip} toggle={toggle} />}
      {tab === 'boletas' && <MyTickets />}
      {tab === 'ranking' && (
        <div className="space-y-4">
          <Leaderboard />
          <PrivateLeagues />
        </div>
      )}
      <Slip slip={slip} setSlip={setSlip} />
    </div>
  );
}

function MatchMarkets({ slip, toggle }: { slip: { offer: Offer }[]; toggle: (o: Offer, label: string) => void }) {
  const { byId } = useTeams();
  const day = useQuery({ queryKey: ['current-day'], queryFn: getCurrentDay });
  const items = useQuery({ queryKey: ['day-items', day.data?.id], queryFn: () => getDayItems(day.data!.id), enabled: !!day.data });
  // Partidos con horario que todavía no empiezan.
  const upcoming = useQuery({
    queryKey: ['bettable', day.data?.id, items.data?.length],
    enabled: !!day.data,
    queryFn: async () => {
      const { data } = await db().from('matches').select('*').eq('status', 'scheduled').gt('scheduled_at', new Date().toISOString()).order('scheduled_at').limit(60);
      return (data ?? []) as Match[];
    },
    refetchInterval: 30_000,
  });
  const [open, setOpen] = useState<string | null>(null);
  if (day.isLoading || upcoming.isLoading) return <Spinner />;
  const list = upcoming.data ?? [];
  if (!list.length)
    return (
      <EmptyState icon={<Ticket className="text-secondary" size={30} />} title="Sin partidos abiertos">
        Los mercados se abren cuando hay un día de competencia en curso o publicado y sus partidos tienen horario.
      </EmptyState>
    );
  return (
    <div className="space-y-2">
      {list.map((m) => (
        <div key={m.id} className={cn('card p-0', m.is_main_event && 'border-secondary/50')}>
          <button onClick={() => setOpen(open === m.id ? null : m.id)} aria-expanded={open === m.id} className="focus-ring flex w-full items-center gap-3 p-3 text-left">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <MatchContextBadge m={m} className="py-0.5 text-[10px]" />
                {m.event_name && !/· (Cuartos|Semifinales|Final|Octavos|Ronda)/.test(m.event_name) && <span className="text-[11px] font-bold uppercase tracking-wider text-secondary">{m.event_name}</span>}
              </div>
              <div>
                <TeamName team={byId.get(m.home_team_id)} size={20} link={false} />
              </div>
              <div>
                <TeamName team={byId.get(m.away_team_id)} size={20} link={false} />
              </div>
            </div>
            <div className="text-right text-xs text-muted">
              <div className="tabular">{fmtTime(m.scheduled_at)}</div>
              <div>
                cierra en <Countdown to={m.scheduled_at!} className="font-semibold text-fg" />
              </div>
            </div>
          </button>
          {open === m.id && <OffersFor match={m} slip={slip} toggle={toggle} />}
        </div>
      ))}
    </div>
  );
}

function OffersFor({ match, slip, toggle }: { match: Match; slip: { offer: Offer }[]; toggle: (o: Offer, label: string) => void }) {
  const { byId } = useTeams();
  const q = useQuery({ queryKey: ['odds', match.id], queryFn: () => engine<{ offers: Offer[]; open: boolean }>('odds.match', { matchId: match.id }) });
  const [showAll, setShowAll] = useState(false);
  if (q.isLoading) return <Spinner label="Calculando cuotas…" />;
  if (q.error) return <div className="p-3"><ErrorBox error={q.error} /></div>;
  const offers = q.data?.offers ?? [];
  if (!q.data?.open) return <p className="p-3 text-sm text-muted">Apuestas cerradas.</p>;
  const groups = ['winner', 'total', 'scorer', 'mvp', 'exact'].map((k) => [k, offers.filter((o) => o.market === k)] as const).filter(([, l]) => l.length);
  const pre = `${byId.get(match.home_team_id)?.short_name} vs ${byId.get(match.away_team_id)?.short_name}`;
  return (
    <div className="space-y-3 border-t border-line p-3">
      {groups.map(([k, list]) => {
        const shown = k === 'exact' && !showAll ? [...list].sort((a, b) => a.odds - b.odds).slice(0, 9) : k === 'total' ? list.filter((o) => o.selection.line === 5.5 || o.selection.line === 6.5 || showAll) : list;
        return (
          <div key={k}>
            <h4 className="mb-1.5 text-xs font-bold uppercase tracking-wider text-muted">{MARKET_TITLE[k]}</h4>
            <div className={cn('grid gap-1.5', k === 'winner' ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3')}>
              {shown.map((o) => (
                <OddsButton key={o.id} o={o} selected={slip.some((s) => s.offer.id === o.id)} onClick={() => toggle(o, `${pre} · ${MARKET_TITLE[k].split(' (')[0]}: ${o.selection.label}`)} />
              ))}
            </div>
          </div>
        );
      })}
      <button className="focus-ring rounded text-xs font-semibold text-primary" onClick={() => setShowAll((s) => !s)}>
        {showAll ? 'Ver menos' : 'Ver más líneas y marcadores'}
      </button>
    </div>
  );
}

function OddsButton({ o, selected, onClick }: { o: Offer; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      className={cn('focus-ring flex min-h-12 items-center justify-between gap-2 rounded-xl border px-3 text-left text-sm transition active:scale-[0.98]', selected ? 'border-primary bg-primary/20' : 'border-line bg-surface-2 hover:border-primary/50')}
    >
      <span className="min-w-0 truncate">{o.selection.label}</span>
      <span className="font-display text-lg font-bold tabular text-primary">{Number(o.odds).toFixed(2)}</span>
    </button>
  );
}

function FutureMarkets({ slip, toggle }: { slip: { offer: Offer }[]; toggle: (o: Offer, label: string) => void }) {
  const { byId } = useTeams();
  const editions = useQuery({ queryKey: ['editions'], queryFn: getEditions });
  const [ed, setEd] = useState<string | null>(null);
  const active = (editions.data ?? []).filter((e) => e.status !== 'finished');
  const current = ed ?? active[0]?.id;
  const offers = useQuery({
    queryKey: ['future-odds', current],
    enabled: !!current,
    queryFn: async () => {
      const { data } = await db().from('odds_offers').select('*').eq('edition_id', current!).is('match_id', null).eq('active', true).order('odds');
      return (data ?? []) as Offer[];
    },
  });
  if (editions.isLoading) return <Spinner />;
  if (!active.length) return <EmptyState title="No hay competiciones en curso" />;
  const markets = ['champion', 'playoffs', 'promotion', 'relegation'].map((k) => [k, (offers.data ?? []).filter((o) => o.market === k)] as const).filter(([, l]) => l.length);
  return (
    <div className="space-y-3">
      <select value={current} onChange={(e) => setEd(e.target.value)} className="focus-ring min-h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-sm" aria-label="Competición">
        {active.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </select>
      {offers.isLoading ? (
        <Spinner />
      ) : !markets.length ? (
        <p className="card p-4 text-sm text-muted">Las cuotas de largo plazo aparecen cuando se calculan las probabilidades (al cerrar cada jornada).</p>
      ) : (
        markets.map(([k, list]) => (
          <div key={k}>
            <h4 className="mb-1.5 text-xs font-bold uppercase tracking-wider text-muted">{MARKET_TITLE[k]}</h4>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {list.slice(0, 16).map((o) => {
                const t = byId.get(o.selection.teamId!);
                return (
                  <button
                    key={o.id}
                    onClick={() => toggle(o, `${MARKET_TITLE[k]}: ${t?.name}`)}
                    aria-pressed={slip.some((s) => s.offer.id === o.id)}
                    className={cn('focus-ring flex min-h-12 items-center justify-between gap-2 rounded-xl border px-3 text-sm', slip.some((s) => s.offer.id === o.id) ? 'border-primary bg-primary/20' : 'border-line bg-surface-2')}
                  >
                    <TeamName team={t} size={20} link={false} />
                    <span className="font-display text-lg font-bold tabular text-primary">{Number(o.odds).toFixed(2)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function Slip({ slip, setSlip }: { slip: { offer: Offer; label: string }[]; setSlip: (s: { offer: Offer; label: string }[]) => void }) {
  const { profile, setLocalProfile } = useAuth();
  const qc = useQueryClient();
  const { say, prefs } = useA11y();
  const reduce = useReducedMotion();
  const [stake, setStake] = useState(50);
  const [source, setSource] = useState<'credits' | 'club'>('credits');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const odds = useMemo(() => Math.round(slip.reduce((p, s) => p * Number(s.offer.odds), 1) * 100) / 100, [slip]);
  if (!profile || (!slip.length && !okMsg)) return null;
  const isOwner = profile.role === 'owner';
  const max = source === 'credits' ? profile.credits : Infinity;

  const place = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await engine<{ potential: number }>('bet.place', { offerIds: slip.map((s) => s.offer.id), stake, source });
      if (source === 'credits') setLocalProfile({ credits: profile.credits - stake });
      setSlip([]);
      setOkMsg(`Boleta registrada. Posible premio: ${r.potential.toLocaleString('es-MX')}`);
      say('Apuesta registrada');
      if (prefs.sound) playCue('whistle');
      setTimeout(() => setOkMsg(null), 3500);
      qc.invalidateQueries({ queryKey: ['my-bets'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.aside
      initial={reduce ? false : { y: 80 }}
      animate={{ y: 0 }}
      className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 mx-auto max-w-xl px-3 xl:bottom-4"
      aria-label="Boleta de apuestas"
    >
      <div className="card border-primary/60 p-3 shadow-2xl">
        {okMsg ? (
          <div className="flex items-center gap-2 text-sm font-semibold text-win" role="status">
            <Receipt size={16} /> {okMsg}
          </div>
        ) : (
          <>
            <button onClick={() => setExpanded((x) => !x)} className="focus-ring flex w-full items-center gap-2 rounded text-left" aria-expanded={expanded}>
              <Ticket size={18} className="text-primary" aria-hidden />
              <span className="flex-1 font-semibold">
                {slip.length === 1 ? 'Apuesta simple' : `Combinada de ${slip.length}`} · cuota <span className="tabular text-primary">{odds.toFixed(2)}</span>
              </span>
              <span className="text-xs text-muted">{expanded ? 'Ocultar' : 'Ver'}</span>
            </button>
            <AnimatePresence initial={false}>
              {expanded && (
                <motion.div initial={reduce ? false : { height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto">
                    {slip.map((s) => (
                      <li key={s.offer.id} className="flex items-center gap-2 rounded-lg bg-surface-2 px-2 py-1.5 text-sm">
                        <span className="min-w-0 flex-1 truncate">{s.label}</span>
                        <span className="font-semibold tabular">{Number(s.offer.odds).toFixed(2)}</span>
                        <button onClick={() => setSlip(slip.filter((x) => x.offer.id !== s.offer.id))} className="focus-ring rounded p-1 text-muted hover:text-loss" aria-label="Quitar">
                          <X size={14} />
                        </button>
                      </li>
                    ))}
                  </ul>
                  {isOwner && (
                    <div className="mt-2 flex gap-1 rounded-xl bg-surface-2 p-1 text-xs">
                      {(['credits', 'club'] as const).map((s) => (
                        <button key={s} onClick={() => setSource(s)} aria-pressed={source === s} className={cn('focus-ring flex-1 rounded-lg py-1.5 font-semibold', source === s ? 'bg-primary text-bg' : 'text-muted')}>
                          {s === 'credits' ? 'Mis créditos' : 'Dinero del club'}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 flex items-center gap-2">
                    <label htmlFor="stake" className="text-sm text-muted">
                      Monto
                    </label>
                    <Input id="stake" type="number" inputMode="numeric" min={1} max={max} value={stake} onChange={(e) => setStake(Math.max(1, Math.floor(Number(e.target.value) || 0)))} className="w-28" />
                    <div className="flex gap-1">
                      {[25, 100, 250].map((v) => (
                        <button key={v} onClick={() => setStake(v)} className="focus-ring rounded-lg bg-surface-2 px-2 py-1.5 text-xs font-semibold">
                          {v}
                        </button>
                      ))}
                    </div>
                    <button onClick={() => setSlip([])} className="focus-ring ml-auto rounded p-2 text-muted hover:text-loss" aria-label="Vaciar boleta">
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="text-sm">
                      Premio posible <b className="tabular text-win">{Math.floor(stake * odds).toLocaleString('es-MX')}</b>
                    </div>
                    <Button onClick={place} disabled={busy || stake < 1 || stake > max}>
                      {busy ? 'Enviando…' : 'Apostar'}
                    </Button>
                  </div>
                  {error ? <div className="mt-2"><ErrorBox error={error} /></div> : null}
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </div>
    </motion.aside>
  );
}

function MyTickets() {
  const { profile } = useAuth();
  const q = useQuery({ queryKey: ['my-bets', profile?.id], queryFn: () => getMyBets(profile!.id), enabled: !!profile });
  const matchIds = [...new Set((q.data ?? []).map((b) => b.match_id).filter(Boolean) as string[])];
  const matches = useQuery({ queryKey: ['bet-matches', matchIds.join()], queryFn: () => getMatchesByIds(matchIds), enabled: matchIds.length > 0 });
  const { byId } = useTeams();
  const tickets = useMemo(() => {
    const m = new Map<string, Bet[]>();
    for (const b of q.data ?? []) {
      const k = b.parlay_id ?? b.id;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(b);
    }
    return [...m.values()];
  }, [q.data]);
  if (q.isLoading) return <Spinner />;
  const settled = tickets.filter((t) => t.every((b) => b.status !== 'open'));
  const net = settled.reduce((s, t) => s + Number(t[0].payout ?? 0) - Number(t[0].stake), 0);
  const won = settled.filter((t) => Number(t[0].payout ?? 0) > 0).length;
  const mById = new Map((matches.data ?? []).map((m) => [m.id, m]));
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-surface-2 p-3">
          <div className="text-[11px] uppercase text-muted">Boletas</div>
          <div className="font-display text-2xl font-bold tabular">{tickets.length}</div>
        </div>
        <div className="rounded-xl bg-surface-2 p-3">
          <div className="text-[11px] uppercase text-muted">Aciertos</div>
          <div className="font-display text-2xl font-bold tabular">{settled.length ? Math.round((won / settled.length) * 100) : 0}%</div>
        </div>
        <div className="rounded-xl bg-surface-2 p-3">
          <div className="text-[11px] uppercase text-muted">Ganancia neta</div>
          <div className={cn('font-display text-2xl font-bold tabular', net >= 0 ? 'text-win' : 'text-loss')}>
            {net >= 0 ? '+' : ''}
            {net.toLocaleString('es-MX')}
          </div>
        </div>
      </div>
      {!tickets.length && <p className="card p-4 text-sm text-muted">Aún no tienes boletas.</p>}
      {tickets.map((t) => {
        const first = t[0];
        const status = t.some((b) => b.status === 'open') ? 'open' : Number(first.payout ?? 0) > 0 ? 'won' : 'lost';
        return (
          <article key={first.parlay_id ?? first.id} className="card p-3">
            <div className="mb-1 flex items-center justify-between gap-2 text-sm">
              <span className="font-semibold">{t.length > 1 ? `Combinada (${t.length})` : 'Simple'}</span>
              <Badge tone={status === 'won' ? 'win' : status === 'lost' ? 'loss' : 'primary'}>{status === 'won' ? `+${first.payout}` : status === 'lost' ? 'Perdida' : 'Abierta'}</Badge>
            </div>
            <ul className="space-y-0.5 text-sm text-muted">
              {t.map((b) => {
                const m = b.match_id ? mById.get(b.match_id) : undefined;
                return (
                  <li key={b.id} className="flex justify-between gap-2">
                    <span className="truncate">
                      {m ? `${byId.get(m.home_team_id)?.short_name}-${byId.get(m.away_team_id)?.short_name} · ` : ''}
                      {MARKET_TITLE[b.market]?.split(' (')[0]}: {b.selection.label ?? byId.get(b.selection.teamId ?? '')?.name}
                    </span>
                    <span className="tabular">{Number(b.odds).toFixed(2)}</span>
                  </li>
                );
              })}
            </ul>
            <div className="mt-1 text-xs text-muted">
              {first.source === 'club' ? 'Dinero del club' : 'Créditos'} · apostado {Number(first.stake).toLocaleString('es-MX')}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function Leaderboard() {
  const { profile } = useAuth();
  const q = useQuery({ queryKey: ['bettor-board'], queryFn: getBettorBoard });
  if (q.isLoading) return <Spinner />;
  return (
    <div className="card overflow-hidden p-0">
      <h3 className="flex items-center gap-2 border-b border-line px-4 py-3 font-display text-xl font-bold uppercase">
        <TrendingUp size={18} aria-hidden /> Mejores apostadores
      </h3>
      <ol>
        {(q.data ?? []).map((r, i) => (
          <li key={r.user_id} className={cn('flex items-center gap-3 border-b border-line/50 px-4 py-2 text-sm last:border-0', r.user_id === profile?.id && 'bg-primary/10')}>
            <span className="w-6 text-right font-display text-lg font-bold tabular text-muted">{i < 3 ? <Medal size={18} className={['text-yellow-400', 'text-slate-300', 'text-amber-600'][i]} aria-label={`Lugar ${i + 1}`} /> : i + 1}</span>
            <span className="flex-1 truncate font-medium">{r.display_name}</span>
            <span className="text-xs text-muted">
              {r.won}/{r.bets}
            </span>
            <span className={cn('w-20 text-right font-display text-lg font-bold tabular', r.net >= 0 ? 'text-win' : 'text-loss')}>
              {r.net >= 0 ? '+' : ''}
              {Number(r.net).toLocaleString('es-MX')}
            </span>
          </li>
        ))}
        {!(q.data ?? []).length && <li className="p-4 text-center text-sm text-muted">Nadie ha apostado todavía.</li>}
      </ol>
    </div>
  );
}
