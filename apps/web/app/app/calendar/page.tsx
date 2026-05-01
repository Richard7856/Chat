"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Grid3X3,
  Loader2,
  Rows3,
  X,
} from "lucide-react";
import type { Activity, Task } from "@euromex/shared";
import { api, loadSession } from "../../lib/api";
import { Button } from "../../components/ui/button";
import { ActivityCard } from "../../components/activity-card";
import { TaskCard } from "../../components/task-card";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function startOfMonth(y: number, m: number): Date {
  return new Date(y, m, 1);
}
function endOfMonth(y: number, m: number): Date {
  return new Date(y, m + 1, 0, 23, 59, 59, 999);
}
/** Returns Monday of the week that contains `date` (ISO week start) */
function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sun
  const diff = day === 0 ? -6 : 1 - day; // shift to Monday
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}
function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}
function isoDate(d: Date): string {
  return d.toISOString().split("T")[0]!;
}

type Filter = "all" | "activities" | "tasks" | "mine";
type ViewMode = "month" | "week";

// ─── Calendar cell item ───────────────────────────────────────────────────────

interface DayItem {
  kind: "activity" | "task";
  id: string;
  title: string;
  activity?: Activity;
  task?: Task;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function CalendarPage() {
  const router = useRouter();
  const [me, setMe] = useState<{ id: string } | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<DayItem | null>(null);

  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-indexed
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  // Semana actual (lunes): cuando el modo semanal está activo
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(today));

