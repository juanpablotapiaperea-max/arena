// Planificador semanal: elegir días y competiciones, generar el plan y
// ajustarlo arrastrando jornadas entre días (funciona con el dedo en iPad).
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlertTriangle,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  GripVertical,
  Merge,
  Play,
  Plus,
  Radio,
  Sparkles,
  Trash2,
  X,
  Zap,
  Flag,
} from "lucide-react";
import {
  engine,
  getEditions,
  type Edition,
  type Plan,
  type PlanBlock,
  type PlanDay,
  type Unit,
} from "@/lib/engine";
import { compColor } from "@/lib/compColors";
import { useA11y } from "@/lib/a11y";
import {
  Badge,
  Button,
  ErrorBox,
  SectionTitle,
  Spinner,
  cn,
} from "@/components/ui";
import { fmtShortDate } from "@/components/game";

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function mondayOf(d: Date) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  x.setHours(12, 0, 0, 0);
  return x;
}
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Minutos estimados del día: ráfagas cada 2 min (máx. 6 h) y vivos de 6 min. */
function estimateMinutes(d: Pick<PlanDay, "matches" | "lives">) {
  const normal = Math.max(0, d.matches - d.lives);
  const bursts = Math.ceil(normal / 6);
  return Math.min(360, Math.max(bursts * 2, d.lives * 6 + 2));
}
const fmtDur = (min: number) =>
  min >= 60
    ? `${Math.floor(min / 60)} h ${min % 60 ? `${min % 60} min` : ""}`
    : `${min} min`;

