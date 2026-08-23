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
    PROJECT_ROOT,
  };

  return cachedEnv;
}

export function getGitHubPrivateKey() {
  const env = getEnv();
  return readFileSync(env.GITHUB_PRIVATE_KEY_PATH, "utf8");
}

export function isDebugEnabled() {
  return process.env.DEBUG === "1" || process.env.DEBUG === "true";
}
