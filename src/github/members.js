import { getEnv } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { getGitHubClient } from "./client.js";
import { getTeamMembership } from "./teams.js";

export function normalizeGithubLogin(value) {
  let login = String(value ?? "").trim();
  if (!login) {
    return null;
  }
  login = login.replace(/^https?:\/\/(www\.)?github\.com\//i, "");
  login = login.replace(/^@/, "").split("/")[0].trim();
  return login || null;
}

export async function listOrgMembers() {
  const env = getEnv();
  const octokit = await getGitHubClient();
  return octokit.paginate(octokit.rest.orgs.listMembers, {
    org: env.GH_ORG,
    per_page: 100,
  });
}

export async function getOrgMembership(username) {
  const env = getEnv();
  const octokit = await getGitHubClient();
  try {
    const { data } = await octokit.rest.orgs.getMembershipForUser({
      org: env.GH_ORG,
      username,
    });
    return data;
  } catch (error) {
    if (error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function findTeamMemberByUsername({ teamSlug, username }) {
  const login = normalizeGithubLogin(username);
  if (!login) {
    return null;
  }
  const membership = await getTeamMembership({ teamSlug, username: login });
  if (membership?.state === "active" || membership?.state === "pending") {
    return { login, membership };
  }
  return null;
}

const profileCache = new Map();

export async function getGitHubUserProfile(login) {
  const key = normalizeGithubLogin(login)?.toLowerCase() ?? "";
  if (!key) {
    return null;
  }
  if (profileCache.has(key)) {
    return profileCache.get(key);
  }
  const octokit = await getGitHubClient();
  try {
    const { data } = await octokit.rest.users.getByUsername({ username: key });
    profileCache.set(key, data);
    return data;
  } catch (error) {
    logger.debug("[GITHUB]", `Could not load GitHub profile ${login}: ${error.message}`);
    profileCache.set(key, null);
    return null;
  }
}
