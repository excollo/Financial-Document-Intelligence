import request from "supertest";
import crypto from "crypto";
import { app } from "../index";
import { Job } from "../models/Job";

function signPost(path: string, body: any, timestamp: string, nonce: string) {
  const rawBody = JSON.stringify(body);
  const payload = `POST\n${path}\n${rawBody}\n${timestamp}\n${nonce}`;
  return crypto
    .createHmac("sha256", process.env.INTERNAL_CALLBACK_SIGNING_SECRET || process.env.INTERNAL_SECRET || "")
    .update(payload, "utf8")
    .digest("hex");
}

describe("internal job route security", () => {
  beforeAll(() => {
    process.env.INTERNAL_SECRET = "test-secret";
    process.env.INTERNAL_CALLBACK_SIGNING_SECRET = "test-secret";
    process.env.INTERNAL_CALLBACK_SIGNATURE_REQUIRED = "true";
  });

  beforeEach(() => {
    jest.spyOn(Job, "findOneAndUpdate").mockResolvedValue(null as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejects unsigned internal status update", async () => {
    const response = await request(app).post("/api/jobs/internal/status").send({
      job_id: "job-1",
      tenant_id: "tenant-1",
      status: "processing",
    });
    expect(response.status).toBe(403);
  });

  it("accepts valid signed internal status update request", async () => {
    const body = {
      job_id: "job-1",
      tenant_id: "tenant-1",
      status: "processing",
    };
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = `nonce-job-${Date.now()}`;
    const signature = signPost("/api/jobs/internal/status", body, timestamp, nonce);
    const response = await request(app)
      .post("/api/jobs/internal/status")
      .set("x-internal-secret", "test-secret")
      .set("x-timestamp", timestamp)
      .set("x-nonce", nonce)
      .set("x-signature", signature)
      .send(body);

    expect(response.status).not.toBe(401);
    expect(response.status).not.toBe(403);
  });
});

