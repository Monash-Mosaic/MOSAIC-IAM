import { getAllUsers } from "../notion/users.js";
import { getEnv } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { getGitHubClient } from "./client.js";
import { isTeamMember, listTeamMembers } from "./teams.js";

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

async function scanMembersForEmail(members, normalizedEmail) {
  const octokit = await getGitHubClient();
  for (const member of members) {
    try {
      const { data: user } = await octokit.rest.users.getByUsername({
        username: member.login,
      });
      if (user.email?.trim().toLowerCase() !== normalizedEmail) {
        continue;
      }
      const membership = await getOrgMembership(member.login);
      if (membership?.state === "active") {
        return { login: member.login, membership };
      }
    } catch (error) {
      logger.debug("[GITHUB]", `Could not inspect member ${member.login}: ${error.message}`);
    }
  }
  return null;
}

async function uniqueTeamMemberLogins(teamSlugs) {
  const seen = new Set();
  for (const teamSlug of teamSlugs) {
    const members = await listTeamMembers({ teamSlug });
    for (const member of members) {
      seen.add(member.login);
    }
  }
  return [...seen].map((login) => ({ login }));
}

export async function findMemberByEmail(email, knownLogin, { teamSlugs = [] } = {}) {
  if (knownLogin) {
    const membership = await getOrgMembership(knownLogin);
    if (membership?.state === "active") {
      return { login: knownLogin, membership };
    }
  }

  const normalized = email.trim().toLowerCase();
  if (teamSlugs.length) {
    const teamMembers = await uniqueTeamMemberLogins(teamSlugs);
    const fromTeams = await scanMembersForEmail(teamMembers, normalized);
    if (fromTeams) {
      return fromTeams;
    }
  }

  const members = await listOrgMembers();
  return scanMembersForEmail(members, normalized);
}

export async function findProbableMemberForUser(user, teamSlugs) {
  if (!teamSlugs.length || !user?.email) {
    return null;
  }

  const normalizedEmail = user.email.trim().toLowerCase();
  const iamUsers = await getAllUsers();
  const roster = await listTeamMembers({ teamSlug: teamSlugs[0] });
  const probable = [];

  for (const member of roster) {
    const membership = await getOrgMembership(member.login);
    if (membership?.state !== "active") {
      continue;
    }

    let onAllTeams = true;
    for (const teamSlug of teamSlugs) {
      if (!(await isTeamMember({ teamSlug, username: member.login }))) {
        onAllTeams = false;
        break;
      }
    }
    if (!onAllTeams) {
      continue;
    }

    const profile = await getGitHubUserProfile(member.login);
    if (profile?.email?.trim().toLowerCase() === normalizedEmail) {
      return { login: member.login, membership };
    }

    const loginTaken = iamUsers.some(
      (item) =>
        item.pageId !== user.pageId &&
        String(item.githubUsername ?? "").trim().toLowerCase() === member.login.toLowerCase(),
    );
    if (!loginTaken) {
      probable.push({ login: member.login, membership });
    }
  }

  if (probable.length === 1) {
    logger.info(
      "[GITHUB]",
      `Resolved probable GitHub member ${probable[0].login} for ${user.email} via team roster`,
    );
    return probable[0];
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
