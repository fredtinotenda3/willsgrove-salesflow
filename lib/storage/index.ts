import "server-only";
import type { StorageDriver } from "@/lib/storage/types";
import { LocalDiskStorageDriver } from "@/lib/storage/local-disk-driver";

export type { StorageDriver, StoredFile } from "@/lib/storage/types";

/**
 * Driver selection. Only "local" exists at Milestone 0 -- STORAGE_DRIVER is
 * read here (rather than hardcoding LocalDiskStorageDriver at call sites)
 * so that adding an "s3" branch later is a one-line change with no caller
 * impact.
 */
function createDriver(): StorageDriver {
  const driver = process.env.STORAGE_DRIVER ?? "local";

  switch (driver) {
    case "local":
      return new LocalDiskStorageDriver();
    default:
      throw new Error(
        `Unsupported STORAGE_DRIVER "${driver}". Only "local" is implemented at this milestone.`
      );
  }
}

let cached: StorageDriver | undefined;

export function getStorageDriver(): StorageDriver {
  if (!cached) {
    cached = createDriver();
  }
  return cached;
}
