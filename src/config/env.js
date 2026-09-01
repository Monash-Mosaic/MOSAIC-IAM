import { createPrivateKey } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const WORKER_BINDING_KEYS = [
  "NODE_ENV",
  "DEBUG",
  "IAM_ENFORCEMENT_MODE",
  "NOTION_TOKEN",
  "NOTION_USERS_DATA_SOURCE_ID",
  "NOTION_POLICIES_DATA_SOURCE_ID",
  "NOTION_RESOURCES_DATA_SOURCE_ID",
  "NOTION_WORKSPACE_INVITE_URL",
  "FIGMA_INVITE_URL",
  "GH_APP_ID",
  "GH_INSTALLATION_ID",
  "GH_PRIVATE_KEY",
  "GH_PRIVATE_KEY_PATH",
  "GH_ORG",
  "SLACK_BOT_TOKEN",
  "SLACK_APP_TOKEN",
  "SLACK_SIGNING_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REFRESH_TOKEN",
  "GOOGLE_REDIRECT_URI",
];

const REQUIRED_ENV = [
  "NOTION_TOKEN",
  "NOTION_USERS_DATA_SOURCE_ID",
  "NOTION_POLICIES_DATA_SOURCE_ID",
  "NOTION_RESOURCES_DATA_SOURCE_ID",
  "GH_APP_ID",
  "GH_INSTALLATION_ID",
  "GH_ORG",
];

function isCloudflareWorkerRuntime() {
  return globalThis.navigator?.userAgent === "Cloudflare-Workers";
}

function resolveProjectRoot() {
  if (isCloudflareWorkerRuntime()) {
    return "/";
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

const PROJECT_ROOT = resolveProjectRoot();

if (!isCloudflareWorkerRuntime()) {
  dotenv.config({ path: path.join(PROJECT_ROOT, ".env") });
}

let cachedEnv;

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name) {
  return process.env[name]?.trim() || "";
}

function resolvePrivateKeyPath(configuredPath) {
  if (path.isAbsolute(configuredPath)) {
    return configuredPath;
  }
  return path.resolve(PROJECT_ROOT, configuredPath);
}

function normalizePem(value) {
  let key = String(value).trim();
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1);
  }
  if (!key.includes("\n")) {
    key = key.replace(/\\n/g, "\n");
  }
  return key;
}

/** GitHub App JWT libs require PKCS#8; GitHub-issued keys are often PKCS#1. */
function normalizeGitHubPrivateKey(value) {
  const pem = normalizePem(value);
  if (!pem.includes("BEGIN RSA PRIVATE KEY")) {
    return pem;
  }
  const key = createPrivateKey({ key: pem, format: "pem", type: "pkcs1" });
  return key.export({ type: "pkcs8", format: "pem" });
}

function resolveGitHubPrivateKeyConfig() {
  const inline = optionalEnv("GH_PRIVATE_KEY");
  const configuredPath = optionalEnv("GH_PRIVATE_KEY_PATH");
  if (inline) {
    return { GH_PRIVATE_KEY_PATH: "", hasInlinePrivateKey: true };
  }
  if (!configuredPath) {
    throw new Error(
      "Missing required environment variable: GH_PRIVATE_KEY or GH_PRIVATE_KEY_PATH",
    );
  }
  const privateKeyPath = resolvePrivateKeyPath(configuredPath);
  if (!isCloudflareWorkerRuntime() && !existsSync(privateKeyPath)) {
    throw new Error(`GitHub App private key file not found: ${privateKeyPath}`);
  }
  return { GH_PRIVATE_KEY_PATH: privateKeyPath, hasInlinePrivateKey: false };
}

/**
 * Copy Cloudflare Worker bindings onto process.env so local and production
 * code share the same env accessors. Bindings are a proxy — read known keys.
 */
export function applyWorkerBindings(bindings) {
  if (!bindings) {
    return;
  }
  for (const key of WORKER_BINDING_KEYS) {
    const value = bindings[key];
    if (typeof value === "string") {
      process.env[key] = value;
    }
  }
  cachedEnv = undefined;
}

export function getEnv() {
  if (cachedEnv) {
    return cachedEnv;
  }

  for (const name of REQUIRED_ENV) {
    requireEnv(name);
  }

  const privateKey = resolveGitHubPrivateKeyConfig();

  cachedEnv = {
    NODE_ENV: process.env.NODE_ENV?.trim() || "development",
    NOTION_TOKEN: requireEnv("NOTION_TOKEN"),
    NOTION_USERS_DATA_SOURCE_ID: requireEnv("NOTION_USERS_DATA_SOURCE_ID"),
    NOTION_POLICIES_DATA_SOURCE_ID: requireEnv("NOTION_POLICIES_DATA_SOURCE_ID"),
    NOTION_RESOURCES_DATA_SOURCE_ID: requireEnv("NOTION_RESOURCES_DATA_SOURCE_ID"),
    GH_APP_ID: requireEnv("GH_APP_ID"),
    GH_INSTALLATION_ID: requireEnv("GH_INSTALLATION_ID"),
    GH_PRIVATE_KEY_PATH: privateKey.GH_PRIVATE_KEY_PATH,
    GH_ORG: requireEnv("GH_ORG"),
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

export function getSlackEnv() {
  return {
    ...getSlackHttpEnv(),
    SLACK_APP_TOKEN: requireEnv("SLACK_APP_TOKEN"),
  };
}

export function getSlackHttpEnv() {
  return {
    SLACK_BOT_TOKEN: requireEnv("SLACK_BOT_TOKEN"),
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

export function getFigmaInviteUrl() {
  return optionalEnv("FIGMA_INVITE_URL");
}

export function getGitHubPrivateKey() {
  const inline = optionalEnv("GH_PRIVATE_KEY");
  if (inline) {
    return normalizeGitHubPrivateKey(inline);
  }
  const env = getEnv();
  if (!env.GH_PRIVATE_KEY_PATH) {
    throw new Error(
      "Missing required environment variable: GH_PRIVATE_KEY or GH_PRIVATE_KEY_PATH",
    );
  }
  return normalizeGitHubPrivateKey(readFileSync(env.GH_PRIVATE_KEY_PATH, "utf8"));
}

export function isDebugEnabled() {
  return process.env.DEBUG === "1" || process.env.DEBUG === "true";
}
