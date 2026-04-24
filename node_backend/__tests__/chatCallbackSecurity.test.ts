import request from "supertest";
import crypto from "crypto";

jest.mock("../models/ChatJobStatus", () => ({
  ChatJobStatus: {
    findOneAndUpdate: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    }),
  },
}));

function signPost(path: string, body: any, timestamp: string, nonce: string) {
  const rawBody = JSON.stringify(body);
  const payload = `POST\n${path}\n${rawBody}\n${timestamp}\n${nonce}`;
  return crypto
    .createHmac("sha256", process.env.INTERNAL_CALLBACK_SIGNING_SECRET || process.env.INTERNAL_SECRET || "")
    .update(payload, "utf8")
    .digest("hex");
}

describe("chat callback security", () => {
  let app: any;

  beforeAll(() => {
    process.env.INTERNAL_SECRET = "test-secret";
    process.env.INTERNAL_CALLBACK_SIGNING_SECRET = "test-secret";
    process.env.INTERNAL_CALLBACK_SIGNATURE_REQUIRED = "true";
    // Import after env + mocks so middleware/controller initialize with test settings.
    app = require("../index").app;
  });

  it("rejects unsigned chat status callback", async () => {
    const response = await request(app).post("/api/chats/chat-status/update").send({
      jobId: "job-1",
      status: "failed",
    });
    expect(response.status).toBe(403);
  });

  it("accepts valid signed chat status callback", async () => {
    const body = { jobId: "job-1", status: "failed" };
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = `nonce-chat-${Date.now()}`;
    const signature = signPost("/api/chats/chat-status/update", body, timestamp, nonce);

    const response = await request(app)
      .post("/api/chats/chat-status/update")
      .set("x-internal-secret", "test-secret")
      .set("x-timestamp", timestamp)
      .set("x-nonce", nonce)
      .set("x-signature", signature)
      .send(body);

    expect(response.status).toBe(200);
  });
});

