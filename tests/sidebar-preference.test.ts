import { describe, expect, it } from "vitest";
import { SIDEBAR_STORAGE_KEY, readSidebarCollapsed, writeSidebarCollapsed, type StorageLike } from "@/lib/ui/sidebar-preference";

function memory(): StorageLike & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => void (data[k] = v) };
}
const throwing: StorageLike = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };

describe("sidebar preference", () => {
  it("defaults to expanded", () => expect(readSidebarCollapsed(memory())).toBe(false));
  it("round-trips collapsed and expanded", () => {
    const s = memory();
    expect(writeSidebarCollapsed(s, true)).toBe(true);
    expect(s.data[SIDEBAR_STORAGE_KEY]).toBe("1");
    expect(readSidebarCollapsed(s)).toBe(true);
    writeSidebarCollapsed(s, false);
    expect(readSidebarCollapsed(s)).toBe(false);
  });
  it("treats unexpected stored values as expanded", () => {
    const s = memory();
    s.data[SIDEBAR_STORAGE_KEY] = "yes";
    expect(readSidebarCollapsed(s)).toBe(false);
  });
  it("never throws when storage is blocked or missing", () => {
    expect(readSidebarCollapsed(throwing)).toBe(false);
    expect(writeSidebarCollapsed(throwing, true)).toBe(false);
    expect(readSidebarCollapsed(null)).toBe(false);
    expect(writeSidebarCollapsed(undefined, true)).toBe(false);
  });
});
