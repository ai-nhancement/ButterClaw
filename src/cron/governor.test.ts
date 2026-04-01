import { describe, it, expect } from "vitest";
import {
  CronGovernor,
  UserActivityTracker,
  resolveJobPriority,
  isInQuietHours,
  comparePriority,
} from "./governor.js";
import type { CronJob } from "./types.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeJob(overrides: Partial<CronJob> & { name: string }): CronJob {
  return {
    id: `job-${overrides.name}`,
    name: overrides.name,
    enabled: true,
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    schedule: { kind: "every", everyMs: 3600000 },
    sessionTarget: "isolated",
    wakeMode: "now",
    payload: { kind: "agentTurn", message: "test" },
    state: {},
    ...overrides,
  } as CronJob;
}

// ---------------------------------------------------------------------------
// resolveJobPriority
// ---------------------------------------------------------------------------

describe("resolveJobPriority", () => {
  it("returns normal by default", () => {
    expect(resolveJobPriority(makeJob({ name: "daily report" }))).toBe("normal");
  });

  it("detects explicit priority tag in name", () => {
    expect(resolveJobPriority(makeJob({ name: "check [priority:critical] servers" }))).toBe("critical");
    expect(resolveJobPriority(makeJob({ name: "[priority:high] send reminder" }))).toBe("high");
    expect(resolveJobPriority(makeJob({ name: "task [priority:low]" }))).toBe("low");
  });

  it("detects explicit priority tag in description", () => {
    expect(resolveJobPriority(makeJob({
      name: "monitor",
      description: "runs security checks [priority:critical]",
    }))).toBe("critical");
  });

  it("detects security keywords as critical", () => {
    expect(resolveJobPriority(makeJob({ name: "security scan" }))).toBe("critical");
    expect(resolveJobPriority(makeJob({ name: "breach alert monitor" }))).toBe("critical");
  });

  it("detects cleanup keywords as low", () => {
    expect(resolveJobPriority(makeJob({ name: "session cleanup" }))).toBe("low");
    expect(resolveJobPriority(makeJob({ name: "gc old files" }))).toBe("low");
    expect(resolveJobPriority(makeJob({ name: "prune stale data" }))).toBe("low");
    expect(resolveJobPriority(makeJob({ name: "maintenance sweep" }))).toBe("low");
  });

  it("explicit tag overrides heuristics", () => {
    // "cleanup" would be low, but explicit tag wins
    expect(resolveJobPriority(makeJob({ name: "cleanup [priority:high]" }))).toBe("high");
  });
});

// ---------------------------------------------------------------------------
// comparePriority
// ---------------------------------------------------------------------------

