import { createHash, createHmac } from "node:crypto";

/**
 * Minimal AWS Signature Version 4 signer for S3-compatible object storage
 * (Cloudflare R2). Dependency-free on purpose: the whole surface this
 * project needs is PUT / GET / DELETE of a single object, which does not
 * justify pulling in the full AWS SDK (and its transitive tree) into a
 * security-sensitive server bundle.
 *
 * Pure and deterministic (the clock is injected), so it is verified in
 * tests against AWS's own published S3 signing example.
 * Reference: https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html
 */

export const EMPTY_PAYLOAD_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/** RFC 3986 encoding of one path segment (S3 does not double-encode). */
export function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function encodePath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeSegment(segment))
    .join("/");
}

export type SignInput = {
  method: string;
  /** Absolute URL. Its pathname must already be URI-encoded. */
  url: URL;
  /** Extra headers to sign (lower-case names). host / x-amz-* are added here. */
  headers?: Record<string, string>;
  payloadHash: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
  now: Date;
};

function amzDate(now: Date): string {
  return now.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

/**
 * Returns the full header set to send, including `authorization`,
 * `x-amz-date` and `x-amz-content-sha256`.
 */
export function signRequest(input: SignInput): Record<string, string> {
  const date = amzDate(input.now);
  const dateStamp = date.slice(0, 8);

  const headers: Record<string, string> = {
    ...Object.fromEntries(Object.entries(input.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v.trim()])),
    host: input.url.host,
    "x-amz-content-sha256": input.payloadHash,
    "x-amz-date": date,
  };

  const sortedNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedNames.map((name) => `${name}:${headers[name]}\n`).join("");
  const signedHeaders = sortedNames.join(";");

  const canonicalQuery = [...input.url.searchParams.entries()]
    .map(([k, v]) => [encodeSegment(k), encodeSegment(v)] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const canonicalRequest = [
    input.method.toUpperCase(),
    input.url.pathname,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", date, scope, sha256Hex(canonicalRequest)].join("\n");

  const kDate = hmac(`AWS4${input.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, input.service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
