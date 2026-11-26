import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { send, live, findUnique, auditCreate } = vi.hoisted(() => ({
  send: vi.fn(),
  live: vi.fn(),
  findUnique: vi.fn(),
  auditCreate: vi.fn(async () => ({})),
}));

vi.mock("@/lib/auth/csrf", () => ({ verifyCsrfOrigin: () => ({ ok: true }) }));
vi.mock("@/lib/auth/current-user", () => ({ requireUserOrResponse: async () => ({ ok: true, user: { id: "u1", name: "Stan" } }) }));
vi.mock("@/lib/prisma", () => ({ prisma: { orderHandover: { findUnique }, auditEvent: { create: auditCreate } } }));
vi.mock("@/lib/storage", () => ({ getStorageDriver: () => ({ get: async () => Buffer.from("a,b\r\n") }) }));
vi.mock("@/lib/channels/config", () => ({ canUseLiveEmailAdapter: () => live() }));
vi.mock("@/lib/channels/get-adapter", () => ({ getChannelAdapter: () => ({ send }) }));

import { POST } from "@/app/api/orders/[id]/handover/[handoverId]/email/route";

function call(body: unknown) {
  const request = new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) });
  return POST(request as never, { params: Promise.resolve({ id: "ord1", handoverId: "hnd1" }) });
}

const HANDOVER = {
  orderId: "ord1",
  reference: "HND-1",
  storageKey: "abcd/x.bin",
  originalFileName: "ORD-1-handover.csv",
  mimeType: "text/csv; charset=utf-8",
  fileSize: BigInt(5),
  order: { reference: "ORD-1", customer: { name: "Acme" } },
};

describe("POST handover email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    live.mockReturnValue(true);
    findUnique.mockResolvedValue(HANDOVER);
    send.mockResolvedValue({ ok: true, providerMessageId: "m1" });
  });

  it("503s honestly when no live email provider is configured", async () => {
    live.mockReturnValue(false);
    const res = await call({ to: "a@b.com" });
    expect(res.status).toBe(503);
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects invalid and too many recipients", async () => {
    expect((await call({ to: "not-an-email" })).status).toBe(400);
    expect((await call({ to: "a@b.com,c@d.com,e@f.com,g@h.com,i@j.com,k@l.com" })).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses a handover that belongs to another order", async () => {
    findUnique.mockResolvedValue({ ...HANDOVER, orderId: "other" });
    expect((await call({ to: "a@b.com" })).status).toBe(404);
  });

  it("sends the stored file as an attachment, de-duplicates recipients and audits", async () => {
    const res = await call({ to: "A@b.com; a@b.com, c@d.com" });
    expect(res.status).toBe(200);
    const sent = send.mock.calls[0][0];
    expect(sent.to).toBe("a@b.com,c@d.com");
    expect(sent.attachments).toEqual([{ name: "ORD-1-handover.csv", contentType: "text/csv", content: Buffer.from("a,b\r\n") }]);
    expect(sent.subject).toBe("SAP invoice handover HND-1 - ORD-1");
    expect(auditCreate).toHaveBeenCalledTimes(1);
  });

  it("surfaces a provider failure as 502", async () => {
    send.mockResolvedValue({ ok: false, message: "Email provider rejected the message: bad" });
    expect((await call({ to: "a@b.com" })).status).toBe(502);
    expect(auditCreate).not.toHaveBeenCalled();
  });
});
