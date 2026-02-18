import { describe, it, expect, vi, afterEach } from "vitest";
import { parseCron, cronMatchesNow, shouldRunAgain } from "./cron-matcher";

describe("parseCron", () => {
  it("parses simple exact values", () => {
    const fields = parseCron("0 10 * * *");
    expect(fields.minute).toEqual([0]);
    expect(fields.hour).toEqual([10]);
    expect(fields.dayOfMonth).toHaveLength(31); // * = all
    expect(fields.month).toHaveLength(12); // * = all
    expect(fields.dayOfWeek).toHaveLength(7); // * = all
  });

  it("parses list values (comma-separated)", () => {
    const fields = parseCron("0 10 * * 1,4");
    expect(fields.dayOfWeek).toEqual([1, 4]);
  });

  it("parses step values (*/N)", () => {
    const fields = parseCron("0 */6 * * *");
    expect(fields.hour).toEqual([0, 6, 12, 18]);
  });

  it("parses range values (N-M)", () => {
    const fields = parseCron("0 9-17 * * *");
    expect(fields.hour).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
  });

  it("parses range with step (N-M/S)", () => {
    const fields = parseCron("0 0-23/8 * * *");
    expect(fields.hour).toEqual([0, 8, 16]);
  });

  it("parses every minute", () => {
    const fields = parseCron("* * * * *");
    expect(fields.minute).toHaveLength(60);
    expect(fields.hour).toHaveLength(24);
  });

  it("throws on invalid expression (too few fields)", () => {
    expect(() => parseCron("0 10 * *")).toThrow("expected 5 fields");
  });

  it("throws on invalid value", () => {
    expect(() => parseCron("abc 10 * * *")).toThrow("Invalid cron value");
  });
});

describe("cronMatchesNow", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("matches every-minute cron at any time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-11T14:35:00Z"));
    expect(cronMatchesNow("* * * * *")).toBe(true);
  });

  it("matches daily at 10:00 UTC when time is 10:00 UTC", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-11T10:00:00Z"));
    expect(cronMatchesNow("0 10 * * *")).toBe(true);
  });

  it("does NOT match daily at 10:00 UTC when time is 10:01 UTC", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-11T10:01:00Z"));
    expect(cronMatchesNow("0 10 * * *")).toBe(false);
  });

  it("does NOT match daily at 10:00 UTC when time is 09:00 UTC", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-11T09:00:00Z"));
    expect(cronMatchesNow("0 10 * * *")).toBe(false);
  });

  it("matches every 6 hours at minute 0", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-11T06:00:00Z"));
    expect(cronMatchesNow("0 */6 * * *")).toBe(true);
  });

  it("matches every 6 hours at 18:00", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-11T18:00:00Z"));
    expect(cronMatchesNow("0 */6 * * *")).toBe(true);
  });

  it("does NOT match every 6 hours at 07:00", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-11T07:00:00Z"));
    expect(cronMatchesNow("0 */6 * * *")).toBe(false);
  });

  it("matches Monday at 10:00 (day-of-week = 1)", () => {
    vi.useFakeTimers();
    // 2026-02-09 is a Monday
    vi.setSystemTime(new Date("2026-02-09T10:00:00Z"));
    expect(cronMatchesNow("0 10 * * 1")).toBe(true);
  });

  it("does NOT match Monday cron on Tuesday", () => {
    vi.useFakeTimers();
    // 2026-02-10 is a Tuesday
    vi.setSystemTime(new Date("2026-02-10T10:00:00Z"));
    expect(cronMatchesNow("0 10 * * 1")).toBe(false);
  });

  it("matches Mon & Thu cron on Monday", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-09T10:00:00Z")); // Monday
    expect(cronMatchesNow("0 10 * * 1,4")).toBe(true);
  });

  it("matches Mon & Thu cron on Thursday", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-12T10:00:00Z")); // Thursday
    expect(cronMatchesNow("0 10 * * 1,4")).toBe(true);
  });

  it("does NOT match Mon & Thu cron on Wednesday", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-11T10:00:00Z")); // Wednesday
    expect(cronMatchesNow("0 10 * * 1,4")).toBe(false);
  });

  it("respects timezone when provided", () => {
    vi.useFakeTimers();
    // 07:00 UTC = 10:00 Moscow (UTC+3)
    vi.setSystemTime(new Date("2026-02-11T07:00:00Z"));
    expect(cronMatchesNow("0 10 * * *", "Europe/Moscow")).toBe(true);
    // Without timezone → checks UTC → 07:00 ≠ 10:00
    expect(cronMatchesNow("0 10 * * *")).toBe(false);
  });
});

describe("shouldRunAgain", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns true when lastRunAt is undefined", () => {
    expect(shouldRunAgain(undefined)).toBe(true);
  });

  it("returns true when lastRunAt was > 55s ago", () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);
    const lastRun = new Date(now - 60_000).toISOString(); // 60s ago
    expect(shouldRunAgain(lastRun)).toBe(true);
  });

  it("returns false when lastRunAt was < 55s ago", () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);
    const lastRun = new Date(now - 30_000).toISOString(); // 30s ago
    expect(shouldRunAgain(lastRun)).toBe(false);
  });

  it("returns false when lastRunAt is right now", () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);
    const lastRun = new Date(now).toISOString();
    expect(shouldRunAgain(lastRun)).toBe(false);
  });
});
