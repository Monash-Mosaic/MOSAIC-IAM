import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getEnv } from "../config/env.js";
import { logger } from "../utils/logger.js";

export function loadGitHubMigrationMapping() {
  const env = getEnv();
  const filePath = path.join(env.PROJECT_ROOT, "migration", "github-users.json");
  if (!existsSync(filePath)) {
    return new Map();
  }
  const raw = JSON.parse(readFileSync(filePath, "utf8"));
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Invalid GitHub migration mapping at ${filePath}; expected { "login": "email" }`);
  }
  const map = new Map();
  for (const [login, email] of Object.entries(raw)) {
    const key = String(login ?? "").trim().toLowerCase();
    const value = String(email ?? "").trim().toLowerCase();
    if (!key || !value) {
      continue;
    }
    map.set(key, value);
  }
  logger.info("[GITHUB]", `Loaded ${map.size} GitHub migration mapping(s) from migration/github-users.json`);
  return map;
}

export function mapGitHubLoginToUser({ login, email }, users, migrationMap) {
  const loginKey = String(login ?? "").trim().toLowerCase();
  const githubEmail = String(email ?? "").trim().toLowerCase();

  if (githubEmail) {
    const user = users.find((item) => item.email === githubEmail);
    if (user) {
      return { user, method: "email" };
    }
  }

  const byUsername = users.find(
    (item) => String(item.githubUsername ?? "").trim().toLowerCase() === loginKey,
  );
  if (byUsername) {
    return { user: byUsername, method: "githubUsername" };
  }

  const mappedEmail = migrationMap.get(loginKey);
  if (mappedEmail) {
    const user = users.find((item) => item.email === mappedEmail);
    if (user) {
      return { user, method: "migration" };
    }
    logger.warn(
      "[GITHUB]",
      `Migration mapping for ${login} points to ${mappedEmail}, but no IAM user exists for that email.`,
    );
    return { user: null, method: "migration-missing-user" };
  }

  return { user: null, method: "unresolved" };
}
