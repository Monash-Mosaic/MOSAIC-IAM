import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_CLOCK_SKEW_SECONDS = 60 * 5;

export class SlackRequestError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "SlackRequestError";
    this.status = status;
  }
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifySlackSignature({
  signingSecret,
  timestamp,
  signature,
  rawBody,
  nowMs = Date.now(),
}) {
  if (!signingSecret) {
    throw new SlackRequestError(401, "Slack signing secret is not configured");
  }
  if (typeof rawBody !== "string") {
    throw new SlackRequestError(400, "Malformed Slack request");
  }
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) {
    throw new SlackRequestError(400, "Malformed Slack request");
  }
  if (!signature.startsWith("v0=")) {
    throw new SlackRequestError(401, "Invalid Slack signature");
  }

  const ageSeconds = Math.abs(nowMs / 1000 - Number(timestamp));
  if (ageSeconds > MAX_CLOCK_SKEW_SECONDS) {
    throw new SlackRequestError(403, "Stale Slack request");
  }

  const baseString = `v0:${timestamp}:${rawBody}`;
  const expected = `v0=${createHmac("sha256", signingSecret).update(baseString).digest("hex")}`;
  if (!safeEqual(expected, signature)) {
    throw new SlackRequestError(401, "Invalid Slack signature");
  }
}

export async function readVerifiedSlackBody(request, signingSecret) {
  const rawBody = await request.text();
  verifySlackSignature({
    signingSecret,
    timestamp: request.headers.get("x-slack-request-timestamp") || "",
    signature: request.headers.get("x-slack-signature") || "",
    rawBody,
  });
  return rawBody;
}
