/** Pure paging helpers for admin lists: invalid input falls back to safe defaults instead of throwing. */
export const ADMIN_PAGE_SIZE = 25;
export const ADMIN_MAX_PAGE_SIZE = 100;

const int = (v: unknown) => (typeof v === "string" && /^\d{1,6}$/.test(v) ? Number(v) : NaN);

export function readPaging(raw: { page?: unknown; pageSize?: unknown }): { page: number; pageSize: number } {
  const p = int(raw.page);
  const s = int(raw.pageSize);
  return { page: Number.isFinite(p) && p >= 1 ? p : 1, pageSize: Number.isFinite(s) && s >= 1 ? Math.min(s, ADMIN_MAX_PAGE_SIZE) : ADMIN_PAGE_SIZE };
}

export const firstParam = (v: string | string[] | undefined): string | undefined => {
  const value = Array.isArray(v) ? v[0] : v;
  return value && value.trim() ? value.trim() : undefined;
};
