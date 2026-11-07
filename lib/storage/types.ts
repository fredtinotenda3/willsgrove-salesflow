/**
 * Storage abstraction for uploaded files (customer PO attachments, etc.).
 *
 * Milestone 0 ships a single driver (local disk, see local-disk-driver.ts),
 * selected via STORAGE_DRIVER. The interface is deliberately narrow and
 * key-based so a later swap to an S3-compatible driver (STORAGE_DRIVER=s3)
 * requires no changes to callers -- only a new driver implementing this
 * same contract.
 *
 * Callers never choose or see a file path: `put()` generates and returns
 * the storage key. This is a deliberate security boundary, not a style
 * choice -- see local-disk-driver.ts for why a user-influenced key would
 * allow path traversal.
 */

export type StoredFile = {
  storageKey: string;
  fileSize: number;
  checksum: string; // sha256, hex-encoded
};

export interface StorageDriver {
  /**
   * Persists the given bytes and returns the generated key plus size and
   * checksum computed from the actual stored bytes (never trust a
   * caller-supplied size or checksum).
   *
   * `extensionHint` is used only to keep stored filenames human-inspectable
   * on disk during support/debugging; it never participates in key
   * generation or lookup and is sanitized defensively regardless.
   */
  put(data: Buffer, extensionHint?: string): Promise<StoredFile>;

  /** Returns the file's bytes, or null if the key does not exist. */
  get(storageKey: string): Promise<Buffer | null>;

  /** Deletes the file. A missing key is not an error (idempotent). */
  delete(storageKey: string): Promise<void>;
}
