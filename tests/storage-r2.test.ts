import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { signRequest, EMPTY_PAYLOAD_SHA256 } from "@/lib/storage/sigv4";
import { R2StorageDriver, resolveR2Config } from "@/lib/storage/r2-driver";

const CONFIG = {
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "secret",
  bucket: "willsgrove-salesflow",
  endpoint: "https://acct.r2.cloudflarestorage.com",
  region: "auto",
  keyPrefix: "",
};

describe("sigv4", () => {
  it("matches AWS's published S3 GET-with-Range example signature", () => {
    // https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html (Example: GET Object)
    const headers = signRequest({
      method: "GET",
      url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
      headers: { range: "bytes=0-9" },
      payloadHash: EMPTY_PAYLOAD_SHA256,
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      region: "us-east-1",
      service: "s3",
      now: new Date("2013-05-24T00:00:00Z"),
    });
    expect(headers.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
    );
  });
});

describe("resolveR2Config", () => {
  it("lists every missing variable", () => {
    expect(() => resolveR2Config({})).toThrow(/R2_ACCESS_KEY_ID.*R2_SECRET_ACCESS_KEY.*R2_BUCKET_NAME/);
  });

  it("derives the endpoint from the account id and defaults the region", () => {
    const config = resolveR2Config({ R2_ACCESS_KEY_ID: "a", R2_SECRET_ACCESS_KEY: "b", R2_BUCKET_NAME: "c", R2_ACCOUNT_ID: "abc123" });
    expect(config.endpoint).toBe("https://abc123.r2.cloudflarestorage.com");
    expect(config.region).toBe("auto");
  });

  it("rejects a plain-http remote endpoint", () => {
    expect(() =>
      resolveR2Config({ R2_ACCESS_KEY_ID: "a", R2_SECRET_ACCESS_KEY: "b", R2_BUCKET_NAME: "c", R2_ENDPOINT: "http://example.com" })
    ).toThrow(/https/);
  });
});

describe("R2StorageDriver", () => {
  const fixedClock = () => new Date("2026-11-26T10:00:00Z");

  it("puts, gets and deletes with signed path-style requests", async () => {
    const calls: Array<{ url: string; method: string; headers: Record<string, string>; body?: Uint8Array }> = [];
    const store = new Map<string, Uint8Array>();
    const fetchMock = vi.fn(async (url: URL | string, init: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, method: init.method!, headers: init.headers as Record<string, string>, body: init.body as Uint8Array | undefined });
      if (init.method === "PUT") {
        store.set(u, init.body as Uint8Array);
        return new Response(null, { status: 200 });
      }
      if (init.method === "GET") {
        const hit = store.get(u);
        return hit ? new Response(hit as BodyInit, { status: 200 }) : new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 404 });
      }
      store.delete(u);
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    const driver = new R2StorageDriver(CONFIG, fetchMock, fixedClock);
    const data = Buffer.from("hello,world\r\n");
    const stored = await driver.put(data, "csv");

    expect(stored.storageKey).toMatch(/^[0-9a-f]{4}\/[0-9a-f-]{36}\.bin$/);
    expect(stored.fileSize).toBe(data.byteLength);
    expect(stored.checksum).toHaveLength(64);

    const put = calls[0];
    expect(put.url).toBe(`https://acct.r2.cloudflarestorage.com/willsgrove-salesflow/${stored.storageKey}`);
    expect(put.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20261126\/auto\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
    expect(put.headers["x-amz-date"]).toBe("20261126T100000Z");
    expect(JSON.stringify(calls)).not.toContain("secret");

    expect((await driver.get(stored.storageKey))?.toString()).toBe("hello,world\r\n");
    await driver.delete(stored.storageKey);
    expect(await driver.get(stored.storageKey)).toBeNull();
  });

  it("applies the key prefix", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch;
    const driver = new R2StorageDriver({ ...CONFIG, keyPrefix: "prod/files" }, fetchMock, fixedClock);
    const stored = await driver.put(Buffer.from("x"));
    expect(String((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0])).toContain(`/willsgrove-salesflow/prod/files/${stored.storageKey}`);
  });

  it("rejects tampered keys before any request is made", async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;
    const driver = new R2StorageDriver(CONFIG, fetchMock, fixedClock);
    await expect(driver.get("../../etc/passwd")).rejects.toThrow(/Invalid storage key/);
    await expect(driver.delete("abcd/not-a-uuid.bin")).rejects.toThrow(/Invalid storage key/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports an actionable error on 403 without leaking credentials", async () => {
    const fetchMock = vi.fn(async () => new Response("<Error><Code>SignatureDoesNotMatch</Code></Error>", { status: 403 })) as unknown as typeof fetch;
    const driver = new R2StorageDriver(CONFIG, fetchMock, fixedClock);
    const error = await driver.put(Buffer.from("x")).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/^R2 upload failed: HTTP 403 SignatureDoesNotMatch\./);
    expect((error as Error).message).not.toContain("AKIDEXAMPLE");
  });
});
