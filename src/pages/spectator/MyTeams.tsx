import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import { Activity, CalendarClock, HeartPulse, Newspaper, Star, Trophy } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useTeams } from '@/lib/hooks';
import { DEMO_MODE, db } from '@/lib/supabase';
import type { Match, News, Standing, Edition } from '@/lib/engine';
import type { Team } from '@/lib/types';
import { Crest } from '@/components/Crest';
import { Button, SectionTitle, Spinner } from '@/components/ui';
import { FormPills, TeamName, fmtTime } from '@/components/game';
import { ShareTeamButton } from '@/components/ShareCard';

interface TeamSnapshot {
  next: Match | null;
  last: Match | null;
  standings: (Standing & { edition: Edition | undefined })[];
  injured: { first_name: string; last_name: string; injury_days: number; position: string }[];
  news: News[];
  titles: number;
}

async function loadSnapshot(team: Team): Promise<TeamSnapshot> {
  const or = `home_team_id.eq.${team.id},away_team_id.eq.${team.id}`;
  const [next, last, st, inj, news, champs] = await Promise.all([
    db().from('matches').select('*').or(or).in('status', ['scheduled', 'live']).order('unit_index').limit(1),
    db().from('matches').select('*').or(or).eq('status', 'finished').order('finished_at', { ascending: false }).limit(1),
    db().from('edition_standings').select('*').eq('team_id', team.id),
    db().from('players').select('first_name,last_name,injury_days,position').eq('team_id', team.id).gt('injury_days', 0),
    db().from('news').select('*').eq('team_id', team.id).eq('status', 'published').order('published_at', { ascending: false }).limit(4),
    db().from('editions').select('id', { count: 'exact', head: true }).eq('champion_team_id', team.id),
  ]);
  const standings = (st.data ?? []) as Standing[];
  const edIds = [...new Set(standings.map((s) => s.edition_id))];
  const eds = edIds.length ? (((await db().from('editions').select('*').in('id', edIds)).data ?? []) as Edition[]) : [];
  const edMap = new Map(eds.map((e) => [e.id, e]));
  return {
    next: (next.data?.[0] as Match) ?? null,
    last: (last.data?.[0] as Match) ?? null,
    standings: standings
      .map((s) => ({ ...s, edition: edMap.get(s.edition_id) }))
      .filter((s) => s.edition && s.edition.status !== 'finished'),
    injured: (inj.data ?? []) as TeamSnapshot['injured'],
    news: (news.data ?? []) as News[],
    titles: champs.count ?? 0,
  };
}

