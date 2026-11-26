import "server-only";
import type { StorageDriver } from "@/lib/storage/types";
import { LocalDiskStorageDriver } from "@/lib/storage/local-disk-driver";
import { R2StorageDriver } from "@/lib/storage/r2-driver";

export type { StorageDriver, StoredFile } from "@/lib/storage/types";

/**
 * Driver selection via STORAGE_DRIVER:
 *   "local" -- local disk (STORAGE_LOCAL_DIR); development / single-server only.
 *   "r2"    -- Cloudflare R2 (S3-compatible); required on serverless hosts
 *              (e.g. Vercel) where the filesystem is read-only/ephemeral.
 */
function createDriver(): StorageDriver {
  const driver = (process.env.STORAGE_DRIVER ?? "").trim().toLowerCase() || "local";

  switch (driver) {
    case "local":
      return new LocalDiskStorageDriver();
    case "r2":
      return new R2StorageDriver();
    default:
      throw new Error(`Unsupported STORAGE_DRIVER "${driver}". Supported drivers: "local", "r2".`);
  }
}

let cached: StorageDriver | undefined;

export function getStorageDriver(): StorageDriver {
  if (!cached) {
    cached = createDriver();
  }
  return cached;
}
