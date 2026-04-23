import crypto from "crypto";
import {
  buildSignedInternalJsonRequest,
  buildSignedInternalRawRequest,
} from "../services/internalRequestSigning";

describe("internal request signing", () => {
  beforeEach(() => {
    process.env.INTERNAL_SECRET = "secret-123";
    process.env.INTERNAL_CALLBACK_SIGNING_SECRET = "signing-123";
    jest.resetModules();
  });

  it("builds deterministic JSON payload signature contract", () => {
    const url = "http://python.test/jobs/pipeline";
    const payload = { job_id: "job-1", tenant_id: "tenant-1" };
    const signed = buildSignedInternalJsonRequest("POST", url, payload);
    const path = "/jobs/pipeline";
    const expectedPayload = `POST\n${path}\n${signed.data}\n${signed.headers["X-Timestamp"]}\n${signed.headers["X-Nonce"]}`;
    const expected = crypto
      .createHmac("sha256", process.env.INTERNAL_CALLBACK_SIGNING_SECRET || process.env.INTERNAL_SECRET || "")
      .update(expectedPayload, "utf8")
      .digest("hex");
    expect(signed.headers["X-Signature"]).toBe(expected);
    expect(signed.headers["X-Internal-Secret"]).toBe("secret-123");
  });

  it("builds raw payload signature contract", () => {
    const url = "http://python.test/onboarding/re-onboard";
    const rawBody = Buffer.from([0xff, 0x00, 0x41, 0x42, 0x43, 0x0a]);
    const signed = buildSignedInternalRawRequest("POST", url, rawBody);
    const path = "/onboarding/re-onboard";
    const expectedPayload = Buffer.concat([
      Buffer.from(`POST\n${path}\n`, "utf8"),
      rawBody,
      Buffer.from(`\n${signed.headers["X-Timestamp"]}\n${signed.headers["X-Nonce"]}`, "utf8"),
    ]);
    const expected = crypto
      .createHmac("sha256", process.env.INTERNAL_CALLBACK_SIGNING_SECRET || process.env.INTERNAL_SECRET || "")
      .update(expectedPayload)
      .digest("hex");
    expect(signed.headers["X-Signature"]).toBe(expected);
  });
});
