import { describe, expect, it } from "vitest";
import { formatDuration, parseDuration, parseSince, parseTs } from "../src/time.js";

const NOW = Date.parse("2026-09-21T00:00:00Z");

describe("parseDuration", () => {
  it("parses units", () => {
    expect(parseDuration("90s")).toBe(90_000);
    expect(parseDuration("10m")).toBe(600_000);
    expect(parseDuration("2h")).toBe(7_200_000);
    expect(parseDuration("2d")).toBe(172_800_000);
    expect(parseDuration("1w")).toBe(604_800_000);
    expect(parseDuration("1.5h")).toBe(5_400_000);
    expect(parseDuration(" 30M ")).toBe(1_800_000);
  });
  it("rejects garbage", () => {
    expect(() => parseDuration("10")).toThrow(/invalid duration/);
    expect(() => parseDuration("abc")).toThrow();
    expect(() => parseDuration("-5m")).toThrow();
    expect(() => parseDuration("")).toThrow();
  });
});

describe("parseSince", () => {
  it("handles relative durations", () => {
    expect(parseSince("2d", NOW)).toBe(NOW - 172_800_000);
    expect(parseSince("12h", NOW)).toBe(NOW - 43_200_000);
    expect(parseSince("90m", NOW)).toBe(NOW - 5_400_000);
  });
  it("handles dates as UTC midnight and ISO timestamps", () => {
    expect(parseSince("2026-09-01", NOW)).toBe(Date.parse("2026-09-01T00:00:00Z"));
    expect(parseSince("2026-09-01T10:30:00Z", NOW)).toBe(Date.parse("2026-09-01T10:30:00Z"));
  });
  it("handles all", () => {
    expect(parseSince("all", NOW)).toBeNull();
    expect(parseSince("ALL", NOW)).toBeNull();
  });
  it("rejects garbage", () => {
    expect(() => parseSince("yesterday", NOW)).toThrow(/invalid --since/);
    expect(() => parseSince("2026-13-45", NOW)).toThrow();
  });
});

describe("parseTs / formatDuration", () => {
  it("parses ISO or returns NaN", () => {
    expect(parseTs("2026-09-20T10:00:00.000Z")).toBe(Date.parse("2026-09-20T10:00:00Z"));
    expect(parseTs(undefined)).toBeNaN();
    expect(parseTs("nope")).toBeNaN();
  });
  it("formats", () => {
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(6 * 60_000)).toBe("6m");
    expect(formatDuration(125 * 60_000)).toBe("2h 5m");
    expect(formatDuration(120 * 60_000)).toBe("2h");
  });
});
