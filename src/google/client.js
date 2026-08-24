import { getGoogleEnv, isGoogleConfigured } from "../config/env.js";
import { refreshGoogleAccessToken } from "./oauth.js";

let cachedToken = {
  accessToken: "",
  expiresAt: 0,
};

export function assertGoogleConfigured() {
  if (!isGoogleConfigured()) {
    return false;
  }
  return true;
}

export async function getGoogleAccessToken() {
  if (!isGoogleConfigured()) {
    return null;
  }
  if (cachedToken.accessToken && Date.now() < cachedToken.expiresAt - 30_000) {
    return cachedToken.accessToken;
  }

  const google = getGoogleEnv();
  const tokens = await refreshGoogleAccessToken({
    clientId: google.clientId,
    clientSecret: google.clientSecret,
    refreshToken: google.refreshToken,
  });
  cachedToken = {
    accessToken: tokens.access_token,
    expiresAt: Date.now() + Number(tokens.expires_in ?? 3600) * 1000,
  };
  return cachedToken.accessToken;
}

export async function googleDriveRequest(path, { method = "GET", query = {}, body } = {}) {
  const accessToken = await getGoogleAccessToken();
  if (!accessToken) {
    throw new Error("Google Drive is not configured");
  }

  const url = new URL(`https://www.googleapis.com/drive/v3${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error?.message || payload.error_description || `Google Drive API ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return payload;
}
