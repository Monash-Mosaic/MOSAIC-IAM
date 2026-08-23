import { getEnv } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { getGitHubClient } from "./client.js";

export async function listOrgMembers() {
  const env = getEnv();
  const octokit = await getGitHubClient();
  return octokit.paginate(octokit.rest.orgs.listMembers, {
    org: env.GITHUB_ORG,
    per_page: 100,
  });
}

export async function getOrgMembership(username) {
  const env = getEnv();
  const octokit = await getGitHubClient();
  try {
    const { data } = await octokit.rest.orgs.getMembershipForUser({
      org: env.GITHUB_ORG,
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
