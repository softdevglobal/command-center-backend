import type {
  AgentAttendanceAgentMetrics,
  AgentAttendanceEventRow,
  AgentAttendancePeriodMetrics,
  AgentAttendanceReportGroupBy,
  AgentAttendanceReportResult,
} from "../../types/agent-attendance.types.js";

type AgentProfile = {
  agent_id: string | null;
  agent_display_name: string | null;
};

type DayWork = {
  workMs: number;
  displayName: string | null;
};

function roundHours(ms: number): number {
  return Math.round((ms / 3_600_000) * 100) / 100;
}

function metricsFromWorkDays(
  workByDay: Map<string, DayWork>
): Pick<
  AgentAttendanceAgentMetrics,
  "total_days" | "total_working_hours" | "avg_hours_per_day"
> {
  let totalMs = 0;
  let days = 0;
  for (const day of workByDay.values()) {
    if (day.workMs <= 0) continue;
    days += 1;
    totalMs += day.workMs;
  }
  const totalHours = roundHours(totalMs);
  return {
    total_days: days,
    total_working_hours: totalHours,
    avg_hours_per_day: days > 0 ? Math.round((totalHours / days) * 100) / 100 : 0,
  };
}

export function utcDateKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function endOfUtcDayMs(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999);
}

function isoWeekKey(ms: number): string {
  const d = new Date(ms);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function monthKey(ms: number): string {
  const d = new Date(ms);
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${d.getUTCFullYear()}-${m}`;
}

export function periodKeyFor(
  groupBy: AgentAttendanceReportGroupBy,
  dayKey: string
): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const ms = Date.UTC(y!, m! - 1, d!);
  if (groupBy === "day") return dayKey;
  if (groupBy === "week") return isoWeekKey(ms);
  return monthKey(ms);
}

function addWorkSegment(
  workByDay: Map<string, DayWork>,
  startMs: number,
  endMs: number,
  displayName: string | null
): void {
  if (endMs <= startMs) return;
  let cursor = startMs;
  while (cursor < endMs) {
    const dayKey = utcDateKey(cursor);
    const dayEnd = endOfUtcDayMs(cursor);
    const segmentEnd = Math.min(endMs, dayEnd + 1);
    const existing = workByDay.get(dayKey) ?? { workMs: 0, displayName };
    existing.workMs += segmentEnd - cursor;
    if (displayName && !existing.displayName) {
      existing.displayName = displayName;
    }
    workByDay.set(dayKey, existing);
    cursor = segmentEnd;
  }
}

/** Computes worked milliseconds per UTC calendar day from chronological events. */
export function computeWorkMsByDayForUser(
  events: AgentAttendanceEventRow[],
  rangeEndMs: number
): Map<string, DayWork> {
  const sorted = [...events].sort(
    (a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at)
  );

  const workByDay = new Map<string, DayWork>();
  let state: "off" | "working" | "break" = "off";
  let segmentStart: number | null = null;
  let displayName: string | null = null;

  for (const ev of sorted) {
    const t = Date.parse(ev.occurred_at);
    if (!Number.isFinite(t)) continue;
    if (ev.agent_display_name) displayName = ev.agent_display_name;

    switch (ev.event_type) {
      case "clock_in":
        if (state === "off") {
          state = "working";
          segmentStart = t;
        }
        break;
      case "break_start":
        if (state === "working" && segmentStart !== null) {
          addWorkSegment(workByDay, segmentStart, t, displayName);
          state = "break";
          segmentStart = null;
        }
        break;
      case "break_end":
        if (state === "break") {
          state = "working";
          segmentStart = t;
        }
        break;
      case "clock_out":
        if (state === "working" && segmentStart !== null) {
          addWorkSegment(workByDay, segmentStart, t, displayName);
        }
        state = "off";
        segmentStart = null;
        break;
      default:
        break;
    }
  }

  if (state === "working" && segmentStart !== null) {
    addWorkSegment(workByDay, segmentStart, rangeEndMs, displayName);
  }

  return workByDay;
}

function mergeAgentMetrics(
  profiles: Map<string, AgentProfile>,
  userId: string,
  workByDay: Map<string, DayWork>
): AgentAttendanceAgentMetrics {
  const profile = profiles.get(userId);
  const latestName =
    [...workByDay.values()]
      .map((d) => d.displayName)
      .filter(Boolean)
      .pop() ?? profile?.agent_display_name ?? null;

  const base = metricsFromWorkDays(workByDay);
  return {
    user_id: userId,
    agent_id: profile?.agent_id ?? null,
    agent_display_name: latestName,
    ...base,
  };
}

function aggregateSummary(
  agents: AgentAttendanceAgentMetrics[],
  includeAgentCount = false
): AgentAttendanceReportResult["summary"] {
  const totalDays = agents.reduce((sum, a) => sum + a.total_days, 0);
  const totalMs = agents.reduce(
    (sum, a) => sum + a.total_working_hours * 3_600_000,
    0
  );
  const totalHours = roundHours(totalMs);
  const avg =
    totalDays > 0 ? Math.round((totalHours / totalDays) * 100) / 100 : 0;

  return {
    total_days: totalDays,
    total_working_hours: totalHours,
    avg_hours_per_day: avg,
    ...(includeAgentCount ? { agent_count: agents.length } : {}),
  };
}

export function buildAttendanceReport(input: {
  groupBy: AgentAttendanceReportGroupBy;
  from: string;
  to: string;
  events: AgentAttendanceEventRow[];
  profiles: Map<string, AgentProfile>;
  rangeEndMs: number;
  singleUserId?: string;
}): AgentAttendanceReportResult {
  const byUser = new Map<string, AgentAttendanceEventRow[]>();
  for (const ev of input.events) {
    const list = byUser.get(ev.user_id) ?? [];
    list.push(ev);
    byUser.set(ev.user_id, list);
  }

  const userIds =
    input.singleUserId != null
      ? [input.singleUserId]
      : [...byUser.keys()].sort();

  const periodMap = new Map<
    string,
    { agents: AgentAttendanceAgentMetrics[]; dayKeys: Set<string> }
  >();

  const allAgentTotals: AgentAttendanceAgentMetrics[] = [];

  for (const userId of userIds) {
    const userEvents = byUser.get(userId) ?? [];
    const workByDay = computeWorkMsByDayForUser(userEvents, input.rangeEndMs);
    const agentTotal = mergeAgentMetrics(input.profiles, userId, workByDay);
    allAgentTotals.push(agentTotal);

    for (const [dayKey, dayWork] of workByDay) {
      if (dayWork.workMs <= 0) continue;
      const pKey = periodKeyFor(input.groupBy, dayKey);
      let bucket = periodMap.get(pKey);
      if (!bucket) {
        bucket = { agents: [], dayKeys: new Set<string>() };
        periodMap.set(pKey, bucket);
      }
      bucket.dayKeys.add(dayKey);

      let agentInPeriod = bucket.agents.find((a) => a.user_id === userId);
      if (!agentInPeriod) {
        agentInPeriod = {
          user_id: userId,
          agent_id: agentTotal.agent_id,
          agent_display_name: agentTotal.agent_display_name,
          total_days: 0,
          total_working_hours: 0,
          avg_hours_per_day: 0,
        };
        bucket.agents.push(agentInPeriod);
      }

      const hours = roundHours(dayWork.workMs);
      agentInPeriod.total_days += 1;
      agentInPeriod.total_working_hours = roundHours(
        agentInPeriod.total_working_hours * 3_600_000 + dayWork.workMs
      );
      agentInPeriod.avg_hours_per_day =
        agentInPeriod.total_days > 0
          ? Math.round(
              (agentInPeriod.total_working_hours / agentInPeriod.total_days) * 100
            ) / 100
          : 0;
    }
  }

  const periods: AgentAttendancePeriodMetrics[] = [...periodMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period_key, bucket]) => {
      const periodSummary = aggregateSummary(bucket.agents, true);
      const [y, m, d] = period_key.includes("W")
        ? [0, 0, 0]
        : period_key.split("-").map(Number);
      let period_start = input.from;
      let period_end = input.to;
      if (input.groupBy === "day" && y && m && d) {
        period_start = `${period_key}T00:00:00.000Z`;
        period_end = `${period_key}T23:59:59.999Z`;
      }

      return {
        period_key,
        period_start,
        period_end,
        total_days: periodSummary.total_days,
        total_working_hours: periodSummary.total_working_hours,
        avg_hours_per_day: periodSummary.avg_hours_per_day,
        agents: bucket.agents.sort((a, b) =>
          (a.agent_display_name ?? "").localeCompare(b.agent_display_name ?? "")
        ),
      };
    });

  const overallFromAgents =
    input.singleUserId != null && allAgentTotals.length === 1
      ? allAgentTotals[0]!
      : null;

  const summary = overallFromAgents
    ? {
        total_days: overallFromAgents.total_days,
        total_working_hours: overallFromAgents.total_working_hours,
        avg_hours_per_day: overallFromAgents.avg_hours_per_day,
      }
    : aggregateSummary(allAgentTotals, true);

  const result: AgentAttendanceReportResult = {
    group_by: input.groupBy,
    from: input.from,
    to: input.to,
    summary,
    periods,
  };

  if (input.singleUserId != null && overallFromAgents) {
    result.agent = overallFromAgents;
  }

  return result;
}

export function parseReportDateRange(input: {
  from: string;
  to: string;
}): { fromIso: string; toIso: string; rangeEndMs: number } | { error: string } {
  const fromRaw = input.from.trim();
  const toRaw = input.to.trim();

  const dayRe = /^(\d{4})-(\d{2})-(\d{2})$/;
  const fromMatch = dayRe.exec(fromRaw);
  const toMatch = dayRe.exec(toRaw);
  if (!fromMatch || !toMatch) {
    return {
      error: "from and to must be calendar dates in YYYY-MM-DD format.",
    };
  }

  const fromStart = Date.UTC(
    Number(fromMatch[1]),
    Number(fromMatch[2]) - 1,
    Number(fromMatch[3]),
    0,
    0,
    0,
    0
  );
  const toEnd = Date.UTC(
    Number(toMatch[1]),
    Number(toMatch[2]) - 1,
    Number(toMatch[3]),
    23,
    59,
    59,
    999
  );

  if (!Number.isFinite(fromStart) || !Number.isFinite(toEnd) || fromStart > toEnd) {
    return { error: "Invalid date range: from must be on or before to." };
  }

  const maxSpanMs = 366 * 24 * 60 * 60 * 1000;
  if (toEnd - fromStart > maxSpanMs) {
    return { error: "Date range cannot exceed 366 days." };
  }

  return {
    fromIso: new Date(fromStart).toISOString(),
    toIso: new Date(toEnd).toISOString(),
    rangeEndMs: Math.min(toEnd, Date.now()),
  };
}
