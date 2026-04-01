import type { CronJob } from "./types.js";

// ---------------------------------------------------------------------------
// Initiative governance — priority, quiet hours, user activity
// ---------------------------------------------------------------------------

/**
 * Job priority levels, from highest to lowest.
 *
 *   critical  — security alerts, system health (always fires)
 *   high      — time-sensitive reminders, scheduled messages
 *   normal    — standard cron jobs (default)
 *   low       — cleanup, maintenance, background tasks
 */
export type CronPriority = "critical" | "high" | "normal" | "low";

/**
 * Governance decision for a single job.
 */
export type GovernanceDecision = {
  /** Whether the job is allowed to run */
  allowed: boolean;
  /** Why the job was suppressed (undefined when allowed) */
  reason?: "quiet_hours" | "user_idle" | "priority_deferred";
};

/**
 * Quiet hours window — a daily time range when low-priority jobs are suppressed.
 * Times are in 24-hour format (e.g., "23:00" to "06:00").
 */
export type QuietHoursConfig = {
  enabled: boolean;
  /** Start of quiet window, 24h format "HH:MM" */
  start: string;
  /** End of quiet window, 24h format "HH:MM" */
  end: string;
  /** Timezone for the quiet window (IANA, e.g., "America/New_York"). Defaults to system tz. */
  tz?: string;
};

/**
 * User activity tracking configuration.
 */
export type ActivityConfig = {
  enabled: boolean;
  /** Duration in ms after which user is considered idle (default: 30 min) */
  idleThresholdMs: number;
};

/**
 * Full governor configuration.
 */
export type GovernorConfig = {
  enabled: boolean;
  quietHours?: QuietHoursConfig;
  activity?: ActivityConfig;
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_IDLE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

export const DEFAULT_GOVERNOR_CONFIG: GovernorConfig = {
  enabled: false,
};

// ---------------------------------------------------------------------------
// Priority resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the priority for a cron job.
 *
 * Checks the job name and description for priority hints. Jobs can declare
 * priority via a `[priority:critical]` tag in their name or description.
 * Defaults to "normal" when no hint is found.
 */
export function resolveJobPriority(job: CronJob): CronPriority {
  const text = `${job.name} ${job.description ?? ""}`.toLowerCase();

  // Explicit tags: [priority:critical], [priority:high], etc.
  const tagMatch = text.match(/\[priority:(critical|high|normal|low)\]/);
  if (tagMatch) return tagMatch[1] as CronPriority;

  // Heuristic: security-related jobs are critical
  if (/\b(?:security|alert|emergency|incident|breach)\b/.test(text)) return "critical";

  // Heuristic: cleanup/maintenance jobs are low
  if (/\b(?:cleanup|clean[-\s]?up|prune|sweep|gc|garbage|maintenance|housekeeping)\b/.test(text)) return "low";

  return "normal";
}

/** Priority ordering for comparisons (lower number = higher priority) */
const PRIORITY_ORDER: Record<CronPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export function comparePriority(a: CronPriority, b: CronPriority): number {
  return PRIORITY_ORDER[a] - PRIORITY_ORDER[b];
}

// ---------------------------------------------------------------------------
// Quiet hours check
// ---------------------------------------------------------------------------

/**
 * Parse a "HH:MM" string into minutes since midnight.
 */
function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * Get current minutes since midnight in the specified timezone.
 */
function currentMinutesInTz(nowMs: number, tz?: string): number {
  const date = new Date(nowMs);
  const options: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    timeZone: tz,
  };
  try {
    const parts = new Intl.DateTimeFormat("en-US", options).formatToParts(date);
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    return hour * 60 + minute;
  } catch {
    // Invalid timezone — fall back to system local time
    return date.getHours() * 60 + date.getMinutes();
  }
}

/**
 * Check whether the current time falls within the quiet hours window.
 * Handles overnight ranges (e.g., 23:00–06:00).
 */
export function isInQuietHours(config: QuietHoursConfig, nowMs: number): boolean {
  if (!config.enabled) return false;

  const current = currentMinutesInTz(nowMs, config.tz);
  const start = parseTimeToMinutes(config.start);
  const end = parseTimeToMinutes(config.end);

  if (start <= end) {
    // Same-day window: e.g., 09:00–17:00
    return current >= start && current < end;
  }
  // Overnight window: e.g., 23:00–06:00
  return current >= start || current < end;
}

// ---------------------------------------------------------------------------
// User activity tracking
// ---------------------------------------------------------------------------

/**
 * Lightweight user activity tracker.
 *
 * Tracks the timestamp of the last user interaction. Other components
 * call `touch()` when user activity is detected (message sent, command
 * issued, etc.). The governor checks `isIdle()` to decide whether to
 * suppress non-urgent jobs.
 */