  // ── Auth bootstrap ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!loadSession()) {
      router.replace("/login");
      return;
    }
    api<{ user: { id: string } }>("/auth/me", { method: "GET", auth: true })
      .then((r) => setMe({ id: r.user.id }))
      .catch(() => router.replace("/login"));
  }, [router]);

  // ── Fetch data — used by both month and week view ──────────────────────────
  const fetchRange = useCallback(async (from: string, to: string) => {
    setLoading(true);
    try {
      const [actRes, taskRes] = await Promise.all([
        api<{ activities: Activity[] }>(`/activities?from=${from}T00:00:00Z&to=${to}T23:59:59Z`, {
          method: "GET",
          auth: true,
        }),
        api<{ tasks: Task[] }>(`/tasks?from=${from}&to=${to}`, {
          method: "GET",
          auth: true,
        }),
      ]);
      setActivities(actRes.activities);
      setTasks(taskRes.tasks);
    } catch {
      // keep stale data on error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!me) return;
    if (viewMode === "month") {
      fetchRange(isoDate(startOfMonth(year, month)), isoDate(endOfMonth(year, month)));
    } else {
      fetchRange(isoDate(weekStart), isoDate(addDays(weekStart, 6)));
    }
  }, [me, year, month, viewMode, weekStart, fetchRange]);

  function prevPeriod() {
    if (viewMode === "week") {
      setWeekStart((w) => addDays(w, -7));
    } else {
      if (month === 0) { setMonth(11); setYear((y) => y - 1); }
      else setMonth((m) => m - 1);
    }
  }
  function nextPeriod() {
    if (viewMode === "week") {
      setWeekStart((w) => addDays(w, 7));
    } else {
      if (month === 11) { setMonth(0); setYear((y) => y + 1); }
      else setMonth((m) => m + 1);
    }
  }

  // ── Build day map ───────────────────────────────────────────────────────────
  const dayMap = useMemo(() => {
    const map = new Map<string, DayItem[]>();
    const addItem = (date: string, item: DayItem) => {
      const key = date.slice(0, 10); // YYYY-MM-DD
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    };

    for (const act of activities) {
      if (filter === "tasks") continue;
      if (filter === "mine" && me && !act.participants.some((p) => p.userId === me.id) && act.creatorUserId !== me.id) continue;
      addItem(act.scheduledAt, { kind: "activity", id: act.id, title: act.title, activity: act });
    }
    for (const task of tasks) {
      if (filter === "activities") continue;
      if (!task.dueDate) continue;
      if (filter === "mine" && me && !task.assignees.some((a) => a.userId === me.id) && task.creatorUserId !== me.id) continue;
      addItem(task.dueDate, { kind: "task", id: task.id, title: task.title, task });
    }
    return map;
  }, [activities, tasks, filter, me]);

  // ── Calendar grid ───────────────────────────────────────────────────────────
  const firstDayOfMonth = new Date(year, month, 1).getDay(); // 0 = Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthName = new Date(year, month, 1).toLocaleDateString("es-MX", { month: "long", year: "numeric" });

  // Weekly view: 7 days Mon–Sun starting from weekStart
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekLabel = (() => {
    const s = weekStart.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
    const e = addDays(weekStart, 6).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
    return `${s} – ${e}`;
  })();

  const cells: Array<number | null> = [
    ...Array<null>(firstDayOfMonth).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  // Pad to 6 rows × 7 cols = 42 cells
  while (cells.length < 42) cells.push(null);

  const todayStr = isoDate(today);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-border bg-card px-4 py-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()} aria-label="Volver">
          <ArrowLeft className="size-4" />
        </Button>
        <CalendarDays className="size-5 text-primary" />
        <h1 className="text-base font-semibold">Calendario</h1>
        <div className="flex-1" />
        {loading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      </header>

      <div className="mx-auto max-w-5xl px-4 py-6">
        {/* Month navigation + filters */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="size-8" onClick={prevPeriod}>
              <ChevronLeft className="size-4" />
            </Button>
            <span className="min-w-[180px] text-center text-sm font-semibold capitalize">
              {viewMode === "month" ? monthName : weekLabel}
            </span>
            <Button variant="ghost" size="icon" className="size-8" onClick={nextPeriod}>
              <ChevronRight className="size-4" />
            </Button>
          </div>

          {/* Fase 20: toggle vista mensual / semanal */}
          <div className="flex rounded-lg border border-border overflow-hidden text-xs">
            <button
              type="button"
              onClick={() => setViewMode("month")}
              title="Vista mensual"
              className={[
                "flex items-center gap-1 px-3 py-1.5 transition-colors",
                viewMode === "month" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-secondary",
              ].join(" ")}
            >
              <Grid3X3 size={13} /> Mes
            </button>
            <button
              type="button"
              onClick={() => {
                setViewMode("week");
                setWeekStart(startOfWeek(today));
              }}
              title="Vista semanal"
              className={[
                "flex items-center gap-1 px-3 py-1.5 transition-colors",
                viewMode === "week" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-secondary",
              ].join(" ")}
            >
              <Rows3 size={13} /> Semana
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5 text-xs">
            {(["all", "activities", "tasks", "mine"] as Filter[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={[
                  "rounded-full px-3 py-1 transition-colors",
                  filter === f
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-muted-foreground hover:bg-secondary/80",
                ].join(" ")}
              >
                {f === "all" ? "Todos" : f === "activities" ? "Actividades" : f === "tasks" ? "Tareas" : "Mis asignaciones"}
              </button>
            ))}
          </div>
        </div>

        {/* ── Vista semanal ── */}
        {viewMode === "week" && (
          <>
            <div className="grid grid-cols-7 gap-px rounded-xl border border-border bg-border overflow-hidden">
              {weekDays.map((day) => {
                const dateStr = isoDate(day);
                const items = dayMap.get(dateStr) ?? [];
                const isToday = dateStr === todayStr;
                const dayLabel = day.toLocaleDateString("es-MX", { weekday: "short", day: "numeric" });
                return (
                  <div
                    key={dateStr}
                    className={["min-h-[160px] bg-background p-2", isToday ? "bg-primary/5 ring-inset ring-1 ring-primary/30" : ""].join(" ")}
                  >
                    <div className={["mb-2 text-xs font-semibold text-center capitalize", isToday ? "text-primary" : "text-muted-foreground"].join(" ")}>
                      {dayLabel}
                    </div>
                    <div className="space-y-1">
                      {items.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setSelected(item)}
                          className={[
                            "flex w-full items-start gap-1 rounded px-1.5 py-1 text-[11px] text-left transition-colors hover:opacity-80",
                            item.kind === "activity"
                              ? "bg-primary/15 text-primary"
                              : "bg-green-500/15 text-green-700",
                          ].join(" ")}
                        >
                          {item.kind === "activity" ? (
                            <CalendarDays className="size-3 shrink-0 mt-0.5" />
                          ) : (
                            <CheckSquare className="size-3 shrink-0 mt-0.5" />
                          )}
                          <span className="break-words leading-tight">{item.title}</span>
                        </button>
                      ))}
                      {items.length === 0 && (
                        <p className="text-center text-[10px] text-muted-foreground/40 py-2">–</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ── Vista mensual ── */}
        {viewMode === "month" && <>
        {/* Day-of-week headers */}
        <div className="mb-1 grid grid-cols-7 text-center text-[11px] font-medium text-muted-foreground">
          {["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"].map((d) => (
            <div key={d} className="py-1">{d}</div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 gap-px rounded-xl border border-border bg-border">
          {cells.map((day, idx) => {
            if (!day) {
              return <div key={`empty-${idx}`} className="min-h-[88px] bg-background/50" />;
            }
            const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const items = dayMap.get(dateStr) ?? [];
            const isToday = dateStr === todayStr;

            return (
              <div
                key={dateStr}
                className={[
                  "min-h-[88px] bg-background p-1.5",
                  isToday ? "bg-primary/5 ring-inset ring-1 ring-primary/30" : "",
                ].join(" ")}
              >
                <div
                  className={[
                    "mb-1 flex size-6 items-center justify-center rounded-full text-xs font-medium",
                    isToday ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                  ].join(" ")}
                >
                  {day}
                </div>
                <div className="space-y-0.5">
                  {items.slice(0, 3).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelected(item)}
                      className={[
                        "flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-[10px] text-left transition-colors hover:opacity-80",
                        item.kind === "activity"
                          ? "bg-primary/15 text-primary"
                          : "bg-green-500/15 text-green-700",
                      ].join(" ")}
                    >
                      {item.kind === "activity" ? (
                        <CalendarDays className="size-2.5 shrink-0" />
                      ) : (
                        <CheckSquare className="size-2.5 shrink-0" />
                      )}
                      <span className="truncate">{item.title}</span>
                    </button>
                  ))}
                  {items.length > 3 && (
                    <p className="px-1 text-[10px] text-muted-foreground">+{items.length - 3} más</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="mt-3 flex items-center gap-4 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <CalendarDays className="size-3 text-primary" /> Actividad
          </span>
          <span className="flex items-center gap-1">
            <CheckSquare className="size-3 text-green-700" /> Tarea
          </span>
        </div>
        </>}
      </div>

      {/* Detail drawer */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-4 pb-4 backdrop-blur-sm sm:items-center">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="text-sm font-semibold">
                {selected.kind === "activity" ? "Actividad" : "Tarea"}
              </span>
              <Button variant="ghost" size="icon" onClick={() => setSelected(null)}>
                <X className="size-4" />
              </Button>
            </div>
            <div className="p-4">
              {selected.kind === "activity" && selected.activity && me && (
                <ActivityCard
                  payload={{
                    activityId: selected.activity.id,
                    title: selected.activity.title,
                    scheduledAt: selected.activity.scheduledAt,
                    location: selected.activity.location ?? undefined,
                    creatorId: selected.activity.creatorUserId,
                    participantIds: selected.activity.participants.map((p) => p.userId),
                  }}
                  currentUserId={me.id}
                />
              )}
              {selected.kind === "task" && selected.task && me && (
                <TaskCard
                  payload={{
                    taskId: selected.task.id,
                    title: selected.task.title,
                    dueDate: selected.task.dueDate ?? undefined,
                    creatorId: selected.task.creatorUserId,
                    assigneeIds: selected.task.assignees.map((a) => a.userId),
                  }}
                  currentUserId={me.id}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
