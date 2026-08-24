import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

dotenv.config({ path: path.join(PROJECT_ROOT, ".env") });

const REQUIRED_ENV = [
  "NOTION_TOKEN",
  "NOTION_USERS_DATA_SOURCE_ID",
  "NOTION_POLICIES_DATA_SOURCE_ID",
  "NOTION_RESOURCES_DATA_SOURCE_ID",
  "NOTION_ACCESS_TRACKING_DATA_SOURCE_ID",
  "GITHUB_APP_ID",
  "GITHUB_INSTALLATION_ID",
  "GITHUB_PRIVATE_KEY_PATH",
  "GITHUB_ORG",
];

let cachedEnv;

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function resolvePrivateKeyPath(configuredPath) {
  if (path.isAbsolute(configuredPath)) {
    return configuredPath;
  }
  return path.resolve(PROJECT_ROOT, configuredPath);
}

export function getEnv() {
  if (cachedEnv) {
    return cachedEnv;
  }

  for (const name of REQUIRED_ENV) {
    requireEnv(name);
  }

  const privateKeyPath = resolvePrivateKeyPath(process.env.GITHUB_PRIVATE_KEY_PATH.trim());
  if (!existsSync(privateKeyPath)) {
    throw new Error(`GitHub App private key file not found: ${privateKeyPath}`);
  }

  cachedEnv = {
    NODE_ENV: process.env.NODE_ENV?.trim() || "development",
    NOTION_TOKEN: requireEnv("NOTION_TOKEN"),
    NOTION_USERS_DATA_SOURCE_ID: requireEnv("NOTION_USERS_DATA_SOURCE_ID"),
    NOTION_POLICIES_DATA_SOURCE_ID: requireEnv("NOTION_POLICIES_DATA_SOURCE_ID"),
    NOTION_RESOURCES_DATA_SOURCE_ID: requireEnv("NOTION_RESOURCES_DATA_SOURCE_ID"),
    NOTION_ACCESS_TRACKING_DATA_SOURCE_ID: requireEnv("NOTION_ACCESS_TRACKING_DATA_SOURCE_ID"),
    GITHUB_APP_ID: requireEnv("GITHUB_APP_ID"),
    GITHUB_INSTALLATION_ID: requireEnv("GITHUB_INSTALLATION_ID"),
    GITHUB_PRIVATE_KEY_PATH: privateKeyPath,
    GITHUB_ORG: requireEnv("GITHUB_ORG"),
    IAM_ENFORCEMENT_MODE: getEnforcementMode(),
    PROJECT_ROOT,
  };

  return cachedEnv;
}

/**
 * observe | enforce | unset
 * Unset preserves current reconciliation (grants still run; GitHub revocation
 * is not implemented). Set observe during legacy import so destructive
 * revocation cannot run if it is added later.
 */
export function getEnforcementMode() {
  const raw = process.env.IAM_ENFORCEMENT_MODE?.trim().toLowerCase() || "";
  if (!raw) {
    return "unset";
  }
  if (raw === "observe" || raw === "enforce") {
    return raw;
  }
  throw new Error(
    `Invalid IAM_ENFORCEMENT_MODE="${process.env.IAM_ENFORCEMENT_MODE}". Use observe or enforce.`,
  );
}

export function allowsDestructiveRevocation() {
  return getEnforcementMode() !== "observe";
}

function optionalEnv(name) {
  return process.env[name]?.trim() || "";
}

export function getSlackEnv() {
  return {
    SLACK_BOT_TOKEN: requireEnv("SLACK_BOT_TOKEN"),
    SLACK_APP_TOKEN: requireEnv("SLACK_APP_TOKEN"),
    SLACK_SIGNING_SECRET: requireEnv("SLACK_SIGNING_SECRET"),
  };
}

export function getOptionalSlackBotToken() {
  return optionalEnv("SLACK_BOT_TOKEN");
}

export function getRequiredSlackBotToken() {
  return requireEnv("SLACK_BOT_TOKEN");
}

export function getGoogleEnv() {
  return {
    clientId: optionalEnv("GOOGLE_CLIENT_ID"),
    clientSecret: optionalEnv("GOOGLE_CLIENT_SECRET"),
    refreshToken: optionalEnv("GOOGLE_REFRESH_TOKEN"),
    redirectUri: optionalEnv("GOOGLE_REDIRECT_URI") || "http://127.0.0.1:53682/oauth2/callback",
  };
}

export function isGoogleConfigured() {
  const google = getGoogleEnv();
  return Boolean(google.clientId && google.clientSecret && google.refreshToken);
}

export function getNotionWorkspaceInviteUrl() {
  return optionalEnv("NOTION_WORKSPACE_INVITE_URL");
}

export function getGitHubPrivateKey() {
  const env = getEnv();
  return readFileSync(env.GITHUB_PRIVATE_KEY_PATH, "utf8");
}

export function isDebugEnabled() {
  return process.env.DEBUG === "1" || process.env.DEBUG === "true";
}
