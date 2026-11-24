/**
 * Sidebar collapse preference. Pure helpers over an injected Storage-like
 * object so they are unit-testable and so a browser that blocks storage
 * (private mode, disabled cookies) degrades to "expanded" rather than
 * throwing. The preference is per browser/device by design: it is a layout
 * convenience, not account data, so nothing is sent to the server.
 */
export const SIDEBAR_STORAGE_KEY = "salesflow:sidebar-collapsed";
export const SIDEBAR_PREFERENCE_EVENT = "salesflow:sidebar-preference";

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function readSidebarCollapsed(storage: StorageLike | null | undefined): boolean {
  try {
    return storage?.getItem(SIDEBAR_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Returns false when the value could not be persisted (the in-page toggle still works for this visit). */
export function writeSidebarCollapsed(storage: StorageLike | null | undefined, collapsed: boolean): boolean {
  try {
    storage?.setItem(SIDEBAR_STORAGE_KEY, collapsed ? "1" : "0");
    return Boolean(storage);
  } catch {
    return false;
  }
}
