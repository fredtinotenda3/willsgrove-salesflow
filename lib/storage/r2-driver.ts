import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { StorageDriver, StoredFile } from "@/lib/storage/types";
import { encodePath, sha256Hex, signRequest, EMPTY_PAYLOAD_SHA256 } from "@/lib/storage/sigv4";

/**
 * Cloudflare R2 storage driver (S3-compatible API, path-style addressing,
 * SigV4, region "auto").
 *
 * Same security properties as the local driver:
 *  - Object keys are generated here from a random UUID, never from any
 *    caller-supplied string ("<4 hex>/<uuid>.bin"), and every key passed
 *    to get()/delete() is re-validated against that exact shape before a
 *    request is built, so a tampered key can never address another object.
 *  - Size and checksum are computed from the bytes actually uploaded.
 *  - The bucket must stay PRIVATE. Files are only ever served through the
 *    authenticated /api routes, never via a public bucket URL.
 *  - Credentials are read from the environment only and never logged;
 *    error messages carry the HTTP status and the S3 error code, not the
 *    request headers.
 *
 * Environment:
 *   R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME   (required)
 *   R2_ENDPOINT   e.g. https://<account>.r2.cloudflarestorage.com
 *   R2_ACCOUNT_ID used to derive the endpoint when R2_ENDPOINT is unset
 *   R2_REGION     defaults to "auto"
 *   R2_KEY_PREFIX optional folder prefix inside the bucket (no leading /)
 */

const KEY_PATTERN = /^[0-9a-f]{4}\/[0-9a-f-]{36}\.bin$/;
const REQUEST_TIMEOUT_MS = 30_000;

export type R2Config = {
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string;
  region: string;
  keyPrefix: string;
};

export function resolveR2Config(env: Record<string, string | undefined> = process.env): R2Config {
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = env.R2_BUCKET_NAME?.trim();
  const accountId = env.R2_ACCOUNT_ID?.trim();
  const endpoint = (env.R2_ENDPOINT?.trim() || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "")).replace(/\/+$/, "");

  const missing: string[] = [];
  if (!accessKeyId) missing.push("R2_ACCESS_KEY_ID");
  if (!secretAccessKey) missing.push("R2_SECRET_ACCESS_KEY");
  if (!bucket) missing.push("R2_BUCKET_NAME");
  if (!endpoint) missing.push("R2_ENDPOINT (or R2_ACCOUNT_ID)");
  if (missing.length > 0) {
    throw new Error(`STORAGE_DRIVER=r2 requires these environment variables: ${missing.join(", ")}.`);
  }

  try {
    const parsed = new URL(endpoint);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
      throw new Error("R2_ENDPOINT must use https.");
    }
  } catch (error) {
    throw new Error(error instanceof Error && error.message.includes("https") ? error.message : "R2_ENDPOINT is not a valid URL.");
  }

  const keyPrefix = (env.R2_KEY_PREFIX ?? "").trim().replace(/^\/+|\/+$/g, "");

  return {
    accessKeyId: accessKeyId!,
    secretAccessKey: secretAccessKey!,
    bucket: bucket!,
    endpoint,
    region: env.R2_REGION?.trim() || "auto",
    keyPrefix,
  };
}

type FetchLike = typeof fetch;

export class R2StorageDriver implements StorageDriver {
  constructor(
    private readonly config: R2Config = resolveR2Config(),
    private readonly fetchImpl: FetchLike = fetch,
    private readonly clock: () => Date = () => new Date()
  ) {}

  private objectUrl(storageKey: string): URL {
    if (!KEY_PATTERN.test(storageKey)) {
      throw new Error("Invalid storage key.");
    }
    const fullKey = this.config.keyPrefix ? `${this.config.keyPrefix}/${storageKey}` : storageKey;
    return new URL(`${this.config.endpoint}/${encodePath(`${this.config.bucket}/${fullKey}`)}`);
  }

  private async request(method: "PUT" | "GET" | "DELETE", url: URL, body?: Buffer, contentType?: string): Promise<Response> {
    const payloadHash = body ? sha256Hex(body) : EMPTY_PAYLOAD_SHA256;
    const headers = signRequest({
      method,
      url,
      headers: contentType ? { "content-type": contentType } : undefined,
      payloadHash,
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      region: this.config.region,
      service: "s3",
      now: this.clock(),
    });

    // `host` is set by fetch itself.
    delete headers.host;

    return this.fetchImpl(url, {
      method,
      headers,
      body: body ? new Uint8Array(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  }

  private async failure(action: string, response: Response): Promise<Error> {
    let code = "";
    try {
      const text = await response.text();
      code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1] ?? "";
    } catch {
      // ignore: status alone is enough
    }
    const hint =
      response.status === 403
        ? " Check R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY and that the API token has Object Read & Write on this bucket."
        : response.status === 404 && code === "NoSuchBucket"
          ? " Check R2_BUCKET_NAME."
          : "";
    return new Error(`R2 ${action} failed: HTTP ${response.status}${code ? ` ${code}` : ""}.${hint}`);
  }

  async put(data: Buffer, extensionHint?: string): Promise<StoredFile> {
    void extensionHint; // never part of the key (see local driver)
    const id = randomUUID();
    const prefix = id.replace(/-/g, "").slice(0, 4);
    const storageKey = `${prefix}/${id}.bin`;

    const response = await this.request("PUT", this.objectUrl(storageKey), data, "application/octet-stream");
    if (!response.ok) {
      throw await this.failure("upload", response);
    }
    await response.arrayBuffer().catch(() => undefined);

    return {
      storageKey,
      fileSize: data.byteLength,
      checksum: createHash("sha256").update(data).digest("hex"),
    };
  }

  async get(storageKey: string): Promise<Buffer | null> {
    const response = await this.request("GET", this.objectUrl(storageKey));
    if (response.status === 404) {
      await response.arrayBuffer().catch(() => undefined);
      return null;
    }
    if (!response.ok) {
      throw await this.failure("download", response);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async delete(storageKey: string): Promise<void> {
    const response = await this.request("DELETE", this.objectUrl(storageKey));
    if (response.status === 404 || response.ok) {
      await response.arrayBuffer().catch(() => undefined);
      return;
    }
    throw await this.failure("delete", response);
  }
}
