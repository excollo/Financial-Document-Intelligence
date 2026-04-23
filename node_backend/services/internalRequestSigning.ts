import crypto from "crypto";

function getSecrets() {
  const internalSecret = process.env.INTERNAL_SECRET || "";
  const signingSecret = process.env.INTERNAL_CALLBACK_SIGNING_SECRET || internalSecret;
  return { internalSecret, signingSecret };
}

function buildSigningPayloadBuffer(
  method: string,
  path: string,
  rawBody: Buffer,
  timestamp: string,
  nonce: string
): Buffer {
  const prefix = Buffer.from(`${method.toUpperCase()}\n${path}\n`, "utf8");
  const suffix = Buffer.from(`\n${timestamp}\n${nonce}`, "utf8");
  return Buffer.concat([prefix, rawBody, suffix]);
}

export function buildSignedInternalJsonRequest(
  method: string,
  url: string,
  payload: unknown,
  additionalHeaders: Record<string, string> = {}
) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(16).toString("hex");
  const rawBody = JSON.stringify(payload ?? {});
  const path = new URL(url).pathname;
  const { internalSecret, signingSecret } = getSecrets();
  const signingPayload = buildSigningPayloadBuffer(
    method,
    path,
    Buffer.from(rawBody, "utf8"),
    timestamp,
    nonce
  );
  const signature = crypto
    .createHmac("sha256", signingSecret)
    .update(signingPayload)
    .digest("hex");

  return {
    data: rawBody,
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Secret": internalSecret,
      "X-Timestamp": timestamp,
      "X-Nonce": nonce,
      "X-Signature": signature,
      ...additionalHeaders,
    },
  };
}

export function buildSignedInternalRawRequest(
  method: string,
  url: string,
  rawBody: string | Buffer,
  additionalHeaders: Record<string, string> = {}
) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(16).toString("hex");
  const path = new URL(url).pathname;
  const { internalSecret, signingSecret } = getSecrets();
  const rawBodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, "utf8");
  const signingPayload = buildSigningPayloadBuffer(method, path, rawBodyBuffer, timestamp, nonce);
  const signature = crypto
    .createHmac("sha256", signingSecret)
    .update(signingPayload)
    .digest("hex");

  return {
    data: rawBody,
    headers: {
      "X-Internal-Secret": internalSecret,
      "X-Timestamp": timestamp,
      "X-Nonce": nonce,
      "X-Signature": signature,
      ...additionalHeaders,
    },
  };
}
