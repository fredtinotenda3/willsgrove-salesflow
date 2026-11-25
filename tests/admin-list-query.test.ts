import { describe, expect, it } from "vitest";
import { buildQuery, orderByFor, parseDateRange, parseSort, pickParams, previousWindow, resolvePreset, totalPagesFor } from "@/lib/admin/list-query";

const SORTS = { name: (d: "asc" | "desc") => ({ name: d }), total: (d: "asc" | "desc") => ({ total: d }) };

describe("sorting is allow-listed", () => {
  it("accepts a known key and direction", () => expect(parseSort({ sort: "total", dir: "desc" }, ["name", "total"], { key: "name", dir: "asc" })).toEqual({ key: "total", dir: "desc" }));
  it("ignores an unknown key (never reaches a query) and falls back", () => expect(parseSort({ sort: "password; drop", dir: "desc" }, ["name"], { key: "name", dir: "asc" })).toEqual({ key: "name", dir: "desc" }));
  it("ignores an invalid direction", () => expect(parseSort({ sort: "name", dir: "sideways" }, ["name"], { key: "name", dir: "desc" })).toEqual({ key: "name", dir: "asc" }));
  it("uses the first value when a param is repeated", () => expect(parseSort({ sort: ["name", "total"] }, ["name", "total"], { key: "total", dir: "asc" }).key).toBe("name"));
  it("always appends an id tiebreaker so paging is stable", () => {
    expect(orderByFor({ key: "total", dir: "desc" }, SORTS, "name")).toEqual([{ total: "desc" }, { id: "desc" }]);
    expect(orderByFor({ key: "nope", dir: "asc" }, SORTS, "name")).toEqual([{ name: "asc" }, { id: "asc" }]);
  });
});

describe("params and paging", () => {
  it("keeps only named keys and drops empties", () => expect(pickParams({ q: "abc", status: "", evil: "x", sort: ["a", "b"] }, ["q", "status", "sort"])).toEqual({ q: "abc", sort: "a" }));
  it("builds a query string without empty values and lets overrides win", () => {
    expect(buildQuery({ q: "a b", status: undefined }, { page: "2" })).toBe("?q=a+b&page=2");
    expect(buildQuery({}, {})).toBe("");
    expect(buildQuery({ page: "3" }, { page: undefined })).toBe("");
  });
  it("computes at least one page", () => { expect(totalPagesFor(0, 25)).toBe(1); expect(totalPagesFor(26, 25)).toBe(2); expect(totalPagesFor(50, 25)).toBe(2); });
});

describe("date windows", () => {
  it("treats `to` as an inclusive day (exclusive upper bound is the next midnight)", () => {
    const r = parseDateRange("2026-03-01", "2026-03-31");
    expect(r.gte?.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(r.lt?.toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });
  it("supports one-sided ranges", () => { expect(parseDateRange("2026-03-01", undefined).lt).toBeUndefined(); expect(parseDateRange(undefined, "2026-03-01").gte).toBeUndefined(); });
  it("rejects malformed and inverted dates instead of throwing", () => {
    expect(parseDateRange("03/01/2026", "x")).toEqual({});
    expect(parseDateRange("2026-03-10", "2026-03-01")).toEqual({});
    expect(parseDateRange("2026-02-31", undefined).gte?.toISOString()).toBeDefined();
  });
  it("the previous window is equally long and ends where the current one starts", () => {
    const cur = { gte: new Date("2026-03-01T00:00:00Z"), lt: new Date("2026-03-11T00:00:00Z") };
    const prev = previousWindow(cur);
    expect(prev.lt.getTime()).toBe(cur.gte.getTime());
    expect(prev.lt.getTime() - prev.gte.getTime()).toBe(cur.lt.getTime() - cur.gte.getTime());
  });
  it("resolves presets against 'now' and defaults to 30 days", () => {
    const now = new Date("2026-05-15T10:30:00Z");
    const d30 = resolvePreset(undefined, now);
    expect(d30.key).toBe("30d");
    expect(d30.lt.toISOString()).toBe("2026-05-16T00:00:00.000Z");
    expect(d30.lt.getTime() - d30.gte.getTime()).toBe(30 * 86_400_000);
    expect(resolvePreset("mtd", now).gte.toISOString()).toBe("2026-05-01T00:00:00.000Z");
    expect(resolvePreset("ytd", now).gte.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(resolvePreset("bogus", now).key).toBe("30d");
  });
  it("a command-centre drill-down link selects the same window it counted", () => {
    const w = resolvePreset("7d", new Date("2026-05-15T10:30:00Z"));
    const to = new Date(w.lt.getTime() - 86_400_000).toISOString().slice(0, 10);
    const parsed = parseDateRange(w.gte.toISOString().slice(0, 10), to);
    expect(parsed.gte?.getTime()).toBe(w.gte.getTime());
    expect(parsed.lt?.getTime()).toBe(w.lt.getTime());
  });
});