function TeamPanel({ team, star, index }: { team: Team; star: boolean; index: number }) {
  const { byId } = useTeams();
  const reduce = useReducedMotion();
  const snap = useQuery({ queryKey: ['team-snapshot', team.id], enabled: !DEMO_MODE, queryFn: () => loadSnapshot(team), refetchInterval: 60_000 });
  const s = snap.data;
  const last = s?.last;
  const lastResult = last
    ? (() => {
        const home = last.home_team_id === team.id;
        const gf = (home ? last.home_score : last.away_score) ?? 0;
        const ga = (home ? last.away_score : last.home_score) ?? 0;
        const rival = byId.get(home ? last.away_team_id : last.home_team_id);
        return { gf, ga, rival, won: gf > ga, ot: last.overtime };
      })()
    : null;
  const main = s?.standings[0];

  return (
    <motion.li
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06 }}
      className="card overflow-hidden"
      style={{ boxShadow: `inset 4px 0 0 ${team.primary_color}` }}
    >
      <div className="flex items-center gap-4 p-4" style={{ background: `linear-gradient(110deg, ${team.primary_color}22, transparent 60%)` }}>
        <Crest team={team} size={64} />
        <div className="min-w-0 flex-1">
          <Link to={`/equipos/${team.key}`} className="focus-ring flex items-center gap-2 rounded font-display text-2xl font-bold uppercase hover:text-primary">
            <span className="truncate">{team.name}</span>
            {star && <Star size={18} className="shrink-0 text-secondary" fill="currentColor" aria-label="Estelar" />}
          </Link>
          <div className="text-sm text-muted">
            {team.division ? `División ${team.division}` : 'Sin división'} · Estilo {team.play_style}
          </div>
        </div>
        <ShareTeamButton
          team={team}
          subtitle={main?.edition ? `${main.edition.name} · ${main.position}.º lugar` : `Ataque ${Math.round(team.attack)} · Defensa ${Math.round(team.defense)}`}
          lines={[
            { label: 'Ataque', value: String(Math.round(team.attack)) },
            { label: 'Defensa', value: String(Math.round(team.defense)) },
            { label: 'Portero', value: String(Math.round(team.goalie)) },
            { label: 'Títulos', value: String(s?.titles ?? 0) },
            ...(main ? [{ label: 'Puntos', value: String(main.points) }, { label: 'Récord', value: `${main.wins + main.ot_wins}-${main.losses + main.ot_losses}` }] : []),
          ]}
        />
      </div>

      {snap.isLoading ? (
        <div className="p-4">
          <Spinner />
        </div>
      ) : (
        <div className="grid gap-px bg-line/40 sm:grid-cols-2">
          <div className="bg-surface p-4">
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
              <CalendarClock size={14} aria-hidden /> Próximo partido
            </h4>
            {s?.next ? (
              <Link to={s.next.status === 'live' ? `/en-vivo/${s.next.id}` : '/hoy'} className="focus-ring block rounded">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted">vs</span>
                  <TeamName team={byId.get(s.next.home_team_id === team.id ? s.next.away_team_id : s.next.home_team_id)} size={20} link={false} />
                </div>
                <div className="mt-1 text-xs text-muted">
                  {s.next.status === 'live' ? <span className="font-semibold text-live">● En vivo ahora</span> : s.next.scheduled_at ? fmtTime(s.next.scheduled_at) : 'Fecha por definir'}
                  {s.next.event_name ? ` · ${s.next.event_name}` : ''}
                </div>
              </Link>
            ) : (
              <p className="text-sm text-muted">Sin partidos programados.</p>
            )}
          </div>

          <div className="bg-surface p-4">
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
              <Activity size={14} aria-hidden /> Último resultado
            </h4>
            {lastResult ? (
              <div className="flex items-center gap-3">
                <span className={`rounded-lg px-2 py-0.5 font-display text-lg font-bold ${lastResult.won ? 'bg-win/15 text-win' : 'bg-loss/15 text-loss'}`}>
                  {lastResult.won ? 'G' : 'P'} {lastResult.gf}–{lastResult.ga}
                  {lastResult.ot ? ' TE' : ''}
                </span>
                <span className="min-w-0 truncate text-sm">vs {lastResult.rival?.name}</span>
              </div>
            ) : (
              <p className="text-sm text-muted">Aún no juega esta temporada.</p>
            )}
          </div>

          <div className="bg-surface p-4">
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
              <Trophy size={14} aria-hidden /> Posición
            </h4>
            {s?.standings.length ? (
              <ul className="space-y-1.5">
                {s.standings.slice(0, 3).map((x) => (
                  <li key={x.edition_id + x.group_label}>
                    <Link to={`/competiciones/${x.edition_id}`} className="focus-ring flex items-center gap-2 rounded text-sm hover:text-primary">
                      <span className="w-8 font-display text-xl font-bold tabular">{x.position}.º</span>
                      <span className="min-w-0 flex-1 truncate">
                        {x.edition?.name}
                        {x.group_label ? ` · Grupo ${x.group_label}` : ''}
                      </span>
                      <span className="text-xs text-muted tabular">{x.points} pts</span>
                      <FormPills form={x.form} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">La tabla aparece al cerrar la primera jornada.</p>
            )}
          </div>

          <div className="bg-surface p-4">
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
              <HeartPulse size={14} aria-hidden /> Enfermería
            </h4>
            {s?.injured.length ? (
              <ul className="space-y-1 text-sm">
                {s.injured.map((p) => (
                  <li key={p.first_name + p.last_name} className="flex justify-between gap-2">
                    <span className="truncate">
                      {p.first_name} {p.last_name} <span className="text-muted">({p.position})</span>
                    </span>
                    <span className="text-xs text-loss">{p.injury_days} d</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-win">Plantilla completa, sin lesionados.</p>
            )}
          </div>

          {!!s?.news.length && (
            <div className="bg-surface p-4 sm:col-span-2">
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
                <Newspaper size={14} aria-hidden /> Noticias
              </h4>
              <ul className="space-y-1.5">
                {s.news.map((n) => (
                  <li key={n.id}>
                    <Link to={`/noticias#${n.id}`} className="focus-ring block rounded text-sm hover:text-primary">
                      {n.kind === 'rumor' && <span className="mr-1 text-xs font-semibold uppercase text-secondary">Rumor</span>}
                      {n.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </motion.li>
  );
}

export function MyTeamsPage() {
  const { profile } = useAuth();
  const { byId } = useTeams();
  const favs = (profile?.favorite_team_ids ?? []).map((id) => byId.get(id)).filter(Boolean) as Team[];
  const star = profile?.star_team_id ? byId.get(profile.star_team_id) : undefined;

  if (!favs.length && !star) {
    return (
      <div>
        <SectionTitle>Mi equipo</SectionTitle>
        <div className="card flex flex-col items-center gap-3 p-8 text-center">
          <p className="text-sm text-muted">Aún no eliges tus equipos. Escoge hasta 3 principales y un estelar.</p>
          <Link to="/perfil">
            <Button>Elegir equipos</Button>
          </Link>
        </div>
      </div>
    );
  }

  const list = [star, ...favs.filter((t) => t.id !== star?.id)].filter(Boolean) as Team[];
  return (
    <div>
      <SectionTitle>Mi equipo</SectionTitle>
      <ul className="grid gap-4 lg:grid-cols-2">
        {list.map((t, i) => (
          <TeamPanel key={t.id} team={t} star={t.id === star?.id} index={i} />
        ))}
      </ul>
    </div>
  );
}
