import crypto from "crypto";
import { verifyInternalCallbackRequest } from "../middleware/internalRequestVerification";

function createMockRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function sign(path: string, body: any, timestamp: string, nonce: string) {
  const rawBody = JSON.stringify(body);
  const payload = `POST\n${path}\n${rawBody}\n${timestamp}\n${nonce}`;
  return crypto
    .createHmac("sha256", process.env.INTERNAL_SECRET || "")
    .update(payload, "utf8")
    .digest("hex");
}

describe("verifyInternalCallbackRequest", () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.INTERNAL_SECRET = "test-secret";
    process.env.INTERNAL_CALLBACK_SIGNING_SECRET = "test-secret";
    process.env.INTERNAL_CALLBACK_SIGNATURE_REQUIRED = "true";
    process.env.NODE_ENV = "test";
    delete process.env.REDIS_URL;
  });

  it("rejects missing signed headers", async () => {
    const req: any = {
      method: "POST",
      originalUrl: "/api/documents/upload-status/update",
      headers: { "x-internal-secret": "test-secret" },
      rawBody: Buffer.from(JSON.stringify({ ok: true })),
      body: { ok: true },
      ip: "127.0.0.1",
    };
    const res = createMockRes();
    const next = jest.fn();

    await verifyInternalCallbackRequest(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("accepts a valid signed request", async () => {
    const path = "/api/summaries/summary-status/update";
    const body = { jobId: "job-1", status: "completed" };
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = `nonce-${Date.now()}`;
    const signature = sign(path, body, timestamp, nonce);

    const req: any = {
      method: "POST",
      originalUrl: path,
      headers: {
        "x-internal-secret": "test-secret",
        "x-timestamp": timestamp,
        "x-nonce": nonce,
        "x-signature": signature,
      },
      rawBody: Buffer.from(JSON.stringify(body)),
      body,
      ip: "127.0.0.1",
    };
    const res = createMockRes();
    const next = jest.fn();

    await verifyInternalCallbackRequest(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects expired timestamps", async () => {
    const path = "/api/summaries/summary-status/update";
    const body = { jobId: "job-1", status: "completed" };
    const timestamp = String(Math.floor(Date.now() / 1000) - 1000);
    const nonce = `nonce-expired-${Date.now()}`;
    const signature = sign(path, body, timestamp, nonce);
    const req: any = {
      method: "POST",
      originalUrl: path,
      headers: {
        "x-internal-secret": "test-secret",
        "x-timestamp": timestamp,
        "x-nonce": nonce,
        "x-signature": signature,
      },
      rawBody: Buffer.from(JSON.stringify(body)),
      body,
      ip: "127.0.0.1",
    };
    const res = createMockRes();
    const next = jest.fn();
    await verifyInternalCallbackRequest(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("rejects replayed nonce", async () => {
    const path = "/api/summaries/summary-status/update";
    const body = { jobId: "job-2", status: "completed" };
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = `nonce-replay-${Date.now()}`;
    const signature = sign(path, body, timestamp, nonce);
    const req: any = {
      method: "POST",
      originalUrl: path,
      headers: {
        "x-internal-secret": "test-secret",
        "x-timestamp": timestamp,
        "x-nonce": nonce,
        "x-signature": signature,
      },
      rawBody: Buffer.from(JSON.stringify(body)),
      body,
      ip: "127.0.0.1",
    };
    const res1 = createMockRes();
    const next1 = jest.fn();
    await verifyInternalCallbackRequest(req, res1, next1);
    expect(next1).toHaveBeenCalled();

    const res2 = createMockRes();
    const next2 = jest.fn();
    await verifyInternalCallbackRequest(req, res2, next2);
    expect(next2).not.toHaveBeenCalled();
    expect(res2.status).toHaveBeenCalledWith(401);
  });

  it("blocks weak mode in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.INTERNAL_CALLBACK_SIGNATURE_REQUIRED = "false";
    const req: any = {
      method: "POST",
      originalUrl: "/api/documents/upload-status/update",
      headers: { "x-internal-secret": "test-secret" },
      rawBody: Buffer.from(JSON.stringify({ ok: true })),
      body: { ok: true },
      ip: "127.0.0.1",
    };
    const res = createMockRes();
    const next = jest.fn();
    await verifyInternalCallbackRequest(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
  });
});