export class UserActivityTracker {
  private lastActivityMs: number;
  private idleThresholdMs: number;

  constructor(idleThresholdMs?: number) {
    this.idleThresholdMs = idleThresholdMs ?? DEFAULT_IDLE_THRESHOLD_MS;
    this.lastActivityMs = Date.now();
  }

  /** Record user activity (call on message send, command, etc.) */
  touch(nowMs?: number): void {
    this.lastActivityMs = nowMs ?? Date.now();
  }

  /** Check whether the user is considered idle */
  isIdle(nowMs?: number): boolean {
    const now = nowMs ?? Date.now();
    return now - this.lastActivityMs > this.idleThresholdMs;
  }

  /** Time in ms since last activity */
  idleDurationMs(nowMs?: number): number {
    const now = nowMs ?? Date.now();
    return Math.max(0, now - this.lastActivityMs);
  }

  /** Get the configured idle threshold */
  get threshold(): number {
    return this.idleThresholdMs;
  }
}

// ---------------------------------------------------------------------------
// Governor — the main decision engine
// ---------------------------------------------------------------------------

/**
 * CronGovernor applies governance policies to cron job execution.
 *
 * Given a list of runnable jobs, the governor filters and prioritizes them
 * based on:
 *
 * 1. **Quiet hours** — low and normal priority jobs are suppressed
 *    during the configured quiet window. High and critical always run.
 *
 * 2. **User activity** — when the user is idle, low-priority jobs are
 *    deferred to avoid unnecessary background work.
 *
 * 3. **Priority ordering** — jobs are sorted by priority so critical
 *    and high-priority jobs execute first when concurrency is limited.
 *
 * The governor is stateless and side-effect-free — it only filters and
 * sorts. The timer remains responsible for execution.
 */
export class CronGovernor {
  private config: GovernorConfig;
  private activityTracker: UserActivityTracker;

  constructor(config?: Partial<GovernorConfig>, activityTracker?: UserActivityTracker) {
    this.config = { ...DEFAULT_GOVERNOR_CONFIG, ...config };
    this.activityTracker = activityTracker ?? new UserActivityTracker(
      config?.activity?.idleThresholdMs,
    );
  }

  /** Access the activity tracker (for external touch() calls) */
  get activity(): UserActivityTracker {
    return this.activityTracker;
  }

  /** Whether the governor is enabled */
  get enabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Evaluate a single job against governance policies.
   */
  evaluate(job: CronJob, nowMs?: number): GovernanceDecision {
    if (!this.config.enabled) return { allowed: true };

    const now = nowMs ?? Date.now();
    const priority = resolveJobPriority(job);

    // Critical jobs always run
    if (priority === "critical") return { allowed: true };

    // Quiet hours: suppress normal and low priority
    if (this.config.quietHours && isInQuietHours(this.config.quietHours, now)) {
      if (priority === "low" || priority === "normal") {
        return { allowed: false, reason: "quiet_hours" };
      }
      // High priority jobs still run during quiet hours
    }

    // User idle: suppress low priority
    if (this.config.activity?.enabled && this.activityTracker.isIdle(now)) {
      if (priority === "low") {
        return { allowed: false, reason: "user_idle" };
      }
    }

    return { allowed: true };
  }

  /**
   * Filter and prioritize a list of runnable jobs.
   *
   * Returns only the jobs that pass governance checks, sorted by priority
   * (critical first, low last).
   */
  govern(jobs: CronJob[], nowMs?: number): { allowed: CronJob[]; suppressed: Array<{ job: CronJob; reason: string }> } {
    if (!this.config.enabled) {
      return { allowed: jobs, suppressed: [] };
    }

    const now = nowMs ?? Date.now();
    const allowed: CronJob[] = [];
    const suppressed: Array<{ job: CronJob; reason: string }> = [];

    for (const job of jobs) {
      const decision = this.evaluate(job, now);
      if (decision.allowed) {
        allowed.push(job);
      } else {
        suppressed.push({ job, reason: decision.reason ?? "unknown" });
      }
    }

    // Sort allowed jobs by priority (critical first)
    allowed.sort((a, b) => comparePriority(resolveJobPriority(a), resolveJobPriority(b)));

    return { allowed, suppressed };
  }

  /**
   * Update the governor configuration at runtime.
   */
  updateConfig(config: Partial<GovernorConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.activity?.idleThresholdMs !== undefined) {
      this.activityTracker = new UserActivityTracker(config.activity.idleThresholdMs);
    }
  }
}
