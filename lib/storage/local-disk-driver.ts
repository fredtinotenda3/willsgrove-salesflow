import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StorageDriver, StoredFile } from "@/lib/storage/types";

/**
 * Local-disk storage driver.
 *
 * Security properties this driver depends on and preserves:
 *
 * 1. Storage keys are generated here, server-side, from a random UUID --
 *    never derived from the caller's original filename or any other
 *    caller-supplied input. This is what prevents path traversal: there is
 *    no user-controlled string anywhere in the path that gets built.
 * 2. Keys are split into a two-level directory prefix (first 4 hex chars)
 *    purely to avoid tens of thousands of files in one directory; this has
 *    no bearing on the security property above.
 * 3. The resolved absolute path is always verified to stay inside the
 *    configured root. This is defense-in-depth given (1) already rules out
 *    traversal, cheap enough to keep unconditionally, and cheap insurance
 *    against a future bug that starts accepting a caller-influenced key.
 * 4. The root directory lives OUTSIDE the project tree and is configured
 *    via STORAGE_LOCAL_DIR in .env.local (never committed), per the
 *    explicit instruction that uploaded files must not live inside the
 *    repository or be reachable by git.
 */

function resolveRoot(): string {
  const configured = process.env.STORAGE_LOCAL_DIR;
  if (!configured || configured.trim() === "") {
    throw new Error(
      "STORAGE_LOCAL_DIR is not set. Set it in .env.local to a folder outside the project (see SETUP-WINDOWS.md)."
    );
  }
  return path.resolve(configured);
}

function keyToAbsolutePath(root: string, storageKey: string): string {
  // storageKey is always of the form "<4 hex>/<uuid>.bin" -- validate the
  // shape defensively before building a path from it, in addition to (1)
  // above, as a second independent guard against path traversal.
  if (!/^[0-9a-f]{4}\/[0-9a-f-]{36}\.bin$/.test(storageKey)) {
    throw new Error("Invalid storage key.");
  }

  const resolved = path.resolve(root, storageKey);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;

  if (!resolved.startsWith(rootWithSep)) {
    throw new Error("Storage key resolves outside the storage root.");
  }

  return resolved;
}

export class LocalDiskStorageDriver implements StorageDriver {
  async put(data: Buffer): Promise<StoredFile> {
    const root = resolveRoot();

    const id = randomUUID();
    const prefix = id.replace(/-/g, "").slice(0, 4);
    const storageKey = `${prefix}/${id}.bin`;

    const absolutePath = keyToAbsolutePath(root, storageKey);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, data, { flag: "wx" }); // wx: fail loudly on an (astronomically unlikely) collision rather than overwrite

    const checksum = createHash("sha256").update(data).digest("hex");

    return { storageKey, fileSize: data.byteLength, checksum };
  }

  async get(storageKey: string): Promise<Buffer | null> {
    const root = resolveRoot();
    const absolutePath = keyToAbsolutePath(root, storageKey);

    try {
      return await readFile(absolutePath);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async delete(storageKey: string): Promise<void> {
    const root = resolveRoot();
    const absolutePath = keyToAbsolutePath(root, storageKey);

    try {
      await rm(absolutePath, { force: true });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return;
      }
      throw error;
    }
  }
}

/** Fails fast with a clear message if the configured root can't be used. */
export async function assertStorageRootWritable(): Promise<void> {
  const root = resolveRoot();
  await mkdir(root, { recursive: true });
  const probe = path.join(root, ".write-check");
  await writeFile(probe, "ok");
  await stat(probe);
  await rm(probe, { force: true });
}
