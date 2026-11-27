// Top histórico de jugadores: lo que cada uno ha hecho en todas las temporadas y
// competiciones de ARENA, con sus títulos y premios individuales.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronDown, Lock, Medal, Search } from "lucide-react";
import { DEMO_MODE, db } from "@/lib/supabase";
import { usePlayers, useTeams } from "@/lib/hooks";
import { useAuth } from "@/lib/auth";
import { Crest } from "@/components/Crest";
import { Button, ErrorBox, Spinner, cn } from "@/components/ui";

interface LegendRow {
  player_id: string;
  first_name: string;
  last_name: string;
  pos: "F" | "D" | "G";
  age: number;
  retired: boolean;
  team_id: string | null;
  main_team_id: string | null;
  seasons: number;
  gp: number;
  goals: number;
  assists: number;
  mvps: number;
  hat_tricks: number;
  gwg: number;
  goalie_gp: number;
  saves: number;
  goals_against: number;
  shutouts: number;
  goalie_wins: number;
  titles: string[];
  awards: string[];
  value: number;
  goalie_value: number;
  by_comp:
    | {
        comp: string;
        f: number;
        gp: number;
        g: number;
        a: number;
        ggp: number;
        w: number;
        so: number;
      }[]
    | null;
}

type SortKey =
  | "value"
  | "points"
  | "goals"
  | "assists"
  | "gp"
  | "ppg"
  | "titles"
  | "awards"
  | "mvps"
  | "wins"
  | "shutouts"
  | "svpct";
type PosFilter = "all" | "F" | "D" | "G";

const MIN_GP_AVG = 20; // para los promedios, mínimo de partidos

const SKATER_SORTS: [SortKey, string][] = [
  ["value", "Valor"],
  ["points", "Puntos"],
  ["goals", "Goles"],
  ["assists", "Asistencias"],
  ["gp", "Partidos"],
  ["ppg", "Promedio"],
  ["titles", "Títulos"],
  ["awards", "Premios"],
  ["mvps", "MVP"],
];
const GOALIE_SORTS: [SortKey, string][] = [
  ["value", "Valor"],
  ["wins", "Victorias"],
  ["gp", "Partidos"],
  ["shutouts", "En cero"],
  ["svpct", "% atajadas"],
  ["titles", "Títulos"],
  ["awards", "Premios"],
];

const n = (v: unknown) => Number(v ?? 0);
const svPct = (r: LegendRow) =>
  n(r.saves) + n(r.goals_against) > 0
    ? n(r.saves) / (n(r.saves) + n(r.goals_against))
    : 0;
const posLabel = (p: string) =>
  p === "G" ? "Portero" : p === "D" ? "Defensa" : "Delantero";

function value(r: LegendRow, k: SortKey): number {
  switch (k) {
    case "value":
      return r.pos === "G" ? n(r.goalie_value) : n(r.value);
    case "points":
      return n(r.goals) + n(r.assists);
    case "goals":
      return n(r.goals);
    case "assists":
      return n(r.assists);
    case "gp":
      return r.pos === "G" ? n(r.goalie_gp) : n(r.gp);
    case "ppg":
      return n(r.gp) >= MIN_GP_AVG ? (n(r.goals) + n(r.assists)) / n(r.gp) : -1;
    case "titles":
      return r.titles.length;
    case "awards":
      return r.awards.length;
    case "mvps":
      return n(r.mvps);
    case "wins":
      return n(r.goalie_wins);
    case "shutouts":
      return n(r.shutouts);
    case "svpct":
      return n(r.goalie_gp) >= MIN_GP_AVG ? svPct(r) : -1;
  }
}

