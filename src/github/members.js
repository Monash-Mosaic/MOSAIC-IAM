import { getEnv } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { getGitHubClient } from "./client.js";

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

export async function findMemberByEmail(email, knownLogin) {
  const octokit = await getGitHubClient();

  if (knownLogin) {
    const membership = await getOrgMembership(knownLogin);
    if (membership?.state === "active") {
      return { login: knownLogin, membership };
    }
  }

  const members = await listOrgMembers();
  const normalized = email.trim().toLowerCase();

  for (const member of members) {
    try {
      const { data: user } = await octokit.rest.users.getByUsername({
        username: member.login,
      });
      if (user.email?.trim().toLowerCase() === normalized) {
        const membership = await getOrgMembership(member.login);
        if (membership?.state === "active") {
          return { login: member.login, membership };
        }
      }
    } catch (error) {
      logger.debug("[GITHUB]", `Could not inspect member ${member.login}: ${error.message}`);
    }
  }

  return null;
}

const profileCache = new Map();

export async function getGitHubUserProfile(login) {
  const key = String(login ?? "").trim().toLowerCase();
  if (!key) {
    return null;
  }
  if (profileCache.has(key)) {
    return profileCache.get(key);
  }
  const octokit = await getGitHubClient();
  try {
    const { data } = await octokit.rest.users.getByUsername({ username: login });
    profileCache.set(key, data);
    return data;
  } catch (error) {
    logger.debug("[GITHUB]", `Could not load GitHub profile ${login}: ${error.message}`);
    profileCache.set(key, null);
    return null;
  }
}