describe("comparePriority", () => {
  it("orders critical < high < normal < low", () => {
    expect(comparePriority("critical", "high")).toBeLessThan(0);
    expect(comparePriority("high", "normal")).toBeLessThan(0);
    expect(comparePriority("normal", "low")).toBeLessThan(0);
    expect(comparePriority("critical", "low")).toBeLessThan(0);
  });

  it("returns 0 for same priority", () => {
    expect(comparePriority("normal", "normal")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// isInQuietHours
// ---------------------------------------------------------------------------

describe("isInQuietHours", () => {
  // Use a fixed reference: 2026-04-01 02:30 UTC
  const at0230utc = new Date("2026-04-01T02:30:00Z").getTime();

  it("returns false when disabled", () => {
    expect(isInQuietHours({ enabled: false, start: "00:00", end: "06:00" }, at0230utc)).toBe(false);
  });

  it("detects overnight quiet window (23:00–06:00 UTC)", () => {
    const config = { enabled: true, start: "23:00", end: "06:00", tz: "UTC" };
    // 02:30 UTC is within 23:00–06:00
    expect(isInQuietHours(config, at0230utc)).toBe(true);
  });

  it("detects outside overnight quiet window", () => {
    const config = { enabled: true, start: "23:00", end: "06:00", tz: "UTC" };
    // 12:00 UTC is outside 23:00–06:00
    const atNoon = new Date("2026-04-01T12:00:00Z").getTime();
    expect(isInQuietHours(config, atNoon)).toBe(false);
  });

  it("falls back to local time on invalid timezone", () => {
    const config = { enabled: true, start: "00:00", end: "23:59", tz: "Invalid/Timezone" };
    // Should not throw, and should use local time fallback
    expect(() => isInQuietHours(config, Date.now())).not.toThrow();
  });

  it("detects same-day quiet window (09:00–17:00 UTC)", () => {
    const config = { enabled: true, start: "09:00", end: "17:00", tz: "UTC" };
    const at1030 = new Date("2026-04-01T10:30:00Z").getTime();
    expect(isInQuietHours(config, at1030)).toBe(true);

    const at2000 = new Date("2026-04-01T20:00:00Z").getTime();
    expect(isInQuietHours(config, at2000)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// UserActivityTracker
// ---------------------------------------------------------------------------

describe("UserActivityTracker", () => {
  it("starts as active (just created)", () => {
    const tracker = new UserActivityTracker(30000);
    expect(tracker.isIdle()).toBe(false);
  });

  it("becomes idle after threshold", () => {
    const tracker = new UserActivityTracker(1000); // 1 second
    const now = Date.now();
    tracker.touch(now - 2000); // Last activity 2 seconds ago
    expect(tracker.isIdle(now)).toBe(true);
  });

  it("resets on touch", () => {
    const tracker = new UserActivityTracker(1000);
    const now = Date.now();
    tracker.touch(now - 2000); // Was idle
    tracker.touch(now);        // User active again
    expect(tracker.isIdle(now)).toBe(false);
  });

  it("reports idle duration", () => {
    const tracker = new UserActivityTracker(1000);
    const now = Date.now();
    tracker.touch(now - 5000);
    expect(tracker.idleDurationMs(now)).toBe(5000);
  });

  it("exposes threshold", () => {
    const tracker = new UserActivityTracker(45000);
    expect(tracker.threshold).toBe(45000);
  });
});

// ---------------------------------------------------------------------------
// CronGovernor
// ---------------------------------------------------------------------------

describe("CronGovernor", () => {
  describe("when disabled", () => {
    it("allows all jobs", () => {
      const governor = new CronGovernor({ enabled: false });
      const jobs = [
        makeJob({ name: "cleanup old sessions" }),
        makeJob({ name: "daily report" }),
      ];
      const result = governor.govern(jobs);
      expect(result.allowed).toHaveLength(2);
      expect(result.suppressed).toHaveLength(0);
    });
  });

  describe("quiet hours suppression", () => {
    function governorInQuietHours() {
      return new CronGovernor({
        enabled: true,
        quietHours: { enabled: true, start: "23:00", end: "06:00", tz: "UTC" },
      });
    }

    // 02:30 UTC — inside quiet hours
    const quietTime = new Date("2026-04-01T02:30:00Z").getTime();

    it("suppresses low-priority jobs during quiet hours", () => {
      const governor = governorInQuietHours();
      const decision = governor.evaluate(makeJob({ name: "cleanup temp files" }), quietTime);
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe("quiet_hours");
    });

    it("suppresses normal-priority jobs during quiet hours", () => {
      const governor = governorInQuietHours();
      const decision = governor.evaluate(makeJob({ name: "daily summary" }), quietTime);
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe("quiet_hours");
    });

    it("allows high-priority jobs during quiet hours", () => {
      const governor = governorInQuietHours();
      const decision = governor.evaluate(makeJob({ name: "[priority:high] send reminder" }), quietTime);
      expect(decision.allowed).toBe(true);
    });

    it("always allows critical jobs during quiet hours", () => {
      const governor = governorInQuietHours();
      const decision = governor.evaluate(makeJob({ name: "security alert monitor" }), quietTime);
      expect(decision.allowed).toBe(true);
    });

    it("allows all jobs outside quiet hours", () => {
      const governor = governorInQuietHours();
      const dayTime = new Date("2026-04-01T12:00:00Z").getTime();
      const decision = governor.evaluate(makeJob({ name: "cleanup temp files" }), dayTime);
      expect(decision.allowed).toBe(true);
    });
  });

  describe("user idle suppression", () => {
    it("suppresses low-priority jobs when user is idle", () => {
      const tracker = new UserActivityTracker(1000);
      const now = Date.now();
      tracker.touch(now - 5000); // Idle for 5 seconds

      const governor = new CronGovernor(
        { enabled: true, activity: { enabled: true, idleThresholdMs: 1000 } },
        tracker,
      );

      const decision = governor.evaluate(makeJob({ name: "cleanup old files" }), now);
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe("user_idle");
    });

    it("allows normal-priority jobs when user is idle", () => {
      const tracker = new UserActivityTracker(1000);
      const now = Date.now();
      tracker.touch(now - 5000);

      const governor = new CronGovernor(
        { enabled: true, activity: { enabled: true, idleThresholdMs: 1000 } },
        tracker,
      );

      const decision = governor.evaluate(makeJob({ name: "daily report" }), now);
      expect(decision.allowed).toBe(true);
    });

    it("allows low-priority jobs when user is active", () => {
      const tracker = new UserActivityTracker(1000);
      tracker.touch(); // Active right now

      const governor = new CronGovernor(
        { enabled: true, activity: { enabled: true, idleThresholdMs: 1000 } },
        tracker,
      );

      const decision = governor.evaluate(makeJob({ name: "cleanup old files" }));
      expect(decision.allowed).toBe(true);
    });
  });

  describe("govern (batch filtering + sorting)", () => {
    it("filters and sorts jobs by priority", () => {
      const governor = new CronGovernor({
        enabled: true,
        quietHours: { enabled: true, start: "23:00", end: "06:00", tz: "UTC" },
      });
      const quietTime = new Date("2026-04-01T02:30:00Z").getTime();

      const jobs = [
        makeJob({ name: "daily report" }),          // normal → suppressed
        makeJob({ name: "security scan" }),          // critical → allowed
        makeJob({ name: "[priority:high] reminder" }), // high → allowed
        makeJob({ name: "cleanup temp" }),           // low → suppressed
      ];

      const result = governor.govern(jobs, quietTime);

      expect(result.allowed).toHaveLength(2);
      expect(result.suppressed).toHaveLength(2);

      // Critical should come before high
      expect(result.allowed[0].name).toBe("security scan");
      expect(result.allowed[1].name).toBe("[priority:high] reminder");

      // Suppressed reasons
      expect(result.suppressed.map((s) => s.reason)).toEqual(["quiet_hours", "quiet_hours"]);
    });

    it("returns all jobs when governor is disabled", () => {
      const governor = new CronGovernor({ enabled: false });
      const jobs = [makeJob({ name: "a" }), makeJob({ name: "b" })];
      const result = governor.govern(jobs);
      expect(result.allowed).toHaveLength(2);
      expect(result.suppressed).toHaveLength(0);
    });
  });

  describe("updateConfig", () => {
    it("can enable governance at runtime", () => {
      const governor = new CronGovernor({ enabled: false });
      expect(governor.enabled).toBe(false);

      governor.updateConfig({
        enabled: true,
        quietHours: { enabled: true, start: "22:00", end: "07:00", tz: "UTC" },
      });
      expect(governor.enabled).toBe(true);
    });
  });
});