export function LegendsPage() {
  const { profile } = useAuth();
  const admin = profile?.role === "admin";
  const [view, setView] = useState<"history" | "rating">("history");
  return (
    <div className="space-y-5">
      {admin && (
        <div className="flex gap-1" role="tablist" aria-label="Vista">
          <button
            role="tab"
            aria-selected={view === "history"}
            onClick={() => setView("history")}
            className={cn(
              "focus-ring min-h-10 rounded-xl px-3.5 text-sm font-semibold",
              view === "history"
                ? "bg-primary text-bg"
                : "bg-surface-2 text-muted",
            )}
          >
            Top histórico
          </button>
          <button
            role="tab"
            aria-selected={view === "rating"}
            onClick={() => setView("rating")}
            className={cn(
              "focus-ring inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3.5 text-sm font-semibold",
              view === "rating"
                ? "bg-primary text-bg"
                : "bg-surface-2 text-muted",
            )}
          >
            <Lock size={14} aria-hidden /> Mejor media
          </button>
        </div>
      )}
      {admin && view === "rating" ? <BestRatings /> : <History />}
    </div>
  );
}

function History() {
  const reduce = useReducedMotion();
  const { byId } = useTeams();
  const [pos, setPos] = useState<PosFilter>("all");
  const [sort, setSort] = useState<SortKey>("value");
  const [query, setQuery] = useState("");
  const [retired, setRetired] = useState(true);
  const [shown, setShown] = useState(50);

  const list = useQuery({
    queryKey: ["player-alltime"],
    enabled: !DEMO_MODE,
    queryFn: async () => {
      const r = await db().rpc("player_alltime");
      if (r.error) throw new Error(r.error.message);
      return (r.data ?? []) as LegendRow[];
    },
    staleTime: 5 * 60_000,
  });

  const goalies = pos === "G";
  const sorts = goalies ? GOALIE_SORTS : SKATER_SORTS;
  const activeSort = sorts.some(([k]) => k === sort) ? sort : sorts[0][0];

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = (list.data ?? []).filter(
      (r) =>
        (pos === "all" ? r.pos !== "G" : r.pos === pos) &&
        (retired || !r.retired) &&
        (!q || `${r.first_name} ${r.last_name}`.toLowerCase().includes(q)),
    );
    // Desempate: puntos, luego partidos.
    return filtered
      .map((r) => ({ r, v: value(r, activeSort) }))
      .filter((x) => x.v >= 0)
      .sort(
        (a, b) =>
          b.v - a.v ||
          value(b.r, "value") - value(a.r, "value") ||
          n(b.r.gp) - n(a.r.gp),
      )
      .map((x) => x.r);
  }, [list.data, pos, retired, query, activeSort, goalies]);

  const podium = rows.slice(0, 3);

  return (
    <div className="space-y-5">
      <header
        className="relative overflow-hidden rounded-3xl p-6"
        style={{
          background:
            "radial-gradient(ellipse at 80% 0%, rgb(var(--team-primary) / 0.35), transparent 60%), linear-gradient(135deg, rgb(var(--surface-2)), rgb(var(--bg)))",
        }}
      >
        <div className="flex items-center gap-4">
          <div
            className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-primary/20 text-primary"
            aria-hidden
          >
            <Medal size={32} />
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.3em] text-muted">
              Todas las temporadas
            </div>
            <h1 className="font-display text-4xl font-extrabold uppercase leading-none sm:text-5xl">
              Top histórico
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted">
              Lo que cada jugador ha hecho en ARENA, en todas las competiciones:
              títulos, goles, asistencias, partidos, promedios y premios
              individuales. Incluye a los retirados.
            </p>
          </div>
        </div>
      </header>

      <div className="space-y-3">
        <div
          className="-mx-4 flex gap-1 overflow-x-auto px-4"
          role="tablist"
          aria-label="Posición"
        >
          {(
            [
              ["all", "Jugadores de campo"],
              ["F", "Delanteros"],
              ["D", "Defensas"],
              ["G", "Porteros"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              role="tab"
              aria-selected={pos === k}
              onClick={() => {
                setPos(k);
                setShown(50);
              }}
              className={cn(
                "focus-ring min-h-10 shrink-0 rounded-xl px-3.5 text-sm font-semibold",
                pos === k ? "bg-primary text-bg" : "bg-surface-2 text-muted",
              )}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">
            Ordenar por
          </span>
          {sorts.map(([k, l]) => (
            <button
              key={k}
              onClick={() => {
                setSort(k);
                setShown(50);
              }}
              aria-pressed={activeSort === k}
              className={cn(
                "focus-ring min-h-9 rounded-full border px-3 text-xs font-semibold",
                activeSort === k
                  ? "border-primary bg-primary/15 text-fg"
                  : "border-line text-muted hover:text-fg",
              )}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative min-w-0 flex-1 sm:max-w-xs">
            <span className="sr-only">Buscar jugador</span>
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
              aria-hidden
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar jugador"
              className="focus-ring min-h-10 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-sm"
            />
          </label>
          <label className="flex min-h-10 items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={retired}
              onChange={(e) => setRetired(e.target.checked)}
              className="h-4 w-4 accent-[rgb(var(--team-primary))]"
            />
            Incluir retirados
          </label>
        </div>
        {activeSort === "value" && (
          <p className="text-xs text-muted">
            No es lo mismo destacar en Segunda que en Primera. El valor suma{" "}
            {goalies
              ? "victorias, porterías en cero (×3)"
              : "goles, asistencias"}
            , MVP (×2) y títulos (×15), según el peso de cada competición:
            Primera, OHL y ALL STARS ×1 · CHAMPIONS ×1.25 · COPA ×0.75 · Segunda
            ×0.25.
          </p>
        )}
        {(activeSort === "ppg" || activeSort === "svpct") && (
          <p className="text-xs text-muted">
            Promedios con al menos {MIN_GP_AVG} partidos jugados.
          </p>
        )}
      </div>

      {list.isLoading ? (
        <Spinner />
      ) : list.error ? (
        <ErrorBox error={list.error} />
      ) : rows.length === 0 ? (
        <p className="card p-4 text-sm text-muted">
          No hay jugadores con esos filtros.
        </p>
      ) : (
        <>
          {/* Podio */}
          {!query && (
            <ol className="grid gap-3 sm:grid-cols-3">
              {podium.map((r, i) => {
                const t =
                  byId.get(r.main_team_id ?? "") ?? byId.get(r.team_id ?? "");
                const medal = ["#facc15", "#cbd5e1", "#d97706"][i];
                return (
                  <motion.li
                    key={r.player_id}
                    initial={reduce ? false : { opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.06 }}
                    className="card relative overflow-hidden p-4"
                    style={{ boxShadow: `inset 0 3px 0 ${medal}` }}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className="font-display text-4xl font-extrabold tabular"
                        style={{ color: medal }}
                      >
                        {i + 1}
                      </span>
                      {t && <Crest team={t} size={44} />}
                      <div className="min-w-0">
                        <div className="line-clamp-2 break-words font-display text-xl font-bold uppercase leading-tight">
                          {r.first_name} {r.last_name}
                        </div>
                        <div className="truncate text-xs text-muted">
                          {t?.name ?? "—"} · {posLabel(r.pos)}
                          {r.retired ? " · Retirado" : ""}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 font-display text-3xl font-extrabold tabular">
                      {format(r, activeSort)}
                    </div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                      {sorts.find(([k]) => k === activeSort)?.[1]}
                    </div>
                  </motion.li>
                );
              })}
            </ol>
          )}

          <ol className="space-y-2">
            {rows.slice(0, shown).map((r) => (
              <LegendItem
                key={r.player_id}
                r={r}
                rank={rows.indexOf(r) + 1}
                goalie={goalies}
                sort={activeSort}
              />
            ))}
          </ol>
          {rows.length > shown && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => setShown((s) => s + 50)}>
                Ver más ({rows.length - shown} restantes)
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function format(r: LegendRow, k: SortKey): string {
  const v = value(r, k);
  if (k === "ppg") return v.toFixed(2);
  if (k === "svpct") return `${(v * 100).toFixed(1)}%`;
  if (k === "value") return String(Math.round(v));
  return String(v);
}

function LegendItem({
  r,
  rank,
  goalie,
  sort,
}: {
  r: LegendRow;
  rank: number;
  goalie: boolean;
  sort: SortKey;
}) {
  const { byId } = useTeams();
  const [open, setOpen] = useState(false);
  const t = byId.get(r.main_team_id ?? "") ?? byId.get(r.team_id ?? "");
  const now =
    r.team_id && r.team_id !== r.main_team_id ? byId.get(r.team_id) : undefined;
  const gp = goalie ? n(r.goalie_gp) : n(r.gp);
  const cells: [string, string | number, SortKey | null][] = goalie
    ? [
        ["PJ", gp, "gp"],
        ["Victorias", n(r.goalie_wins), "wins"],
        ["En cero", n(r.shutouts), "shutouts"],
        ["% atajadas", `${(svPct(r) * 100).toFixed(1)}`, "svpct"],
        ["GC/PJ", gp ? (n(r.goals_against) / gp).toFixed(2) : "—", null],
        ["Valor", Math.round(n(r.goalie_value)), "value"],
      ]
    : [
        ["PJ", gp, "gp"],
        ["Goles", n(r.goals), "goals"],
        ["Asist.", n(r.assists), "assists"],
        ["Puntos", n(r.goals) + n(r.assists), "points"],
        ["G/PJ", gp ? (n(r.goals) / gp).toFixed(2) : "—", null],
        [
          "Pts/PJ",
          gp ? ((n(r.goals) + n(r.assists)) / gp).toFixed(2) : "—",
          "ppg",
        ],
        ["Valor", Math.round(n(r.value)), "value"],
      ];
  const extras = r.titles.length + r.awards.length + (r.by_comp?.length ?? 0);

  return (
    <li
      className="card overflow-hidden"
      style={t ? { boxShadow: `inset 4px 0 0 ${t.primary_color}` } : undefined}
    >
      <div className="flex flex-col gap-3 p-3 2xl:flex-row 2xl:items-center">
        <div className="flex min-w-0 items-center gap-3 2xl:w-80 2xl:shrink-0">
          <span
            className={cn(
              "w-8 text-center font-display text-xl font-extrabold tabular",
              rank <= 3 ? "text-yellow-300" : "text-muted",
            )}
          >
            {rank}
          </span>
          {t && <Crest team={t} size={36} />}
          <div className="min-w-0">
            <div className="line-clamp-2 break-words font-display text-lg font-bold uppercase leading-tight">
              {r.first_name} {r.last_name}
            </div>
            <div className="text-xs text-muted">
              {t ? (
                <Link to={`/equipos/${t.key}`} className="hover:text-fg">
                  {t.name}
                </Link>
              ) : (
                "—"
              )}
              {now ? ` · ahora en ${now.name}` : ""} · {posLabel(r.pos)} ·{" "}
              {r.seasons} {r.seasons === 1 ? "temporada" : "temporadas"}
              {r.retired ? " · Retirado" : ` · ${r.age} años`}
            </div>
          </div>
        </div>

        <div
          className={cn(
            "grid flex-1 gap-1.5 text-center",
            goalie
              ? "grid-cols-3 sm:grid-cols-6"
              : "grid-cols-4 sm:grid-cols-7",
          )}
        >
          {cells.map(([label, v, k]) => (
            <div
              key={label}
              className={cn(
                "rounded-lg py-1.5",
                k === sort ? "bg-primary/15" : "bg-surface-2",
              )}
            >
              <div className="font-display text-lg font-bold tabular leading-tight">
                {v}
              </div>
              <div className="text-[9px] font-semibold uppercase tracking-wider text-muted">
                {label}
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          disabled={!extras}
          className={cn(
            "focus-ring flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold 2xl:w-40",
            extras
              ? "bg-surface-2 text-fg hover:bg-surface-2/70"
              : "text-muted",
          )}
        >
          <span title="Títulos">🏆 {r.titles.length}</span>
          <span title="Premios individuales">🎖️ {r.awards.length}</span>
          {extras > 0 && (
            <ChevronDown
              size={16}
              className={cn("transition", open && "rotate-180")}
              aria-hidden
            />
          )}
        </button>
      </div>

      {open && extras > 0 && (
        <div className="space-y-2 border-t border-line px-3 pb-3 pt-2">
          {(r.by_comp?.length ?? 0) > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-muted">
                Por competición
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs tabular">
                  <thead className="text-muted">
                    <tr>
                      <th className="py-1 pr-2 font-semibold">Competición</th>
                      <th className="px-2 py-1 font-semibold">Peso</th>
                      <th className="px-2 py-1 text-right font-semibold">PJ</th>
                      {goalie ? (
                        <>
                          <th className="px-2 py-1 text-right font-semibold">
                            Vict.
                          </th>
                          <th className="px-2 py-1 text-right font-semibold">
                            En cero
                          </th>
                        </>
                      ) : (
                        <>
                          <th className="px-2 py-1 text-right font-semibold">
                            G
                          </th>
                          <th className="px-2 py-1 text-right font-semibold">
                            A
                          </th>
                          <th className="px-2 py-1 text-right font-semibold">
                            Pts
                          </th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {r.by_comp!.map((c) => (
                      <tr key={c.comp} className="border-t border-line/60">
                        <td className="py-1 pr-2 font-medium">{c.comp}</td>
                        <td
                          className={cn(
                            "px-2 py-1",
                            Number(c.f) < 1 ? "text-muted" : "text-secondary",
                          )}
                        >
                          ×{Number(c.f)}
                        </td>
                        <td className="px-2 py-1 text-right">
                          {goalie ? c.ggp : c.gp}
                        </td>
                        {goalie ? (
                          <>
                            <td className="px-2 py-1 text-right">{c.w}</td>
                            <td className="px-2 py-1 text-right">{c.so}</td>
                          </>
                        ) : (
                          <>
                            <td className="px-2 py-1 text-right">{c.g}</td>
                            <td className="px-2 py-1 text-right">{c.a}</td>
                            <td className="px-2 py-1 text-right font-semibold">
                              {n(c.g) + n(c.a)}
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {r.titles.length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-muted">
                Títulos
              </div>
              <div className="flex flex-wrap gap-1.5">
                {r.titles.map((c) => (
                  <span
                    key={c}
                    className="inline-flex items-center gap-1 rounded-full border border-yellow-400/50 bg-yellow-400/10 px-2 py-0.5 text-xs font-medium text-yellow-200"
                  >
                    <span aria-hidden>🏆</span> {c}
                  </span>
                ))}
              </div>
            </div>
          )}
          {r.awards.length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-muted">
                Premios individuales
              </div>
              <div className="flex flex-wrap gap-1.5">
                {r.awards.map((a, i) => (
                  <span
                    key={`${a}-${i}`}
                    className="inline-flex items-center gap-1 rounded-full border border-purple-400/40 bg-purple-400/10 px-2 py-0.5 text-xs font-medium text-purple-200"
                  >
                    <span aria-hidden>
                      {a.startsWith("Balón de Oro") ? "👑" : "🎖️"}
                    </span>{" "}
                    {a}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** Solo para el administrador: los jugadores en activo con mejor media. */
function BestRatings() {
  const { byId } = useTeams();
  const all = usePlayers();
  const [pos, setPos] = useState<PosFilter>("all");
  const [div, setDiv] = useState<0 | 1 | 2>(0);
  const [shown, setShown] = useState(50);
  const rows = useMemo(
    () =>
      (all.data ?? [])
        .filter(
          (p) =>
            !p.retired &&
            (pos === "all" || p.position === pos) &&
            (!div ||
              (p.team_id ? byId.get(p.team_id)?.division : null) === div),
        )
        .sort(
          (a, b) =>
            b.rating - a.rating || b.potential - a.potential || a.age - b.age,
        ),
    [all.data, pos, div, byId],
  );
  return (
    <div className="space-y-4">
      <header className="card flex items-start gap-3 p-4">
        <Lock size={18} className="mt-0.5 shrink-0 text-primary" aria-hidden />
        <div>
          <h1 className="font-display text-3xl font-extrabold uppercase leading-none">
            Mejor media
          </h1>
          <p className="mt-1 text-sm text-muted">
            Solo tú ves esta lista. Jugadores en activo ordenados por su media
            (calidad actual); desempata el potencial.
          </p>
        </div>
      </header>
      <div
        className="-mx-4 flex gap-1 overflow-x-auto px-4"
        role="tablist"
        aria-label="Posición"
      >
        {(
          [
            ["all", "Todos"],
            ["F", "Delanteros"],
            ["D", "Defensas"],
            ["G", "Porteros"],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            role="tab"
            aria-selected={pos === k}
            onClick={() => {
              setPos(k);
              setShown(50);
            }}
            className={cn(
              "focus-ring min-h-10 shrink-0 rounded-xl px-3.5 text-sm font-semibold",
              pos === k ? "bg-primary text-bg" : "bg-surface-2 text-muted",
            )}
          >
            {l}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">
          División
        </span>
        {(
          [
            [0, "Todas"],
            [1, "Primera"],
            [2, "Segunda"],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            onClick={() => {
              setDiv(k);
              setShown(50);
            }}
            aria-pressed={div === k}
            className={cn(
              "focus-ring min-h-9 rounded-full border px-3 text-xs font-semibold",
              div === k
                ? "border-primary bg-primary/15 text-fg"
                : "border-line text-muted hover:text-fg",
            )}
          >
            {l}
          </button>
        ))}
      </div>
      {all.isLoading ? (
        <Spinner />
      ) : all.error ? (
        <ErrorBox error={all.error} />
      ) : (
        <>
          <ol className="space-y-2">
            {rows.slice(0, shown).map((p, i) => {
              const t = p.team_id ? byId.get(p.team_id) : undefined;
              return (
                <li
                  key={p.id}
                  className="card flex flex-col gap-3 p-3 sm:flex-row sm:items-center"
                  style={
                    t
                      ? { boxShadow: `inset 4px 0 0 ${t.primary_color}` }
                      : undefined
                  }
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span
                      className={cn(
                        "w-8 shrink-0 text-center font-display text-xl font-extrabold tabular",
                        i < 3 ? "text-yellow-300" : "text-muted",
                      )}
                    >
                      {i + 1}
                    </span>
                    {t && <Crest team={t} size={36} />}
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-2 break-words font-display text-lg font-bold uppercase leading-tight">
                        {p.first_name} {p.last_name}
                      </div>
                      <div className="text-xs text-muted">
                        {t?.name ?? "Sin equipo"}
                        {t?.division ? (
                          <span
                            className={cn(
                              "ml-1.5 rounded px-1.5 py-px text-[10px] font-bold uppercase",
                              t.division === 1
                                ? "bg-primary/20 text-fg"
                                : "bg-surface-2 text-muted",
                            )}
                          >
                            {t.division === 1 ? "Primera" : "Segunda"}
                          </span>
                        ) : null}{" "}
                        · {posLabel(p.position)} · {p.age} años
                        {p.injury_days > 0 ? " · Lesionado" : ""}
                      </div>
                    </div>
                  </div>
                  <div className="grid shrink-0 grid-cols-3 gap-1.5 text-center">
                    {(
                      [
                        ["Media", p.rating, true],
                        ["Potencial", p.potential, false],
                        ["Forma", p.form, false],
                      ] as const
                    ).map(([label, v, main]) => (
                      <div
                        key={label}
                        className={cn(
                          "rounded-lg py-1.5 sm:w-20",
                          main ? "bg-primary/15" : "bg-surface-2",
                        )}
                      >
                        <div className="font-display text-xl font-bold tabular leading-tight">
                          {v}
                        </div>
                        <div className="text-[9px] font-semibold uppercase tracking-wider text-muted">
                          {label}
                        </div>
                      </div>
                    ))}
                  </div>
                </li>
              );
            })}
          </ol>
          {rows.length > shown && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => setShown((s) => s + 50)}>
                Ver más ({rows.length - shown} restantes)
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
