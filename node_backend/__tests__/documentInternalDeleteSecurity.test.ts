import request from "supertest";
import crypto from "crypto";
import { app } from "../index";
import { Document } from "../models/Document";

function signDelete(path: string, body: any, timestamp: string, nonce: string) {
  const rawBody = JSON.stringify(body);
  const payload = `DELETE\n${path}\n${rawBody}\n${timestamp}\n${nonce}`;
  return crypto
    .createHmac("sha256", process.env.INTERNAL_CALLBACK_SIGNING_SECRET || process.env.INTERNAL_SECRET || "")
    .update(payload, "utf8")
    .digest("hex");
}

describe("document internal delete callback security", () => {
  const scopedBody = {
    documentId: "doc-1",
    workspaceId: "ws-1",
    domainId: "tenant-1",
  };
  beforeAll(() => {
    process.env.INTERNAL_SECRET = "test-secret";
    process.env.INTERNAL_CALLBACK_SIGNING_SECRET = "test-secret";
    process.env.INTERNAL_CALLBACK_SIGNATURE_REQUIRED = "true";
    process.env.NODE_ENV = "test";
  });

  beforeEach(() => {
    jest.spyOn(Document, "findOne").mockResolvedValue(null as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejects unsigned internal delete", async () => {
    const response = await request(app).delete("/api/documents/internal/doc-1").send(scopedBody);
    expect(response.status).toBe(403);
  });

  it("rejects invalid signature on internal delete", async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = `nonce-invalid-${Date.now()}`;
    const response = await request(app)
      .delete("/api/documents/internal/doc-1")
      .set("x-internal-secret", "test-secret")
      .set("x-timestamp", timestamp)
      .set("x-nonce", nonce)
      .set("x-signature", "bad-signature")
      .send(scopedBody);
    expect(response.status).toBe(401);
  });

  it("rejects expired timestamp on internal delete", async () => {
    const timestamp = String(Math.floor(Date.now() / 1000) - 1000);
    const nonce = `nonce-expired-${Date.now()}`;
    const signature = signDelete("/api/documents/internal/doc-1", scopedBody, timestamp, nonce);
    const response = await request(app)
      .delete("/api/documents/internal/doc-1")
      .set("x-internal-secret", "test-secret")
      .set("x-timestamp", timestamp)
      .set("x-nonce", nonce)
      .set("x-signature", signature)
      .send(scopedBody);
    expect(response.status).toBe(401);
  });

  it("rejects replayed nonce on internal delete", async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = `nonce-replay-${Date.now()}`;
    const signature = signDelete("/api/documents/internal/doc-1", scopedBody, timestamp, nonce);

    const first = await request(app)
      .delete("/api/documents/internal/doc-1")
      .set("x-internal-secret", "test-secret")
      .set("x-timestamp", timestamp)
      .set("x-nonce", nonce)
      .set("x-signature", signature)
      .send(scopedBody);
    expect(first.status).not.toBe(401);
    expect(first.status).not.toBe(403);

    const second = await request(app)
      .delete("/api/documents/internal/doc-1")
      .set("x-internal-secret", "test-secret")
      .set("x-timestamp", timestamp)
      .set("x-nonce", nonce)
      .set("x-signature", signature)
      .send(scopedBody);
    expect(second.status).toBe(401);
  });

  it("accepts valid signed internal delete request", async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = `nonce-valid-${Date.now()}`;
    const signature = signDelete("/api/documents/internal/doc-1", scopedBody, timestamp, nonce);
    const response = await request(app)
      .delete("/api/documents/internal/doc-1")
      .set("x-internal-secret", "test-secret")
      .set("x-timestamp", timestamp)
      .set("x-nonce", nonce)
      .set("x-signature", signature)
      .send(scopedBody);

    expect(response.status).not.toBe(401);
    expect(response.status).not.toBe(403);
  });
});

