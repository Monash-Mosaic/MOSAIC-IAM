import { createServer } from "node:http";
import { getGoogleEnv } from "../config/env.js";
import { logger } from "../utils/logger.js";

export const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

export function buildGoogleAuthUrl({ clientId, redirectUri, state = "mosaic-iam" }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_DRIVE_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeGoogleAuthCode({ clientId, clientSecret, redirectUri, code }) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    code,
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error_description || payload.error || "Google token exchange failed");
  }
  return payload;
}

export async function refreshGoogleAccessToken({ clientId, clientSecret, refreshToken }) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error_description || payload.error || "Google token refresh failed");
  }
  return payload;
}

export async function runInteractiveGoogleAuth() {
  const google = getGoogleEnv();
  if (!google.clientId || !google.clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required for npm run google:auth");
  }

  const authUrl = buildGoogleAuthUrl({
    clientId: google.clientId,
    redirectUri: google.redirectUri,
  });
  logger.info("[GOOGLE]", "Open this URL to authorize MOSAIC IAM with Google Drive:");
  logger.info("[GOOGLE]", authUrl);

  const tokens = await waitForAuthorizationCode(google);
  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Re-run with prompt=consent and ensure Drive access is granted.",
    );
  }
  return tokens;
}

function waitForAuthorizationCode(google) {
  const redirect = new URL(google.redirectUri);
  const port = Number(redirect.port || (redirect.protocol === "https:" ? 443 : 80));
  const expectedPath = redirect.pathname || "/";

  return new Promise((resolve, reject) => {
    const server = createServer(async (request, response) => {
      try {
        const requestUrl = new URL(request.url, google.redirectUri);
        if (requestUrl.pathname !== expectedPath) {
          response.writeHead(404);
          response.end("Not found");
          return;
        }
        const error = requestUrl.searchParams.get("error");
        if (error) {
          response.writeHead(400, { "Content-Type": "text/plain" });
          response.end("Authorization failed. You can close this window.");
          server.close();
          reject(new Error(`Google OAuth was denied: ${error}`));
          return;
        }
        const code = requestUrl.searchParams.get("code");
        if (!code) {
          response.writeHead(400, { "Content-Type": "text/plain" });
          response.end("Missing authorization code.");
          return;
        }
        const tokens = await exchangeGoogleAuthCode({
          clientId: google.clientId,
          clientSecret: google.clientSecret,
          redirectUri: google.redirectUri,
          code,
        });
        response.writeHead(200, { "Content-Type": "text/plain" });
        response.end("Google authorization complete. You can close this window and return to the terminal.");
        server.close();
        resolve(tokens);
      } catch (error) {
        response.writeHead(500, { "Content-Type": "text/plain" });
        response.end("Authorization failed. Check the terminal for details.");
        server.close();
        reject(error);
      }
    });

    server.on("error", reject);
    server.listen(port, redirect.hostname, () => {
      logger.info("[GOOGLE]", `Waiting for OAuth redirect on ${google.redirectUri}`);
    });
  });
}