export function Planner() {
  const qc = useQueryClient();
  const { say } = useA11y();
  const plan = useQuery({
    queryKey: ["plan"],
    queryFn: () => engine<Plan>("plan.get"),
  });
  const editions = useQuery({ queryKey: ["editions"], queryFn: getEditions });
  const [week, setWeek] = useState(() => mondayOf(new Date()));
  const [pickedDays, setPickedDays] = useState<Set<string>>(new Set());
  const [pickedEds, setPickedEds] = useState<Set<string> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [adding, setAdding] = useState<PlanDay | null>(null);
  const [starting, setStarting] = useState<PlanDay | null>(null);

  const active = (editions.data ?? []).filter((e) => e.status !== "finished");
  const eds = pickedEds ?? new Set(active.map((e) => e.id));
  const edById = new Map((editions.data ?? []).map((e) => [e.id, e]));
  const days = plan.data?.days ?? [];
  const existingDates = new Map(days.map((d) => [d.date, d]));
  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(week);
    d.setDate(d.getDate() + i);
    return iso(d);
  });
  const today = iso(new Date());

  const run = async <T,>(
    label: string,
    fn: () => Promise<T>,
    done?: string,
  ) => {
    setBusy(label);
    setError(null);
    try {
      const out = await fn();
      if (out && typeof out === "object" && "days" in (out as object))
        qc.setQueryData(["plan"], out);
      else await qc.invalidateQueries({ queryKey: ["plan"] });
      if (done) say(done);
      return out;
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  const generate = (dates = [...pickedDays].sort(), editionIds = [...eds]) =>
    run(
      "generate",
      () => engine<Plan>("plan.generate", { dates, editionIds }),
      "Plan generado",
    ).then(() => setPickedDays(new Set()));

  const maxInterest = Math.max(1, ...days.map((d) => d.interest));

  return (
    <div className="space-y-6">
      <SectionTitle>Planificador semanal</SectionTitle>
      {error ? <ErrorBox error={error} /> : null}

      <FinishSeason
        active={active.length}
        onDone={(p) => qc.setQueryData(["plan"], p)}
      />

      {/* Paso 1 y 2 */}
      <section className="card space-y-5 p-4" aria-labelledby="gen-title">
        <h3 id="gen-title" className="flex items-center gap-2 font-semibold">
          <Sparkles size={18} className="text-secondary" aria-hidden /> Generar
          días nuevos
        </h3>

        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted">
              1 · Elige los días
            </span>
            <div className="flex items-center gap-1">
              <button
                className="focus-ring rounded-lg p-2 hover:bg-surface-2"
                aria-label="Semana anterior"
                onClick={() =>
                  setWeek(
                    (w) =>
                      new Date(
                        w.getFullYear(),
                        w.getMonth(),
                        w.getDate() - 7,
                        12,
                      ),
                  )
                }
              >
                <ChevronLeft size={18} />
              </button>
              <span className="min-w-36 text-center text-sm font-medium">
                Semana del {fmtShortDate(iso(week))}
              </span>
              <button
                className="focus-ring rounded-lg p-2 hover:bg-surface-2"
                aria-label="Semana siguiente"
                onClick={() =>
                  setWeek(
                    (w) =>
                      new Date(
                        w.getFullYear(),
                        w.getMonth(),
                        w.getDate() + 7,
                        12,
                      ),
                  )
                }
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
          <div
            className="grid grid-cols-7 gap-1.5"
            role="group"
            aria-label="Días de la semana"
          >
            {weekDates.map((date, i) => {
              const ex = existingDates.get(date);
              const locked = !!ex && ex.status !== "planned";
              const on = pickedDays.has(date);
              const past = date < today;
              return (
                <button
                  key={date}
                  disabled={locked || past}
                  aria-pressed={on}
                  onClick={() =>
                    setPickedDays((s) => {
                      const n = new Set(s);
                      if (n.has(date)) n.delete(date);
                      else n.add(date);
                      return n;
                    })
                  }
                  className={cn(
                    "focus-ring flex min-h-16 flex-col items-center justify-center rounded-xl border text-center transition disabled:opacity-35",
                    on
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-line bg-surface-2 hover:border-primary/50",
                    i >= 5 && !on && "opacity-70",
                  )}
                >
                  <span className="text-[11px] font-semibold uppercase">
                    {WEEKDAYS[i]}
                  </span>
                  <span className="font-display text-2xl font-bold leading-none">
                    {Number(date.slice(8))}
                  </span>
                  {ex && (
                    <span className="mt-0.5 text-[9px] font-semibold uppercase text-muted">
                      {ex.status === "planned"
                        ? "planeado"
                        : ex.status === "closed"
                          ? "jugado"
                          : "en curso"}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setPickedDays(
                  new Set(
                    weekDates
                      .slice(0, 5)
                      .filter(
                        (d) =>
                          d >= today &&
                          !(
                            existingDates.get(d) &&
                            existingDates.get(d)!.status !== "planned"
                          ),
                      ),
                  ),
                )
              }
            >
              Lunes a viernes
            </Button>
            {pickedDays.size > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setPickedDays(new Set())}
              >
                Limpiar
              </Button>
            )}
          </div>
        </div>

        <div>
          <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted">
            2 · Elige las competiciones
          </span>
          {editions.isLoading ? (
            <Spinner />
          ) : active.length === 0 ? (
            <p className="rounded-xl bg-surface-2 p-3 text-sm text-muted">
              No hay competiciones en curso. Arráncalas en «Competiciones».
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {active.map((e) => {
                const on = eds.has(e.id);
                const name = e.name.split(" · ")[0];
                return (
                  <button
                    key={e.id}
                    aria-pressed={on}
                    onClick={() =>
                      setPickedEds(() => {
                        const n = new Set(eds);
                        if (n.has(e.id)) n.delete(e.id);
                        else n.add(e.id);
                        return n;
                      })
                    }
                    className={cn(
                      "focus-ring flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm font-medium transition",
                      on
                        ? "border-transparent text-bg"
                        : "border-line bg-surface-2 text-muted",
                    )}
                    style={
                      on
                        ? { background: compColor(e.config.competitionKey) }
                        : undefined
                    }
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={() => generate()}
            disabled={!pickedDays.size || !eds.size || busy !== null}
          >
            <Sparkles size={16} />{" "}
            {busy === "generate"
              ? "Generando…"
              : `3 · Generar ${pickedDays.size || ""} ${pickedDays.size === 1 ? "día" : "días"}`}
          </Button>
          <span className="text-xs text-muted">
            Reparte las jornadas buscando un interés parecido por día. Luego
            puedes arrastrarlas.
          </span>
        </div>
      </section>

      {plan.isLoading ? (
        <Spinner />
      ) : (
        <>
          {plan.data?.warnings.length ? (
            <div
              className="rounded-2xl border border-secondary/40 bg-secondary/10 p-4"
              role="status"
            >
              <h3 className="mb-1 flex items-center gap-2 font-semibold text-secondary">
                <AlertTriangle size={16} aria-hidden /> Revisa estas reglas
              </h3>
              <ul className="list-disc space-y-0.5 pl-5 text-sm">
                {plan.data.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-muted">
                Son avisos: la decisión final es tuya.
              </p>
            </div>
          ) : null}
          <Board
            days={days}
            edById={edById}
            maxInterest={maxInterest}
            busy={busy}
            onMove={(blockId, dayId, index) =>
              run(
                "move",
                () => engine<Plan>("plan.move", { blockId, dayId, index }),
                "Jornada movida",
              )
            }
            onRemove={(blockId) =>
              run(
                "remove",
                () => engine<Plan>("plan.removeBlock", { blockId }),
                "Jornada quitada del plan",
              )
            }
            onPublish={(d) =>
              run(
                "publish",
                () =>
                  engine<Plan>("plan.publish", {
                    dayId: d.id,
                    published: !d.published,
                  }),
                d.published ? "Día oculto" : "Día publicado",
              )
            }
            onMerge={(into, from) =>
              run(
                "merge",
                () =>
                  engine<Plan>("plan.merge", {
                    intoDayId: into.id,
                    fromDayId: from.id,
                  }),
                "Días fusionados",
              )
            }
            onDeleteDay={(d) =>
              run(
                "delete",
                () => engine<Plan>("plan.deleteDay", { dayId: d.id }),
                "Día quitado",
              )
            }
            onAdd={setAdding}
            onStart={setStarting}
            setLocal={(p) => qc.setQueryData(["plan"], p)}
            plan={plan.data!}
          />
        </>
      )}

      {adding && (
        <AddUnitDialog
          day={adding}
          onClose={() => setAdding(null)}
          onAdd={(editionId, unitIndex) =>
            run(
              "add",
              () =>
                engine<Plan>("plan.addBlock", {
                  dayId: adding.id,
                  editionId,
                  unitIndex,
                }),
              "Jornada agregada",
            )
          }
        />
      )}
      {starting && (
        <StartDialog
          day={starting}
          onClose={() => setStarting(null)}
          onStart={async (mode) => {
            const r = await run(
              "start",
              () =>
                engine<{ lives: number; bursts: number; startsAt: string }>(
                  "day.start",
                  { dayId: starting.id, mode },
                ),
              "Día iniciado",
            );
            if (r) {
              setStarting(null);
              await qc.invalidateQueries();
            }
          }}
          busy={busy === "start"}
        />
      )}
    </div>
  );
}

function Board({
  days,
  plan,
  edById,
  maxInterest,
  busy,
  onMove,
  onRemove,
  onPublish,
  onMerge,
  onDeleteDay,
  onAdd,
  onStart,
  setLocal,
}: {
  days: PlanDay[];
  plan: Plan;
  edById: Map<string, Edition>;
  maxInterest: number;
  busy: string | null;
  onMove: (blockId: string, dayId: string, index: number) => void;
  onRemove: (blockId: string) => void;
  onPublish: (d: PlanDay) => void;
  onMerge: (into: PlanDay, from: PlanDay) => void;
  onDeleteDay: (d: PlanDay) => void;
  onAdd: (d: PlanDay) => void;
  onStart: (d: PlanDay) => void;
  setLocal: (p: Plan) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const [dragging, setDragging] = useState<PlanBlock | null>(null);
  const blockDay = useMemo(
    () =>
      new Map(days.flatMap((d) => d.blocks.map((b) => [b.id, d.id] as const))),
    [days],
  );
  const editable = (d: PlanDay) => d.status === "planned";

  const onDragStart = (e: DragStartEvent) =>
    setDragging(
      days.flatMap((d) => d.blocks).find((b) => b.id === e.active.id) ?? null,
    );
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const { active, over } = e;
    if (!over) return;
    const fromDay = blockDay.get(String(active.id));
    const toDay =
      blockDay.get(String(over.id)) ?? String(over.id).replace("day:", "");
    const target = days.find((d) => d.id === toDay);
    if (!fromDay || !target || !editable(target)) return;
    const list = target.blocks.filter((b) => b.id !== active.id);
    let index = list.findIndex((b) => b.id === over.id);
    if (index < 0) index = list.length;
    // Actualización optimista
    const moving = days
      .flatMap((d) => d.blocks)
      .find((b) => b.id === active.id)!;
    const next = days.map((d) => {
      let blocks = d.blocks.filter((b) => b.id !== active.id);
      if (d.id === toDay)
        blocks = [
          ...blocks.slice(0, index),
          { ...moving, day_id: toDay },
          ...blocks.slice(index),
        ];
      const totals = {
        matches: blocks.reduce((s, b) => s + b.matches_count, 0),
        lives: blocks.reduce((s, b) => s + b.live_count, 0),
        interest: blocks.reduce((s, b) => s + Number(b.interest), 0),
      };
      return {
        ...d,
        ...totals,
        blocks: blocks.map((b, i) => ({ ...b, sort_order: i })),
      };
    });
    setLocal({ ...plan, days: next });
    onMove(String(active.id), toDay, index);
  };

  if (!days.length)
    return (
      <div className="card flex flex-col items-center gap-2 p-10 text-center">
        <CalendarPlus className="text-primary" size={32} aria-hidden />
        <p className="font-semibold">Aún no hay días planeados</p>
        <p className="max-w-md text-sm text-muted">
          Elige los días y las competiciones arriba y pulsa «Generar». Después
          podrás arrastrar cada jornada al día que quieras.
        </p>
      </div>
    );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      <p className="text-xs text-muted">
        Mantén presionada una jornada y arrástrala a otro día o a otra posición.
        También puedes usar las flechas de cada tarjeta.
      </p>
      <div
        className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-4"
        role="list"
        aria-label="Días planeados"
      >
        {days.map((d, i) => (
          <DayColumn
            key={d.id}
            day={d}
            prev={days[i - 1]}
            next={days[i + 1]}
            edById={edById}
            maxInterest={maxInterest}
            busy={busy}
            onMove={onMove}
            onRemove={onRemove}
            onPublish={onPublish}
            onMerge={onMerge}
            onDeleteDay={onDeleteDay}
            onAdd={onAdd}
            onStart={onStart}
          />
        ))}
      </div>
      <DragOverlay>
        {dragging ? (
          <BlockCard
            block={dragging}
            ed={
              dragging.edition_id ? edById.get(dragging.edition_id) : undefined
            }
            overlay
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function DayColumn({
  day,
  prev,
  next,
  edById,
  maxInterest,
  busy,
  onMove,
  onRemove,
  onPublish,
  onMerge,
  onDeleteDay,
  onAdd,
  onStart,
}: {
  day: PlanDay;
  prev?: PlanDay;
  next?: PlanDay;
  edById: Map<string, Edition>;
  maxInterest: number;
  busy: string | null;
  onMove: (blockId: string, dayId: string, index: number) => void;
  onRemove: (blockId: string) => void;
  onPublish: (d: PlanDay) => void;
  onMerge: (into: PlanDay, from: PlanDay) => void;
  onDeleteDay: (d: PlanDay) => void;
  onAdd: (d: PlanDay) => void;
  onStart: (d: PlanDay) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${day.id}` });
  const editable = day.status === "planned";
  const minutes = estimateMinutes(day);
  const over6h = minutes > 360;
  const ratio = day.interest / maxInterest;
  const weekday = new Date(`${day.date}T12:00:00`).toLocaleDateString("es-MX", {
    weekday: "long",
  });

  return (
    <section
      role="listitem"
      aria-label={`${weekday} ${day.date}`}
      className={cn(
        "card flex w-[min(86vw,320px)] shrink-0 snap-start flex-col p-3",
        isOver && "border-primary",
        !editable && "opacity-80",
      )}
    >
      <header className="mb-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-display text-2xl font-bold uppercase leading-none">
              {weekday}
            </div>
            <div className="text-xs text-muted">{fmtShortDate(day.date)}</div>
          </div>
          <div className="flex flex-col items-end gap-1">
            {day.status === "planned" ? (
              day.published ? (
                <Badge tone="primary">Publicado</Badge>
              ) : (
                <Badge>Borrador</Badge>
              )
            ) : day.status === "closed" ? (
              <Badge tone="win">Jugado</Badge>
            ) : (
              <Badge tone="live">En curso</Badge>
            )}
          </div>
        </div>
        <div>
          <div className="mb-1 flex justify-between text-[11px] text-muted">
            <span>Interés</span>
            <span className="tabular">{Math.round(day.interest)}</span>
          </div>
          <div
            className="h-2 overflow-hidden rounded-full bg-surface-2"
            role="meter"
            aria-valuenow={Math.round(ratio * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Interés del día"
          >
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.max(4, ratio * 100)}%`,
                background:
                  "linear-gradient(90deg, rgb(var(--team-primary)), rgb(var(--team-secondary)))",
              }}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          <span>
            <b className="tabular">{day.matches}</b> partidos
          </span>
          <span className="inline-flex items-center gap-1">
            <Radio size={12} className="text-live" aria-hidden />
            <b className="tabular">{day.lives}</b> en vivo
          </span>
          <span
            className={cn(over6h && "font-semibold text-secondary")}
            title="Duración estimada"
          >
            ≈ {fmtDur(minutes)}
            {over6h && " (más de 6 h)"}
          </span>
        </div>
      </header>

      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-24 flex-1 flex-col gap-2 rounded-xl p-1 transition",
          isOver && "bg-primary/5",
        )}
      >
        <SortableContext
          items={day.blocks.map((b) => b.id)}
          strategy={verticalListSortingStrategy}
        >
          {day.blocks.map((b, idx) => (
            <SortableBlock
              key={b.id}
              block={b}
              ed={b.edition_id ? edById.get(b.edition_id) : undefined}
              disabled={!editable}
              onPrevDay={
                prev && prev.status === "planned" && editable
                  ? () => onMove(b.id, prev.id, prev.blocks.length)
                  : undefined
              }
              onNextDay={
                next && next.status === "planned" && editable
                  ? () => onMove(b.id, next.id, 0)
                  : undefined
              }
              onUp={
                idx > 0 && editable
                  ? () => onMove(b.id, day.id, idx - 1)
                  : undefined
              }
              onDown={
                idx < day.blocks.length - 1 && editable
                  ? () => onMove(b.id, day.id, idx + 1)
                  : undefined
              }
              onRemove={editable ? () => onRemove(b.id) : undefined}
            />
          ))}
        </SortableContext>
        {!day.blocks.length && (
          <p className="p-4 text-center text-xs text-muted">
            Suelta aquí una jornada
          </p>
        )}
      </div>

      {editable && (
        <footer className="mt-3 space-y-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => onAdd(day)}
          >
            <Plus size={14} /> Agregar jornada
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPublish(day)}
              disabled={busy !== null}
            >
              {day.published ? <EyeOff size={14} /> : <Eye size={14} />}{" "}
              {day.published ? "Ocultar" : "Publicar"}
            </Button>
            <Button
              size="sm"
              onClick={() => onStart(day)}
              disabled={!day.blocks.length || busy !== null}
            >
              <Play size={14} /> Iniciar
            </Button>
          </div>
          <div className="flex justify-between">
            {next && next.status === "planned" ? (
              <button
                className="focus-ring inline-flex items-center gap-1 rounded px-1 text-xs text-muted hover:text-fg"
                onClick={() => onMerge(day, next)}
              >
                <Merge size={12} /> Fusionar con el siguiente
              </button>
            ) : (
              <span />
            )}
            <button
              className="focus-ring inline-flex items-center gap-1 rounded px-1 text-xs text-muted hover:text-loss"
              onClick={() => onDeleteDay(day)}
            >
              <Trash2 size={12} /> Quitar día
            </button>
          </div>
        </footer>
      )}
    </section>
  );
}

function SortableBlock(props: {
  block: PlanBlock;
  ed?: Edition;
  disabled: boolean;
  onPrevDay?: () => void;
  onNextDay?: () => void;
  onUp?: () => void;
  onDown?: () => void;
  onRemove?: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.block.id, disabled: props.disabled });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && "opacity-30")}
    >
      <BlockCard {...props} handle={{ ...attributes, ...listeners }} />
    </div>
  );
}

function BlockCard({
  block,
  ed,
  handle,
  overlay,
  onPrevDay,
  onNextDay,
  onUp,
  onDown,
  onRemove,
}: {
  block: PlanBlock;
  ed?: Edition;
  handle?: Record<string, unknown>;
  overlay?: boolean;
  onPrevDay?: () => void;
  onNextDay?: () => void;
  onUp?: () => void;
  onDown?: () => void;
  onRemove?: () => void;
}) {
  const color = compColor(ed?.config.competitionKey);
  const [comp, unit] = block.label.split(" · ");
  const isFinal = unit === "Final";
  return (
    <article
      className={cn(
        "relative flex items-stretch gap-2 rounded-xl border border-line bg-surface-2 p-2 pl-3",
        overlay && "rotate-2 shadow-2xl ring-2 ring-primary",
        block.status === "done" && "opacity-50",
      )}
      style={{ boxShadow: `inset 4px 0 0 ${color}` }}
      aria-label={`${block.label}, ${block.matches_count} partidos${block.live_count ? `, ${block.live_count} en vivo` : ""}`}
    >
      {handle && (
        <button
          {...handle}
          className="focus-ring -ml-1 flex touch-none items-center rounded text-muted hover:text-fg"
          aria-label={`Mover ${block.label}`}
        >
          <GripVertical size={16} />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <div
          className="text-[10px] font-bold uppercase tracking-wider"
          style={{ color }}
        >
          {comp}
        </div>
        <div className="flex items-center gap-1.5 font-semibold">
          {isFinal && <span aria-hidden>🏆</span>}
          <span className="truncate">{unit}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
          <span className="tabular">{block.matches_count} part.</span>
          {block.live_count > 0 && (
            <span className="inline-flex items-center gap-0.5 text-live">
              <Radio size={10} aria-hidden />
              {block.live_count} en vivo
            </span>
          )}
          <span
            className="inline-flex items-center gap-0.5"
            title={`Interés ${block.interest}`}
          >
            <Zap size={10} aria-hidden />
            {Math.round(Number(block.interest))}
          </span>
        </div>
      </div>
      {(onPrevDay || onNextDay || onUp || onDown || onRemove) && (
        <div className="flex flex-col items-end justify-between gap-1">
          <div className="flex gap-0.5">
            {onPrevDay && (
              <IconBtn label="Al día anterior" onClick={onPrevDay}>
                <ChevronLeft size={14} />
              </IconBtn>
            )}
            {onNextDay && (
              <IconBtn label="Al día siguiente" onClick={onNextDay}>
                <ChevronRight size={14} />
              </IconBtn>
            )}
          </div>
          <div className="flex gap-0.5">
            {onUp && (
              <IconBtn label="Subir" onClick={onUp}>
                <ChevronLeft size={14} className="rotate-90" />
              </IconBtn>
            )}
            {onDown && (
              <IconBtn label="Bajar" onClick={onDown}>
                <ChevronRight size={14} className="rotate-90" />
              </IconBtn>
            )}
            {onRemove && (
              <IconBtn label="Quitar del plan" onClick={onRemove}>
                <X size={14} />
              </IconBtn>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

function IconBtn({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="focus-ring flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface hover:text-fg"
    >
      {children}
    </button>
  );
}

function AddUnitDialog({
  day,
  onClose,
  onAdd,
}: {
  day: PlanDay;
  onClose: () => void;
  onAdd: (editionId: string, unitIndex: number) => void;
}) {
  const q = useQuery({
    queryKey: ["unplanned"],
    queryFn: () =>
      engine<{ editionId: string; name: string; units: Unit[] }[]>(
        "plan.unplanned",
      ),
  });
  return (
    <Dialog title={`Agregar a ${fmtShortDate(day.date)}`} onClose={onClose}>
      {q.isLoading ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          {(q.data ?? []).filter((e) => e.units.length).length === 0 && (
            <p className="text-sm text-muted">
              Todas las jornadas ya están planeadas.
            </p>
          )}
          {(q.data ?? [])
            .filter((e) => e.units.length)
            .map((e) => (
              <div key={e.editionId}>
                <h4 className="mb-1 text-xs font-bold uppercase tracking-wider text-muted">
                  {e.name}
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {e.units.slice(0, 12).map((u, i) => (
                    <button
                      key={u.index}
                      onClick={() => {
                        onAdd(e.editionId, u.index);
                        onClose();
                      }}
                      className={cn(
                        "focus-ring rounded-lg border px-2.5 py-1.5 text-sm",
                        i === 0
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-line bg-surface-2",
                      )}
                    >
                      {u.label}
                      {u.main && " 🔴"}
                    </button>
                  ))}
                  {e.units.length > 12 && (
                    <span className="self-center text-xs text-muted">
                      +{e.units.length - 12} más
                    </span>
                  )}
                </div>
              </div>
            ))}
          <p className="text-xs text-muted">
            Resaltada: la siguiente en orden. Agregar otra fuera de orden es
            posible, pero esperará a que termine la anterior.
          </p>
        </div>
      )}
    </Dialog>
  );
}

function StartDialog({
  day,
  onClose,
  onStart,
  busy,
}: {
  day: PlanDay;
  onClose: () => void;
  onStart: (mode: "real" | "now") => void;
  busy: boolean;
}) {
  const isToday = day.date === iso(new Date());
  return (
    <Dialog title="Iniciar día de competencia" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Al iniciar se mueven la forma y las lesiones de los jugadores, se
          bloquean los estilos de juego y se arma el guion del día. Todo se
          ejecuta solo.
        </p>
        <div className="grid gap-2">
          <button
            disabled={busy}
            onClick={() => onStart("now")}
            className="focus-ring rounded-2xl border border-primary bg-primary/10 p-4 text-left transition hover:bg-primary/20 disabled:opacity-50"
          >
            <div className="font-semibold text-primary">Empezar ahora</div>
            <div className="text-sm text-muted">
              La primera ráfaga sale en un minuto y el primer evento en vivo en
              cinco.
            </div>
          </button>
          <button
            disabled={busy || !isToday}
            onClick={() => onStart("real")}
            className="focus-ring rounded-2xl border border-line p-4 text-left transition hover:border-primary/60 disabled:opacity-40"
          >
            <div className="font-semibold">
              Horario de clase (8:00 a 14:00, hora de México)
            </div>
            <div className="text-sm text-muted">
              {isToday
                ? "Si ya pasó de las 8:00, empieza enseguida."
                : "Disponible el mismo día."}
            </div>
          </button>
        </div>
        {busy && <Spinner label="Preparando el día…" />}
      </div>
    </Dialog>
  );
}

export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-line bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:rounded-3xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3 className="font-display text-2xl font-bold uppercase">{title}</h3>
          <button
            onClick={onClose}
            className="focus-ring rounded-lg p-2 text-muted hover:text-fg"
            aria-label="Cerrar"
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** «Indicar fin de temporada»: todo lo que falta termina el día elegido. */
function FinishSeason({
  active,
  onDone,
}: {
  active: number;
  onDone: (p: Plan) => void;
}) {
  const { say } = useA11y();
  const today = iso(new Date());
  const plus = (n: number) => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + n);
    return iso(d);
  };
  const [date, setDate] = useState(today);
  const [time, setTime] = useState(() => {
    const d = new Date(Date.now() + 4 * 3600_000);
    return `${String(Math.min(23, d.getHours())).padStart(2, '0')}:00`;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<{ dates: string[]; plan: Plan } | null>(
    null,
  );

  const go = async () => {
    const days =
      Math.round(
        (Date.parse(`${date}T12:00:00`) - Date.parse(`${today}T12:00:00`)) /
          86_400_000,
      ) + 1;
    const msg =
      days <= 1
        ? `Todo lo que falta de las ${active} competiciones se juega HOY y termina a las ${time}. Lo que ya se está jugando también se acomoda para acabar a esa hora. ¿Continuar?`
        : `Todo lo que falta se reparte en ${days} días, hasta el ${fmtShortDate(date)}; cada día termina a las ${time}. ¿Continuar?`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    setError(null);
    try {
      const r = await engine<{ dates: string[]; plan: Plan }>(
        "season.finishBy",
        { endDate: date, endTime: time },
      );
      setResult(r);
      onDone(r.plan);
      say("Temporada reprogramada");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const chips: [string, string][] = [
    ["Hoy", today],
    ["Mañana", plus(1)],
    ["En 3 días", plus(2)],
    ["En 7 días", plus(6)],
  ];

  return (
    <section
      className="card space-y-3 border-primary/40 bg-primary/5 p-4"
      aria-labelledby="fin-title"
    >
      <h3 id="fin-title" className="flex items-center gap-2 font-semibold">
        <Flag size={18} className="text-primary" aria-hidden /> Indicar fin de
        temporada
      </h3>
      <p className="text-sm text-muted">
        Elige qué día debe terminar todo. Se reparte lo que falta de todas las
        competiciones y el ritmo se acelera solo para acabar a tiempo. Los días
        arrancan solos.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div
          className="flex flex-wrap gap-1"
          role="group"
          aria-label="Atajos de fecha"
        >
          {chips.map(([label, d]) => (
            <button
              key={label}
              onClick={() => setDate(d)}
              aria-pressed={date === d}
              className={cn(
                "focus-ring min-h-10 rounded-xl px-3 text-sm font-medium",
                date === d ? "bg-primary text-bg" : "bg-surface-2 text-muted",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">Último día</span>
          <input
            type="date"
            min={today}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="focus-ring min-h-10 rounded-xl border border-line bg-surface-2 px-3"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">Hora en que termina todo</span>
          <input type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} className="focus-ring min-h-10 rounded-xl border border-line bg-surface-2 px-3" />
        </label>
        <Button onClick={go} disabled={!active || busy}>
          {busy ? "Reprogramando…" : "Terminar ese día"}
        </Button>
      </div>
      {error ? <ErrorBox error={error} /> : null}
      {result && (
        <div className="rounded-xl bg-surface-2 p-3 text-sm" role="status">
          <div className="font-semibold">Listo. Así queda:</div>
          <ul className="mt-1 space-y-0.5">
            {result.plan.days
              .filter((d) => result.dates.includes(d.date))
              .map((d) => (
                <li key={d.date} className="flex justify-between gap-3">
                  <span>{fmtShortDate(d.date)}</span>
                  <span className="tabular text-muted">
                    {d.matches.toLocaleString("es-MX")} partidos ·{" "}
                    {d.blocks.length} jornadas
                  </span>
                </li>
              ))}
          </ul>
        </div>
      )}
    </section>
  );
}
